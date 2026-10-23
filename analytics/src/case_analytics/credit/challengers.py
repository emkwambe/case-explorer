"""Champion/challenger and reject inference (Sprint 12), on the seed-42 application pool, where every
applicant's simulated outcome is known.

The fair-comparison rule: every comparison is against the bureau-score policy (the credit policy's
thresholds reading the bureau FICO the models see), the champion. The as-is policy reads the claimed
FICO, which in this generator equals the true score, so it is reported as a reference only. Expected loss
uses the simulation's true charge-off PD × LGD × EAD; realised 30+ DPD is the simulated outcome. Both
are synthetic truth, used only to evaluate.
"""

from __future__ import annotations

import base64
import hashlib
import math
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

from . import evaluate as ev
from .data import DATA_DIR, Data
from .fairness import CHAMPION
from .models import LOGIT_NAME, XGB_NAME, logistic, logistic_coefficients, predict, xgb

OVERLAY_FRACTIONS = tuple(round(0.01 * i, 2) for i in range(21))
AS_IS = "as_is_policy_reference"
CHALLENGER_A = "challenger_a_xgb_alone"
CHALLENGER_B = "challenger_b_overlay"
METHODS = ("funded_only", "hard_cutoff", "fuzzy", "oracle")


def decisions(seed: int, data: Data) -> pd.DataFrame:
    name = f"decisions-seed-{seed}.csv"
    path = DATA_DIR / name if name in data.manifest["files"] else DATA_DIR / "books" / name
    return pd.read_csv(path, dtype={"decision_claimed": str, "decision_bureau": str})


def lowest(p: np.ndarray, count: int, eligible: np.ndarray | None = None) -> np.ndarray:
    """A mask of the `count` lowest-PD rows (among `eligible`), ties broken by pool order."""
    idx = np.arange(len(p)) if eligible is None else np.flatnonzero(eligible)
    pick = idx[np.argsort(p[idx], kind="mergesort")[:count]]
    out = np.zeros(len(p), dtype=bool)
    out[pick] = True
    return out


class Infeasible(ValueError):
    """The overlay fraction asks for more non-fraud reviews than the book holds."""


def overlay(
    champion: np.ndarray, review: np.ndarray, fraud: np.ndarray, p: np.ndarray, f: float
) -> np.ndarray:
    """Challenger B: the champion's approvals minus its k highest-PD approvals, plus the k lowest-PD
    champion reviews that are not fraud referrals; k = round(f × approvals). Volume is unchanged."""
    k = int(round(f * int(champion.sum())))
    if k == 0:
        return champion.copy()
    approved = np.flatnonzero(champion)
    drop = approved[np.argsort(-p[approved], kind="mergesort")[:k]]
    candidates = review & ~fraud
    add = lowest(p, k, candidates)
    if int(add.sum()) < k:
        raise Infeasible(f"overlay: only {int(add.sum())} non-fraud reviews for k = {k}")
    out = champion.copy()
    out[drop] = False
    return out | add


def tune_overlay(books: list[tuple[pd.DataFrame, pd.DataFrame]], score, lgd: float) -> dict[str, Any]:
    """Choose f on the calibration books by total expected loss; ties go to the smaller f. A fraction
    that needs more non-fraud reviews than a book holds is recorded as infeasible and not chosen."""
    scored = [(frame, dec, score(frame)) for frame, dec in books]
    rows: list[dict[str, Any]] = []
    for f in OVERLAY_FRACTIONS:
        total: float | None = 0.0
        for frame, dec, p in scored:
            champ = dec["decision_bureau"].to_numpy() == "APPROVE"
            review = dec["decision_bureau"].to_numpy() == "REVIEW"
            fraud = dec["fraud_review"].to_numpy() == 1
            el = (frame["pd_chargeoff"] * lgd * frame["ead"]).to_numpy()
            try:
                total = (total or 0.0) + float(el[overlay(champ, review, fraud, p, f)].sum())
            except Infeasible:
                total = None
                break
        rows.append({"f": f, "expected_loss": total, "feasible": total is not None})
    best = min((r for r in rows if r["feasible"]), key=lambda r: (round(r["expected_loss"], 6), r["f"]))
    return {
        "grid": rows,
        "chosen_f": best["f"],
        "criterion": "lowest total expected loss on the calibration books; ties to the smaller f; infeasible fractions excluded",
    }


def bitmask(mask: np.ndarray) -> str:
    """Approvals over the pool order as base64 of the bits, most significant first (numpy packbits)."""
    return base64.b64encode(np.packbits(mask.astype(np.uint8)).tobytes()).decode("ascii")


def pool_hash(ids: np.ndarray) -> str:
    return hashlib.sha256("\n".join(map(str, ids)).encode("utf-8")).hexdigest()


def difference_ci(
    a: np.ndarray, c: np.ndarray, value: np.ndarray, n: int = ev.BOOTSTRAPS
) -> dict[str, float]:
    """Challenger minus champion of a total (Σ value over approvals), with a percentile 95% interval
    from paired bootstrap resamples of the pool's applications (fixed seed)."""
    d = (a.astype(float) - c.astype(float)) * value
    rng = np.random.default_rng(ev.BOOTSTRAP_SEED)
    m = len(d)
    draws = np.array([d[rng.integers(0, m, m)].sum() for _ in range(n)])
    return {
        "point": float(d.sum()),
        "low": float(np.percentile(draws, 2.5)),
        "high": float(np.percentile(draws, 97.5)),
    }


def policy_row(mask: np.ndarray, champion: np.ndarray, el: np.ndarray, dpd: np.ndarray) -> dict[str, Any]:
    n = int(mask.sum())
    row: dict[str, Any] = {
        "approvals": n,
        "expected_loss": float(el[mask].sum()),
        "dpd30": int(dpd[mask].sum()),
        "dpd30_rate": float(dpd[mask].mean()),
        "loss_per_approved_loan": float(el[mask].sum() / n),
        "swap_in": int((mask & ~champion).sum()),
        "swap_out": int((champion & ~mask).sum()),
    }
    if n == int(champion.sum()):
        row["difference_vs_champion"] = {
            "expected_loss": difference_ci(mask, champion, el),
            "dpd30": difference_ci(mask, champion, dpd.astype(float)),
        }
    return row


def champion_challenger(
    data: Data, model: Any, lgd: float, log=print
) -> tuple[dict[str, Any], dict[str, Any]]:
    """The comparison block and the Sandbox's approval bitmasks."""
    pool = data.frame([data.test], funded_only=False)
    dec = decisions(data.test.seed, data)
    if not np.array_equal(dec["application_id"].to_numpy(), pool["application_id"].to_numpy()):
        raise ValueError("decisions are not aligned with the seed-42 pool")
    p = predict(model, data.X(pool))
    el = (pool["pd_chargeoff"] * lgd * pool["ead"]).to_numpy()
    dpd = pool["dpd30"].to_numpy(dtype=int)
    champion = dec["decision_bureau"].to_numpy() == "APPROVE"
    review = dec["decision_bureau"].to_numpy() == "REVIEW"
    fraud = dec["fraud_review"].to_numpy() == 1
    n = int(champion.sum())

    cal = [(data.frame([b], funded_only=False), decisions(b.seed, data)) for b in data.calibration]
    tuning = tune_overlay(cal, lambda frame: predict(model, data.X(frame)), lgd)
    f = tuning["chosen_f"]
    k = int(round(f * n))
    log(f"  overlay: f = {f} (k = {k}) chosen on the calibration books")

    a_mask = lowest(p, n)
    b_mask = overlay(champion, review, fraud, p, f)
    as_is = dec["decision_claimed"].to_numpy() == "APPROVE"
    rows = {
        CHAMPION: policy_row(champion, champion, el, dpd),
        CHALLENGER_A: policy_row(a_mask, champion, el, dpd),
        CHALLENGER_B: policy_row(b_mask, champion, el, dpd),
        AS_IS: policy_row(as_is, champion, el, dpd),
    }
    swap_in_b = b_mask & ~champion
    rows[CHALLENGER_B]["rule"] = {
        "f": f,
        "k": k,
        "dropped": f"the {k} champion approvals with the highest credit_pd_xgb PD",
        "added": f"the {k} champion reviews with the lowest credit_pd_xgb PD, excluding fraud referrals",
        "drop_pd_at_least": float(p[champion & ~b_mask].min()) if k else None,
        "add_pd_at_most": float(p[swap_in_b].max()) if k else None,
    }
    rows[CHALLENGER_A]["swap_in_by_champion_decision"] = {
        d: int((a_mask & ~champion & (dec["decision_bureau"].to_numpy() == d)).sum())
        for d in ("REVIEW", "DECLINE")
    }
    rows[CHALLENGER_A]["swap_in_fraud_referrals"] = int((a_mask & ~champion & fraud).sum())
    fraud_true = pool["fraud_true"].to_numpy() == 1
    for name, mask in (
        (CHAMPION, champion),
        (CHALLENGER_A, a_mask),
        (CHALLENGER_B, b_mask),
        (AS_IS, as_is),
    ):
        rows[name]["fraud_approved"] = int((mask & fraud_true).sum())
    block: dict[str, Any] = {
        "champion": CHAMPION,
        "fair_comparison_rule": (
            "every challenger is compared with the bureau-score policy at its approval count; the as-is policy reads "
            "the claimed FICO, which in this generator equals the true score, so it is a reference only"
        ),
        "applications": len(pool),
        "lgd": lgd,
        "policies": rows,
        "overlay_tuning": tuning,
        "labels": {
            CHAMPION: "Champion: bureau-score policy",
            CHALLENGER_A: "Challenger A: credit_pd_xgb alone, lowest PD up to the champion's count",
            CHALLENGER_B: "Challenger B: the policy with a credit_pd_xgb overlay",
            AS_IS: "As-is policy (claimed FICO): sees the true score; not a fair benchmark",
        },
    }
    ids = pool["application_id"].to_numpy()
    sandbox = {
        "label": "model-based, evaluation only",
        "pool_applications": len(ids),
        "pool_sha256": pool_hash(ids),
        "encoding": "base64 of numpy.packbits over the pool order (most significant bit first); 1 = approve",
        "candidates": {
            name: {"label": block["labels"][name], "approvals": int(mask.sum()), "bitmask": bitmask(mask)}
            for name, mask in ((CHAMPION, champion), (CHALLENGER_A, a_mask), (CHALLENGER_B, b_mask))
        },
    }
    return block, sandbox


def fico_effect(model: Any, X: pd.DataFrame, sd: float) -> float:
    """Mean change in log-odds for one standard deviation more bureau FICO, over the rows of X. For the
    logistic model this is its coefficient per SD; for XGBoost it is the same quantity, read off the trees."""
    up = X.copy()
    up["fico_bureau"] = up["fico_bureau"] + sd
    p0 = np.clip(predict(model, X), 1e-9, 1 - 1e-9)
    p1 = np.clip(predict(model, up), 1e-9, 1 - 1e-9)
    return float(np.nanmean(np.log(p1 / (1 - p1)) - np.log(p0 / (1 - p0))))


def augmented_sets(data: Data, base: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Training sets per method and family, built from the training books only."""
    train_all = data.frame(data.training, funded_only=False)
    funded = (train_all["funded"] == 1).to_numpy()
    X_all, y_all = data.X(train_all), data.y(train_all)
    Xf, yf = X_all[funded], y_all[funded]
    Xr = X_all[~funded]
    sets: dict[str, dict[str, Any]] = {}
    for family, model in base.items():
        pr = predict(model, Xr)
        m = int(math.ceil(float(pr.sum())))
        hard = np.zeros(len(pr), dtype=int)
        hard[np.argsort(-pr, kind="mergesort")[:m]] = 1
        sets[family] = {
            "hard_cutoff": {
                "X": pd.concat([Xf, Xr], ignore_index=True),
                "y": np.concatenate([yf, hard]),
                "w": None,
                "ids": np.concatenate(
                    [
                        train_all["application_id"].to_numpy()[funded],
                        train_all["application_id"].to_numpy()[~funded],
                    ]
                ),
                "rejects_labelled_default": m,
                "cutoff_pd": float(np.sort(pr)[::-1][m - 1]) if m else None,
            },
            "fuzzy": {
                "X": pd.concat([Xf, Xr, Xr], ignore_index=True),
                "y": np.concatenate([yf, np.ones(len(pr), dtype=int), np.zeros(len(pr), dtype=int)]),
                "w": np.concatenate([np.ones(len(yf)), pr, 1 - pr]),
                "ids": np.concatenate(
                    [
                        train_all["application_id"].to_numpy()[funded],
                        train_all["application_id"].to_numpy()[~funded],
                        train_all["application_id"].to_numpy()[~funded],
                    ]
                ),
                "expected_reject_defaults": float(pr.sum()),
            },
            "oracle": {"X": X_all, "y": y_all, "w": None, "ids": train_all["application_id"].to_numpy()},
        }
    return sets


def fit(
    family: str,
    params: dict[str, Any],
    monotone: tuple[int, ...],
    X: pd.DataFrame,
    y: np.ndarray,
    w: np.ndarray | None,
) -> Any:
    if family == LOGIT_NAME:
        model = logistic(**params)
        return model.fit(X, y, **({"lr__sample_weight": w} if w is not None else {}))
    model = xgb(monotone, **params)
    return model.fit(X, y, **({"sample_weight": w} if w is not None else {}))


def reject_inference(
    data: Data, base: dict[str, Any], params: dict[str, dict[str, Any]], lgd: float, log=print
) -> dict[str, Any]:
    """Funded-only (the Sprint 11 models), hard cut-off and fuzzy augmentation, and the oracle, for both
    families, scored on the seed-42 pool. The share of the funded-only-to-oracle gap each method closes."""
    pool = data.frame([data.test], funded_only=False)
    Xp, yp = data.X(pool), data.y(pool)
    declined = (pool["funded"] == 0).to_numpy()
    el = (pool["pd_chargeoff"] * lgd * pool["ead"]).to_numpy()
    champ = decisions(data.test.seed, data)["decision_bureau"].to_numpy() == "APPROVE"
    n = int(champ.sum())
    test_funded = data.frame([data.test])
    sd = float(data.X(data.frame(data.training))["fico_bureau"].std(ddof=0))
    sets = augmented_sets(data, base)
    seed42 = set(pool["application_id"])
    out: dict[str, Any] = {
        "approval_count": n,
        "fico_effect_definition": "mean change in log-odds for +1 SD of bureau FICO (training funded SD), over the seed-42 pool",
        "fico_sd": sd,
        "families": {},
        "training_sets": {},
    }
    for family, model0 in base.items():
        models = {"funded_only": model0}
        shapes: dict[str, Any] = {}
        for method in ("hard_cutoff", "fuzzy", "oracle"):
            s = sets[family][method]
            if seed42 & set(s["ids"]):
                raise ValueError(f"{family} {method}: a seed-42 application is in the training set")
            models[method] = fit(family, params[family], data.spec.monotone, s["X"], s["y"], s["w"])
            shapes[method] = {
                "rows": len(s["y"]),
                "defaults": int(s["y"].sum()) if s["w"] is None else None,
                "weighted_defaults": float(np.sum(s["y"] * s["w"])) if s["w"] is not None else None,
                "weighted_rows": float(np.sum(s["w"])) if s["w"] is not None else None,
                **{k: v for k, v in s.items() if k not in ("X", "y", "w", "ids")},
            }
            log(f"  reject inference {family} {method}: {len(s['y'])} rows")
        rows: dict[str, Any] = {}
        for method, model in models.items():
            p = predict(model, Xp)
            row: dict[str, Any] = {
                "auc_all_applications": float(roc_auc_score(yp, p)),
                "auc_not_funded": float(roc_auc_score(yp[declined], p[declined])),
                "auc_funded_test_book": float(
                    roc_auc_score(data.y(test_funded), predict(model, data.X(test_funded)))
                ),
                "fico_effect_per_sd": fico_effect(model, Xp, sd),
                "expected_loss_at_champion_count": float(el[lowest(p, n)].sum()),
            }
            if family == LOGIT_NAME:
                row["fico_coefficient_per_sd"] = logistic_coefficients(model, data.spec.features)[
                    "fico_bureau"
                ]
            rows[method] = row
        f0, orc = rows["funded_only"], rows["oracle"]
        for method in ("hard_cutoff", "fuzzy"):
            r = rows[method]
            r["gap_closed"] = {
                k: (r[k] - f0[k]) / (orc[k] - f0[k]) if orc[k] != f0[k] else None
                for k in ("expected_loss_at_champion_count", "auc_all_applications", "auc_not_funded")
            }
        out["families"][family] = rows
        out["training_sets"][family] = shapes
    train_all = data.frame(data.training, funded_only=False)
    out["training_books"] = {
        "seeds": [b.seed for b in data.training],
        "applications": len(train_all),
        "funded": int((train_all["funded"] == 1).sum()),
        "not_funded": int((train_all["funded"] == 0).sum()),
        "funded_defaults": int(train_all.loc[train_all["funded"] == 1, "dpd30"].sum()),
        "all_defaults": int(train_all["dpd30"].sum()),
    }
    out["champion_expected_loss"] = float(el[champ].sum())
    return out


__all__ = ["CHALLENGER_A", "CHALLENGER_B", "METHODS", "XGB_NAME", "champion_challenger", "reject_inference"]

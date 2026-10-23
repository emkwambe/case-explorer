"""Train, calibrate and evaluate the credit PD models, and write the snapshot the app reads.

    python -m case_analytics.credit.pipeline [--out DIR]

Steps: verify the data against its manifest; tune both models by cross-validation over whole
training books (the test book plays no part); refit on all training books; check calibration on the
calibration books and recalibrate only if the pre-registered rule says so; evaluate once on the
locked seed-42 test book; compare learned PD with the simulation's true PD; report the policy view;
and train the all-applications diagnostic. Every number in the snapshot comes from this run.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import sys
from functools import partial
from itertools import product
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import log_loss, roc_auc_score
from sklearn.model_selection import GroupKFold

from . import evaluate as ev
from . import reasons as rs
from .data import DATA_DIR, ROOT, Data, load_data
from .models import (
    LOGIT_GRID,
    LOGIT_NAME,
    XGB_FIXED,
    XGB_GRID,
    XGB_NAME,
    logistic,
    logistic_coefficients,
    predict,
    xgb,
)

SNAPSHOT_DIR = ROOT / "artifacts" / "credit-model-snapshot"
SUMMARY = "credit-model-summary.json"
CASES = "credit-model-cases.json"
CV_FOLDS = 4
PACKAGES = ("xgboost", "scikit-learn", "numpy", "pandas", "scipy", "shap")


def rounded(x: Any, digits: int = 6) -> Any:
    """Round every float in a nested structure, so the snapshot text is stable."""
    if isinstance(x, float):
        return round(x, digits) if np.isfinite(x) else None
    if isinstance(x, dict):
        return {k: rounded(v, digits) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [rounded(v, digits) for v in x]
    if isinstance(x, np.floating):
        return rounded(float(x), digits)
    if isinstance(x, np.integer):
        return int(x)
    return x


def grid(space: dict[str, list[Any]]) -> list[dict[str, Any]]:
    keys = list(space)
    return [dict(zip(keys, values)) for values in product(*(space[k] for k in keys))]


def cross_validate(make, X: pd.DataFrame, y: np.ndarray, groups: np.ndarray) -> dict[str, float]:
    """Mean log loss and AUC over folds that each hold out whole training books."""
    losses, aucs = [], []
    for train_idx, valid_idx in GroupKFold(n_splits=CV_FOLDS).split(X, y, groups):
        model = make().fit(X.iloc[train_idx], y[train_idx])
        p = predict(model, X.iloc[valid_idx])
        losses.append(log_loss(y[valid_idx], np.clip(p, 1e-9, 1 - 1e-9)))
        aucs.append(roc_auc_score(y[valid_idx], p))
    return {"log_loss": float(np.mean(losses)), "auc": float(np.mean(aucs))}


def tune(data: Data, log) -> dict[str, Any]:
    train = data.frame(data.training)
    X, y, groups = data.X(train), data.y(train), train["seed"].to_numpy()
    results: dict[str, Any] = {}

    def build_logistic(params: dict[str, Any]) -> Any:
        return logistic(**params)

    def build_xgb(params: dict[str, Any]) -> Any:
        return xgb(data.spec.monotone, **params)

    for name, space, build in ((LOGIT_NAME, LOGIT_GRID, build_logistic), (XGB_NAME, XGB_GRID, build_xgb)):
        rows = []
        for params in grid(space):
            score = cross_validate(partial(build, params), X, y, groups)
            rows.append({"params": params, **score})
            log(f"  {name} {params}: log loss {score['log_loss']:.6f}, AUC {score['auc']:.4f}")
        best = min(rows, key=lambda r: (r["log_loss"], json.dumps(r["params"], sort_keys=True)))
        results[name] = {
            "grid": space,
            "results": rows,
            "winner": best["params"],
            "criterion": "lowest mean cross-validated log loss",
        }
    return results


def calibration_report(y: np.ndarray, p: np.ndarray, truth: np.ndarray | None = None) -> dict[str, Any]:
    table = ev.deciles(y, p, truth)
    return {
        "metrics": ev.metrics(y, p),
        "deciles": table,
        "trigger": ev.calibration_needed(table, float(np.mean(p)), float(np.mean(y))),
    }


def test_report(
    y: np.ndarray, p: np.ndarray, truth: np.ndarray, truth_no_dealer: np.ndarray
) -> dict[str, Any]:
    ci = ev.bootstrap_ci(
        y,
        p,
        {
            "auc": lambda a, b: float(roc_auc_score(a, b)),
            "ks": ev.ks,
            "brier": lambda a, b: float(np.mean((b - a) ** 2)),
        },
    )
    return {
        "metrics": ev.metrics(y, p),
        "ci95": ci,
        "calibration_in_the_large": {"mean_predicted": float(np.mean(p)), "observed": float(np.mean(y))},
        "deciles": ev.deciles(y, p, truth),
        "learned_vs_true": ev.learned_vs_true(p, truth),
        "learned_vs_true_without_dealer_term": ev.learned_vs_true(p, truth_no_dealer),
    }


def policy_view(data: Data, scores: dict[str, np.ndarray], lgd: float) -> dict[str, Any]:
    """At the credit policy's approval count on the seed-42 application pool, which applications each
    model would approve instead, and the expected loss of each set (synthetic truth: the simulation's
    charge-off PD × LGD × EAD). Declined applications are outside the training population, so the
    model scores for them are extrapolation. Reported only; the full champion/challenger run is Sprint 12."""
    pool = data.frame([data.test], funded_only=False)
    policy = pool["funded"].to_numpy() == 1
    n = int(policy.sum())
    el = (pool["pd_chargeoff"] * lgd * pool["ead"]).to_numpy()
    out: dict[str, Any] = {
        "applications": len(pool),
        "approvals": n,
        "lgd": lgd,
        "policy_expected_loss": float(el[policy].sum()),
    }
    for name, p in scores.items():
        order = np.argsort(p, kind="mergesort")
        approve = np.zeros(len(p), dtype=bool)
        approve[order[:n]] = True
        swap_in, swap_out = approve & ~policy, policy & ~approve
        out[name] = {
            "swap_in": int(swap_in.sum()),
            "swap_out": int(swap_out.sum()),
            "model_expected_loss": float(el[approve].sum()),
            "swap_in_expected_loss": float(el[swap_in].sum()),
            "swap_out_expected_loss": float(el[swap_out].sum()),
        }
    return out


def data_profile(data: Data) -> dict[str, Any]:
    """The data section's shape before and after: rows, defaults, missing values, feature distributions."""

    def shape(df: pd.DataFrame) -> dict[str, Any]:
        X = data.X(df)
        return {
            "rows": len(df),
            "defaults": int(df["dpd30"].sum()),
            "default_rate": float(df["dpd30"].mean()),
            "missing": {c: int(X[c].isna().sum()) for c in X.columns},
        }

    def dist(df: pd.DataFrame) -> dict[str, Any]:
        X = data.X(df)
        q = X.quantile([0.0, 0.25, 0.5, 0.75, 1.0])
        return {
            c: {
                "min": float(q[c].iloc[0]),
                "p25": float(q[c].iloc[1]),
                "median": float(q[c].iloc[2]),
                "p75": float(q[c].iloc[3]),
                "max": float(q[c].iloc[4]),
                "mean": float(X[c].mean()),
                "nonzero": int((X[c].fillna(0) != 0).sum()),
            }
            for c in X.columns
        }

    all_training = data.frame(data.training, funded_only=False)
    return {
        "before": {
            "training_all_applications": shape(all_training),
            "test_all_applications": shape(data.frame([data.test], funded_only=False)),
        },
        "after": {
            "training": shape(data.frame(data.training)),
            "calibration": shape(data.frame(data.calibration)),
            "test": shape(data.frame([data.test])),
            "diagnostic_training_all_applications": shape(all_training),
        },
        "distributions_training_funded": dist(data.frame(data.training)),
        "seeds": data.manifest["seeds"],
        "books": data.manifest["books"],
    }


def run(out: Path = SNAPSHOT_DIR, log=print) -> dict[str, Any]:
    data = load_data()
    train, cal, test = data.frame(data.training), data.frame(data.calibration), data.frame([data.test])
    Xtr, ytr = data.X(train), data.y(train)
    Xcal, ycal = data.X(cal), data.y(cal)
    Xte, yte = data.X(test), data.y(test)
    truth, truth_nd = test["p_dpd30_true"].to_numpy(), test["p_dpd30_no_dealer"].to_numpy()
    log(
        f"training {len(train)} loans ({int(ytr.sum())} defaults), "
        f"calibration {len(cal)} ({int(ycal.sum())}), test {len(test)} ({int(yte.sum())})"
    )

    tuning = tune(data, log)
    final = {
        LOGIT_NAME: logistic(**tuning[LOGIT_NAME]["winner"]).fit(Xtr, ytr),
        XGB_NAME: xgb(data.spec.monotone, **tuning[XGB_NAME]["winner"]).fit(Xtr, ytr),
    }

    models: dict[str, Any] = {}
    test_scores: dict[str, np.ndarray] = {}
    pool = data.frame([data.test], funded_only=False)
    pool_scores: dict[str, np.ndarray] = {}
    for name, model in final.items():
        before = calibration_report(ycal, predict(model, Xcal))
        iso = None
        if before["trigger"]["needed"]:
            iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(
                predict(model, Xcal), ycal
            )

        def calibrate(q: np.ndarray, iso: IsotonicRegression | None = iso) -> np.ndarray:
            return np.asarray(iso.predict(q), dtype=float) if iso is not None else q

        p_test_raw = predict(model, Xte)
        p_test = calibrate(p_test_raw)
        test_scores[name] = p_test
        pool_scores[name] = calibrate(predict(model, data.X(pool)))
        models[name] = {
            "params": {**(XGB_FIXED if name == XGB_NAME else {}), **tuning[name]["winner"]},
            "calibration_books": {
                "before": before,
                "after": calibration_report(ycal, calibrate(predict(model, Xcal)))
                if iso is not None
                else None,
                "recalibrated": iso is not None,
                "method": "isotonic" if iso is not None else None,
            },
            "test": test_report(yte, p_test, truth, truth_nd),
            "test_uncalibrated": ev.metrics(yte, p_test_raw) if iso is not None else None,
        }
        if name == LOGIT_NAME:
            models[name]["coefficients_per_sd"] = logistic_coefficients(model, data.spec.features)
        log(
            f"  {name}: test AUC {models[name]['test']['metrics']['auc']:.4f}, "
            f"Brier {models[name]['test']['metrics']['brier']:.6f}, recalibrated {iso is not None}"
        )

    ceilings = {
        "true_pd": test_report(yte, truth, truth, truth_nd),
        "true_pd_without_dealer_term": test_report(yte, truth_nd, truth, truth_nd),
        "note": (
            "AUC of the simulation's own probabilities on the test book: the first is the best any model could do; "
            "the second removes the dealer-quality term the model is barred from using, the fair benchmark for a "
            "dealer-blind model."
        ),
    }

    recon = json.loads(
        (ROOT / "data" / "credit-tape" / "credit-tape-reconciliation.json").read_text(encoding="utf-8")
    )
    policy = policy_view(data, pool_scores, float(recon["loans"]["lgd"]))

    # Diagnostic (labelled): the same winning XGBoost settings trained on every application of the
    # training books, which only synthetic data can supply outcomes for.
    all_train = data.frame(data.training, funded_only=False)
    diag = xgb(data.spec.monotone, **tuning[XGB_NAME]["winner"]).fit(data.X(all_train), data.y(all_train))
    p_diag = predict(diag, Xte)
    diagnostic: dict[str, Any] = {
        "label": (
            "diagnostic only, not the headline model: trained on every application of the training books "
            "(funded or not), with outcomes only a simulation can provide"
        ),
        "training_rows": len(all_train),
        "training_defaults": int(data.y(all_train).sum()),
        "test": test_report(yte, p_diag, truth, truth_nd),
        "difference_vs_headline": {
            k: float(ev.metrics(yte, p_diag)[k] - models[XGB_NAME]["test"]["metrics"][k])
            for k in ("auc", "ks", "brier", "log_loss")
        },
    }
    log(f"  diagnostic (all applications): test AUC {diagnostic['test']['metrics']['auc']:.4f}")

    comparison = {
        "xgb_minus_logistic": ev.paired_difference(yte, test_scores[XGB_NAME], test_scores[LOGIT_NAME]),
        "note": (
            "positive AUC difference and negative Brier difference favour credit_pd_xgb; "
            "an interval that contains 0 means the test book cannot tell the models apart"
        ),
    }

    reasons, cases = reason_section(
        data, final[XGB_NAME], diag, tuning[XGB_NAME]["winner"], Xtr, ytr, Xte, test, log
    )

    summary = rounded(
        {
            "snapshot_version": "1.0.0",
            "label": "Second opinion only: the credit policy makes the decision.",
            "target": data.spec.raw["target"],
            "features": data.spec.raw["features"],
            "excluded": data.spec.raw["excluded"],
            "data": data_profile(data),
            "tuning": tuning,
            "models": models,
            "ceilings": ceilings,
            "comparison": comparison,
            "policy_view": policy,
            "diagnostic_all_applications": diagnostic,
            "reasons": reasons,
        }
    )
    write_snapshot(out, {SUMMARY: summary, CASES: rounded(cases)}, data)
    return summary


def teaching_typology(row: pd.Series) -> str | None:
    """Reason-accuracy label for a teaching case: fraud twins by typology, clean twins as the control,
    conflicting cases by their combined typology; other teaching groups are not scored."""
    if row["group"] == "causal-pair":
        return str(row["typology"]) if row["role"] == "fraud" else "NONE"
    if row["group"] == "conflicting":
        return str(row["typology"])
    return None


def reason_section(
    data: Data, model: Any, diag: Any, winner: dict[str, Any], Xtr, ytr, Xte, test: pd.DataFrame, log
) -> tuple[dict[str, Any], dict[str, Any]]:
    spec = data.spec
    values, base = rs.shap_values(model, Xte)
    gm, groups = rs.group_matrix(values, spec)
    top1 = [(rs.top_groups(gm[i], groups, 1) or [""])[0] for i in range(len(Xte))]

    teaching = pd.read_csv(DATA_DIR / "teaching-v1.csv", keep_default_na=False, na_values=[""])
    opening = pd.read_csv(DATA_DIR / "opening-library.csv")
    keep = [teaching_typology(r) is not None for _, r in teaching.iterrows()]
    scored = teaching[keep].reset_index(drop=True)
    labels = [str(teaching_typology(r)) for _, r in scored.iterrows()]
    book_labels = test["corruption_type"].astype(str).tolist()

    def accuracy_for(m: Any) -> dict[str, Any]:
        tv, _ = rs.shap_values(m, data.X(scored))
        bv, _ = rs.shap_values(m, Xte)
        return {
            "teaching_twins_and_conflicting": rs.accuracy(rs.group_matrix(tv, spec)[0], groups, labels),
            "funded_test_book": rs.accuracy(rs.group_matrix(bv, spec)[0], groups, book_labels),
        }

    headline, diagnostic = accuracy_for(model), accuracy_for(diag)

    def diff(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for where in a:
            out[where] = {}
            for t, h in a[where].items():
                keys = (
                    ("top1_blames_discrepancy", "top4_blames_discrepancy")
                    if h.get("control")
                    else ("top1_hits", "top4_hits")
                )
                out[where][t] = {k: b[where][t][k] - h[k] for k in keys}
        return out

    log("  reasons: stability over bootstrap retrains")
    stab = rs.stability(lambda: xgb(spec.monotone, **winner), Xtr, ytr, Xte, spec, top1, predict(model, Xte))

    def case_rows(frame: pd.DataFrame, key: str) -> dict[str, Any]:
        X = data.X(frame)
        v, _ = rs.shap_values(model, X)
        g, _ = rs.group_matrix(v, spec)
        p = predict(model, X)
        return {
            str(frame[key].iloc[i]): {"pd": float(p[i]), "reasons": rs.reasons_for(g[i], groups, spec)}
            for i in range(len(frame))
        }

    reasons = {
        "method": (
            "TreeSHAP (shap.TreeExplainer) on credit_pd_xgb in log-odds; contributions summed by feature group; "
            "up to the top four groups that raise risk become reason statements"
        ),
        "base_value_log_odds": base,
        "additivity": {"rows_checked": len(Xte), "tolerance": rs.ADDITIVITY_TOL, "holds": True},
        "groups": {g: spec.groups[g] for g in groups},
        "global": rs.global_importance(values, spec),
        "top1_distribution_test_book": {g: top1.count(g) for g in [*groups, ""]},
        "stability": stab,
        "expected_group_by_typology": {k: list(v) for k, v in rs.EXPECTED_GROUP.items()},
        "accuracy": {
            "headline": headline,
            "diagnostic_all_applications": diagnostic,
            "diagnostic_minus_headline": diff(headline, diagnostic),
        },
    }
    cases = {
        "label": "Second opinion only: the credit policy makes the decision.",
        "model": XGB_NAME,
        "base_value_log_odds": base,
        "teaching": case_rows(teaching, "teaching_id"),
        "opening_library": case_rows(opening, "case_id"),
    }
    return reasons, cases


def write_snapshot(out: Path, documents: dict[str, Any], data: Data) -> None:
    out.mkdir(parents=True, exist_ok=True)
    texts = {name: json.dumps(doc, indent=1, sort_keys=True) + "\n" for name, doc in documents.items()}
    for name, text in texts.items():
        (out / name).write_text(text, encoding="utf-8", newline="\n")
    manifest_text = (ROOT / "data" / "credit-model" / "manifest.json").read_bytes()
    meta = {
        "produced_by": "python -m case_analytics.credit.pipeline",
        "python": sys.version.split()[0],
        "packages": {p: importlib.metadata.version(p) for p in PACKAGES},
        "data_manifest_sha256": hashlib.sha256(manifest_text).hexdigest(),
        "seeds": data.manifest["seeds"],
        "files": {
            name: {
                "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                "bytes": len(text.encode("utf-8")),
            }
            for name, text in sorted(texts.items())
        },
    }
    (out / "SNAPSHOT.json").write_text(
        json.dumps(meta, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=SNAPSHOT_DIR)
    args = parser.parse_args(argv)
    run(args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

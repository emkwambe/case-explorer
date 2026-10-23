"""Fairness evidence for the credit decision and the credit model (Sprint 12): the counterfactual
flip table (built in JavaScript, scripts/lib/fairness.mjs), approval rates by group, and the proxy check.

Group tables are monitoring evidence on the seed-42 application pool. They are computed for the
bureau-score policy (the champion: the credit policy reading the bureau FICO the models see), for a
credit_pd_xgb cut-off at the same approval count, and for the as-is policy (claimed FICO, which in this
generator equals the true score) as a reference row. They neither establish nor rule out compliance.
Sensitive attributes are read here only, never as model inputs.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold

from .data import DATA_DIR, Data

ATTRIBUTES = (
    "age_band",
    "geography_group",
    "zip3",
    "income_band",
    "persona",
    "regime",
    "family_status_scenario",
    "disability_income_scenario",
)
LEGITIMATE_CREDIT_FACTORS = ("income_band",)
MIN_RATED = 30
ZIP3_TOP = 10
Z95 = float(norm.ppf(0.975))
# A reference line on the AIR, never a pass/fail test: no row is marked against it.
AIR_REFERENCE = 0.80
AIR_REFERENCE_NOTE = (
    "0.80 is the four-fifths screening heuristic from the EEOC's 1978 Uniform Guidelines on employee selection. "
    "It is a common informal screen, not a lending legal standard, and crossing it is not a finding of discrimination."
)
PROXY_FOLDS = 5
PROXY_SEED = 12
PROXY_BOOTSTRAPS = 200
PROXY_NAME_ABOVE = 0.60
PROXY_PARAMS: dict[str, Any] = {
    "max_depth": 2,
    "n_estimators": 100,
    "learning_rate": 0.1,
    "tree_method": "hist",
    "n_jobs": 1,
    "random_state": PROXY_SEED,
}
CHAMPION = "bureau_score_policy"
POLICY_LABELS = {
    CHAMPION: "bureau-score policy (the champion): the credit policy's thresholds on the bureau FICO",
    "credit_pd_xgb_cutoff": "credit_pd_xgb: the lowest-PD applications up to the champion's approval count",
    "as_is_policy_reference": "as-is policy (claimed FICO): sees the true score; not a fair benchmark",
}


def wilson(k: int, n: int, z: float = Z95) -> list[float] | None:
    """Wilson score 95% interval for a proportion k/n."""
    if n == 0:
        return None
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return [float(centre - half), float(centre + half)]


def katz(k1: int, n1: int, k0: int, n0: int, z: float = Z95) -> list[float] | None:
    """Katz log-scale 95% interval for the ratio of two independent proportions (k1/n1) / (k0/n0)."""
    if min(k1, k0) == 0:
        return None
    ratio = (k1 / n1) / (k0 / n0)
    se = np.sqrt(1 / k1 - 1 / n1 + 1 / k0 - 1 / n0)
    return [float(ratio * np.exp(-z * se)), float(ratio * np.exp(z * se))]


def grouped(attribute: str, values: pd.Series) -> pd.Series:
    """The attribute's groups; ZIP3 folds everything outside its ten largest into "other"."""
    v = values.astype(str)
    if attribute != "zip3":
        return v
    counts = v.value_counts()
    top = sorted(counts.index, key=lambda g: (-counts[g], g))[:ZIP3_TOP]
    return v.where(v.isin(top), "other")


def group_table(groups: pd.Series, approve: np.ndarray) -> dict[str, Any]:
    """Approval rate by group with Wilson intervals, the difference from the overall rate, and the adverse
    impact ratio (group rate ÷ the highest rated group's rate) with a Katz interval. Groups under
    MIN_RATED applicants are listed but not rated."""
    n_all, k_all = len(approve), int(approve.sum())
    overall = k_all / n_all
    stats = []
    for g in sorted(groups.unique(), key=lambda x: (x == "other", x)):
        mask = (groups == g).to_numpy()
        n, k = int(mask.sum()), int(approve[mask].sum())
        stats.append({"group": g, "applicants": n, "approvals": k, "rated": n >= MIN_RATED})
    rated = [s for s in stats if s["rated"]]
    ref = max(rated, key=lambda s: (s["approvals"] / s["applicants"], s["group"])) if rated else None
    rows = []
    for s in stats:
        rate = s["approvals"] / s["applicants"]
        row = {
            **s,
            "rate": rate,
            "rate_ci95": wilson(s["approvals"], s["applicants"]),
            "difference_from_overall": rate - overall,
            "adverse_impact_ratio": None,
            "air_ci95": None,
        }
        if s["rated"] and ref is not None:
            row["adverse_impact_ratio"] = rate / (ref["approvals"] / ref["applicants"])
            if s is not ref:
                row["air_ci95"] = katz(s["approvals"], s["applicants"], ref["approvals"], ref["applicants"])
        rows.append(row)
    rated_rows = [r for r in rows if r["rated"]]
    lowest = min(rated_rows, key=lambda r: (r["adverse_impact_ratio"], r["group"])) if rated_rows else None
    return {
        "applicants": n_all,
        "approvals": k_all,
        "overall_rate": overall,
        "reference_group": ref["group"] if ref else None,
        "groups": rows,
        "lowest_air": {"group": lowest["group"], "air": lowest["adverse_impact_ratio"]} if lowest else None,
    }


def proxy_check(X: pd.DataFrame, groups: pd.Series) -> dict[str, Any]:
    """How well the credit model's features predict a sensitive attribute: a depth-2 XGBoost, 5-fold
    cross-validated AUC (one-vs-rest, macro-averaged when there are more than two groups) with a
    percentile bootstrap interval over the out-of-fold predictions. Near 0.5: no usable proxy."""
    import xgboost

    classes = sorted(groups.unique(), key=lambda x: (x == "other", x))
    y = groups.map({c: i for i, c in enumerate(classes)}).to_numpy(dtype=int)
    binary = len(classes) == 2
    params = {**PROXY_PARAMS, "objective": "binary:logistic" if binary else "multi:softprob"}
    oof = np.zeros((len(y), len(classes)))
    for train_idx, valid_idx in StratifiedKFold(PROXY_FOLDS, shuffle=True, random_state=PROXY_SEED).split(
        X, y
    ):
        model = xgboost.XGBClassifier(**params).fit(X.iloc[train_idx], y[train_idx])
        oof[valid_idx] = model.predict_proba(X.iloc[valid_idx])

    def auc(yy: np.ndarray, pp: np.ndarray) -> float:
        if binary:
            return float(roc_auc_score(yy, pp[:, 1]))
        return float(
            roc_auc_score(yy, pp, multi_class="ovr", average="macro", labels=list(range(len(classes))))
        )

    point = auc(y, oof)
    rng = np.random.default_rng(PROXY_SEED)
    draws = []
    for _ in range(PROXY_BOOTSTRAPS):
        idx = rng.integers(0, len(y), len(y))
        if len(np.unique(y[idx])) == len(classes):
            draws.append(auc(y[idx], oof[idx]))
    out: dict[str, Any] = {
        "groups": len(classes),
        "auc": point,
        "auc_ci95": [float(np.percentile(draws, 2.5)), float(np.percentile(draws, 97.5))],
        "resamples": len(draws),
        "top_features": None,
    }
    if point > PROXY_NAME_ABOVE:
        full = xgboost.XGBClassifier(**params).fit(X, y)
        gain = {k: float(v) for k, v in full.get_booster().get_score(importance_type="gain").items()}  # type: ignore[arg-type]
        out["top_features"] = [f for f, _ in sorted(gain.items(), key=lambda kv: (-kv[1], kv[0]))[:3]]
    return out


def load_audit(seed: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    sensitive = pd.read_csv(DATA_DIR / f"sensitive-seed-{seed}.csv", dtype=str)
    decisions = pd.read_csv(
        DATA_DIR / f"decisions-seed-{seed}.csv", dtype={"decision_claimed": str, "decision_bureau": str}
    )
    return sensitive, decisions


def flip_summary() -> dict[str, Any]:
    flips = json.loads((DATA_DIR / "fairness-flips.json").read_text(encoding="utf-8"))
    return {
        "clean": flips["clean"],
        "sets": {
            name: [{k: v for k, v in r.items() if k != "examples"} for r in rows]
            for name, rows in flips["sets"].items()
        },
        "note": (
            "audit: flip_sensitive changes the audit record only; deep: the attribute in every layer that holds it, "
            "nothing recomputed; financial: region moved with its housing cost (rent multiplier), so DTI follows. "
            "Compared: credit decision and reason codes, underwriting decision and codes, every fraud rule, and the "
            "credit model's 14 features (identical features give an identical PD and identical reasons)."
        ),
    }


def fairness_section(data: Data, p_xgb_pool: np.ndarray, log=print) -> dict[str, Any]:
    pool = data.frame([data.test], funded_only=False)
    sensitive, decisions = load_audit(data.test.seed)
    ids = pool["application_id"].to_numpy()
    if not (
        np.array_equal(sensitive["application_id"].to_numpy(), ids)
        and np.array_equal(decisions["application_id"].to_numpy(), ids)
    ):
        raise ValueError("sensitive and decision files are not aligned with the seed-42 pool")
    champion = decisions["decision_bureau"].to_numpy() == "APPROVE"
    n = int(champion.sum())
    xgb_cut = np.zeros(len(pool), dtype=bool)
    xgb_cut[np.argsort(p_xgb_pool, kind="mergesort")[:n]] = True
    approvals = {
        CHAMPION: champion,
        "credit_pd_xgb_cutoff": xgb_cut,
        "as_is_policy_reference": decisions["decision_claimed"].to_numpy() == "APPROVE",
    }
    X = data.X(pool)
    groups_out: dict[str, Any] = {}
    proxies: dict[str, Any] = {}
    for attribute in ATTRIBUTES:
        g = grouped(attribute, sensitive[attribute])
        groups_out[attribute] = {
            "legitimate_credit_factor": attribute in LEGITIMATE_CREDIT_FACTORS,
            "policies": {name: group_table(g, a) for name, a in approvals.items()},
        }
        proxies[attribute] = proxy_check(X, g)
        log(
            f"  proxy {attribute}: AUC {proxies[attribute]['auc']:.3f} {proxies[attribute]['top_features'] or ''}"
        )
    return {
        "flips": flip_summary(),
        "policies": {
            name: {"label": POLICY_LABELS[name], "approvals": int(a.sum())} for name, a in approvals.items()
        },
        "matched_volume": n,
        "groups": groups_out,
        "proxy": {
            "method": (
                f"depth-2 XGBoost ({PROXY_PARAMS['n_estimators']} trees) predicting the attribute from the 14 features; "
                f"{PROXY_FOLDS}-fold cross-validated AUC, one-vs-rest macro-averaged for more than two groups; "
                f"percentile interval from {PROXY_BOOTSTRAPS} bootstrap resamples; top three features by gain named "
                f"above {PROXY_NAME_ABOVE}"
            ),
            "attributes": proxies,
        },
        "min_rated_group": MIN_RATED,
        "interval_methods": "approval rate: Wilson 95%; adverse impact ratio: Katz log-scale 95%",
        "air_reference_line": {
            "value": AIR_REFERENCE,
            "note": AIR_REFERENCE_NOTE,
            "not_shown_for": list(LEGITIMATE_CREDIT_FACTORS),
        },
    }

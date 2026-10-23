"""SHAP reasons for `credit_pd_xgb`, their stability, and reason accuracy against the hidden truth.

A prediction's log-odds equal the SHAP base value plus one contribution per feature (checked on every
row). Contributions are summed within each feature group, so correlated features that describe one
cause are reported once; the groups that raise risk most, up to four, become Reg B-style reason
statements (12 CFR 1002.9 requires the specific principal reasons for adverse action). This is a
standard method for ranking reasons, not one regulators have endorsed.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .data import Spec

TOP_REASONS = 4
ADDITIVITY_TOL = 1e-5
STABILITY_BOOTSTRAPS = 20
STABILITY_SEED = 11

# The feature group that should explain each fraud typology (owner decisions D6 and the spec).
EXPECTED_GROUP: dict[str, tuple[str, ...]] = {
    "CONCEALMENT": ("UNDISCLOSED_DEBT",),
    "INFLATION": ("INCOME_DISCREPANCY",),
    "EVIDENCE_TAMPERING": ("ASSET_DISCREPANCY",),
    "FABRICATION": ("ASSET_DISCREPANCY",),
    "ASSET_SEASONING": ("UNSOURCED_DEPOSITS",),
    "INFLATION+CONCEALMENT": ("INCOME_DISCREPANCY", "UNDISCLOSED_DEBT"),
}
DISCREPANCY_GROUPS = ("INCOME_DISCREPANCY", "UNDISCLOSED_DEBT", "ASSET_DISCREPANCY", "UNSOURCED_DEPOSITS")


def shap_values(model: Any, X: pd.DataFrame) -> tuple[np.ndarray, float]:
    """TreeSHAP contributions in log-odds and the base value; asserts additivity on every row."""
    import shap
    import xgboost

    explainer = shap.TreeExplainer(model)
    values = np.asarray(explainer.shap_values(X), dtype=float)
    base = float(np.ravel(explainer.expected_value)[0])
    margin = model.get_booster().predict(xgboost.DMatrix(X), output_margin=True)
    gap = np.max(np.abs(values.sum(axis=1) + base - margin))
    if gap > ADDITIVITY_TOL:
        raise AssertionError(f"SHAP additivity fails: max |Σ contributions + base − log-odds| = {gap}")
    return values, base


def group_matrix(values: np.ndarray, spec: Spec) -> tuple[np.ndarray, list[str]]:
    groups = list(spec.groups)
    index = {f: i for i, f in enumerate(spec.features)}
    out = np.zeros((values.shape[0], len(groups)))
    for j, g in enumerate(groups):
        for f in spec.groups[g]["features"]:
            out[:, j] += values[:, index[f]]
    return out, groups


def top_groups(row: np.ndarray, groups: list[str], k: int = TOP_REASONS, minimum: float = 0.0) -> list[str]:
    """The up-to-k groups whose contribution exceeds `minimum` (0: any positive one), largest first
    (ties by group name). With the materiality threshold as `minimum`, these are the stated reasons."""
    order = sorted((g for g in range(len(groups)) if row[g] > minimum), key=lambda g: (-row[g], groups[g]))
    return [groups[g] for g in order[:k]]


def reasons_for(row: np.ndarray, groups: list[str], spec: Spec, minimum: float = 0.0) -> list[dict[str, Any]]:
    return [
        {"group": g, "statement": spec.groups[g]["statement"], "contribution": float(row[groups.index(g)])}
        for g in top_groups(row, groups, minimum=minimum)
    ]


MATERIALITY_TARGET = 0.05


def false_reason_rate(gm: np.ndarray, groups: list[str], minimum: float) -> float:
    """Share of rows given at least one discrepancy reason (for clean loans, a false reason)."""
    if len(gm) == 0:
        return 0.0
    hits = sum(
        1 for i in range(len(gm)) if set(top_groups(gm[i], groups, minimum=minimum)) & set(DISCREPANCY_GROUPS)
    )
    return hits / len(gm)


def choose_materiality(gm_clean: np.ndarray, groups: list[str], target: float = MATERIALITY_TARGET) -> float:
    """The smallest contribution threshold at which at most `target` of these clean loans are given a
    discrepancy reason, from each loan's largest discrepancy contribution
    among its top four groups (0 when it has none). Chosen on the calibration books only."""
    index = [groups.index(g) for g in DISCREPANCY_GROUPS]
    largest = np.zeros(len(gm_clean))
    for i in range(len(gm_clean)):
        top = set(top_groups(gm_clean[i], groups))
        values = [gm_clean[i, j] for j in index if groups[j] in top]
        largest[i] = max(values) if values else 0.0
    # At most floor(target · n) loans may exceed the threshold, so it is the (floor(target · n) + 1)-th
    # largest value: every loan above it is one of the allowed few, and any lower threshold admits one more.
    allowed = int(np.floor(target * len(largest)))
    ordered = np.sort(largest)[::-1]
    return float(ordered[min(allowed, len(ordered) - 1)])


def global_importance(values: np.ndarray, spec: Spec) -> dict[str, Any]:
    gm, groups = group_matrix(values, spec)
    return {
        "features": {f: float(np.mean(np.abs(values[:, i]))) for i, f in enumerate(spec.features)},
        "groups": {g: float(np.mean(np.abs(gm[:, j]))) for j, g in enumerate(groups)},
        "statistic": "mean |SHAP| in log-odds on the test book",
    }


def accuracy(
    gm: np.ndarray, groups: list[str], typologies: list[str], minimum: float = 0.0
) -> dict[str, Any]:
    """Per typology: how often the top reason, and how often any of the top four, is an expected group.
    Clean rows (NONE) are the control: how often a discrepancy group is blamed when none exists.
    `minimum` is the materiality threshold (0: every positive contribution counts)."""
    out: dict[str, Any] = {}
    tops = [top_groups(gm[i], groups, minimum=minimum) for i in range(len(typologies))]
    for t in sorted(set(typologies)):
        rows = [i for i, x in enumerate(typologies) if x == t]
        if t == "NONE":
            out[t] = {
                "n": len(rows),
                "control": True,
                "top1_blames_discrepancy": sum(
                    1 for i in rows if tops[i][:1] and tops[i][0] in DISCREPANCY_GROUPS
                ),
                "top4_blames_discrepancy": sum(1 for i in rows if set(tops[i]) & set(DISCREPANCY_GROUPS)),
                "by_group": {
                    g: {
                        "top1": sum(1 for i in rows if tops[i][:1] == [g]),
                        "top4": sum(1 for i in rows if g in tops[i]),
                    }
                    for g in DISCREPANCY_GROUPS
                },
            }
            continue
        expected = EXPECTED_GROUP.get(t)
        if expected is None:
            continue
        out[t] = {
            "n": len(rows),
            "expected_groups": list(expected),
            "top1_hits": sum(1 for i in rows if tops[i][:1] and tops[i][0] in expected),
            "top4_hits": sum(1 for i in rows if set(tops[i]) & set(expected)),
            "no_positive_reason": sum(1 for i in rows if not tops[i]),
        }
    return out


def stability(
    make,
    X_train: pd.DataFrame,
    y_train: np.ndarray,
    X_test: pd.DataFrame,
    spec: Spec,
    headline_top1: list[str],
    headline_pd: np.ndarray,
) -> dict[str, Any]:
    """Retrain on `STABILITY_BOOTSTRAPS` resamples of the training rows; for each test loan, the share
    of retrained models whose top reason equals the headline model's. Reported for every loan and for
    the riskiest tenth by headline PD, where a reason statement would actually be sent."""
    rng = np.random.default_rng(STABILITY_SEED)
    agree = np.zeros(len(X_test))
    has_reason = np.array([bool(t) for t in headline_top1])
    for _ in range(STABILITY_BOOTSTRAPS):
        idx = rng.integers(0, len(X_train), len(X_train))
        model = make().fit(X_train.iloc[idx], y_train[idx])
        values, _ = shap_values(model, X_test)
        gm, groups = group_matrix(values, spec)
        for i in range(len(X_test)):
            top = top_groups(gm[i], groups, 1)
            agree[i] += 1.0 if top[:1] == ([headline_top1[i]] if headline_top1[i] else []) else 0.0
    share = agree / STABILITY_BOOTSTRAPS
    riskiest = np.zeros(len(X_test), dtype=bool)
    riskiest[np.argsort(-headline_pd, kind="mergesort")[: len(X_test) // 10]] = True

    def summary(mask: np.ndarray) -> dict[str, Any]:
        scope = share[mask & has_reason]
        return {
            "loans_with_a_reason": int((mask & has_reason).sum()),
            "mean_agreement": float(np.mean(scope)) if len(scope) else None,
            "share_with_agreement_at_least_80pct": float(np.mean(scope >= 0.8)) if len(scope) else None,
            "share_with_agreement_below_50pct": float(np.mean(scope < 0.5)) if len(scope) else None,
        }

    return {
        "bootstraps": STABILITY_BOOTSTRAPS,
        **summary(np.ones(len(X_test), dtype=bool)),
        "riskiest_decile": summary(riskiest),
        "statistic": "per test loan, the share of 20 bootstrap retrains whose top reason group equals the headline model's",
    }

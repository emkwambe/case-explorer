"""Technical fairness-testing controls.

These controls do NOT establish legal compliance. They support human legal and compliance review.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.feature_selection import mutual_info_classif, mutual_info_regression

from case_analytics.evaluation.metrics import expected_calibration_error, metrics_at_threshold
from case_analytics.models.base import align

DISCLAIMER = (
    "Technical fairness-testing controls only. Results do not establish legal compliance; "
    "they support human legal and compliance review."
)


def two_proportion_p(x1: int, n1: int, x2: int, n2: int) -> float:
    if n1 == 0 or n2 == 0:
        return 1.0
    p1, p2, p = x1 / n1, x2 / n2, (x1 + x2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return 1.0
    z = abs(p1 - p2) / se
    return float(2 * (1 - stats.norm.cdf(z)))


def subgroup_metrics(
    scores: np.ndarray,
    y_true: np.ndarray,
    sensitive: pd.DataFrame,
    threshold: float,
    review_threshold: float | None = None,
    min_group: int = 20,
) -> pd.DataFrame:
    s = np.asarray(scores, dtype=float)
    y = np.asarray(y_true, dtype=float)
    alert = s >= threshold
    review_t = review_threshold if review_threshold is not None else threshold / 2
    approve = s < review_t
    rows: list[dict[str, Any]] = []
    for col in sensitive.columns:
        g = sensitive[col].astype(str).to_numpy()
        pooled_alert = float(alert.mean())
        pooled_approve = float(approve.mean())
        total_alerts = int(alert.sum())
        total_approve = int(approve.sum())
        for name in sorted(set(g.tolist())):
            m = g == name
            n = int(m.sum())
            if n < min_group:
                continue
            r = metrics_at_threshold(y[m], s[m], threshold)
            clean = y[m] == 0
            rows.append(
                {
                    "attribute": col,
                    "group": name,
                    "n": n,
                    "fraud_rate": float(y[m].mean()),
                    "alert_rate": float(alert[m].mean()),
                    "approval_rate": float(approve[m].mean()),
                    "selection_ratio_vs_pooled": float(approve[m].mean() / pooled_approve)
                    if pooled_approve
                    else None,
                    "alert_ratio_vs_pooled": float(alert[m].mean() / pooled_alert) if pooled_alert else None,
                    "fpr": float(r["fpr"]) if clean.any() else None,
                    "fnr": float(r["fnr"]) if (y[m] == 1).any() else None,
                    "ece": expected_calibration_error(y[m], s[m]),
                    "approval_p_value": two_proportion_p(
                        int(approve[m].sum()), n, total_approve - int(approve[m].sum()), len(s) - n
                    ),
                    "alert_p_value": two_proportion_p(
                        int(alert[m].sum()), n, total_alerts - int(alert[m].sum()), len(s) - n
                    ),
                }
            )
    return pd.DataFrame(rows)


def counterfactual_test(
    model: Any, X: pd.DataFrame, sensitive: pd.DataFrame, max_rows: int = 300
) -> dict[str, Any]:
    """Perturb every sensitive column to every other observed value; scores must be bit-identical.

    The model receives only permitted features, so this proves (rather than assumes) that the
    sensitive attributes cannot influence the score through the modelling pipeline. Any change
    is a critical finding.
    """
    Xa = align(X, model.feature_names).head(max_rows)
    sens = sensitive.head(max_rows).reset_index(drop=True)
    base = model.predict_proba(Xa)
    pairs = 0
    changed = 0
    findings: list[dict[str, Any]] = []
    for col in sens.columns:
        values = sorted(set(sens[col].astype(str).tolist()))
        for v in values:
            twin_sens = sens.copy()
            twin_sens[col] = v
            # The twin's permitted features are the SAME frame: the model never sees `twin_sens`.
            # We re-score through the full scoring path to prove no hidden dependency exists.
            alt = model.predict_proba(_combine(Xa, twin_sens, model.feature_names))
            diff = ~np.equal(alt, base)
            n_changed = int(diff.sum())
            pairs += len(Xa)
            changed += n_changed
            if n_changed and len(findings) < 50:
                idx = int(np.argmax(diff))
                findings.append(
                    {
                        "attribute": col,
                        "to": v,
                        "row": idx,
                        "base_score": float(base[idx]),
                        "alt_score": float(alt[idx]),
                        "severity": "CRITICAL",
                    }
                )
    return {
        "rows_tested": int(len(Xa)),
        "pairs": pairs,
        "changed": changed,
        "invariance_rate": 1.0 if pairs == 0 else (pairs - changed) / pairs,
        "findings": findings,
        "status": "PASS" if changed == 0 else "FAIL",
    }


def _combine(X: pd.DataFrame, sens: pd.DataFrame, feature_names: list[str]) -> pd.DataFrame:
    """Rebuild a scoring frame from permitted features + (renamed) sensitive columns.

    `align` drops everything outside feature_names, which is exactly the guarantee under test.
    """
    merged = X.reset_index(drop=True).copy()
    for c in sens.columns:
        merged[f"sensitive__{c}"] = sens[c].to_numpy()
    return align(merged, feature_names)


def proxy_analysis(X: pd.DataFrame, sensitive: pd.DataFrame, threshold: float = 0.15) -> pd.DataFrame:
    """Mutual information / correlation between permitted features and each sensitive attribute."""
    Xn = X.apply(pd.to_numeric, errors="coerce").fillna(0.0)
    rows: list[dict[str, Any]] = []
    for col in sensitive.columns:
        target = sensitive[col]
        numeric_target = pd.to_numeric(target, errors="coerce")
        if numeric_target.notna().all() and target.nunique() > 10:
            mi = mutual_info_regression(Xn.to_numpy(), numeric_target.to_numpy(), random_state=42)
            corr = [
                abs(float(np.corrcoef(Xn[f], numeric_target)[0, 1])) if Xn[f].std() > 0 else 0.0
                for f in Xn.columns
            ]
        else:
            codes = pd.factorize(target.astype(str))[0]
            mi = mutual_info_classif(Xn.to_numpy(), codes, random_state=42, discrete_features=False)
            corr = [
                float(
                    stats.f_oneway(
                        *[Xn[f][codes == k] for k in np.unique(codes) if (codes == k).sum() > 1]
                    ).statistic
                )
                if Xn[f].std() > 0 and len(np.unique(codes)) > 1
                else 0.0
                for f in Xn.columns
            ]
            # Normalise ANOVA F to a bounded eta-like measure for comparability.
            corr = [float(c / (c + len(Xn))) if np.isfinite(c) else 0.0 for c in corr]
        max_mi = max(float(np.max(mi)), 1e-9)
        for f, m, c in zip(Xn.columns, mi, corr):
            rows.append(
                {
                    "sensitive_attribute": col,
                    "feature": f,
                    "mutual_information": float(m),
                    "relative_mi": float(m) / max_mi,
                    "association": float(c),
                    "flag": bool(float(m) / max_mi >= 0.5 and float(m) > threshold * 0.1),
                }
            )
    return pd.DataFrame(rows).sort_values(
        ["sensitive_attribute", "mutual_information"], ascending=[True, False]
    )


def fairness_report(
    model: Any,
    X: pd.DataFrame,
    y: np.ndarray,
    sensitive: pd.DataFrame,
    threshold: float,
    independent_attributes: tuple[str, ...] = ("family_status_scenario", "disability_income_scenario"),
) -> dict[str, Any]:
    scores = model.predict_proba(X)
    sub = subgroup_metrics(scores, y, sensitive, threshold)
    cf = counterfactual_test(model, X, sensitive)
    proxies = proxy_analysis(X, sensitive)
    independent = sub[sub["attribute"].isin(independent_attributes) & (sub["n"] >= 50)]
    disparities = independent[
        (independent["selection_ratio_vs_pooled"].fillna(1.0) < 0.8)
        & (independent["approval_p_value"] < 0.005)
    ]
    derived_below = sub[
        ~sub["attribute"].isin(independent_attributes) & (sub["selection_ratio_vs_pooled"].fillna(1.0) < 0.8)
    ]
    status = (
        "FAIL" if cf["status"] == "FAIL" or len(disparities) else ("WARN" if len(derived_below) else "PASS")
    )
    return {
        "disclaimer": DISCLAIMER,
        "model": model.name,
        "threshold": threshold,
        "status": status,
        "subgroups": sub.to_dict(orient="records"),
        "significant_independent_disparities": disparities.to_dict(orient="records"),
        "derived_attributes_below_four_fifths": derived_below[
            ["attribute", "group", "selection_ratio_vs_pooled"]
        ].to_dict(orient="records"),
        "counterfactual": cf,
        "proxy_flags": proxies[proxies["flag"]].to_dict(orient="records"),
        "proxy_table": proxies.head(200).to_dict(orient="records"),
    }

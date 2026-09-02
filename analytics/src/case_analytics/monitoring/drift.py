"""Drift and monitoring metrics."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from case_analytics.models.baseline import rule_matrix


def psi(expected: Any, actual: Any, bins: int = 10) -> float:
    """Population Stability Index using quantile bins of the expected distribution."""
    e = np.asarray(expected, dtype=float)
    a = np.asarray(actual, dtype=float)
    e = e[np.isfinite(e)]
    a = a[np.isfinite(a)]
    if len(e) == 0 or len(a) == 0:
        return 0.0
    edges = np.unique(np.quantile(e, np.linspace(0, 1, bins + 1)))
    if len(edges) < 2:
        return 0.0
    edges[0], edges[-1] = -np.inf, np.inf
    e_hist = np.histogram(e, bins=edges)[0] / len(e)
    a_hist = np.histogram(a, bins=edges)[0] / len(a)
    eps = 1e-6
    e_hist = np.clip(e_hist, eps, None)
    a_hist = np.clip(a_hist, eps, None)
    return float(np.sum((a_hist - e_hist) * np.log(a_hist / e_hist)))


def ks_drift(expected: Any, actual: Any) -> tuple[float, float]:
    e = np.asarray(expected, dtype=float)
    a = np.asarray(actual, dtype=float)
    if len(e) == 0 or len(a) == 0:
        return 0.0, 1.0
    r = stats.ks_2samp(e, a)
    return float(r.statistic), float(r.pvalue)


def feature_drift(reference: pd.DataFrame, current: pd.DataFrame) -> pd.DataFrame:
    rows = []
    ref = reference.apply(pd.to_numeric, errors="coerce")
    cur = current.apply(pd.to_numeric, errors="coerce")
    for col in ref.columns:
        if col not in cur.columns:
            continue
        p = psi(ref[col].dropna(), cur[col].dropna())
        k, pv = ks_drift(ref[col].dropna(), cur[col].dropna())
        rows.append(
            {
                "feature": col,
                "psi": p,
                "ks_statistic": k,
                "ks_p_value": pv,
                "reference_mean": float(ref[col].mean()),
                "current_mean": float(cur[col].mean()),
                "drift": "HIGH" if p >= 0.25 else "MODERATE" if p >= 0.10 else "STABLE",
            }
        )
    return pd.DataFrame(rows).sort_values("psi", ascending=False)


def prediction_drift(ref_scores: Any, cur_scores: Any, threshold: float) -> dict[str, Any]:
    r = np.asarray(ref_scores, dtype=float)
    c = np.asarray(cur_scores, dtype=float)
    k, pv = ks_drift(r, c)
    return {
        "psi": psi(r, c),
        "ks_statistic": k,
        "ks_p_value": pv,
        "reference_mean_score": float(r.mean()) if len(r) else 0.0,
        "current_mean_score": float(c.mean()) if len(c) else 0.0,
        "reference_alert_rate": float((r >= threshold).mean()) if len(r) else 0.0,
        "current_alert_rate": float((c >= threshold).mean()) if len(c) else 0.0,
    }


def rule_firing_drift(reference: pd.DataFrame, current: pd.DataFrame) -> pd.DataFrame:
    rm_ref = rule_matrix(reference.apply(pd.to_numeric, errors="coerce").fillna(0.0))
    rm_cur = rule_matrix(current.apply(pd.to_numeric, errors="coerce").fillna(0.0))
    rows = []
    for rid in rm_ref.columns:
        a, b = float(rm_ref[rid].mean()), float(rm_cur[rid].mean())
        rows.append({"rule_id": rid, "reference_rate": a, "current_rate": b, "delta": b - a})
    return pd.DataFrame(rows)


def monitoring_report(
    model: Any,
    reference: pd.DataFrame,
    comparisons: dict[str, pd.DataFrame],
    threshold: float,
) -> dict[str, Any]:
    ref_scores = model.predict_proba(reference)
    out: dict[str, Any] = {
        "model": model.name,
        "version": model.version,
        "threshold": threshold,
        "splits": {},
    }
    for name, cur in comparisons.items():
        fd = feature_drift(reference, cur)
        out["splits"][name] = {
            "n": int(len(cur)),
            "features_high_drift": fd[fd["drift"] == "HIGH"]["feature"].tolist(),
            "features_moderate_drift": fd[fd["drift"] == "MODERATE"]["feature"].tolist(),
            "top_feature_drift": fd.head(10).to_dict(orient="records"),
            "prediction_drift": prediction_drift(ref_scores, model.predict_proba(cur), threshold),
            "rule_firing": rule_firing_drift(reference, cur).to_dict(orient="records"),
        }
    return out

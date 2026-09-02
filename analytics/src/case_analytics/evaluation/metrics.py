"""Risk-appropriate classification metrics for rare-event fraud detection."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score


def _records(df: pd.DataFrame) -> list[dict[str, Any]]:
    return [{str(k): v for k, v in r.items()} for r in df.to_dict(orient="records")]


def _arr(a: Any) -> np.ndarray:
    return np.asarray(a, dtype=float).ravel()


def confusion(y_true: Any, y_pred: Any) -> dict[str, int]:
    yt, yp = _arr(y_true) > 0.5, _arr(y_pred) > 0.5
    return {
        "tp": int(np.sum(yt & yp)),
        "fp": int(np.sum(~yt & yp)),
        "fn": int(np.sum(yt & ~yp)),
        "tn": int(np.sum(~yt & ~yp)),
    }


def metrics_at_threshold(y_true: Any, scores: Any, threshold: float) -> dict[str, float | int]:
    yt = _arr(y_true)
    pred = (_arr(scores) >= threshold).astype(float)
    c = confusion(yt, pred)
    tp, fp, fn, tn = c["tp"], c["fp"], c["fn"], c["tn"]
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "threshold": float(threshold),
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "fpr": fp / (fp + tn) if fp + tn else 0.0,
        "fnr": fn / (tp + fn) if tp + fn else 0.0,
        "specificity": tn / (fp + tn) if fp + tn else 0.0,
        "accuracy": (tp + tn) / max(1, len(yt)),
        "alert_rate": float(np.mean(pred)) if len(pred) else 0.0,
        **c,
    }


def expected_calibration_error(y_true: Any, scores: Any, n_bins: int = 10) -> float:
    yt, s = _arr(y_true), np.clip(_arr(scores), 0, 1)
    if len(yt) == 0:
        return 0.0
    edges = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (s >= lo) & ((s < hi) | ((hi == 1.0) & (s <= hi)))
        if not mask.any():
            continue
        ece += mask.mean() * abs(yt[mask].mean() - s[mask].mean())
    return float(ece)


def brier(y_true: Any, scores: Any) -> float:
    yt, s = _arr(y_true), np.clip(_arr(scores), 0, 1)
    return float(np.mean((yt - s) ** 2)) if len(yt) else 0.0


def pr_auc(y_true: Any, scores: Any) -> float:
    yt, s = _arr(y_true), _arr(scores)
    if len(yt) == 0 or yt.sum() == 0:
        return 0.0
    return float(average_precision_score(yt, s))


def roc_auc(y_true: Any, scores: Any) -> float:
    yt, s = _arr(y_true), _arr(scores)
    if len(np.unique(yt)) < 2:
        return 0.5
    return float(roc_auc_score(yt, s))


def threshold_sweep(y_true: Any, scores: Any, thresholds: np.ndarray | None = None) -> pd.DataFrame:
    if thresholds is None:
        thresholds = np.round(np.arange(0.05, 0.951, 0.05), 2)
    return pd.DataFrame([metrics_at_threshold(y_true, scores, float(t)) for t in thresholds])


def tune_threshold(y_true: Any, scores: Any, max_fpr: float = 0.05) -> float:
    """Maximise F1 subject to FPR <= max_fpr on a fine grid; fall back to best F1 if infeasible."""
    grid = np.round(np.arange(0.02, 0.99, 0.01), 2)
    sweep = threshold_sweep(y_true, scores, grid)
    feasible = sweep[sweep["fpr"] <= max_fpr]
    pick = feasible if len(feasible) else sweep
    row = pick.sort_values(["f1", "recall"], ascending=[False, False]).iloc[0]
    return float(row["threshold"])


def per_group_recall(y_true: Any, scores: Any, groups: Any, threshold: float) -> pd.DataFrame:
    yt, s, g = _arr(y_true), _arr(scores), np.asarray(groups)
    rows = []
    for name in sorted(set(g.tolist())):
        m = g == name
        if not m.any():
            continue
        r = metrics_at_threshold(yt[m], s[m], threshold)
        rows.append(
            {
                "group": name,
                "n": int(m.sum()),
                "fraud_n": int(yt[m].sum()),
                "recall": r["recall"] if yt[m].sum() else None,
                "alert_rate": r["alert_rate"],
                "fpr": r["fpr"] if (yt[m] == 0).any() else None,
                "pr_auc": pr_auc(yt[m], s[m]) if 0 < yt[m].sum() < m.sum() else None,
            }
        )
    return pd.DataFrame(rows)


@dataclass
class ClassificationReport:
    split: str
    n: int
    fraud_n: int
    threshold: float
    pr_auc: float
    roc_auc: float
    precision: float
    recall: float
    f1: float
    fpr: float
    fnr: float
    specificity: float
    ece: float
    brier: float
    confusion: dict[str, int]
    by_fraud_type: list[dict[str, Any]] = field(default_factory=list)
    by_regime: list[dict[str, Any]] = field(default_factory=list)
    sweep: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def classification_report(
    split: str,
    y_true: Any,
    scores: Any,
    threshold: float,
    fraud_types: Any | None = None,
    regimes: Any | None = None,
) -> ClassificationReport:
    yt, s = _arr(y_true), _arr(scores)
    m = metrics_at_threshold(yt, s, threshold)
    by_type: list[dict[str, Any]] = []
    if fraud_types is not None:
        by_type = _records(per_group_recall(yt, s, fraud_types, threshold))
    by_regime: list[dict[str, Any]] = []
    if regimes is not None:
        by_regime = _records(per_group_recall(yt, s, regimes, threshold))
    return ClassificationReport(
        split=split,
        n=int(len(yt)),
        fraud_n=int(yt.sum()),
        threshold=float(threshold),
        pr_auc=pr_auc(yt, s),
        roc_auc=roc_auc(yt, s),
        precision=float(m["precision"]),
        recall=float(m["recall"]),
        f1=float(m["f1"]),
        fpr=float(m["fpr"]),
        fnr=float(m["fnr"]),
        specificity=float(m["specificity"]),
        ece=expected_calibration_error(yt, s),
        brier=brier(yt, s),
        confusion={k: int(m[k]) for k in ("tp", "fp", "fn", "tn")},
        by_fraud_type=by_type,
        by_regime=by_regime,
        sweep=_records(threshold_sweep(yt, s)),
    )

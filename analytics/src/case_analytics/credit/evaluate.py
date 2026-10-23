"""Evaluation: discrimination (AUC, KS), calibration (Brier, decile reliability, calibration-in-the-large),
bootstrap confidence intervals and learned-versus-true PD. Pure functions of arrays; deterministic."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
from scipy.stats import spearmanr
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

BOOTSTRAP_SEED = 11
BOOTSTRAPS = 1000


def ks(y: np.ndarray, p: np.ndarray) -> float:
    """Kolmogorov–Smirnov: the largest gap between the cumulative score distributions of defaults and non-defaults."""
    order = np.argsort(p, kind="mergesort")
    ys = y[order]
    pos, neg = max(1, int(ys.sum())), max(1, int((1 - ys).sum()))
    cum_pos = np.cumsum(ys) / pos
    cum_neg = np.cumsum(1 - ys) / neg
    return float(np.max(np.abs(cum_pos - cum_neg)))


def metrics(y: np.ndarray, p: np.ndarray) -> dict[str, float]:
    return {
        "auc": float(roc_auc_score(y, p)),
        "ks": ks(y, p),
        "brier": float(brier_score_loss(y, p)),
        "log_loss": float(log_loss(y, np.clip(p, 1e-9, 1 - 1e-9))),
        "mean_predicted": float(np.mean(p)),
        "observed_rate": float(np.mean(y)),
    }


def bootstrap_ci(
    y: np.ndarray,
    p: np.ndarray,
    fns: dict[str, Callable[[np.ndarray, np.ndarray], float]],
    n: int = BOOTSTRAPS,
) -> dict[str, dict[str, float]]:
    """Percentile 95% intervals from `n` resamples of the test rows (fixed seed)."""
    rng = np.random.default_rng(BOOTSTRAP_SEED)
    draws: dict[str, list[float]] = {k: [] for k in fns}
    m = len(y)
    for _ in range(n):
        idx = rng.integers(0, m, m)
        yy, pp = y[idx], p[idx]
        if yy.sum() == 0 or yy.sum() == m:
            continue
        for k, fn in fns.items():
            draws[k].append(fn(yy, pp))
    return {
        k: {"low": float(np.percentile(v, 2.5)), "high": float(np.percentile(v, 97.5)), "resamples": len(v)}
        for k, v in draws.items()
    }


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    phat = k / n
    denom = 1 + z * z / n
    centre = (phat + z * z / (2 * n)) / denom
    half = z * np.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n)) / denom
    return (float(centre - half), float(centre + half))


def deciles(y: np.ndarray, p: np.ndarray, truth: np.ndarray | None = None) -> list[dict[str, Any]]:
    """Ten equal-count bins by predicted PD (ties broken by row order): counts, mean prediction,
    observed rate with its Wilson interval, and the mean true PD when given."""
    order = np.argsort(p, kind="mergesort")
    bins = np.array_split(order, 10)
    out = []
    for i, idx in enumerate(bins):
        k, n = int(y[idx].sum()), len(idx)
        low, high = wilson(k, n)
        row: dict[str, Any] = {
            "decile": i + 1,
            "n": n,
            "defaults": k,
            "mean_predicted": float(np.mean(p[idx])),
            "observed_rate": k / n if n else 0.0,
            "observed_low": low,
            "observed_high": high,
            "prediction_inside_interval": bool(low <= float(np.mean(p[idx])) <= high),
        }
        if truth is not None:
            row["mean_true"] = float(np.mean(truth[idx]))
        out.append(row)
    return out


def calibration_needed(table: list[dict[str, Any]], mean_predicted: float, observed: float) -> dict[str, Any]:
    """The pre-registered trigger (owner decision D11): 3 or more deciles whose mean prediction falls
    outside the Wilson 95% interval of the observed rate, or calibration-in-the-large off by more
    than 10% relative."""
    outside = sum(1 for r in table if not r["prediction_inside_interval"])
    relative = abs(mean_predicted - observed) / observed if observed > 0 else 0.0
    return {
        "deciles_outside": outside,
        "calibration_in_the_large_relative_error": relative,
        "needed": bool(outside >= 3 or relative > 0.10),
        "rule": (
            "recalibrate if 3+ deciles fall outside the Wilson 95% interval, "
            "or mean prediction is off by more than 10% relative"
        ),
    }


def learned_vs_true(p: np.ndarray, truth: np.ndarray) -> dict[str, float]:
    rho = spearmanr(p, truth).statistic
    return {
        "spearman": float(rho),
        "mean_absolute_error": float(np.mean(np.abs(p - truth))),
        "mean_learned": float(np.mean(p)),
        "mean_true": float(np.mean(truth)),
    }

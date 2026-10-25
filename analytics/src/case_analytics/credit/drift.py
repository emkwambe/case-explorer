"""Drift monitoring on shifted books (Sprint 12): do the monitors warn before, or alongside, the decay?

Each drift book is a new seed built by scripts/export_credit_features.mjs with one stated change to an
existing generator setting, plus an unchanged control seed. The reference is the training books' funded
loans. For each book's funded loans: PSI per feature and of the score (the existing psi(), quantile bins
of the reference), and the model's AUC, calibration-in-the-large and expected-loss error. Performance has
decayed when the calibration test fails or the AUC test fires: both books are bootstrapped independently
and the 95% interval of (book AUC − test-book AUC) lies wholly below 0. True PD is synthetic truth, used
only to evaluate.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from sklearn.metrics import roc_auc_score

from ..monitoring.drift import psi
from . import evaluate as ev
from .data import Data, load_book
from .models import predict

WATCH, ACT = 0.10, 0.25
Z95 = 1.959964


def rating(value: float) -> str:
    return "act" if value >= ACT else "watch" if value >= WATCH else "stable"


def log_odds(p: np.ndarray) -> np.ndarray:
    q = np.clip(p, 1e-9, 1 - 1e-9)
    return np.log(q / (1 - q))


def calibration_test(y: np.ndarray, p: np.ndarray) -> dict[str, float | bool]:
    """Observed defaults against the model's expected count (Σ p, variance Σ p(1 − p)): a two-sided
    z-test at 95%. `off` means the book's default rate is not what the model predicts."""
    expected, var = float(p.sum()), float((p * (1 - p)).sum())
    z = (float(y.sum()) - expected) / np.sqrt(var)
    return {
        "observed_defaults": int(y.sum()),
        "expected_defaults": expected,
        "z": float(z),
        "off": bool(abs(z) > Z95),
    }


def auc_draws(y: np.ndarray, p: np.ndarray, rng: np.random.Generator, n: int = ev.BOOTSTRAPS) -> np.ndarray:
    """AUC on `n` resamples of the rows, as ev.bootstrap_ci draws them (NaN where a resample has one class)."""
    m, out = len(y), np.full(n, np.nan)
    for i in range(n):
        idx = rng.integers(0, m, m)
        if 0 < y[idx].sum() < m:
            out[i] = roc_auc_score(y[idx], p[idx])
    return out


def interval(draws: np.ndarray) -> dict[str, Any]:
    v = draws[~np.isnan(draws)]
    return {"low": float(np.percentile(v, 2.5)), "high": float(np.percentile(v, 97.5)), "resamples": len(v)}


def book_report(
    data: Data,
    model: Any,
    seed: int,
    ref_X,
    ref_p: np.ndarray,
    ref_apps_fico,
    lgd: float,
    test_auc: float,
    test_draws: np.ndarray,
) -> dict[str, Any]:
    book = load_book(seed, "drift", manifest=data.manifest)
    frame = data.frame([book])
    X, y = data.X(frame), data.y(frame)
    p = predict(model, X)
    true = frame["p_dpd30_true"].to_numpy()
    ead = frame["ead"].to_numpy()
    features = {c: psi(ref_X[c].dropna(), X[c].dropna()) for c in X.columns}
    score = psi(ref_p, p)
    apps_fico = data.X(data.frame([book], funded_only=False))["fico_bureau"]
    # The same mean shift in bureau FICO applied to the reference funded loans alone, everything else held:
    # how far the score moves on FICO by itself.
    shift = float(np.nanmean(X["fico_bureau"]) - np.nanmean(ref_X["fico_bureau"]))
    moved = ref_X.copy()
    moved["fico_bureau"] = moved["fico_bureau"] + shift
    p_moved = predict(model, moved)
    auc = float(roc_auc_score(y, p))
    # The book's own resamples, drawn independently of the test book's (a seed of its own).
    draws = auc_draws(y, p, np.random.default_rng([ev.BOOTSTRAP_SEED, seed]))
    ci, diff = interval(draws), interval(draws - test_draws)
    return {
        "funded": len(frame),
        "defaults": int(y.sum()),
        "default_rate": float(y.mean()),
        "share_fraud": float((frame["fraud_true"].to_numpy() == 1).mean()),
        "mean_fico_bureau": float(np.nanmean(X["fico_bureau"])),
        "mean_fico_bureau_applications": float(np.nanmean(apps_fico)),
        "psi_fico_bureau_applications": psi(ref_apps_fico.dropna(), apps_fico.dropna()),
        "fico_only": {
            "mean_shift": shift,
            "score_psi": psi(ref_p, p_moved),
            "mean_log_odds_change": float(np.mean(log_odds(p_moved) - log_odds(ref_p))),
            "reference_log_odds_sd": float(np.std(log_odds(ref_p))),
        },
        "psi_features": {c: {"psi": v, "rating": rating(v)} for c, v in features.items()},
        "psi_score": {"psi": score, "rating": rating(score)},
        "features_at_watch_or_act": sorted(c for c, v in features.items() if v >= WATCH),
        "max_feature_psi": max(features.values()),
        "auc": auc,
        "auc_ci95": [ci["low"], ci["high"]],
        "auc_difference_vs_test": {
            "difference": auc - test_auc,
            "ci95": [diff["low"], diff["high"]],
            "resamples": diff["resamples"],
        },
        "auc_decayed": bool(diff["high"] < 0),
        "calibration_in_the_large": {
            "mean_predicted": float(p.mean()),
            "observed": float(y.mean()),
            "true_pd": float(true.mean()),
        },
        "calibration_test": calibration_test(y, p),
        "expected_loss": {
            "model": float((p * lgd * ead).sum()),
            "true": float((true * lgd * ead).sum()),
            "relative_error": float((p * ead).sum() / (true * ead).sum() - 1),
        },
    }


def drift_section(
    data: Data, model: Any, lgd: float, y_test: np.ndarray, p_test: np.ndarray, log=print
) -> dict[str, Any]:
    """`y_test` and `p_test` are the test book's funded outcomes and headline-model PDs. Its resamples use the
    summary's bootstrap seed, so its interval is the one the Sprint 11 summary reports."""
    test_auc = float(roc_auc_score(y_test, p_test))
    test_draws = auc_draws(y_test, p_test, np.random.default_rng(ev.BOOTSTRAP_SEED))
    test_ci = interval(test_draws)
    ref = data.frame(data.training)
    ref_X = data.X(ref)
    ref_p = predict(model, ref_X)
    ref_apps_fico = data.X(data.frame(data.training, funded_only=False))["fico_bureau"]
    books = data.manifest["drift_books"]
    out: dict[str, Any] = {
        "reference": f"the training books' funded loans ({len(ref):,})",
        "thresholds": {"watch": WATCH, "act": ACT},
        "reference_mean_fico_bureau": {
            "funded": float(np.nanmean(ref_X["fico_bureau"])),
            "applications": float(np.nanmean(ref_apps_fico)),
        },
        "fico_only_method": (
            "the book's mean shift in bureau FICO (funded loans) added to every reference funded loan, all other "
            "features unchanged, scored by the same model: the score PSI and mean log-odds change from FICO alone"
        ),
        "psi_method": "the existing psi(): ten quantile bins of the reference, a 1e-6 floor on empty bins",
        "population": "each book's funded loans, scored by the headline credit_pd_xgb",
        "expected_loss_error": (
            "Σ model PD × LGD × EAD over Σ true 30+ DPD probability × LGD × EAD, minus 1, on the funded loans "
            "(the same default event on both sides, so LGD cancels)"
        ),
        "calibration_test": "observed defaults against Σ model PD, two-sided z-test at 95% with variance Σ p(1 − p)",
        "test_book_auc": {
            "auc": test_auc,
            "ci95": [test_ci["low"], test_ci["high"]],
            "defaults": int(y_test.sum()),
        },
        "auc_test": (
            f"both books bootstrapped independently ({ev.BOOTSTRAPS:,} resamples each); the 95% percentile interval "
            "of (book AUC − test-book AUC); the AUC has decayed only if that whole interval is below 0"
        ),
        "decay_rule": "performance has decayed when the calibration test fails or the AUC test fires",
        "books": {},
    }
    for name, b in books.items():
        r = book_report(data, model, int(b["seed"]), ref_X, ref_p, ref_apps_fico, lgd, test_auc, test_draws)
        r["seed"], r["setting"] = int(b["seed"]), b["setting"]
        r["applications"], r["all_defaults"] = int(b["applications"]), int(b["all_defaults"])
        r["psi_warned"] = bool(r["max_feature_psi"] >= WATCH or r["psi_score"]["psi"] >= WATCH)
        r["decayed"] = bool(r["calibration_test"]["off"] or r["auc_decayed"])
        out["books"][name] = r
        diff = r["auc_difference_vs_test"]
        log(
            f"  drift {name}: max feature PSI {r['max_feature_psi']:.3f}, score PSI {r['psi_score']['psi']:.3f}, "
            f"AUC {r['auc']:.3f} (difference {diff['difference']:+.3f}, CI {diff['ci95'][0]:+.3f} to {diff['ci95'][1]:+.3f}), "
            f"EL error {r['expected_loss']['relative_error']:+.1%}, "
            f"calibration off {r['calibration_test']['off']}, decayed {r['decayed']}"
        )
    return out

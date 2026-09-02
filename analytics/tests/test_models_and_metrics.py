from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from case_analytics.evaluation.economics import EconomicsParams, simulate_thresholds
from case_analytics.evaluation.metrics import (
    brier,
    classification_report,
    expected_calibration_error,
    metrics_at_threshold,
    tune_threshold,
)
from case_analytics.evaluation.underwriting import underwriting_outcomes
from case_analytics.models import ALL_MODELS, RulesBaseline
from case_analytics.monitoring.drift import psi


@pytest.mark.parametrize("cls", ALL_MODELS)
def test_each_model_fits_and_scores_in_unit_interval(cls, policy, frame) -> None:
    ps = policy.split(frame)
    y = ps.labels["is_fraud"].to_numpy()
    m = cls().fit(ps.X, y, policy)
    p = m.predict_proba(ps.X)
    assert p.shape == (len(frame),)
    assert np.all(p >= 0) and np.all(p <= 1)
    assert m.backend
    rep = classification_report("train", y, p, 0.5, ps.labels["fraud_type"], ps.labels["regime"])
    assert rep.pr_auc > 0.5  # signal is learnable on the synthetic frame
    assert rep.by_fraud_type and rep.by_regime


def test_rules_baseline_is_deterministic_and_reacts_to_rules(policy, frame) -> None:
    ps = policy.split(frame)
    m = RulesBaseline().fit(ps.X, ps.labels["is_fraud"].to_numpy(), policy)
    a, b = m.predict_proba(ps.X), m.predict_proba(ps.X)
    assert np.array_equal(a, b)
    row = ps.X.iloc[[0]].copy()
    row["disc_salary_vs_employer_pct"] = 0.0
    row["disc_obligations_vs_bureau"] = 0.0
    row["disc_employer_name_mismatch"] = 0
    row["evidence_large_deposit_count"] = 0
    row["ip_risk_score"] = 0.1
    row["is_tor"] = 0
    row["docs_created_within_2_days"] = 0
    row["disc_credit_score_claim_vs_bureau"] = 0
    row["claimed_monthly_obligations"] = 100
    quiet = m.predict_proba(row)[0]
    row["disc_employer_name_mismatch"] = 1
    assert m.predict_proba(row)[0] > quiet


def test_metrics_toy_case() -> None:
    y = [1, 1, 0, 0, 1]
    s = [0.9, 0.4, 0.8, 0.1, 0.6]
    m = metrics_at_threshold(y, s, 0.5)
    assert m["tp"] == 2 and m["fp"] == 1 and m["fn"] == 1 and m["tn"] == 1
    assert m["precision"] == pytest.approx(2 / 3)
    assert m["recall"] == pytest.approx(2 / 3)
    assert m["fpr"] == pytest.approx(0.5)


def test_ece_perfectly_calibrated_is_near_zero() -> None:
    rng = np.random.default_rng(1)
    p = rng.uniform(0, 1, 200_000)
    y = (rng.uniform(0, 1, 200_000) < p).astype(int)
    assert expected_calibration_error(y, p) < 0.01
    assert brier(y, p) < 0.2


def test_tune_threshold_respects_fpr_ceiling() -> None:
    rng = np.random.default_rng(2)
    y = (rng.random(2000) < 0.2).astype(int)
    s = np.clip(y * 0.5 + rng.normal(0.3, 0.2, 2000), 0, 1)
    t = tune_threshold(y, s, max_fpr=0.05)
    assert metrics_at_threshold(y, s, t)["fpr"] <= 0.05


def test_economics_sanity() -> None:
    rng = np.random.default_rng(3)
    y = (rng.random(1000) < 0.2).astype(int)
    s = np.clip(y * 0.6 + rng.normal(0.2, 0.15, 1000), 0, 1)
    table, best = simulate_thresholds(s, y, EconomicsParams(average_loss=50_000, manual_review_cost=100))
    assert 0 < best < 1
    # More fraud captured at lower thresholds; alerts fall monotonically as the threshold rises.
    assert table["alerts"].is_monotonic_decreasing
    assert table["fraud_captured"].is_monotonic_decreasing
    assert (table["fraud_captured"] + table["fraud_missed"]).round(6).nunique() == 1
    # Capacity caps reviewed alerts.
    capped, _ = simulate_thresholds(s, y, EconomicsParams(investigation_capacity=50))
    assert capped["alerts_reviewed"].max() <= 50.0 + 1e-6


def test_underwriting_outcomes_shape() -> None:
    r = underwriting_outcomes([0.1, 0.5, 0.9, 0.2], [0, 1, 1, 1], [300000, 300000, 300000, 300000])
    assert r["approval_rate"] == 0.5 and r["decline_rate"] == 0.25 and r["manual_review_rate"] == 0.25
    assert r["bad_rate_proxy"] == 0.5
    assert r["expected_loss_proxy"] > 0


@settings(max_examples=60, deadline=None)
@given(st.lists(st.tuples(st.integers(0, 1), st.floats(0, 1)), min_size=1, max_size=60), st.floats(0, 1))
def test_metrics_bounded(pairs, t) -> None:
    y = [p[0] for p in pairs]
    s = [p[1] for p in pairs]
    m = metrics_at_threshold(y, s, t)
    for k in ("precision", "recall", "f1", "fpr", "fnr", "specificity", "accuracy"):
        assert 0.0 <= m[k] <= 1.0
    assert 0.0 <= expected_calibration_error(y, s) <= 1.0
    assert 0.0 <= brier(y, s) <= 1.0


@settings(max_examples=40, deadline=None)
@given(st.lists(st.floats(-1e6, 1e6, allow_nan=False, allow_infinity=False), min_size=5, max_size=200))
def test_psi_identical_is_zero(xs) -> None:
    assert psi(np.array(xs), np.array(xs)) == pytest.approx(0.0, abs=1e-9)


def test_psi_detects_shift() -> None:
    rng = np.random.default_rng(4)
    a = rng.normal(0, 1, 5000)
    assert psi(a, rng.normal(0, 1, 5000)) < 0.05
    assert psi(a, rng.normal(1.5, 1, 5000)) > 0.25


def test_native_importance_available_for_trees(policy, frame) -> None:
    from case_analytics.models import GradientBoostingModel, RandomForestModel

    ps = policy.split(frame)
    y = ps.labels["is_fraud"].to_numpy()
    for cls in (RandomForestModel, GradientBoostingModel):
        m = cls(n_estimators=50).fit(ps.X, y, policy)
        imp = m.native_importance()
        assert isinstance(imp, pd.Series) and len(imp) == ps.X.shape[1]

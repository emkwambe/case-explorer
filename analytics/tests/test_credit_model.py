"""Credit PD model: leakage, the split, monotonicity, the snapshot and its documents.

Needs data/credit-model/ with the training books (node scripts/export_credit_features.mjs); CI
regenerates them and checks their SHA-256 against the manifest before these tests run.
"""

from __future__ import annotations

import hashlib
import json

import numpy as np
import pandas as pd
import pytest

from case_analytics.credit import docs
from case_analytics.credit.data import (
    DATA_DIR,
    FORBIDDEN_INPUTS,
    ORACLE_COLUMNS,
    assert_no_leakage,
    load_data,
    load_spec,
)
from case_analytics.credit.models import XGB_FIXED, predict, xgb
from case_analytics.credit.pipeline import SNAPSHOT_DIR, SUMMARY
from case_analytics.features.policy import DEFAULT_POLICY

SENSITIVE_OR_GEO = (
    "age",
    "age_band",
    "region",
    "zip_code",
    "cost_of_living_index",
    "persona",
    "regime",
    "geography_group",
    "income_band",
)


@pytest.fixture(scope="module")
def data():
    if not (DATA_DIR / "books").exists():
        pytest.skip("training books not generated (run node scripts/export_credit_features.mjs)")
    return load_data()


def test_inputs_share_nothing_with_the_oracle_dealer_or_sensitive_attributes():
    spec = load_spec()
    assert set(spec.features).isdisjoint(ORACLE_COLUMNS)
    assert set(spec.features).isdisjoint(FORBIDDEN_INPUTS)
    assert set(spec.features).isdisjoint(SENSITIVE_OR_GEO)
    assert all(DEFAULT_POLICY.classify(f) == "PERMITTED" for f in spec.features)
    assert not any(f.startswith(("truth", "true", "dealer", "label", "sensitive")) for f in spec.features)
    for bad in ("p_dpd30_true", "dealer_id", "corruption_type", "age", "zip_code"):
        with pytest.raises(ValueError):
            assert_no_leakage([*spec.features, bad])


def test_model_matrix_is_exactly_the_spec_features(data):
    X = data.X(data.frame([data.test]))
    assert list(X.columns) == list(data.spec.features)


def test_no_seed_42_loan_appears_in_training_or_calibration(data):
    held_out = set(data.test.apps["application_id"])
    for book in data.training + data.calibration:
        assert book.seed != 42
        assert held_out.isdisjoint(set(book.apps["application_id"])), book.seed
    seeds = data.manifest["seeds"]
    assert 42 not in seeds["training"] and 42 not in seeds["calibration"]
    assert set(seeds["training"]).isdisjoint(seeds["calibration"])


def test_training_books_hold_at_least_2000_defaults_and_the_test_book_is_the_locked_one(data):
    train = data.frame(data.training)
    assert int(train["dpd30"].sum()) >= 2000
    test = data.frame([data.test])
    assert (len(test), int(test["dpd30"].sum())) == (10_000, 225)


def test_oracle_true_pd_matches_the_charge_off_pd():
    oracle = pd.read_csv(DATA_DIR / "oracle-seed-42.csv")
    np.testing.assert_allclose(oracle["p_dpd30_true"] * 0.45, oracle["pd_chargeoff"], atol=1e-6)
    # The dealer-averaged PD is an expectation over the assignment distribution, not the dealer term
    # removed, so on average it matches the realised-dealer PD rather than sitting below it.
    mean_true, mean_avg = oracle["p_dpd30_true"].mean(), oracle["p_dpd30_dealer_averaged"].mean()
    assert abs(mean_avg - mean_true) < 0.1 * mean_true, (mean_avg, mean_true)


def test_monotonic_constraints_hold_on_a_sample_of_test_loans(data):
    summary = json.loads((SNAPSHOT_DIR / SUMMARY).read_text(encoding="utf-8"))
    winner = summary["tuning"]["credit_pd_xgb"]["winner"]
    train = data.frame(data.training)
    model = xgb(data.spec.monotone, **winner).fit(data.X(train), data.y(train))
    sample = data.X(data.frame([data.test])).sample(300, random_state=11)
    base = predict(model, sample)
    for name, direction in zip(data.spec.features, data.spec.monotone):
        bumped = sample.copy()
        step = 0.1 * float(np.nanstd(sample[name])) + (0.05 if name.endswith("_pct") else 1.0)
        bumped[name] = bumped[name] + step
        moved = predict(model, bumped) - base
        if direction > 0:
            assert (moved >= -1e-12).all(), f"raising {name} lowered PD"
        else:
            assert (moved <= 1e-12).all(), f"raising {name} raised PD"


def test_xgboost_settings_are_deterministic_and_unweighted():
    assert XGB_FIXED["scale_pos_weight"] == 1.0
    assert XGB_FIXED["n_jobs"] == 1
    assert XGB_FIXED["subsample"] == 1.0 and XGB_FIXED["colsample_bytree"] == 1.0


def test_snapshot_manifest_hashes_the_committed_files():
    meta = json.loads((SNAPSHOT_DIR / "SNAPSHOT.json").read_text(encoding="utf-8"))
    for name, entry in meta["files"].items():
        assert hashlib.sha256((SNAPSHOT_DIR / name).read_bytes()).hexdigest() == entry["sha256"], name
    data_manifest = (DATA_DIR / "manifest.json").read_bytes()
    assert hashlib.sha256(data_manifest).hexdigest() == meta["data_manifest_sha256"]


def test_shap_contributions_add_up_to_the_log_odds_on_every_test_loan(data):
    from case_analytics.credit import reasons as rs

    summary = json.loads((SNAPSHOT_DIR / SUMMARY).read_text(encoding="utf-8"))
    train = data.frame(data.training)
    model = xgb(data.spec.monotone, **summary["tuning"]["credit_pd_xgb"]["winner"]).fit(
        data.X(train), data.y(train)
    )
    Xte = data.X(data.frame([data.test]))
    values, base = rs.shap_values(
        model, Xte
    )  # raises if any row's contributions + base differ from its log-odds
    assert values.shape == (10_000, len(data.spec.features))
    assert abs(base - summary["reasons"]["base_value_log_odds"]) < 1e-6


def test_reasons_are_the_top_four_risk_raising_groups_with_their_statements():
    from case_analytics.credit import reasons as rs

    spec = load_spec()
    groups = list(spec.groups)
    row = np.array([0.5, -0.2, 0.1, 0.0, 0.3, 0.05, 0.2, -1.0, 0.4])
    assert len(row) == len(groups)
    top = rs.top_groups(row, groups)
    assert len(top) == 4 and all(row[groups.index(g)] > 0 for g in top)
    assert [row[groups.index(g)] for g in top] == sorted((row[groups.index(g)] for g in top), reverse=True)
    stated = rs.reasons_for(row, groups, spec)
    assert [r["statement"] for r in stated] == [spec.groups[g]["statement"] for g in top]
    assert rs.top_groups(-np.abs(row), groups) == []


def test_case_snapshot_covers_the_teaching_set_and_the_opening_library():
    cases = json.loads((SNAPSHOT_DIR / "credit-model-cases.json").read_text(encoding="utf-8"))
    assert len(cases["teaching"]) == 79 and len(cases["opening_library"]) == 13
    assert cases["label"] == "Second opinion only: the credit policy makes the decision."
    for entry in [*cases["teaching"].values(), *cases["opening_library"].values()]:
        assert 0 < entry["pd"] < 1
        assert len(entry["reasons"]) <= 4
        assert all(r["contribution"] > 0 and r["statement"] for r in entry["reasons"])


def test_materiality_threshold_is_chosen_on_calibration_and_keeps_false_reasons_at_most_5pct():
    from case_analytics.credit import reasons as rs

    m = json.loads((SNAPSHOT_DIR / SUMMARY).read_text(encoding="utf-8"))["reasons"]["materiality"]
    assert m["threshold_log_odds"] > 0
    assert "calibration books" in m["chosen_on"] and "test book plays no part" in m["chosen_on"]
    assert m["false_reason_rate"]["calibration_clean_after"] <= rs.MATERIALITY_TARGET
    assert (
        m["false_reason_rate"]["calibration_clean_after"] < m["false_reason_rate"]["calibration_clean_before"]
    )
    # The rule on a hand-built example: 20 clean rows, one discrepancy contribution each.
    groups = list(load_spec().groups)
    j = groups.index("ASSET_DISCREPANCY")
    gm = np.zeros((20, len(groups)))
    gm[:, j] = np.arange(1, 21) / 100
    tau = rs.choose_materiality(gm, groups, target=0.05)
    assert rs.false_reason_rate(gm, groups, tau) <= 0.05
    assert rs.false_reason_rate(gm, groups, tau - 1e-9) > 0.05 or tau == 0


def test_case_snapshot_states_only_reasons_above_the_threshold():
    cases = json.loads((SNAPSHOT_DIR / "credit-model-cases.json").read_text(encoding="utf-8"))
    tau = cases["materiality_threshold_log_odds"]
    for entry in [*cases["teaching"].values(), *cases["opening_library"].values()]:
        assert all(r["contribution"] > tau for r in entry["reasons"])


def test_policy_view_expected_loss_reconciles_to_the_locked_number():
    summary = json.loads((SNAPSHOT_DIR / SUMMARY).read_text(encoding="utf-8"))
    recon = json.loads(
        (DATA_DIR.parent / "credit-tape" / "credit-tape-reconciliation.json").read_text(encoding="utf-8")
    )
    assert (
        round(summary["policy_view"]["policy_expected_loss"]) == recon["loans"]["expected_loss"] == 4_413_431
    )


def test_fair_ceiling_is_the_dealer_averaged_true_pd_at_the_true_level():
    summary = json.loads((SNAPSHOT_DIR / SUMMARY).read_text(encoding="utf-8"))
    full, fair = (
        summary["ceilings"]["true_pd"]["metrics"],
        summary["ceilings"]["true_pd_dealer_averaged"]["metrics"],
    )
    assert abs(fair["mean_predicted"] - full["mean_predicted"]) < 0.1 * full["mean_predicted"]
    assert fair["auc"] < full["auc"]


def test_model_card_headline_numbers_are_the_snapshot_values():
    summary = json.loads((SNAPSHOT_DIR / SUMMARY).read_text(encoding="utf-8"))
    card = (docs.MODEL_CARD).read_text(encoding="utf-8")
    x = summary["models"]["credit_pd_xgb"]["test"]
    auc, low, high = x["metrics"]["auc"], x["ci95"]["auc"]["low"], x["ci95"]["auc"]["high"]
    assert f"{auc:.3f} ({low:.3f}–{high:.3f})" in card
    fair = summary["ceilings"]["true_pd_dealer_averaged"]["metrics"]["auc"]
    assert f"{fair:.3f}" in card
    assert "developer testing, not independent validation" in card
    assert "does not transfer to real data" in card


def test_generated_documents_are_current():
    for path, text in docs.documents().items():
        assert path.read_text(encoding="utf-8") == text, path

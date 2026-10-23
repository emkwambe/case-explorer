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
    np.testing.assert_allclose(oracle["p_dpd30_true"] * 0.45, oracle["pd_chargeoff"], atol=2e-6)
    assert (oracle["p_dpd30_no_dealer"] <= oracle["p_dpd30_true"] + 1e-6).all()


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


def test_generated_documents_are_current():
    for path, text in docs.documents().items():
        assert path.read_text(encoding="utf-8") == text, path

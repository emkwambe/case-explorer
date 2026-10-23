"""Sprint 12 properties: fairness, champion/challenger and reject inference, with Sprint 11's snapshot unchanged."""

from __future__ import annotations

import base64
import hashlib
import json

import numpy as np
import pandas as pd
import pytest

from case_analytics.credit import docs
from case_analytics.credit.data import DATA_DIR, assert_no_leakage
from case_analytics.credit.fairness import ATTRIBUTES, CHAMPION, MIN_RATED, ZIP3_TOP, katz, wilson
from case_analytics.credit.pipeline import CASES, PROPERTIES, SNAPSHOT_DIR, SUMMARY

# Sprint 11.1's snapshot (commit 516383c). Sprint 12 writes its results to a separate file, so these stay.
SPRINT_11_SHA256 = {
    SUMMARY: "606f3ee141185f92a1b62f8df8593d46058e9b9c5eb2bde4af455185ae1dc811",
    CASES: "a714639c711f9fd0edff024fff5eda8f421ac43bc5807af11fff7947f201503e",
}


def properties() -> dict:
    return json.loads((SNAPSHOT_DIR / PROPERTIES).read_text(encoding="utf-8"))


def test_sprint_11_summary_and_cases_are_byte_identical():
    for name, digest in SPRINT_11_SHA256.items():
        assert hashlib.sha256((SNAPSHOT_DIR / name).read_bytes()).hexdigest() == digest, name


def test_wilson_and_katz_match_hand_computed_intervals():
    lo, hi = wilson(5, 10)
    assert lo == pytest.approx(0.236593, abs=1e-6) and hi == pytest.approx(0.763407, abs=1e-6)
    # (20/100) / (40/100) = 0.5; se = sqrt(1/20 - 1/100 + 1/40 - 1/100) = sqrt(0.055)
    lo, hi = katz(20, 100, 40, 100)
    assert lo == pytest.approx(0.315752, abs=1e-6) and hi == pytest.approx(0.791762, abs=1e-6)
    assert wilson(0, 0) is None and katz(0, 10, 5, 10) is None


def test_sensitive_attributes_are_never_model_inputs():
    for a in ATTRIBUTES:
        with pytest.raises(ValueError):
            assert_no_leakage([a])


def test_flips_are_clean_on_every_set():
    fl = properties()["fairness"]["flips"]
    assert fl["clean"] is True
    assert set(fl["sets"]) == {"opening_library", "teaching_v1", "pool_seed_42"}
    for rows in fl["sets"].values():
        for r in rows:
            if r["kind"] == "financial":
                assert r["changed_without_dti_move"] == 0
            else:
                assert r["changed"] == 0, r


def test_group_tables_compare_at_the_champions_volume_with_the_as_is_policy_as_reference():
    f = properties()["fairness"]
    assert f["policies"][CHAMPION]["approvals"] == f["matched_volume"] == 9991
    assert f["policies"]["credit_pd_xgb_cutoff"]["approvals"] == f["matched_volume"]
    assert f["policies"]["as_is_policy_reference"]["approvals"] == 10000
    assert "not a fair benchmark" in f["policies"]["as_is_policy_reference"]["label"]
    assert set(f["groups"]) == set(ATTRIBUTES)
    for name, g in f["groups"].items():
        assert g["legitimate_credit_factor"] == (name == "income_band")
        for t in g["policies"].values():
            assert sum(r["applicants"] for r in t["groups"]) == t["applicants"] == 18674
            assert sum(r["approvals"] for r in t["groups"]) == t["approvals"]
            for r in t["groups"]:
                assert r["rated"] == (r["applicants"] >= MIN_RATED)
                assert (r["adverse_impact_ratio"] is not None) == r["rated"]
                lo, hi = r["rate_ci95"]
                assert lo <= r["rate"] <= hi
    zips = [r["group"] for r in f["groups"]["zip3"]["policies"][CHAMPION]["groups"]]
    assert len(zips) == ZIP3_TOP + 1 and zips[-1] == "other"


def test_proxy_check_names_features_only_above_0_60():
    for a, r in properties()["fairness"]["proxy"]["attributes"].items():
        assert r["auc_ci95"][0] <= r["auc"] <= r["auc_ci95"][1], a
        assert (r["top_features"] is not None) == (r["auc"] > 0.60), a
    # The synthetic scenario attributes are drawn independently of every financial variable.
    for a in ("family_status_scenario", "disability_income_scenario"):
        assert properties()["fairness"]["proxy"]["attributes"][a]["auc"] < 0.55


def test_model_card_carries_the_fairness_section_and_legal_status():
    card = docs.MODEL_CARD.read_text(encoding="utf-8")
    assert "## Fairness" in card
    assert "Legal status, as of October 2026." in card
    assert "they don't establish or rule out legal compliance" in card
    assert "developer testing, not independent validation" in card
    walk = docs.WALKTHROUGH.read_text(encoding="utf-8")
    assert "## 11. Fairness" in walk and "\n11. " in walk.split("## Answer key", 1)[1]


def test_air_has_a_reference_line_only_with_no_pass_fail_marking():
    f = properties()["fairness"]
    line = f["air_reference_line"]
    assert line["value"] == 0.8
    assert line["note"] == (
        "0.80 is the four-fifths screening heuristic from the EEOC's 1978 Uniform Guidelines on employee selection. "
        "It is a common informal screen, not a lending legal standard, and crossing it is not a finding of discrimination."
    )
    assert line["not_shown_for"] == ["income_band"]
    text = json.dumps(f["groups"]).lower()
    for word in ("below", "flag", "four_fifths", "fail", "pass"):
        assert word not in text, word
    card = docs.MODEL_CARD.read_text(encoding="utf-8")
    assert line["note"] in card
    assert "Below four-fifths" not in card
    income = card.split("**Income band**", 1)[1].split("\n\n**", 1)[0]
    assert "0.80" not in income and "reference line" not in income


def test_comparison_block_names_the_bureau_score_policy_as_champion_at_equal_volume():
    c = properties()["champion_challenger"]
    assert c["champion"] == CHAMPION == "bureau_score_policy"
    pol = c["policies"]
    n = pol[CHAMPION]["approvals"]
    assert n == 9991
    for name in ("challenger_a_xgb_alone", "challenger_b_overlay"):
        assert pol[name]["approvals"] == n, name
        assert pol[name]["swap_in"] == pol[name]["swap_out"], name
        assert "difference_vs_champion" in pol[name]
    assert pol["as_is_policy_reference"]["approvals"] == 10000
    # The as-is policy's approvals are the locked book: its expected loss is the locked number.
    assert round(pol["as_is_policy_reference"]["expected_loss"]) == 4413431


def test_overlay_rule_is_tuned_on_calibration_and_never_adds_a_fraud_referral():
    c = properties()["champion_challenger"]
    rule, tune = c["policies"]["challenger_b_overlay"]["rule"], c["overlay_tuning"]
    feasible = [g for g in tune["grid"] if g["feasible"]]
    best = min(feasible, key=lambda g: (g["expected_loss"], g["f"]))
    assert rule["f"] == tune["chosen_f"] == best["f"]
    assert rule["k"] == round(rule["f"] * c["policies"][CHAMPION]["approvals"])
    assert c["policies"]["challenger_b_overlay"]["swap_in"] == rule["k"]
    dec = pd.read_csv(DATA_DIR / "decisions-seed-42.csv")
    b = bits(properties()["sandbox_candidates"]["candidates"]["challenger_b_overlay"]["bitmask"], len(dec))
    champion = (dec["decision_bureau"] == "APPROVE").to_numpy()
    added = b & ~champion
    assert added.sum() == rule["k"]
    assert (dec.loc[added, "decision_bureau"] == "REVIEW").all()
    assert (dec.loc[added, "fraud_review"] == 0).all()


def bits(b64: str, n: int) -> np.ndarray:
    return np.unpackbits(np.frombuffer(base64.b64decode(b64), dtype=np.uint8))[:n].astype(bool)


def test_sandbox_bitmasks_decode_to_the_reported_approvals_over_the_pool_order():
    sb = properties()["sandbox_candidates"]
    ids = pd.read_csv(DATA_DIR / "applications-seed-42.csv", usecols=["application_id"])["application_id"]
    assert sb["pool_applications"] == len(ids) == 18674
    assert sb["pool_sha256"] == hashlib.sha256("\n".join(ids).encode("utf-8")).hexdigest()
    assert sb["label"] == "model-based, evaluation only"
    pol = properties()["champion_challenger"]["policies"]
    for name, cand in sb["candidates"].items():
        assert bits(cand["bitmask"], len(ids)).sum() == cand["approvals"] == pol[name]["approvals"], name


def test_reject_inference_uses_training_books_only_and_reproduces_sprint_11():
    r = properties()["reject_inference"]
    manifest = json.loads((DATA_DIR / "manifest.json").read_text(encoding="utf-8"))
    training = manifest["seeds"]["training"]
    assert r["training_books"]["seeds"] == training and 42 not in training
    assert r["training_books"]["applications"] == sum(
        manifest["books"][str(s)]["applications"] for s in training
    )
    summary = json.loads((SNAPSHOT_DIR / SUMMARY).read_text(encoding="utf-8"))
    for fam, sets in r["training_sets"].items():
        assert sets["oracle"]["rows"] == r["training_books"]["applications"], fam
        assert sets["hard_cutoff"]["rows"] == r["training_books"]["applications"], fam
        assert (
            sets["fuzzy"]["rows"] == r["training_books"]["funded"] + 2 * r["training_books"]["not_funded"]
        ), fam
        f0 = r["families"][fam]["funded_only"]
        assert f0["auc_funded_test_book"] == pytest.approx(
            summary["models"][fam]["test"]["metrics"]["auc"], abs=1e-6
        )
    lg = r["families"]["credit_pd_logistic"]["funded_only"]
    assert lg["fico_coefficient_per_sd"] == pytest.approx(
        summary["models"]["credit_pd_logistic"]["coefficients_per_sd"]["fico_bureau"], abs=1e-6
    )
    for fam in r["families"].values():
        assert set(fam) == {"funded_only", "hard_cutoff", "fuzzy", "oracle"}

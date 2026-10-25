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


def test_overlay_swaps_by_typology_add_up_to_its_difference_and_the_card_names_inflation():
    b = properties()["champion_challenger"]["policies"]["challenger_b_overlay"]
    sw = b["swaps_by_hidden_typology"]
    out = sum(v["expected_loss"] for v in sw["swap_out"].values())
    added = sum(v["expected_loss"] for v in sw["swap_in"].values())
    assert sum(v["loans"] for v in sw["swap_out"].values()) == b["swap_out"]
    assert sum(v["loans"] for v in sw["swap_in"].values()) == b["swap_in"]
    assert added - out == pytest.approx(b["difference_vs_champion"]["expected_loss"]["point"], abs=0.01)
    card = docs.MODEL_CARD.read_text(encoding="utf-8")
    cc = card.split("## Champion/challenger", 1)[1].split("\n## ", 1)[0]
    assert "mostly income-inflation fraud" in cc
    assert "does not transfer to real data" in cc


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


def test_psi_matches_a_hand_computed_example():
    from case_analytics.monitoring.drift import psi

    expected = np.arange(100)  # ten deciles of ten values each
    # The actual sample doubles the first two deciles (20 values each), keeps 10 in each of the next six,
    # and leaves the last two (80–99) empty, which take the 1e-6 floor. PSI = Σ (a − e) ln(a / e):
    actual = np.concatenate([np.arange(0, 10).repeat(2), np.arange(10, 20).repeat(2), np.arange(20, 80)])
    e, a, floor = 0.1, 0.2, 1e-6
    hand = 2 * (a - e) * np.log(a / e) + 2 * (floor - e) * np.log(floor / e)
    assert psi(expected, actual) == pytest.approx(hand, rel=1e-9)


def test_control_book_psi_is_under_0_10_on_every_feature_and_the_score():
    control = properties()["drift"]["books"]["control"]
    assert control["setting"] == "unchanged"
    assert control["max_feature_psi"] < 0.10
    assert all(v["psi"] < 0.10 for v in control["psi_features"].values())
    assert control["psi_score"]["psi"] < 0.10
    assert control["features_at_watch_or_act"] == []


def test_drift_books_are_new_seeds_kept_apart_from_the_model_books():
    manifest = json.loads((DATA_DIR / "manifest.json").read_text(encoding="utf-8"))
    drift = manifest["drift_books"]
    assert set(drift) == {"control", "lower_fico", "more_fraud", "weaker_dealers"}
    used = {manifest["seeds"]["test"], *manifest["seeds"]["training"], *manifest["seeds"]["calibration"]}
    assert not used & {d["seed"] for d in drift.values()}
    assert "drift" not in manifest["seeds"] and not set(manifest["books"]) & {
        str(d["seed"]) for d in drift.values()
    }
    for name, d in drift.items():
        assert manifest["files"][f"books/applications-seed-{d['seed']}.csv"]["sha256"], name
        assert properties()["drift"]["books"][name]["setting"] == d["setting"]


def test_decay_is_a_failed_calibration_test_or_an_auc_difference_interval_wholly_below_0():
    d = properties()["drift"]
    test = json.loads((SNAPSHOT_DIR / SUMMARY).read_text(encoding="utf-8"))["models"]["credit_pd_xgb"]["test"]
    # The test book's resamples use the summary's bootstrap seed, so its interval is the summary's.
    assert d["test_book_auc"]["auc"] == pytest.approx(test["metrics"]["auc"], abs=1e-6)
    assert d["test_book_auc"]["ci95"] == pytest.approx(
        [test["ci95"]["auc"]["low"], test["ci95"]["auc"]["high"]], abs=1e-6
    )
    for name, r in d["books"].items():
        diff = r["auc_difference_vs_test"]
        assert diff["difference"] == pytest.approx(r["auc"] - test["metrics"]["auc"], abs=2e-6), name
        assert diff["ci95"][0] <= diff["difference"] <= diff["ci95"][1], name
        assert r["auc_decayed"] == (diff["ci95"][1] < 0), name
        assert r["decayed"] == (r["calibration_test"]["off"] or r["auc_decayed"]), name
    # An unchanged book must not read as decayed.
    assert d["books"]["control"]["decayed"] is False
    card = docs.MODEL_CARD.read_text(encoding="utf-8")
    assert (
        "the calibration test fails, or the AUC test fires" in card and "| AUC − test book (95% CI) |" in card
    )
    assert (
        "AUC can't reliably detect drops of about 0.05" in card
        and "Calibration is the more sensitive monitor here" in card
    )


def test_drift_card_names_each_psi_against_the_line_it_crossed_and_why_the_score_barely_moved():
    d = properties()["drift"]
    lf = d["books"]["lower_fico"]
    assert lf["psi_features"]["fico_bureau"]["rating"] == "act" and lf["psi_score"]["rating"] == "stable"
    fo = lf["fico_only"]
    assert fo["mean_shift"] == pytest.approx(
        lf["mean_fico_bureau"] - d["reference_mean_fico_bureau"]["funded"], abs=1e-4
    )
    walkthrough = docs.WALKTHROUGH.read_text(encoding="utf-8")
    for text in (docs.MODEL_CARD.read_text(encoding="utf-8"), walkthrough):
        assert "reached the watch line" not in text
        assert (
            f"PSI is {lf['psi_features']['fico_bureau']['psi']:.3f} on `fico_bureau`, past the 0.25 action line"
            in text
        )
        assert f"the score's own PSI is {lf['psi_score']['psi']:.3f}, under the 0.10 watch line" in text
        assert f"for a score PSI of {fo['score_psi']:.3f}" in text
    assert "10. Any two of: independent validation; out-of-time testing; real data." in walkthrough


def test_reject_inference_band_effects_weighted_by_the_pool_add_up_to_the_mean_effect():
    r = properties()["reject_inference"]
    share = r["pool_fico_band_share"]
    assert sum(share.values()) == pytest.approx(1.0, abs=1e-5)
    for fam, rows in r["families"].items():
        for method, row in rows.items():
            weighted = sum(share[b] * row["fico_effect_by_band"][b] for b in share)
            assert weighted == pytest.approx(row["fico_effect_per_sd"], abs=1e-5), (fam, method)
    ri = docs.MODEL_CARD.read_text(encoding="utf-8").split("## Reject inference", 1)[1].split("\n## ", 1)[0]
    lg = r["families"]["credit_pd_logistic"]
    assert "On the table's measure" in ri and "FICO coefficient goes from" not in ri
    assert f"the oracle's is {lg['oracle']['fico_effect_per_sd']:+.3f}".replace("-", "−") in ri
    assert "**Where `credit_pd_xgb` puts its FICO effect.**" in ri

"""Sprint 12 properties: fairness (flips, group tables, proxy check), with Sprint 11's snapshot unchanged."""

from __future__ import annotations

import hashlib
import json

import pytest

from case_analytics.credit import docs
from case_analytics.credit.data import assert_no_leakage
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

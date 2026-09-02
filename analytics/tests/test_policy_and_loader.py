from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from case_analytics.datasets import ManifestMismatch, load_bundle, load_split
from case_analytics.features.policy import FeaturePolicyViolation, load_policy


def test_PROHIBITED_COLUMNS_TEST_truth_salary_rejected(policy, frame) -> None:
    bad = frame.copy()
    bad["truth_salary"] = 1.0
    with pytest.raises(FeaturePolicyViolation, match="truth_salary"):
        policy.split(bad)


def test_policy_splits_permitted_sensitive_labels(policy, frame) -> None:
    ps = policy.split(frame)
    assert "label__is_fraud" not in ps.X.columns
    assert "is_fraud" in ps.labels.columns
    assert "age_band" in ps.sensitive.columns
    assert all(not c.startswith("sensitive__") for c in ps.X.columns)
    assert policy.classify("age") == "SENSITIVE"
    assert policy.classify("expected_outcome") == "PROHIBITED"
    with pytest.raises(FeaturePolicyViolation):
        policy.assert_permitted(["claimed_salary", "age"])


def test_policy_loads_from_json(tmp_path: Path) -> None:
    p = tmp_path / "policy.json"
    p.write_text(
        json.dumps(
            {
                "version": "9.9.9",
                "sensitive_attributes": ["zip"],
                "prohibited_prefixes": ["gt_"],
                "prohibited_fields": ["ssn"],
            }
        )
    )
    pol = load_policy(p)
    assert pol.version == "9.9.9"
    assert pol.classify("gt_x") == "PROHIBITED"
    assert pol.classify("zip") == "SENSITIVE"


def test_loader_sha_check(tmp_path: Path, frame: pd.DataFrame) -> None:
    csv = tmp_path / "train.csv"
    frame.to_csv(csv, index=False)
    manifest = {"file": "train.csv", "record_count": len(frame), "file_sha256": "sha256:deadbeef"}
    (tmp_path / "train.manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ManifestMismatch):
        load_split(tmp_path, "train")
    s = load_split(tmp_path, "train", verify=False)
    assert len(s.frame) == len(frame)


def test_bundle_lineage(data_dir: Path) -> None:
    b = load_bundle(data_dir)
    lin = b.lineage()
    assert "train" in lin["splits"]
    assert lin["splits"]["train"]["configuration_hash"].startswith("sha256:")
    assert b.train.frame.shape[0] == b.train.manifest["record_count"]

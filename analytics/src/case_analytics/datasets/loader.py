"""Governed dataset loading with manifest verification and lineage."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from case_analytics.features.policy import DEFAULT_POLICY, FeaturePolicy, PolicySplit, load_policy

SPLITS = (
    "train",
    "validation",
    "test",
    "out_of_time",
    "geography_stress",
    "economic_regime_stress",
    "adversarial_fraud",
    "clean_negative_control",
)


class ManifestMismatch(RuntimeError):
    """Raised when a dataset file does not match the sha256 recorded in its manifest."""


@dataclass(frozen=True)
class Split:
    name: str
    frame: pd.DataFrame
    manifest: dict[str, Any]

    def policy_split(self, policy: FeaturePolicy) -> PolicySplit:
        return policy.split(self.frame)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return "sha256:" + h.hexdigest()


def load_split(data_dir: str | Path, name: str, *, verify: bool = True) -> Split:
    data_dir = Path(data_dir)
    manifest_path = data_dir / f"{name}.manifest.json"
    manifest: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
    csv_path = data_dir / str(manifest.get("file", f"{name}.csv"))
    if verify:
        expected = manifest.get("file_sha256")
        actual = _sha256(csv_path)
        if expected and expected != actual:
            raise ManifestMismatch(f"{csv_path.name}: manifest sha {expected} != file sha {actual}")
    frame = pd.read_csv(csv_path)
    if int(manifest.get("record_count", len(frame))) != len(frame):
        raise ManifestMismatch(
            f"{csv_path.name}: manifest record_count {manifest['record_count']} != {len(frame)} rows"
        )
    return Split(name=name, frame=frame, manifest=manifest)


@dataclass
class DatasetBundle:
    data_dir: Path
    splits: dict[str, Split]
    policy: FeaturePolicy
    index: dict[str, Any]
    fraud_rules: dict[str, Any]

    def __getattr__(self, item: str) -> Split:
        if item in SPLITS:
            return self.splits[item]
        raise AttributeError(item)

    def get(self, name: str) -> Split:
        return self.splits[name]

    def lineage(self) -> dict[str, Any]:
        return {
            "dataset_version": self.index.get("dataset_version"),
            "generator_version": self.index.get("generator_version"),
            "generator_commit": self.index.get("generator_commit"),
            "seed": self.index.get("seed"),
            "generated_at": self.index.get("generated_at"),
            "feature_schema_version": self.splits["train"].manifest.get("feature_schema_version"),
            "feature_policy_version": self.policy.version,
            "ruleset_version": self.fraud_rules.get("ruleset_version"),
            "splits": {
                name: {
                    "configuration_hash": s.manifest.get("configuration_hash"),
                    "seed": s.manifest.get("seed"),
                    "as_of_date": s.manifest.get("as_of_date"),
                    "population_regime": s.manifest.get("population_regime"),
                    "record_count": s.manifest.get("record_count"),
                    "fraud_rate": s.manifest.get("fraud_rate"),
                    "file_sha256": s.manifest.get("file_sha256"),
                }
                for name, s in self.splits.items()
            },
        }


def load_bundle(data_dir: str | Path, *, verify: bool = True, quick: int | None = None) -> DatasetBundle:
    data_dir = Path(data_dir)
    policy_path = data_dir / "feature_policy.json"
    policy = load_policy(policy_path) if policy_path.exists() else DEFAULT_POLICY
    index_path = data_dir / "datasets.manifest.json"
    index: dict[str, Any] = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
    rules_path = data_dir / "fraud_rules.json"
    rules: dict[str, Any] = json.loads(rules_path.read_text(encoding="utf-8")) if rules_path.exists() else {}
    splits: dict[str, Split] = {}
    for name in SPLITS:
        if not (data_dir / f"{name}.manifest.json").exists():
            continue
        split = load_split(data_dir, name, verify=verify)
        if quick and len(split.frame) > quick:
            split = Split(
                name=name,
                frame=split.frame.sample(quick, random_state=42).reset_index(drop=True),
                manifest=split.manifest,
            )
        splits[name] = split
    if "train" not in splits:
        raise FileNotFoundError(f"No train split found in {data_dir}")
    return DatasetBundle(data_dir=data_dir, splits=splits, policy=policy, index=index, fraud_rules=rules)

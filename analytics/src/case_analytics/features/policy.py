"""Feature policy enforcement: PERMITTED / SENSITIVE / PROHIBITED.

Mirrors src/decisioning/policies/feature_policy.js. The JSON policy exported by the JS
generator (feature_policy.json) is the single source of truth; this module only interprets it.
Every model entry point must pass its frame through :meth:`FeaturePolicy.split` so that
ground truth, labels and identity columns can never reach a model.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

SENSITIVE_PREFIX = "sensitive__"
LABEL_PREFIX = "label__"


class FeaturePolicyViolation(ValueError):
    """Raised when prohibited columns are presented as model inputs."""


@dataclass(frozen=True)
class PolicySplit:
    X: pd.DataFrame
    sensitive: pd.DataFrame
    labels: pd.DataFrame
    prohibited: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class FeaturePolicy:
    version: str
    sensitive_attributes: tuple[str, ...]
    prohibited_prefixes: tuple[str, ...]
    prohibited_fields: tuple[str, ...]

    def classify(self, column: str) -> str:
        if column.startswith(SENSITIVE_PREFIX):
            return "SENSITIVE"
        if column.startswith(LABEL_PREFIX):
            return "LABEL"
        if column in self.prohibited_fields:
            return "PROHIBITED"
        if any(column.startswith(p) for p in self.prohibited_prefixes):
            return "PROHIBITED"
        if column in self.sensitive_attributes:
            return "SENSITIVE"
        return "PERMITTED"

    def split(self, frame: pd.DataFrame, *, strict: bool = True) -> PolicySplit:
        permitted: list[str] = []
        sensitive: list[str] = []
        labels: list[str] = []
        prohibited: list[str] = []
        for col in frame.columns:
            cls = self.classify(str(col))
            if cls == "PERMITTED":
                permitted.append(col)
            elif cls == "SENSITIVE":
                sensitive.append(col)
            elif cls == "LABEL":
                labels.append(col)
            else:
                prohibited.append(col)
        if strict and prohibited:
            raise FeaturePolicyViolation(
                f"Feature policy violation: prohibited columns present in model inputs: {', '.join(prohibited)}"
            )
        sens = frame[sensitive].copy()
        sens.columns = [c.replace(SENSITIVE_PREFIX, "") for c in sens.columns]
        labs = frame[labels].copy()
        labs.columns = [c.replace(LABEL_PREFIX, "") for c in labs.columns]
        return PolicySplit(X=frame[permitted].copy(), sensitive=sens, labels=labs, prohibited=prohibited)

    def assert_permitted(self, columns: list[str]) -> None:
        bad = [c for c in columns if self.classify(c) != "PERMITTED"]
        if bad:
            raise FeaturePolicyViolation(f"Non-permitted columns passed to a model: {', '.join(bad)}")


def load_policy(path: str | Path) -> FeaturePolicy:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return FeaturePolicy(
        version=str(data.get("version", "unknown")),
        sensitive_attributes=tuple(data.get("sensitive_attributes", [])),
        prohibited_prefixes=tuple(data.get("prohibited_prefixes", [])),
        prohibited_fields=tuple(data.get("prohibited_fields", [])),
    )


DEFAULT_POLICY = FeaturePolicy(
    version="1.0.0",
    sensitive_attributes=(
        "age",
        "age_band",
        "zip_code",
        "region",
        "geography_group",
        "income_band",
        "family_status_scenario",
        "disability_income_scenario",
        "persona",
        "cost_of_living_index",
    ),
    prohibited_prefixes=("truth_", "label_", "outcome_", "gt_"),
    prohibited_fields=(
        "case_id",
        "name",
        "ssn_last4",
        "seed",
        "expected_outcome",
        "is_fraud",
        "corruption_type",
    ),
)

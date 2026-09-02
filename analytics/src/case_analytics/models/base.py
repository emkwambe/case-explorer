"""Common model protocol."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

import numpy as np
import pandas as pd

from case_analytics.features.policy import FeaturePolicy

SEED = 42


@runtime_checkable
class FraudModel(Protocol):
    name: str
    version: str
    backend: str
    feature_names: list[str]

    def fit(self, X: pd.DataFrame, y: np.ndarray, policy: FeaturePolicy | None = None) -> FraudModel: ...

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray: ...

    def params(self) -> dict[str, Any]: ...


def check_inputs(X: pd.DataFrame, policy: FeaturePolicy | None) -> pd.DataFrame:
    """Enforce the feature policy and coerce to a numeric frame."""
    if policy is not None:
        policy.assert_permitted([str(c) for c in X.columns])
    Xn = X.apply(pd.to_numeric, errors="coerce").fillna(0.0).astype(float)
    return Xn


def align(X: pd.DataFrame, feature_names: list[str]) -> pd.DataFrame:
    Xn = X.apply(pd.to_numeric, errors="coerce").fillna(0.0).astype(float)
    return Xn.reindex(columns=feature_names, fill_value=0.0)

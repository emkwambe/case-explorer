"""Random forest."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier

from case_analytics.features.policy import FeaturePolicy

from .base import SEED, align, check_inputs


class RandomForestModel:
    name = "random_forest"
    version = "1.0.0"
    backend = "sklearn"

    def __init__(
        self, n_estimators: int = 300, max_depth: int | None = 12, min_samples_leaf: int = 3
    ) -> None:
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.min_samples_leaf = min_samples_leaf
        self.feature_names: list[str] = []
        self.model = RandomForestClassifier(
            n_estimators=n_estimators,
            max_depth=max_depth,
            min_samples_leaf=min_samples_leaf,
            class_weight="balanced_subsample",
            random_state=SEED,
            n_jobs=1,
        )

    def fit(self, X: pd.DataFrame, y: np.ndarray, policy: FeaturePolicy | None = None) -> RandomForestModel:
        Xn = check_inputs(X, policy)
        self.feature_names = [str(c) for c in Xn.columns]
        self.model.fit(Xn.to_numpy(), y)
        return self

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        return self.model.predict_proba(align(X, self.feature_names).to_numpy())[:, 1]

    def native_importance(self) -> pd.Series:
        return pd.Series(self.model.feature_importances_, index=self.feature_names).sort_values(
            ascending=False
        )

    def params(self) -> dict[str, Any]:
        return {
            "n_estimators": self.n_estimators,
            "max_depth": self.max_depth,
            "min_samples_leaf": self.min_samples_leaf,
            "class_weight": "balanced_subsample",
        }

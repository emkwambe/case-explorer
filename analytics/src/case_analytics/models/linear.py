"""Logistic regression with standardisation."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from case_analytics.features.policy import FeaturePolicy

from .base import SEED, align, check_inputs


class LogisticRegressionModel:
    name = "logistic_regression"
    version = "1.0.0"
    backend = "sklearn"

    def __init__(self, C: float = 0.5, max_iter: int = 2000) -> None:
        self.C = C
        self.max_iter = max_iter
        self.feature_names: list[str] = []
        self.pipeline = Pipeline(
            [
                ("scale", StandardScaler()),
                (
                    "lr",
                    LogisticRegression(C=C, max_iter=max_iter, class_weight="balanced", random_state=SEED),
                ),
            ]
        )

    def fit(
        self, X: pd.DataFrame, y: np.ndarray, policy: FeaturePolicy | None = None
    ) -> LogisticRegressionModel:
        Xn = check_inputs(X, policy)
        self.feature_names = [str(c) for c in Xn.columns]
        self.pipeline.fit(Xn.to_numpy(), y)
        return self

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        Xa = align(X, self.feature_names)
        return self.pipeline.predict_proba(Xa.to_numpy())[:, 1]

    def coefficients(self) -> pd.Series:
        lr = self.pipeline.named_steps["lr"]
        return pd.Series(lr.coef_[0], index=self.feature_names).sort_values(key=np.abs, ascending=False)

    def params(self) -> dict[str, Any]:
        return {"C": self.C, "max_iter": self.max_iter, "class_weight": "balanced", "scaler": "standard"}

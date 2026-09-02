"""Gradient boosting: LightGBM, falling back to XGBoost, then sklearn HistGradientBoosting."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from case_analytics.features.policy import FeaturePolicy

from .base import SEED, align, check_inputs


def _make_backend(
    n_estimators: int, learning_rate: float, max_depth: int, scale_pos_weight: float
) -> tuple[str, Any]:
    try:
        import lightgbm as lgb

        return "lightgbm", lgb.LGBMClassifier(
            n_estimators=n_estimators,
            learning_rate=learning_rate,
            max_depth=max_depth,
            num_leaves=min(31, 2**max_depth - 1),
            subsample=0.9,
            subsample_freq=1,
            colsample_bytree=0.9,
            scale_pos_weight=scale_pos_weight,
            random_state=SEED,
            verbose=-1,
            n_jobs=1,
        )
    except ImportError:
        pass
    try:
        import xgboost as xgb

        return "xgboost", xgb.XGBClassifier(
            n_estimators=n_estimators,
            learning_rate=learning_rate,
            max_depth=max_depth,
            subsample=0.9,
            colsample_bytree=0.9,
            scale_pos_weight=scale_pos_weight,
            random_state=SEED,
            n_jobs=1,
            eval_metric="logloss",
        )
    except ImportError:
        pass
    from sklearn.ensemble import HistGradientBoostingClassifier

    return "sklearn-hgb", HistGradientBoostingClassifier(
        max_iter=n_estimators, learning_rate=learning_rate, max_depth=max_depth, random_state=SEED
    )


class GradientBoostingModel:
    name = "gradient_boosting"
    version = "1.0.0"

    def __init__(self, n_estimators: int = 400, learning_rate: float = 0.05, max_depth: int = 5) -> None:
        self.n_estimators = n_estimators
        self.learning_rate = learning_rate
        self.max_depth = max_depth
        self.feature_names: list[str] = []
        self.backend = "unfitted"
        self.model: Any = None

    def fit(
        self, X: pd.DataFrame, y: np.ndarray, policy: FeaturePolicy | None = None
    ) -> GradientBoostingModel:
        Xn = check_inputs(X, policy)
        self.feature_names = [str(c) for c in Xn.columns]
        pos = max(1, int(np.sum(y == 1)))
        neg = max(1, int(np.sum(y == 0)))
        self.backend, self.model = _make_backend(
            self.n_estimators, self.learning_rate, self.max_depth, neg / pos
        )
        self.model.fit(Xn.to_numpy(), y)
        return self

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        return self.model.predict_proba(align(X, self.feature_names).to_numpy())[:, 1]

    def native_importance(self) -> pd.Series:
        imp = getattr(self.model, "feature_importances_", None)
        if imp is None:
            return pd.Series(dtype=float)
        s = pd.Series(np.asarray(imp, dtype=float), index=self.feature_names)
        if s.sum() > 0:
            s = s / s.sum()
        return s.sort_values(ascending=False)

    def params(self) -> dict[str, Any]:
        return {
            "backend": self.backend,
            "n_estimators": self.n_estimators,
            "learning_rate": self.learning_rate,
            "max_depth": self.max_depth,
        }

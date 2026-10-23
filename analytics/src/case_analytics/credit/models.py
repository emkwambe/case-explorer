"""The two PD models: a standardised logistic-regression baseline and `credit_pd_xgb`.

Neither reweights the classes, so both outputs stay probabilities. `credit_pd_xgb` carries the
monotonic constraints from the feature spec and a deterministic configuration: the histogram tree
method with the default 256 bins, one thread, no row or column sampling and a fixed seed. (The exact
method is also deterministic but took 24 s per fit against 2.5 s at the largest grid point on 80,000
rows; both reproduced bit-for-bit on a rerun, so hist was chosen for the search's cost.)
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

MODEL_SEED = 11
XGB_NAME = "credit_pd_xgb"
LOGIT_NAME = "credit_pd_logistic"

XGB_GRID: dict[str, list[Any]] = {
    "max_depth": [2, 3, 4],
    "learning_rate": [0.05, 0.1],
    "n_estimators": [150, 400],
    "min_child_weight": [1, 10],
}
LOGIT_GRID: dict[str, list[Any]] = {"C": [0.1, 1.0, 10.0]}

XGB_FIXED: dict[str, Any] = {
    "objective": "binary:logistic",
    "eval_metric": "logloss",
    "tree_method": "hist",
    "n_jobs": 1,
    "subsample": 1.0,
    "colsample_bytree": 1.0,
    "scale_pos_weight": 1.0,
    "random_state": MODEL_SEED,
}


def logistic(C: float = 1.0) -> Pipeline:
    """Median imputation (missing documents), standardisation, then L2 logistic regression."""
    return Pipeline(
        [
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
            ("lr", LogisticRegression(C=C, max_iter=5000)),
        ]
    )


def xgb(monotone: tuple[int, ...], **params: Any) -> Any:
    import xgboost

    return xgboost.XGBClassifier(
        **{**XGB_FIXED, **params}, monotone_constraints=tuple(int(m) for m in monotone)
    )


def predict(model: Any, X: pd.DataFrame) -> np.ndarray:
    return np.asarray(model.predict_proba(X)[:, 1], dtype=float)


def logistic_coefficients(model: Pipeline, features: tuple[str, ...]) -> dict[str, float]:
    """Coefficients per standard deviation of each feature (the scaled inputs), and the intercept."""
    lr = model.named_steps["lr"]
    out = {f: float(c) for f, c in zip(features, lr.coef_[0])}
    out["(intercept)"] = float(lr.intercept_[0])
    return out

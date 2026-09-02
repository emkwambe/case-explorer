"""Underwriting-outcome metrics for a three-band score policy."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class UnderwritingParams:
    review_threshold: float = 0.3
    decline_threshold: float = 0.7
    loss_given_fraud: float = 0.35
    minutes_per_review: float = 45.0


def underwriting_outcomes(
    scores: Any, y_true: Any, loan_amount: Any, params: UnderwritingParams = UnderwritingParams()
) -> dict[str, Any]:
    s = np.asarray(scores, dtype=float)
    y = np.asarray(y_true, dtype=float) > 0.5
    loan = np.asarray(loan_amount, dtype=float)
    n = max(1, len(s))
    approve = s < params.review_threshold
    decline = s >= params.decline_threshold
    review = ~approve & ~decline
    approved_fraud = approve & y
    declined_clean = decline & ~y
    friction = (review | decline) & ~y
    return {
        "approval_rate": float(approve.mean()),
        "manual_review_rate": float(review.mean()),
        "decline_rate": float(decline.mean()),
        "bad_rate_proxy": float(approved_fraud.sum() / max(1, approve.sum())),
        "expected_loss_proxy": float((loan[approved_fraud] * params.loss_given_fraud).sum()),
        "expected_loss_per_approved_loan": float(
            (loan[approved_fraud] * params.loss_given_fraud).sum() / max(1, approve.sum())
        ),
        "false_decline_rate": float(declined_clean.sum() / max(1, (~y).sum())),
        "review_workload_count": int(review.sum()),
        "review_workload_hours": float(review.sum() * params.minutes_per_review / 60.0),
        "customer_friction_proxy": float(friction.sum() / max(1, (~y).sum())),
        "fraud_captured_rate": float((y & ~approve).sum() / max(1, y.sum())),
        "n": int(n),
        "params": params.__dict__,
    }


def outcomes_table(
    scores: Any, y_true: Any, loan_amount: Any, decline_thresholds: list[float]
) -> pd.DataFrame:
    rows = []
    for d in decline_thresholds:
        p = UnderwritingParams(review_threshold=min(0.3, d / 2), decline_threshold=d)
        r = underwriting_outcomes(scores, y_true, loan_amount, p)
        r.pop("params")
        r["decline_threshold"] = d
        rows.append(r)
    return pd.DataFrame(rows)

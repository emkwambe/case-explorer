"""Decision economics: threshold simulator.

Expected Value = fraud loss avoided
               - false-positive review cost
               - customer friction cost
               - model operating cost
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class EconomicsParams:
    fraud_prevalence: float | None = None  # None -> use observed prevalence
    average_loss: float = 60_000.0  # loss per undetected fraud
    manual_review_cost: float = 85.0  # per alert reviewed
    false_decline_cost: float = 1_200.0  # lost revenue + friction per legitimate applicant declined/alerted
    investigation_capacity: int | None = None  # max alerts reviewable; excess are unreviewed
    model_operating_cost: float = 2.0  # per scored application
    minutes_per_review: float = 45.0
    review_to_decline_rate: float = 0.85  # share of true-fraud alerts that investigators confirm


def simulate_thresholds(
    scores: Any,
    y_true: Any,
    params: EconomicsParams = EconomicsParams(),
    thresholds: np.ndarray | None = None,
) -> tuple[pd.DataFrame, float]:
    s = np.asarray(scores, dtype=float)
    y = np.asarray(y_true, dtype=float) > 0.5
    n = len(s)
    if thresholds is None:
        thresholds = np.round(np.arange(0.05, 0.96, 0.05), 2)
    observed_prev = float(y.mean()) if n else 0.0
    prev = params.fraud_prevalence if params.fraud_prevalence is not None else observed_prev
    # Reweight so results reflect the configured prevalence rather than the sample's.
    w_fraud = prev / observed_prev if observed_prev > 0 else 0.0
    w_clean = (1 - prev) / (1 - observed_prev) if observed_prev < 1 else 0.0
    w = np.where(y, w_fraud, w_clean)
    order = np.argsort(-s)
    rows = []
    for t in thresholds:
        alert = s >= t
        # Capacity: keep only the highest-scoring alerts.
        if params.investigation_capacity is not None and alert.sum() > params.investigation_capacity:
            keep = np.zeros(n, dtype=bool)
            keep[order[: params.investigation_capacity]] = True
            reviewed = alert & keep
        else:
            reviewed = alert
        unreviewed_alerts = alert & ~reviewed
        fraud_captured = float((w * (reviewed & y)).sum()) * params.review_to_decline_rate
        fraud_missed = float((w * y).sum()) - fraud_captured
        false_positives = float((w * (reviewed & ~y)).sum())
        alerts_w = float((w * alert).sum())
        reviewed_w = float((w * reviewed).sum())
        loss_avoided = fraud_captured * params.average_loss
        review_cost = reviewed_w * params.manual_review_cost
        friction_cost = false_positives * params.false_decline_cost
        operating_cost = float(w.sum()) * params.model_operating_cost
        ev = loss_avoided - review_cost - friction_cost - operating_cost
        rows.append(
            {
                "threshold": float(t),
                "alerts": alerts_w,
                "alerts_reviewed": reviewed_w,
                "alerts_unreviewed_capacity": float((w * unreviewed_alerts).sum()),
                "fraud_captured": fraud_captured,
                "fraud_missed": fraud_missed,
                "false_positives": false_positives,
                "review_hours": reviewed_w * params.minutes_per_review / 60.0,
                "fraud_loss_avoided": loss_avoided,
                "review_cost": review_cost,
                "friction_cost": friction_cost,
                "operating_cost": operating_cost,
                "net_expected_benefit": ev,
                "net_benefit_per_application": ev / max(1.0, float(w.sum())),
            }
        )
    table = pd.DataFrame(rows)
    best = (
        float(table.sort_values("net_expected_benefit", ascending=False).iloc[0]["threshold"])
        if len(table)
        else 0.5
    )
    return table, best


def params_dict(p: EconomicsParams) -> dict[str, Any]:
    return asdict(p)

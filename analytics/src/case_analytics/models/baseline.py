"""Deterministic underwriting/fraud rules baseline mirroring src/decisioning/fraud-rules/rules.js."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from case_analytics.features.policy import FeaturePolicy

from .base import align, check_inputs

HIGH, MEDIUM, LOW = 1.0, 0.5, 0.2

# (rule id, weight, reason code, callable on frame -> bool series)
RULES: list[tuple[str, float, str]] = [
    ("FR-001", HIGH, "UNVERIFIABLE_INCOME"),
    ("FR-001b", MEDIUM, "INCOME_VARIANCE_REVIEW"),
    ("FR-002", HIGH, "UNVERIFIABLE_EMPLOYMENT"),
    ("FR-003", HIGH, "UNDISCLOSED_LIABILITIES"),
    ("FR-003b", MEDIUM, "LIABILITY_VARIANCE_REVIEW"),
    ("FR-004", HIGH, "UNVERIFIABLE_ASSETS"),
    ("FR-005", MEDIUM, "UNSOURCED_LARGE_DEPOSIT"),
    ("FR-006", HIGH, "POTENTIAL_DOCUMENT_TAMPERING"),
    ("FR-007", MEDIUM, "POTENTIAL_DOCUMENT_TAMPERING"),
    ("FR-008", LOW, "EMPLOYER_NAME_VARIATION"),
    ("FR-009", HIGH, "IDENTITY_UNVERIFIABLE"),
    ("FR-010", MEDIUM, "HIGH_RISK_NETWORK_ORIGIN"),
    ("FR-011", MEDIUM, "SUSPICIOUS_DOCUMENT_METADATA"),
    ("FR-012", LOW, "ANOMALOUS_APPLICATION_BEHAVIOR"),
    ("FR-013", HIGH, "DATA_INTEGRITY_FAILURE"),
]


def _col(X: pd.DataFrame, name: str) -> pd.Series:
    if name in X.columns:
        return X[name].astype(float)
    return pd.Series(np.zeros(len(X)), index=X.index)


def rule_matrix(X: pd.DataFrame) -> pd.DataFrame:
    """Boolean firing matrix (rows = cases, columns = rule ids)."""
    sal = _col(X, "disc_salary_vs_employer_pct")
    hidden = _col(X, "disc_obligations_vs_bureau")
    chk = _col(X, "disc_checking_vs_bank_pct")
    dep_n = _col(X, "evidence_large_deposit_count")
    dep_total = _col(X, "evidence_large_deposit_total")
    monthly = _col(X, "claimed_salary") / 12.0
    payroll = _col(X, "disc_payroll_vs_expected_pct").abs()
    score_gap = _col(X, "disc_credit_score_claim_vs_bureau")
    cluster = _col(X, "claimed_liability_cluster_days")
    liab_n = _col(X, "claimed_liability_count")
    start_gap = _col(X, "disc_employment_start_vs_hire_days").abs()
    m = pd.DataFrame(index=X.index)
    m["FR-001"] = sal > 0.15
    m["FR-001b"] = (sal > 0.02) & (sal <= 0.15)
    m["FR-002"] = _col(X, "disc_employer_name_mismatch") > 0
    m["FR-003"] = hidden >= 100
    m["FR-003b"] = (hidden >= 25) & (hidden < 100)
    m["FR-004"] = chk > 0.10
    m["FR-005"] = (dep_n > 0) & (dep_total >= monthly * 0.5)
    m["FR-006"] = chk < -0.15
    m["FR-007"] = payroll > 0.15
    m["FR-008"] = _col(X, "disc_w2_employer_variation") > 0
    signals = (
        (score_gap > 40).astype(int)
        + ((cluster <= 120) & (liab_n <= 3)).astype(int)
        + (start_gap > 60).astype(int)
    )
    m["FR-009"] = signals >= 2
    m["FR-010"] = (_col(X, "ip_risk_score") > 0.7) | (_col(X, "is_tor") > 0)
    m["FR-011"] = _col(X, "docs_created_within_2_days") >= 3
    m["FR-012"] = (_col(X, "fields_copy_pasted") >= 4) | (_col(X, "session_duration_seconds") <= 120)
    integrity = (
        (_col(X, "claimed_monthly_obligations") > monthly * 0.8)
        | (_col(X, "disc_w2_exceeds_gross") > 0)
        | (_col(X, "timeline_rent_before_lease") > 0)
        | (_col(X, "timeline_deposit_before_employment") > 0)
    )
    m["FR-013"] = integrity
    return m.astype(bool)


class RulesBaseline:
    name = "rules_baseline"
    version = "1.3.0"
    backend = "deterministic-rules"

    def __init__(self) -> None:
        self.feature_names: list[str] = []
        self.weights = {rid: w for rid, w, _ in RULES}

    def fit(self, X: pd.DataFrame, y: np.ndarray, policy: FeaturePolicy | None = None) -> RulesBaseline:
        Xn = check_inputs(X, policy)
        self.feature_names = [str(c) for c in Xn.columns]
        return self

    def raw_score(self, X: pd.DataFrame) -> np.ndarray:
        Xa = align(X, self.feature_names) if self.feature_names else X
        m = rule_matrix(Xa)
        total = np.zeros(len(Xa))
        for rid, w in self.weights.items():
            total += m[rid].to_numpy(dtype=float) * w
        return total

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        # Squash: one HIGH rule -> 0.76, two HIGH -> 0.95; MEDIUM alone -> 0.5; nothing -> ~0.02.
        raw = self.raw_score(X)
        p = 1.0 - np.exp(-1.45 * raw)
        p = np.where(raw == 0, 0.02, p)
        return np.clip(p, 0.0, 1.0)

    def params(self) -> dict[str, Any]:
        return {"weights": self.weights, "rules": [r for r, _, _ in RULES]}

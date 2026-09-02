from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from case_analytics.features.policy import DEFAULT_POLICY, FeaturePolicy

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def synthetic_frame(n: int = 400, seed: int = 0) -> pd.DataFrame:
    """Small self-contained frame with the production column conventions."""
    rng = np.random.default_rng(seed)
    salary = rng.lognormal(11.2, 0.35, n)
    fraud = rng.random(n) < 0.2
    disc_sal = np.where(fraud, rng.uniform(0.05, 0.4, n), rng.normal(0, 0.01, n))
    hidden = np.where(fraud & (rng.random(n) < 0.5), rng.uniform(50, 800, n), 0.0)
    ip = np.where(fraud, rng.uniform(0.4, 1.0, n), rng.uniform(0, 0.3, n))
    df = pd.DataFrame(
        {
            "loan_amount": salary * 3,
            "claimed_salary": salary * (1 + disc_sal),
            "evidence_employer_salary": salary,
            "disc_salary_vs_employer_pct": disc_sal,
            "disc_obligations_vs_bureau": hidden,
            "disc_employer_name_mismatch": (fraud & (rng.random(n) < 0.3)).astype(int),
            "disc_checking_vs_bank_pct": rng.normal(0, 0.02, n),
            "evidence_large_deposit_count": (fraud & (rng.random(n) < 0.3)).astype(int),
            "evidence_large_deposit_total": np.where(fraud, salary * 0.2, 0.0),
            "disc_credit_score_claim_vs_bureau": np.where(fraud & (rng.random(n) < 0.2), 60.0, 0.0),
            "claimed_liability_cluster_days": rng.uniform(0, 2000, n),
            "claimed_liability_count": rng.integers(0, 5, n),
            "disc_employment_start_vs_hire_days": 0.0,
            "ip_risk_score": ip,
            "is_tor": (ip > 0.9).astype(int),
            "docs_created_within_2_days": np.where(fraud, rng.integers(0, 5, n), 0),
            "fields_copy_pasted": rng.integers(0, 3, n),
            "session_duration_seconds": rng.uniform(150, 900, n),
            "claimed_monthly_obligations": salary / 12 * rng.uniform(0.05, 0.4, n),
            "evidence_credit_score": rng.normal(690, 40, n),
            "sensitive__age_band": rng.choice(["22-29", "30-39", "40-49"], n),
            "sensitive__family_status_scenario": rng.choice(["SINGLE", "MARRIED"], n),
            "sensitive__disability_income_scenario": rng.integers(0, 2, n),
            "label__is_fraud": fraud.astype(int),
            "label__fraud_type": np.where(fraud, "INFLATION", "NONE"),
            "label__regime": rng.choice(["PRIME", "SUBPRIME"], n),
            "label__case_id": [f"c-{i}" for i in range(n)],
        }
    )
    return df


@pytest.fixture
def policy() -> FeaturePolicy:
    return DEFAULT_POLICY


@pytest.fixture
def frame() -> pd.DataFrame:
    return synthetic_frame()


@pytest.fixture
def data_dir() -> Path:
    if not (DATA_DIR / "train.manifest.json").exists():
        pytest.skip("governed datasets not built (run scripts/build_datasets.js)")
    return DATA_DIR

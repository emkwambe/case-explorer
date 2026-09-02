from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from case_analytics.explainability.explain import (
    REASON_CODE_MAP,
    global_importance,
    local_explanations,
    partial_dependence,
    shap_values_for,
)
from case_analytics.fairness.analysis import counterfactual_test, fairness_report, subgroup_metrics
from case_analytics.governance.registry import (
    InvalidTransition,
    ModelRegistry,
    SeparationOfDutiesViolation,
)
from case_analytics.governance.validation_package import render_validation_package
from case_analytics.models import LogisticRegressionModel, RandomForestModel


@pytest.fixture
def fitted_lr(policy, frame):
    ps = policy.split(frame)
    return LogisticRegressionModel().fit(ps.X, ps.labels["is_fraud"].to_numpy(), policy), ps


def test_counterfactual_invariance_on_lr(fitted_lr) -> None:
    model, ps = fitted_lr
    r = counterfactual_test(model, ps.X, ps.sensitive, max_rows=100)
    assert r["pairs"] > 0
    assert r["changed"] == 0
    assert r["status"] == "PASS"


def test_counterfactual_catches_a_leaky_model(fitted_lr) -> None:
    model, ps = fitted_lr

    class Leaky:
        name, version, backend = "leaky", "0", "x"
        feature_names = [*model.feature_names, "sensitive__disability_income_scenario"]

        def predict_proba(self, X):
            base = model.predict_proba(X[model.feature_names])
            bump = (X["sensitive__disability_income_scenario"].to_numpy(dtype=float) >= 1) * 0.1
            return np.clip(base + bump, 0, 1)

    # A model whose feature list includes a sensitive column is exactly what the test must catch.
    r = counterfactual_test(
        Leaky(),
        ps.X.assign(
            sensitive__disability_income_scenario=ps.sensitive["disability_income_scenario"].to_numpy()
        ),
        ps.sensitive,
        max_rows=50,
    )
    assert r["status"] == "FAIL" and r["changed"] > 0


def test_subgroup_and_full_report(fitted_lr) -> None:
    model, ps = fitted_lr
    y = ps.labels["is_fraud"].to_numpy()
    sub = subgroup_metrics(model.predict_proba(ps.X), y, ps.sensitive, 0.5)
    assert {"attribute", "group", "approval_rate", "fpr", "approval_p_value"} <= set(sub.columns)
    rep = fairness_report(model, ps.X, y, ps.sensitive, 0.5)
    assert rep["status"] in ("PASS", "WARN", "FAIL")
    assert "legal compliance" in rep["disclaimer"]


def test_explainability_pieces(policy, frame) -> None:
    ps = policy.split(frame)
    y = ps.labels["is_fraud"].to_numpy()
    rf = RandomForestModel(n_estimators=40).fit(ps.X, y, policy)
    imp = global_importance(rf, ps.X, y, n_repeats=2)
    assert imp.iloc[0]["permutation_importance"] >= imp.iloc[-1]["permutation_importance"]
    sv = shap_values_for(rf, ps.X.head(30))
    assert sv is not None and sv.shape == (30, ps.X.shape[1])
    loc = local_explanations(sv, ps.X.head(30), rf.feature_names)
    assert len(loc) == 30 and loc[0]["top_contributions"]
    codes = [c["reason_code"] for le in loc for c in le["reason_codes"]]
    assert codes and all(c in {v[0] for v in REASON_CODE_MAP.values()} for c in codes)
    pdp = partial_dependence(rf, ps.X.head(50), imp["feature"].head(2).tolist(), grid_points=5)
    assert len(pdp) == 2


def test_registry_state_machine_and_segregation(tmp_path: Path) -> None:
    reg = ModelRegistry(tmp_path / "registry.json")
    reg.register_model("m", "purpose", "owner", "dev")
    key = reg.register_version("m", "1.0.0", developer="dev", lineage={}, params={})
    with pytest.raises(InvalidTransition):
        reg.transition(key, "PRODUCTION", "ops", "skip")
    reg.transition(key, "DEVELOPMENT", "dev", "start")
    reg.transition(key, "VALIDATION_PENDING", "dev", "submit")
    with pytest.raises(SeparationOfDutiesViolation):
        reg.transition(key, "VALIDATED", "dev", "self-validate")
    with pytest.raises(SeparationOfDutiesViolation):
        reg.transition(key, "VALIDATED", "dev", "", override=True)
    reg.transition(key, "VALIDATED", "dev", "emergency override approved by CRO", override=True)
    types = [e["event_type"] for e in reg.audit_for(key)]
    assert "SEGREGATION_OVERRIDE" in types
    assert types.count("STATE_TRANSITION") == 3
    reg.transition(key, "APPROVED", "mrm", "ok")
    assert reg.data["approvals"][-1]["approver"] == "mrm"
    reg.save()
    reloaded = ModelRegistry(tmp_path / "registry.json")
    assert reloaded.get_version(key)["state"] == "APPROVED"
    for e in reloaded.data["audit_events"]:
        assert {
            "event_type",
            "actor",
            "timestamp",
            "model_version",
            "previous_state",
            "new_state",
            "reason",
        } <= set(e)


def test_validation_package_renders(policy) -> None:
    import pandas as pd

    champion = {
        "model": "gradient_boosting",
        "version": "1.0.0",
        "backend": "lightgbm",
        "threshold": 0.4,
        "test": {
            "pr_auc": 0.9,
            "roc_auc": 0.95,
            "precision": 0.8,
            "recall": 0.7,
            "f1": 0.75,
            "fpr": 0.02,
            "ece": 0.03,
            "brier": 0.05,
        },
        "out_of_time": {"pr_auc": 0.85, "recall": 0.6, "fpr": 0.03},
        "adversarial": {"pr_auc": 0.7, "recall": 0.5},
        "clean_control_fpr": 0.01,
        "splits": {
            "test": {
                "n": 10,
                "fraud_n": 2,
                "pr_auc": 0.9,
                "roc_auc": 0.9,
                "recall": 0.7,
                "fpr": 0.02,
                "ece": 0.03,
            }
        },
        "by_fraud_type": [{"group": "INFLATION", "n": 5, "fraud_n": 5, "recall": 0.8, "alert_rate": 0.8}],
    }
    md = render_validation_package(
        champion=champion,
        models=[champion],
        lineage={"splits": {"train": {"record_count": 10, "fraud_rate": 0.2}}},
        feature_names=["claimed_salary"],
        policy=policy,
        fairness={
            "disclaimer": "x legal compliance",
            "status": "PASS",
            "counterfactual": {"pairs": 1, "changed": 0, "invariance_rate": 1.0},
            "subgroups": [],
        },
        importance=pd.DataFrame({"feature": ["claimed_salary"], "permutation_importance": [0.1]}),
        findings=[
            {"finding_id": 1, "severity": "LOW", "title": "t", "detail": "d", "remediation_status": "OPEN"}
        ],
        approval={"approver": "mrm", "at": "now", "reason": "ok"},
        economics={"ev_optimal_threshold": 0.3, "net_benefit_at_selected": 1.0},
        monitoring={"splits": {}},
    )
    for h in (
        "Model purpose",
        "Dataset lineage",
        "Feature definitions",
        "Fairness",
        "Limitations",
        "Approval decision",
    ):
        assert h in md
    assert "APPROVED by mrm" in md

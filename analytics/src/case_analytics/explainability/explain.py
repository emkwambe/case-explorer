"""Model explainability: global importance, SHAP, partial dependence, decomposition, reason-code mapping."""

from __future__ import annotations

import warnings
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.metrics import average_precision_score  # noqa: E402

from case_analytics.models.base import SEED, align  # noqa: E402

# feature -> (governed reason code, evidence source). Mirrors src/decisioning/reason-codes/catalog.js.
REASON_CODE_MAP: dict[str, tuple[str, str]] = {
    "disc_salary_vs_employer_pct": ("UNVERIFIABLE_INCOME", "EMPLOYER_VERIFICATION.salary"),
    "disc_salary_vs_w2_pct": ("UNVERIFIABLE_INCOME", "W2_DOCUMENT.w2_wages"),
    "disc_obligations_vs_bureau": ("UNDISCLOSED_LIABILITIES", "CREDIT_BUREAU.liabilities"),
    "disc_obligations_vs_bureau_pct": ("UNDISCLOSED_LIABILITIES", "CREDIT_BUREAU.liabilities"),
    "disc_liability_count": ("UNDISCLOSED_LIABILITIES", "CREDIT_BUREAU.liabilities"),
    "disc_employer_name_mismatch": ("UNVERIFIABLE_EMPLOYMENT", "EMPLOYER_VERIFICATION.employer"),
    "disc_w2_employer_variation": ("EMPLOYER_NAME_VARIATION", "W2_DOCUMENT.employer"),
    "disc_employment_start_vs_hire_days": ("UNVERIFIABLE_EMPLOYMENT", "EMPLOYER_VERIFICATION.hire_date"),
    "evidence_large_deposit_total": ("UNSOURCED_LARGE_DEPOSIT", "BANK_STATEMENT.recent_large_deposits"),
    "evidence_large_deposit_count": ("UNSOURCED_LARGE_DEPOSIT", "BANK_STATEMENT.recent_large_deposits"),
    "disc_payroll_vs_expected_pct": (
        "POTENTIAL_DOCUMENT_TAMPERING",
        "BANK_STATEMENT.monthly_payroll_deposit",
    ),
    "ip_risk_score": ("HIGH_RISK_NETWORK_ORIGIN", "APPLICATION_METADATA.ip_risk_score"),
    "is_tor": ("HIGH_RISK_NETWORK_ORIGIN", "APPLICATION_METADATA.is_tor"),
    "is_vpn": ("HIGH_RISK_NETWORK_ORIGIN", "APPLICATION_METADATA.is_vpn"),
    "docs_created_within_2_days": ("SUSPICIOUS_DOCUMENT_METADATA", "APPLICATION_METADATA.documents"),
    "min_doc_age_days": ("SUSPICIOUS_DOCUMENT_METADATA", "APPLICATION_METADATA.documents"),
    "fields_copy_pasted": ("ANOMALOUS_APPLICATION_BEHAVIOR", "APPLICATION_METADATA.session"),
    "session_duration_seconds": ("ANOMALOUS_APPLICATION_BEHAVIOR", "APPLICATION_METADATA.session"),
    "typing_speed_wpm": ("ANOMALOUS_APPLICATION_BEHAVIOR", "APPLICATION_METADATA.session"),
    "is_business_hours": ("ANOMALOUS_APPLICATION_BEHAVIOR", "APPLICATION_METADATA.submitted"),
    "hour_of_day": ("ANOMALOUS_APPLICATION_BEHAVIOR", "APPLICATION_METADATA.submitted"),
    "backend_dti_verified": ("EXCESSIVE_DTI", "EMPLOYER_VERIFICATION.salary"),
    "backend_dti_bureau": ("EXCESSIVE_DTI", "CREDIT_BUREAU.liabilities"),
    "claimed_backend_dti": ("EXCESSIVE_DTI", "APPLICATION.stated"),
    "obligations_to_income": ("EXCESSIVE_DTI", "APPLICATION.stated"),
    "residual_income_claimed": ("INSUFFICIENT_INCOME", "APPLICATION.stated"),
    "evidence_credit_score": ("INSUFFICIENT_CREDIT_SCORE", "CREDIT_BUREAU.credit_score"),
    "reserves_months_verified": ("INSUFFICIENT_RESERVES", "BANK_STATEMENT.checking_balance"),
    "evidence_checking_balance": ("INSUFFICIENT_RESERVES", "BANK_STATEMENT.checking_balance"),
    "claimed_tenure_months": ("LIMITED_EMPLOYMENT_HISTORY", "EMPLOYER_VERIFICATION.hire_date"),
    "disc_checking_vs_bank_pct": ("UNVERIFIABLE_ASSETS", "BANK_STATEMENT.checking_balance"),
    "disc_credit_score_claim_vs_bureau": ("RAPID_CREDIT_PROFILE_CONSTRUCTION", "CREDIT_BUREAU.credit_score"),
    "claimed_liability_cluster_days": ("RAPID_CREDIT_PROFILE_CONSTRUCTION", "CREDIT_BUREAU.liabilities"),
    "timeline_rent_before_lease": ("DATA_INTEGRITY_FAILURE", "RENT_VERIFICATION.lease_start"),
    "timeline_deposit_before_employment": ("DATA_INTEGRITY_FAILURE", "EMPLOYER_VERIFICATION.hire_date"),
    "disc_w2_exceeds_gross": ("DATA_INTEGRITY_FAILURE", "W2_DOCUMENT.w2_wages"),
    "evidence_overdraft_count": ("TIGHT_RESIDUAL_INCOME", "BANK_STATEMENT.overdraft_count"),
}


def global_importance(model: Any, X: pd.DataFrame, y: np.ndarray, n_repeats: int = 5) -> pd.DataFrame:
    """Permutation importance (drop in average precision) for any model exposing predict_proba."""
    Xa = align(X, model.feature_names).reset_index(drop=True)
    y = np.asarray(y, dtype=float)
    rng = np.random.default_rng(SEED)
    base = average_precision_score(y, model.predict_proba(Xa)) if y.sum() > 0 else 0.0
    means, stds = [], []
    for f in model.feature_names:
        drops = []
        for _ in range(n_repeats):
            Xp = Xa.copy()
            Xp[f] = rng.permutation(Xp[f].to_numpy())
            score = average_precision_score(y, model.predict_proba(Xp)) if y.sum() > 0 else 0.0
            drops.append(base - score)
        means.append(float(np.mean(drops)))
        stds.append(float(np.std(drops)))
    out = pd.DataFrame({"feature": model.feature_names, "permutation_importance": means, "std": stds})
    native = getattr(model, "native_importance", None)
    if callable(native):
        ni = native()
        if len(ni):
            out["native_importance"] = out["feature"].map(ni).fillna(0.0)
    coef = getattr(model, "coefficients", None)
    if callable(coef):
        out["coefficient"] = out["feature"].map(coef()).fillna(0.0)
    return out.sort_values("permutation_importance", ascending=False).reset_index(drop=True)


def shap_values_for(model: Any, X: pd.DataFrame, background: pd.DataFrame | None = None) -> np.ndarray | None:
    """SHAP values (n x features) for the positive class, or None when not supported."""
    if model.name == "rules_baseline":
        return None
    try:
        import shap
    except ImportError:
        return None
    Xa = align(X, model.feature_names)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if model.name in ("random_forest", "gradient_boosting"):
            inner = model.model
            explainer = shap.TreeExplainer(inner)
            vals = explainer.shap_values(Xa.to_numpy())
            if isinstance(vals, list):
                vals = vals[1]
            vals = np.asarray(vals)
            if vals.ndim == 3:
                vals = vals[:, :, 1]
            return vals
        if model.name == "logistic_regression":
            pipe = model.pipeline
            scaler, lr = pipe.named_steps["scale"], pipe.named_steps["lr"]
            Z = scaler.transform(Xa.to_numpy())
            bg = (
                scaler.transform(align(background, model.feature_names).to_numpy())
                if background is not None
                else Z
            )
            explainer = shap.LinearExplainer(lr, bg)
            return np.asarray(explainer.shap_values(Z))
    return None


def shap_summary_plot(shap_vals: np.ndarray, X: pd.DataFrame, feature_names: list[str], path: Path) -> None:
    import shap

    Xa = align(X, feature_names)
    plt.figure(figsize=(9, 7))
    shap.summary_plot(shap_vals, Xa, feature_names=feature_names, show=False, max_display=20)
    plt.tight_layout()
    plt.savefig(path, dpi=110)
    plt.close("all")


def local_explanations(
    shap_vals: np.ndarray | None, X: pd.DataFrame, feature_names: list[str], top_k: int = 5
) -> list[dict[str, Any]]:
    """Score decomposition per case: top positive and negative contributions."""
    out: list[dict[str, Any]] = []
    if shap_vals is None:
        return out
    Xa = align(X, feature_names)
    for i in range(len(Xa)):
        row = shap_vals[i]
        order = np.argsort(-np.abs(row))
        contribs = [
            {"feature": feature_names[j], "value": float(Xa.iloc[i, j]), "contribution": float(row[j])}
            for j in order[:top_k]
        ]
        out.append(
            {
                "index": int(i),
                "top_contributions": contribs,
                "positive_total": float(row[row > 0].sum()),
                "negative_total": float(row[row < 0].sum()),
                "reason_codes": reason_codes_for_case(row, feature_names),
            }
        )
    return out


def reason_codes_for_case(
    shap_row: np.ndarray, feature_names: list[str], top_n: int = 3
) -> list[dict[str, Any]]:
    """Top-N governed reason codes from positive SHAP contributions, each with its evidence source."""
    agg: dict[str, dict[str, Any]] = {}
    for j, f in enumerate(feature_names):
        c = float(shap_row[j])
        if c <= 0 or f not in REASON_CODE_MAP:
            continue
        code, source = REASON_CODE_MAP[f]
        entry = agg.setdefault(
            code, {"reason_code": code, "contribution": 0.0, "features": [], "evidence_sources": set()}
        )
        entry["contribution"] += c
        entry["features"].append(f)
        entry["evidence_sources"].add(source)
    ranked = sorted(agg.values(), key=lambda e: -e["contribution"])[:top_n]
    return [
        {
            "reason_code": e["reason_code"],
            "contribution": round(e["contribution"], 5),
            "features": e["features"],
            "evidence_sources": sorted(e["evidence_sources"]),
        }
        for e in ranked
    ]


def partial_dependence(
    model: Any, X: pd.DataFrame, features: list[str], grid_points: int = 15
) -> dict[str, Any]:
    Xa = align(X, model.feature_names)
    out: dict[str, Any] = {}
    for f in features:
        if f not in Xa.columns:
            continue
        col = Xa[f]
        grid = np.unique(np.quantile(col, np.linspace(0.02, 0.98, grid_points)))
        means = []
        for g in grid:
            Xg = Xa.copy()
            Xg[f] = g
            means.append(float(np.mean(model.predict_proba(Xg))))
        out[f] = {"grid": [float(g) for g in grid], "mean_score": means}
    return out


def pdp_plot(pd_result: dict[str, Any], path: Path, title: str) -> None:
    n = len(pd_result)
    if n == 0:
        return
    cols = min(3, n)
    rows = int(np.ceil(n / cols))
    fig, axes = plt.subplots(rows, cols, figsize=(4.2 * cols, 3.2 * rows), squeeze=False)
    for ax, (f, d) in zip(axes.ravel(), pd_result.items()):
        ax.plot(d["grid"], d["mean_score"], marker="o", ms=3)
        ax.set_title(f, fontsize=9)
        ax.set_ylabel("mean score")
        ax.grid(alpha=0.3)
    for ax in axes.ravel()[n:]:
        ax.axis("off")
    fig.suptitle(title)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)

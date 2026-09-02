"""End-to-end model development, validation and governance pipeline.

python -m case_analytics.pipeline --data data --out artifacts [--quick]
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.calibration import calibration_curve  # noqa: E402
from sklearn.metrics import precision_recall_curve  # noqa: E402

from case_analytics import __version__  # noqa: E402
from case_analytics.datasets import DatasetBundle, load_bundle  # noqa: E402
from case_analytics.evaluation.economics import (  # noqa: E402
    EconomicsParams,
    params_dict,
    simulate_thresholds,
)
from case_analytics.evaluation.metrics import classification_report, tune_threshold  # noqa: E402
from case_analytics.evaluation.underwriting import UnderwritingParams, underwriting_outcomes  # noqa: E402
from case_analytics.explainability.explain import (  # noqa: E402
    global_importance,
    local_explanations,
    partial_dependence,
    pdp_plot,
    shap_summary_plot,
    shap_values_for,
)
from case_analytics.fairness.analysis import fairness_report  # noqa: E402
from case_analytics.governance.registry import ModelRegistry  # noqa: E402
from case_analytics.governance.validation_package import render_validation_package  # noqa: E402
from case_analytics.models import ALL_MODELS  # noqa: E402
from case_analytics.monitoring.drift import monitoring_report  # noqa: E402
from case_analytics.serialization import dump_json  # noqa: E402
from case_analytics.serialization import dumps as json_dumps

EVAL_SPLITS = (
    "test",
    "out_of_time",
    "geography_stress",
    "economic_regime_stress",
    "adversarial_fraud",
    "clean_negative_control",
)
KEY_METRICS = ("pr_auc", "roc_auc", "precision", "recall", "f1", "fpr", "fnr", "specificity", "ece", "brier")


def _split_xy(
    bundle: DatasetBundle, name: str
) -> tuple[pd.DataFrame, np.ndarray, pd.DataFrame, pd.DataFrame]:
    ps = bundle.get(name).policy_split(bundle.policy)
    y = ps.labels["is_fraud"].astype(int).to_numpy()
    return ps.X, y, ps.sensitive, ps.labels


def _slim(report: dict[str, Any]) -> dict[str, Any]:
    return {k: report[k] for k in ("n", "fraud_n", *KEY_METRICS)}


def run(data_dir: Path, out_dir: Path, quick: bool = False) -> dict[str, Any]:
    t0 = time.time()
    out_dir.mkdir(parents=True, exist_ok=True)
    bundle = load_bundle(data_dir, quick=600 if quick else None)
    lineage = bundle.lineage()
    X_tr, y_tr, _, _ = _split_xy(bundle, "train")
    X_va, y_va, _, _ = _split_xy(bundle, "validation")
    feature_names = [str(c) for c in X_tr.columns]
    print(f"train {len(X_tr)} rows, {len(feature_names)} permitted features, fraud rate {y_tr.mean():.3f}")

    registry = ModelRegistry(out_dir / "registry.json")
    registry.register_model(
        "mortgage_fraud_score",
        "Fraud/misrepresentation alerting for mortgage applications",
        "fraud-strategy",
        "pipeline",
    )

    results: list[dict[str, Any]] = []
    fitted: dict[str, Any] = {}
    for cls in ALL_MODELS:
        model = cls()
        if quick and model.name == "random_forest":
            model = cls(n_estimators=120)  # type: ignore[call-arg]
        if quick and model.name == "gradient_boosting":
            model = cls(n_estimators=150)  # type: ignore[call-arg]
        model.fit(X_tr, y_tr, bundle.policy)
        fitted[model.name] = model
        threshold = tune_threshold(y_va, model.predict_proba(X_va), max_fpr=0.05)
        run_version = registry.next_free_version(model.name, model.version)
        entry: dict[str, Any] = {
            "model": model.name,
            "version": run_version,
            "backend": model.backend,
            "params": model.params(),
            "threshold": threshold,
            "splits": {},
        }
        key = registry.register_version(
            model.name,
            run_version,
            developer="pipeline",
            lineage=lineage,
            params=model.params(),
            backend=model.backend,
            feature_schema_version=str(lineage.get("feature_schema_version")),
            threshold=threshold,
        )
        registry.transition(key, "DEVELOPMENT", "pipeline", "Trained on governed train split")
        for split in EVAL_SPLITS:
            if split not in bundle.splits:
                continue
            X, y, _, labels = _split_xy(bundle, split)
            rep = classification_report(
                split, y, model.predict_proba(X), threshold, labels["fraud_type"], labels["regime"]
            )
            d = rep.to_dict()
            entry["splits"][split] = _slim(d)
            if split == "test":
                entry["test"] = _slim(d)
                entry["by_fraud_type"] = d["by_fraud_type"]
                entry["by_regime"] = d["by_regime"]
                entry["threshold_sweep"] = d["sweep"]
                entry["confusion"] = d["confusion"]
            registry.record_evaluation(key, split, _slim(d), "pipeline")
        entry["out_of_time"] = {
            k: entry["splits"].get("out_of_time", {}).get(k) for k in ("pr_auc", "roc_auc", "recall", "fpr")
        }
        entry["adversarial"] = {
            k: entry["splits"].get("adversarial_fraud", {}).get(k) for k in ("pr_auc", "recall")
        }
        entry["clean_control_fpr"] = entry["splits"].get("clean_negative_control", {}).get("fpr")
        entry["registry_key"] = key
        results.append(entry)
        print(
            f"  {model.name:<22} backend={model.backend:<12} thr={threshold:.2f} test PR-AUC={entry['test']['pr_auc']:.3f} "
            f"recall={entry['test']['recall']:.3f} FPR={entry['test']['fpr']:.3f} OOT PR-AUC={entry['out_of_time']['pr_auc']:.3f}"
        )

    # Champion selection: highest test PR-AUC, tie-break by out-of-time PR-AUC.
    champion = max(
        results, key=lambda r: (round(r["test"]["pr_auc"], 4), round(r["out_of_time"]["pr_auc"] or 0, 4))
    )
    champ_model = fitted[champion["model"]]
    X_te, y_te, sens_te, labels_te = _split_xy(bundle, "test")
    scores_te = champ_model.predict_proba(X_te)
    loan_te = pd.to_numeric(X_te["loan_amount"], errors="coerce").fillna(0).to_numpy()

    # Underwriting outcomes and decision economics.
    uw = underwriting_outcomes(
        scores_te,
        y_te,
        loan_te,
        UnderwritingParams(
            review_threshold=champion["threshold"] / 2, decline_threshold=champion["threshold"]
        ),
    )
    econ_params = EconomicsParams()
    econ_table, ev_best = simulate_thresholds(scores_te, y_te, econ_params)
    econ_table.to_csv(out_dir / "threshold-economics.csv", index=False)
    sel_row = econ_table.iloc[(econ_table["threshold"] - champion["threshold"]).abs().argsort().iloc[0]]
    economics = {
        "params": params_dict(econ_params),
        "ev_optimal_threshold": ev_best,
        "selected_threshold": champion["threshold"],
        "net_benefit_at_selected": float(sel_row["net_expected_benefit"]),
        "net_benefit_at_ev_optimal": float(econ_table["net_expected_benefit"].max()),
        "table": econ_table.to_dict(orient="records"),
    }
    champion["underwriting_outcomes"] = uw
    champion["economics"] = {k: v for k, v in economics.items() if k != "table"}

    # Explainability.
    importance = global_importance(champ_model, X_te, y_te, n_repeats=3 if quick else 5)
    importance.to_csv(out_dir / f"feature-importance_{champ_model.name}.csv", index=False)
    explain: dict[str, Any] = {"global_importance": importance.head(25).to_dict(orient="records")}
    n_local = 25
    for name, model in fitted.items():
        sv = shap_values_for(model, X_te.head(400 if quick else 800), background=X_tr.head(200))
        if sv is None:
            continue
        shap_summary_plot(sv, X_te.head(len(sv)), model.feature_names, out_dir / f"shap_summary_{name}.png")
        if name == champ_model.name:
            explain["shap_mean_abs"] = (
                pd.Series(np.abs(sv).mean(axis=0), index=model.feature_names)
                .sort_values(ascending=False)
                .head(25)
                .to_dict()
            )
            locals_ = local_explanations(sv[:n_local], X_te.head(n_local), model.feature_names)
            for i, le in enumerate(locals_):
                le["case_id"] = str(labels_te["case_id"].iloc[i])
                le["score"] = float(scores_te[i])
                le["label_is_fraud"] = int(y_te[i])
                le["label_fraud_type"] = str(labels_te["fraud_type"].iloc[i])
            explain["local_explanations"] = locals_
    top_feats = importance["feature"].head(6).tolist()
    pdp = partial_dependence(champ_model, X_te.head(300), top_feats)
    pdp_plot(pdp, out_dir / "pdp.png", f"Partial dependence: {champ_model.name}")
    explain["partial_dependence"] = pdp

    # Fairness and monitoring on the champion.
    fairness = fairness_report(champ_model, X_te, y_te, sens_te, champion["threshold"])
    dump_json(out_dir / "fairness-report.json", fairness)
    comparisons = {s: _split_xy(bundle, s)[0] for s in EVAL_SPLITS if s in bundle.splits and s != "test"}
    monitoring = monitoring_report(champ_model, X_tr, comparisons, champion["threshold"])
    dump_json(out_dir / "monitoring-report.json", monitoring)

    # Governance: findings, independent validation, approval.
    key = champion["registry_key"]
    if fairness["status"] == "FAIL":
        registry.record_finding(
            key,
            "CRITICAL",
            "Fairness control failed",
            json_dumps(fairness["counterfactual"]["findings"][:3], indent=None),
            "independent-validation",
        )
    if (champion["out_of_time"]["pr_auc"] or 0) < champion["test"]["pr_auc"] - 0.10:
        registry.record_finding(
            key,
            "HIGH",
            "Out-of-time degradation",
            f"OOT PR-AUC {champion['out_of_time']['pr_auc']:.3f} vs test {champion['test']['pr_auc']:.3f}",
            "independent-validation",
        )
    if champion["test"]["ece"] > 0.05:
        registry.record_finding(
            key,
            "MEDIUM",
            "Calibration error above 0.05",
            f"ECE {champion['test']['ece']:.3f}",
            "independent-validation",
            remediation="OPEN",
        )
    if champion["clean_control_fpr"] is not None and champion["clean_control_fpr"] > 0.05:
        registry.record_finding(
            key,
            "HIGH",
            "Clean-control false positives above 5%",
            f"FPR {champion['clean_control_fpr']:.3f}",
            "independent-validation",
        )
    registry.transition(key, "VALIDATION_PENDING", "pipeline", "Submitted for independent validation")
    critical = [f for f in registry.findings_for(key) if f["severity"] == "CRITICAL"]
    approval: dict[str, Any] | None = None
    if critical:
        registry.transition(key, "VALIDATION_FAILED", "independent-validation", "Critical findings open")
    else:
        registry.transition(
            key,
            "VALIDATED",
            "independent-validation",
            "Performance, robustness, fairness and explainability reviewed",
        )
        registry.transition(
            key, "APPROVED", "model-risk", "Approved for challenger deployment subject to open findings"
        )
        approval = registry.data["approvals"][-1]
    for r in results:
        if r["model"] != champion["model"]:
            registry.transition(r["registry_key"], "VALIDATION_PENDING", "pipeline", "Challenger candidate")
    registry.save()

    package = render_validation_package(
        champion=champion,
        models=results,
        lineage=lineage,
        feature_names=feature_names,
        policy=bundle.policy,
        fairness=fairness,
        importance=importance,
        findings=registry.findings_for(key),
        approval=approval,
        economics=economics,
        monitoring=monitoring,
    )
    (out_dir / "validation-package.md").write_text(package, encoding="utf-8")

    _plots(results, fitted, bundle, out_dir)
    (out_dir / "model-comparison.md").write_text(render_comparison(results, champion), encoding="utf-8")

    summary = {
        "analytics_version": __version__,
        "generated_at": pd.Timestamp.utcnow().isoformat(),
        "runtime_seconds": round(time.time() - t0, 1),
        "lineage": lineage,
        "feature_names": feature_names,
        "champion": {k: v for k, v in champion.items() if k not in ("threshold_sweep",)},
        "models": [
            {k: v for k, v in r.items() if k not in ("threshold_sweep", "by_regime")} for r in results
        ],
        "explainability": explain,
        "fairness_status": fairness["status"],
        "economics": {k: v for k, v in economics.items() if k != "table"},
        "registry_state": {k: v["state"] for k, v in registry.data["model_versions"].items()},
    }
    dump_json(out_dir / "model-summary.json", summary)
    print(
        f"champion: {champion['model']} ({champion['backend']}) thr={champion['threshold']:.2f} in {summary['runtime_seconds']}s"
    )
    return summary


def _plots(
    results: list[dict[str, Any]], fitted: dict[str, Any], bundle: DatasetBundle, out_dir: Path
) -> None:
    X_te, y_te, _, _ = _split_xy(bundle, "test")
    fig, ax = plt.subplots(figsize=(6.5, 5))
    for r in results:
        s = fitted[r["model"]].predict_proba(X_te)
        p, rc, _ = precision_recall_curve(y_te, s)
        ax.plot(rc, p, label=f"{r['model']} (AP={r['test']['pr_auc']:.3f})")
    ax.set_xlabel("Recall")
    ax.set_ylabel("Precision")
    ax.set_title("Precision-recall (held-out test)")
    ax.legend(fontsize=8)
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_dir / "pr_curves.png", dpi=110)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.5, 5))
    ax.plot([0, 1], [0, 1], "k--", lw=1)
    for r in results:
        s = np.clip(fitted[r["model"]].predict_proba(X_te), 0, 1)
        frac, mean_pred = calibration_curve(y_te, s, n_bins=10, strategy="uniform")
        ax.plot(mean_pred, frac, marker="o", ms=3, label=f"{r['model']} (ECE={r['test']['ece']:.3f})")
    ax.set_xlabel("Mean predicted probability")
    ax.set_ylabel("Observed fraud rate")
    ax.set_title("Calibration (held-out test)")
    ax.legend(fontsize=8)
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_dir / "calibration.png", dpi=110)
    plt.close(fig)


def render_comparison(results: list[dict[str, Any]], champion: dict[str, Any]) -> str:
    L = ["# Model comparison\n"]
    cols = [
        "model",
        "backend",
        "threshold",
        "pr_auc",
        "roc_auc",
        "precision",
        "recall",
        "f1",
        "fpr",
        "ece",
        "brier",
    ]
    L.append("| " + " | ".join(cols) + " |\n|" + "---|" * len(cols) + "\n")
    for r in results:
        t = r["test"]
        L.append(
            f"| {r['model']} | {r['backend']} | {r['threshold']:.2f} | {t['pr_auc']:.3f} | {t['roc_auc']:.3f} | "
            f"{t['precision']:.3f} | {t['recall']:.3f} | {t['f1']:.3f} | {t['fpr']:.3f} | {t['ece']:.3f} | {t['brier']:.3f} |\n"
        )
    L.append("\n## Robustness across splits (PR-AUC)\n")
    splits = [s for s in EVAL_SPLITS if s != "clean_negative_control"]
    L.append(
        "| model | "
        + " | ".join(splits)
        + " | clean-control FPR |\n|---|"
        + "---|" * (len(splits) + 1)
        + "\n"
    )
    for r in results:
        vals = [f"{r['splits'].get(s, {}).get('pr_auc', float('nan')):.3f}" for s in splits]
        L.append(
            f"| {r['model']} | "
            + " | ".join(vals)
            + f" | {r['clean_control_fpr'] if r['clean_control_fpr'] is not None else float('nan'):.3f} |\n"
        )
    L.append("\n## Why the champion wins\n")
    L.append(_why(results, champion))
    L.append("\n## Recall by fraud type (champion, test)\n")
    L.append("| fraud type | n | recall |\n|---|---|---|\n")
    for g in champion.get("by_fraud_type", []):
        rec = g.get("recall")
        L.append(f"| {g['group']} | {g['n']} | {'n/a' if rec is None else f'{rec:.3f}'} |\n")
    return "".join(L)


def _why(results: list[dict[str, Any]], champion: dict[str, Any]) -> str:
    by = {r["model"]: r for r in results}
    c = champion
    rules, lr = by.get("rules_baseline"), by.get("logistic_regression")
    parts: list[str] = []
    parts.append(
        f"{c['model']} ({c['backend']}) reaches test PR-AUC {c['test']['pr_auc']:.3f} and ROC-AUC {c['test']['roc_auc']:.3f} "
        f"at threshold {c['threshold']:.2f} (recall {c['test']['recall']:.3f}, FPR {c['test']['fpr']:.3f})."
    )
    if rules:
        d = c["test"]["pr_auc"] - rules["test"]["pr_auc"]
        parts.append(
            f"Against the rules baseline (PR-AUC {rules['test']['pr_auc']:.3f}) the gain is {d:+.3f}: the rules emit a small "
            "set of discrete scores, so they cannot rank cases within a severity tier, and every threshold below a HIGH rule "
            "trades recall for the same false positives. A learned model ranks continuously."
        )
    if lr and c["model"] != "logistic_regression":
        d = c["test"]["pr_auc"] - lr["test"]["pr_auc"]
        direction = "outperforms" if d > 0 else "does not outperform"
        parts.append(
            f"It {direction} logistic regression (PR-AUC {lr['test']['pr_auc']:.3f}, {d:+.3f}). The fraud signal is "
            "conjunctive and non-linear: a claimed-versus-bureau score gap only matters together with a clustered thin "
            "file, unsourced deposits only matter relative to income, and metadata risk is informative only above a "
            "threshold. Tree ensembles model those interactions and thresholds directly; a linear model has to approximate "
            "them with additive effects."
        )
    oot = c["out_of_time"]["pr_auc"]
    adv = c["adversarial"]["pr_auc"]
    if oot is not None:
        parts.append(
            f"Robustness: out-of-time PR-AUC {oot:.3f} under a rate shock and adversarial PR-AUC {adv:.3f} where fraud is "
            "placed among marginal applicants; the drop versus test, if any, is the price of relying on discrepancy "
            "features whose base rates shift with the population."
        )
    parts.append(
        f"Calibration: ECE {c['test']['ece']:.3f} and Brier {c['test']['brier']:.3f}; scores are usable as probabilities "
        "for the decision-economics simulator without post-hoc recalibration if ECE stays under 0.05."
    )
    others = [r for r in results if r["model"] != c["model"]]
    if any(r["test"]["pr_auc"] >= c["test"]["pr_auc"] - 0.01 for r in others):
        parts.append(
            "The margin over the runner-up is small; the champion is preferred on the tie-break of out-of-time PR-AUC, "
            "and both should be kept as champion/challenger."
        )
    return " ".join(parts) + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Case Explorer model development pipeline")
    p.add_argument("--data", default="data")
    p.add_argument("--out", default="artifacts")
    p.add_argument("--quick", action="store_true", help="subsample splits for a fast run")
    a = p.parse_args(argv)
    run(Path(a.data), Path(a.out), quick=a.quick)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

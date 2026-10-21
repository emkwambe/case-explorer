# Case Explorer analytics workbench

Case Explorer is a credit risk lab. This workbench is its mortgage fraud-analytics suite: the Python
model-development, validation, explainability, fairness, monitoring and governance layer for the
synthetic mortgage cases produced by the JavaScript generator. Credit-default modelling on the Solar
prime book is not in it yet.

```
cd analytics
pip install -e ".[dev]"
node ../scripts/build_datasets.js --out data --train 6000 --seed 42   # governed datasets + manifests
python -m case_analytics.pipeline --data data --out artifacts [--quick]
pytest -q && ruff check . && mypy src
```

Layout:

| Package | Purpose |
|---|---|
| `features/policy.py` | Enforces the PERMITTED / SENSITIVE / PROHIBITED feature policy exported by the generator. Every model entry point calls it. |
| `datasets/` | Manifest-verified loading of train / validation / test / out-of-time / stress / adversarial / clean-control splits with lineage. |
| `models/` | Rules baseline, logistic regression, random forest, gradient boosting (LightGBM, XGBoost or sklearn fallback). |
| `evaluation/` | Rare-event metrics (PR-AUC, calibration, Brier, per-type recall, threshold sweeps), underwriting outcomes, decision-economics threshold simulator. |
| `explainability/` | Permutation and native importance, SHAP summary and local explanations, partial dependence, score decomposition, SHAP-to-reason-code mapping. |
| `fairness/` | Subgroup metrics, real counterfactual invariance test, proxy analysis. Technical controls only, not legal compliance. |
| `monitoring/` | PSI / KS feature drift, prediction drift, rule firing-rate drift. |
| `governance/` | JSON model registry with lifecycle states, separation of duties, immutable audit events, validation-package renderer. |
| `pipeline.py` | Runs everything and writes `artifacts/model-summary.json`, `model-comparison.md`, `validation-package.md`, plots and reports. |

Outputs in `artifacts/` are generated; do not edit them by hand.

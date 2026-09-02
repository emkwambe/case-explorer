# Contributing

Case Explorer is a mortgage risk simulation, fraud analytics and model-validation lab. Every claim the repository makes about itself is generated from an artifact, so contributions are judged on whether they move a measured number, not on whether they read well.

## Prerequisites

| Tool | Version | Pinned in |
|---|---|---|
| Node.js | 22 | `.nvmrc` |
| Python | 3.13 | `.python-version` |
| Docker | optional | `docker-compose.yml` |

Docker is only needed for the PostgreSQL storage path and the compose stack (`npm run docker:up`). Everything else runs against the in-memory store.

## Setup

```bash
npm ci

cd analytics
pip install -e ".[dev]"
```

## Local verification loop

All of the following must pass before you open a pull request. CI (`.github/workflows/ci.yml`) runs the same commands.

JavaScript, from the repository root:

```bash
npm run lint                     # oxlint
npm test                         # vitest (unit, property and contract tests)
npm run benchmark                # three-layer benchmark; fails on a mandatory release gate
npm run readme:metrics -- --check
```

`npm run benchmark` writes `artifacts/` and exits non-zero when any mandatory gate in `src/evaluation/gates.js` fails. The gates cover generator quality (ledger invariants, evidence consistency, distribution tests, correlation targets, reproducibility, required fields), detection (ground-truth reconciliation), decision (rule agreement, prohibited variables, reason-code governance), fairness (counterfactual invariance, scenario attribute parity) and network analytics (ring recall, cluster false positives).

Python, from `analytics/`:

```bash
ruff check .
ruff format --check .
mypy src
pytest -q
```

The Python tests read the governed splits, so run `node scripts/build_datasets.js --out analytics/data` first if `analytics/data/` is empty.

## README metrics are generated, never typed

The blocks between `<!-- metrics:start -->` and `<!-- metrics:end -->` and between `<!-- model-metrics:start -->` and `<!-- model-metrics:end -->` in `README.md` are written by `scripts/update_readme_metrics.js` from `artifacts/validation-summary.json` and `analytics/artifacts/model-summary.json`. Never hand-edit them. `npm run readme:metrics -- --check` fails the build if the committed README does not match the artifacts, which is how a typed number gets caught.

The same rule applies to prose elsewhere in the repository: if you want to state a metric, take it from an artifact and name the artifact.

## Changes that must be justified by benchmark movement

Any change touching:

- case generation (`src/core/`, `src/generator.js`, `src/distribution_config.json`)
- the fraud rules (`src/decisioning/fraud-rules/rules.js`)
- the underwriting policy (`src/decisioning/underwriting/policy.js`)
- the reason-code catalog (`src/decisioning/reason-codes/catalog.js`)

must be accompanied by a benchmark run and a description of what moved. Run `npm run benchmark` before and after, and put the artifact diff in the pull request description: which gate values changed, in which direction, and why the change is intended. A refactor that claims to be behaviour-preserving should show identical gate values. A change that improves one layer at the expense of another needs the trade explained.

Version the thing you changed. `FRAUD_RULESET_VERSION`, `UNDERWRITING_POLICY_VERSION`, `REASON_CODE_CATALOG_VERSION` and `FEATURE_POLICY_VERSION` are recorded in every benchmark manifest and dataset manifest, so bumping them is what makes an artifact comparison meaningful.

## Adding a fraud typology

A typology is not complete until it exists in all seven places. A partial addition will fail the benchmark rather than silently degrade.

1. **Mutation operator** in `src/core/corruption.js`. Decide which layer you mutate: claimed truth (`corruptPresentation`), evidence (`tamperEvidence`, `applyTypologyEvidence`) or world truth (`corruptWorldTruth`). Document the layer in `docs/methodology/FRAUD_SCENARIO_METHODOLOGY.md`.
2. **Ground-truth finding** in `src/core/findings.js` (`generateGroundTruthFindings`), with `claimed_value`, `true_value` and the evidence citations that prove the delta.
3. **Expected decision** in `computeDecision` in the same file, placed in the documented precedence order.
4. **Fraud rule** in `src/decisioning/fraud-rules/rules.js` with full governance metadata: `id` (next `FR-0NN`), `version`, `description`, `features_used` (decision-view paths only), `threshold`, `target_scenarios`, `severity`, `reason_code`, `effective_date`, `owner`, `approval_status`. The rule may read only claims, evidence and metadata, never truth or labels.
5. **Recovery mapping** in `RECOVERY_MAP` in `src/evaluation/detection/index.js`, listing the reason codes that count as recovering the new ground-truth finding type. Without this the `ground_truth_reconciliation` gate will drop.
6. **Stratum** in the `STRATA` array in `scripts/benchmark.js`, so the typology gets a dedicated stratified sample rather than only appearing at its blended rate.
7. **Tests**: a unit test that the operator produces the intended delta, a test that the rule fires on it and does not fire on a clean case, and a decision test that the expected outcome is what the precedence order says.

## Adding a reason code

Add an entry to `REASON_CODES` in `src/decisioning/reason-codes/catalog.js` with `code`, `category` (one of `CREDIT_RISK`, `FRAUD_INDICATOR`, `DATA_QUALITY`, `VERIFICATION_FAILURE`, `MANUAL_REVIEW_TRIGGER`), a plain-language `description` suitable for an adverse-action notice, `adverse_action`, the alignment `dimensions` that can support it, and the `permitted_inputs` it may be derived from.

Two governance rules are enforced by `validateDecisionReasonCodes` and by the `reason_code_governance` release gate:

- A `DECLINE` must cite at least one code with `adverse_action: true`.
- A `DECLINE` can never be justified by fraud indicators alone. Fraud indicators drive investigation; the decline, if there is one, is expressed through a verification failure, a material application discrepancy or a credit-risk reason that the evidence actually supports.

If a new code is a fraud indicator, set `adverse_action: false` and make sure some adverse-action-eligible code is also emitted on any path that can decline.

## Commit messages

- Imperative subject line, no trailing period. "Add straw-buyer typology", not "Added" or "Adding".
- Explain why in the body, not what the diff already shows. If a number moved, say which and by how much.
- No em-dashes.
- Reference the artifact or gate that motivated the change where one exists.

## Generated files are not committed

`.gitignore` excludes `analytics/data/*.csv`, the dataset manifests, `analytics/artifacts/`, `public/artifacts/`, `dist/`, `coverage/` and the Python caches. Regenerate them locally:

```bash
npm run datasets                                     # analytics/data/*
npm run benchmark                                    # artifacts/*
cd analytics && python -m case_analytics.pipeline --data data --out artifacts
```

`artifacts/` from the JavaScript benchmark is committed because `npm run readme:metrics -- --check` compares the README against it. Do not commit dataset CSVs or model artifacts.

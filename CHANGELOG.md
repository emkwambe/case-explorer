# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-09-02

Three commits took the project from a synthetic case generator with a mixed validation script to a governed decisioning, model-validation and investigation stack. Numbers stated in the README are generated from `artifacts/validation-summary.json` and `analytics/artifacts/model-summary.json`.

### Added

**Benchmark and release gates**

- Three-layer evaluation replacing the single mixed harness: generator quality (distribution tests, copula correlations, ledger invariants, evidence consistency, required-field contract, seeded reproducibility), detection (governed fraud-rule catalog `FR-001` to `FR-017` evaluated on the underwriter-visible view only, with per-rule analytics and ground-truth reconciliation) and decision (underwriting policy on permitted inputs, decision-rule agreement, adverse-action reason-code governance, calibration by risk band).
- Fairness controls: subgroup analysis on isolated audit attributes and deterministic counterfactual invariance tests.
- Explicit release gates in `src/evaluation/gates.js`. `npm run benchmark` writes `artifacts/` (summary JSON, Markdown report, CSVs) and exits non-zero when a mandatory gate fails.
- `scripts/update_readme_metrics.js` generates the README metric blocks from artifacts, with a `--check` mode that fails CI when the committed README does not match.
- Three-class feature policy (permitted, sensitive, prohibited) enforced at runtime in `src/decisioning/policies/feature_policy.js`, and a governed reason-code catalog emitted on every decision.
- Four typologies with evidence trails: `OCCUPANCY_MISREPRESENTATION`, `GIFT_FUND_MISREPRESENTATION`, `ASSET_SEASONING`, `STRAW_BUYER`.

**Python model workbench (`analytics/`)**

- Four strategies compared on governed splits: rules baseline, logistic regression, random forest and gradient boosting (LightGBM), with a generated comparison narrative.
- Governed splits built by `scripts/build_datasets.js`: train, validation, test, out-of-time, geography stress, economic-regime stress, adversarial fraud and a clean negative control, each with a manifest carrying dataset version, generator commit, configuration hash and seed.
- Metrics: PR-AUC, ROC-AUC, precision, recall, F1, FPR, FNR, specificity, calibration error, Brier, confusion, per-fraud-type and per-regime slices, threshold sweeps and underwriting outcome rates.
- Decision economics: expected value as loss avoided minus review, friction and operating cost, with investigation capacity and adjustable prevalence.
- Explainability: permutation and native importance, SHAP summary and local explanations, partial dependence, score decomposition, and a mapping from features to governed reason codes with their evidence sources.
- Fairness: subgroup metrics with two-proportion tests, counterfactual invariance testing and proxy analysis, stated as technical controls only.
- Governance: model registry with nine lifecycle states, separation of duties requiring an audited override for a developer to validate their own model, immutable audit events and an auto-generated validation package.

**API, storage and operations**

- Versioned Zod contracts for world truth, claims, evidence, findings, decisions, explanations, model output, review actions and audit events, enforced at every system boundary.
- Investigation workflow from `NEW` to `CLOSED` with four-eyes disposition approval, evidence citations, notes and a hash-chained audit trail. Simulated cases are never labelled SAR-ready.
- Entity and network analytics over devices, IPs, addresses, employers and document fingerprints, with coordinated-ring injection to measure recall.
- Documented REST API with OpenAPI 3.1 at `/api/docs`, covering dataset generation, scoring, explanation, review, audit, models, evaluations and the threshold simulator, with API-key auth, per-key rate limits and request validation.
- PostgreSQL storage with migrations and immutability triggers on decisions, explanations, evaluations, review actions and audit events. The in-memory store implements the same interface for tests.
- Prometheus metrics at `/api/metrics`: generation and schema failures, scoring latency, prediction and decision distributions, rule firing rates, manual review rate, explanation availability and component versions.
- Docker image and a compose stack (postgres, migrate, seed, api, analytics).
- CI pipeline running lint, unit tests, the benchmark with release gates, Python format, type, test and pipeline checks, PostgreSQL integration tests, dependency audit, secret scanning, CodeQL, container scan and Pages deployment.
- Methodology documentation: data dictionary, parameter sources with provenance classes, statistical assumptions, fraud scenario methodology and limitations.

**User interface**

- New tabs making the analytical work visible: Decision (underwriting factors against thresholds, governed reason codes by category, rule alerts with cited evidence), Explanation (six governance questions plus model importances and SHAP plots from published artifacts), Fairness (live counterfactual test on the selected case), Investigation (workflow including the four-eyes control and the hash-chained audit trail with export), Network, Economics and Validation (release gates read from benchmark artifacts).
- A ten-step guided walkthrough from generating a borrower to exporting the validation package.

### Changed

- `src/generator.js` modularised into `src/core`, `src/utils` and `src/ml`, alongside the Express API scaffold.
- Sensitive attributes isolated under `audit_attributes` and never used as decision inputs.
- The `IMMIGRANT_PROFESSIONAL` persona replaced by `RELOCATED_PROFESSIONAL`.
- Fraud metadata signals now apply to a configurable share of fraud cases and never to the incoherent negative control.
- Small income variances (15 percent or less) and liability variances (under 100 USD per month) re-underwrite on verified figures with a manual-review floor instead of auto-declining.
- Credit-bureau evidence itemises revolving and other debt, so hidden liabilities are evidence-visible.
- Case ids and as-of dating are deterministic for seeded runs.
- Life scripts anchor to the simulation as-of date; synthetic-identity and incoherent timelines are relative to origination.
- The 98 KB single-component explorer replaced by a module tree under `src/ui` (theme, primitives, hooks, tabs grouped by purpose). The demo library is generated deterministically from a fixed seed, so it opens on the same twelve cases for every reviewer and cannot drift from the current schema.
- Where artifacts are not published, the UI says so rather than showing invented numbers.

### Fixed

- The `INCOHERENT` negative control now produces timeline violations that actually violate the timeline (rent before lease, deposit before employment start).
- Blended inflation spans all three severities.
- ZIP codes are five digits.
- Analytics artifacts serialise through a JSON-safe writer, so non-finite metrics become `null` rather than invalid JSON.
- A rejected investigation transition set its error inside a state updater where React discarded it.
- The rule identifier was split across text nodes in the UI.
- Audit event hashing used a `JSON.stringify` replacer array, which the runtime applies at every depth, so nested `payload` keys were stripped and payload contents were never covered by the hash. Tampering inside a payload was undetectable. Replaced with a recursive canonical serialiser.
- API-key authentication was mounted globally rather than scoped to `/api`, so the static demo UI served by the container returned 401.
- The GitHub Pages deployment published only the benchmark artifacts, leaving the demo without the model artifacts its Explanation and Validation tabs read.

### Removed

- The single mixed validation harness as the authoritative quality signal, superseded by the three-layer benchmark and its gates.
- The 2,100-line embedded case fixture in the UI, replaced by deterministic seeded generation.

## [1.0.0] - 2026-08-01

The synthetic case generator and its terminal tooling, plus the first infrastructure and planning documents.

### Added

- Synthetic mortgage case generator (`src/generator.js`) producing a coherent simulated financial life: demographics, persona, employment, income trajectory, liabilities, assets, credit score, housing and rent history.
- Statistical primitives with copula-correlated draws: a five-variable Gaussian copula over age, salary, DTI, checking balance and credit score, sampled by Cholesky decomposition with numerical inverse CDFs, on top of truncated normal, lognormal and beta marginals.
- Persona definitions with their own salary distributions, so each profession stays in its own income range.
- Population regimes (prime, subprime, self-employed) as a configurable mixture with regime-specific shifts.
- Geography: ZIP codes, cost-of-living regions and regional salary, rent and checking multipliers.
- Closed-loop monthly cash-flow ledger enforcing the accounting identity `ending_balance = starting_balance + salary_deposits - total_outflows`, with income stream, expense obligations, monthly statements and overdraft events.
- Evidence synthesis derived from the ledger (W-2, employer verification, bank statement, credit bureau, rent verification, geographic verification), each document carrying creation and modification dates, age before submission, generator label and fidelity noise.
- Application metadata: submission timing, IP address and risk score, VPN and Tor flags, typing speed, copy-paste field count, session duration and autofill use.
- Corruption operators for `TIMING_DRIFT`, `INFLATION`, `CONCEALMENT`, `FABRICATION`, `BUST_OUT`, `EVIDENCE_TAMPERING` and `INCOHERENT`, plus a configurable blended mix.
- Alignment findings and a ground-truth findings graph recording the exact delta between world truth, claimed truth and evidence, with evidence citations and an A0 to A5 classification.
- Decision labels: alignment level, case coherence status, fraud risk level, expected outcome, difficulty and a human-readable rationale.
- Terminal validation suite (`validate.js`) covering distribution fits, regime proportions, latent and copula correlations, corruption unit checks, ledger invariants, metadata signal separation and a five-stage evaluation harness, exiting non-zero on failure.
- Terminal batch generation (`batch_generate.js`) writing JSON and CSV, and narrative example cases (`examples.js`).
- React and Vite explorer UI with per-case tabs and ML dataset CSV export.
- Configuration-driven tuning through `src/distribution_config.json`.
- Initial CI workflow, PostgreSQL schema draft, database setup guide and environment template.
- Planning and assessment documents: multi-disciplinary analysis report, GitHub Projects board configuration for the 90-day roadmap and its setup guide, and a product quality assessment report.

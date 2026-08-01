# Synthetic Underwriting Case Explorer

A React + Vite application that generates realistic synthetic mortgage-underwriting cases for ML training, UI stress-testing, and fraud-model R&D.

Every case is a simulated financial life — not just a bundle of documents. The generator produces a coherent narrative of employment, income, debt, assets, housing history, credit, evidence documents, application metadata, and (optionally) fraud.

---

## Quick start

```bash
npm install
npm run dev          # start the UI
npm run build        # production build
npm run lint         # oxlint
npm run validate     # terminal validation suite
```

Terminal batch generation:

```bash
node batch_generate.js 10000 my_dataset 42
# writes my_dataset.json and my_dataset.csv
```

Narrative examples:

```bash
node examples.js
```

---

## What it generates

### Core financial life
- **Demographics**: age, SSN last-4
- **Persona**: profession/life situation (teacher, nurse, software engineer, entrepreneur, immigrant professional, etc.)
  - Each persona now has its own salary distribution (`salary_median`, `salary_gini`, `salary_min`, `salary_max`) so teachers stay near teacher salaries and software engineers stay near tech salaries.
- **Employment**: industry, salary, tenure, stability pattern
- **Income trajectory**: employment-start events and occasional salary increases
- **Liabilities**: DTI, student loans, auto loans, other monthly debt
- **Assets**: checking balance, down-payment amount
- **Credit score**: base score plus DTI penalty
- **Housing / rent history**: address changes with monthly rent payments
- **Regime**: prime, subprime, or self-employed population segment
- **Geography**: zip code, cost-of-living region, regional salary/rent/checking multipliers

### Evidence documents
- W-2 document
- Employer verification
- Bank statement (with recurring debits, rent payments, overdraft history, and ledger-derived payroll deposit)
- Credit bureau record
- Rent verification
- Geographic verification (zip code, region, cost-of-living index)

Each document has:
- creation / modification dates
- age before submission
- PDF generator label
- fidelity (noise relative to truth)

### Closed-loop cash-flow ledger
Every case now carries a `monthly_ledger` inside `truth.current_state`. The ledger is simulated backwards from the sampled checking balance and enforces the accounting identity:

```
ending_balance = starting_balance + salary_deposits - total_outflows
```

Ledger components:
- **Income stream**: gross salary, pay frequency, pretax deduction rate, net per check, annual W-2 wages
- **Expense obligations**: rent, utilities, liability payments, discretionary spending
- **Monthly ledger**: last N months of deposits, outflows, and balances
- **Overdraft events**: recorded when the implied starting balance falls negative

Evidence documents are derived from this ledger, so W-2 wages, bank balances, and payroll deposits are mutually consistent by construction.

### Application metadata
- Submission timestamp, hour, day-of-week, business-hours flag
- IP address, IP risk score, VPN/TOR flags
- Typing speed, copy-paste field count, session duration, autofill use

### Alignment findings (9 + 3 checks)
1. Identity alignment
2. Employer alignment
3. Income reconciliation
4. Asset reconciliation
5. Liability reconciliation
6. Address alignment
7. Timeline consistency
8. Cash-flow consistency
9. Loan affordability / decision consistency
10. Document metadata (new)
11. Network / IP risk (new)
12. Behavioral biometrics (new)

### Decision / labels
- `alignment_level`: A0 … A5
- `case_coherence_status`: COHERENT | COHERENT_WITH_EXPLAINABLE_VARIANCES | INCOHERENT | FRAUDULENT
- `fraud_risk_level`: NONE | LOW | MODERATE | HIGH | CRITICAL
- `expected_outcome`: APPROVE | MANUAL_REVIEW | DECLINE
- `difficulty`: BASIC | INTERMEDIATE | ADVANCED
- `reason`: human-readable decision rationale

### Fraud / corruption types
- `NONE` — clean case
- `TIMING_DRIFT` — benign date variance
- `INFLATION` — overstated income/assets
- `CONCEALMENT` — omitted liabilities
- `FABRICATION` — fake employer, inflated assets
- `BUST_OUT` — synthetic identity with compressed credit-building history
- `EVIDENCE_TAMPERING` — altered bank statements, unsupported deposits, document-level manipulation while the application claim stays clean
- `MIXED` / blended — configurable 85/7/5/3/1 clean/fraud mix

### Ground-truth findings graph
Every generated case includes a `ground_truth_findings` array that records the exact delta between World Truth, Claimed Truth, and Evidence. Each finding contains:
- `type`: e.g., `INCOME_MISREPRESENTATION`, `LIABILITY_CONCEALMENT`, `EVIDENCE_TAMPERING`
- `target_layer`: `CLAIMED_TRUTH`, `EVIDENCE`, or `WORLD`
- `claimed_value` and `true_value`
- `evidence_citations`: the exact document and field that prove the delta
- `classification`: A0–A5

### A3 incoherent world cases
`INCOHERENT` corruption generates negative-control cases where the underlying world truth violates accounting or timeline invariants (e.g., rent paid before lease start, W-2 wages exceeding gross salary). These are labeled A3 and expected to decline so you can test whether an AI rejects impossible worlds instead of overfitting to document patterns.

### AI evaluation harness
`validate.js` now includes a five-stage FCGS benchmark on a held-out sample:
1. **Extraction score** — fraction of expected fields present in evidence.
2. **Reconciliation score** — fraction of ground-truth deltas correctly flagged by a rule-based checker.
3. **Reasoning score** — mean absolute error of reconstructed salary/checking vs truth.
4. **Decision accuracy** — agreement between checker decision and ground-truth expected outcome.
5. **Explanation overlap** — Jaccard similarity between ground-truth evidence citations and checker citations.

This makes the dataset directly usable as a benchmark for extraction, reconciliation, reasoning, and explanation quality.

---

## Architecture

```
src/distribution_config.json   # Single source of truth for distributions, regimes, personas, copula, fraud mix
src/generator.js               # Pure JS generator (browser + Node)
src/FraudCaseExplorer.jsx      # React UI
validate.js                    # Terminal validation suite
batch_generate.js              # Terminal batch generator
examples.js                    # Narrative A0–A5 example cases
```

`src/generator.js` is dependency-free except for the React/Vite toolchain. It exposes:

- `generateCase(id, config, corruptionType, severity, seed, providedTruth?)`
- `generateBlendedCase(id, config, seed, adversarial?)`
- `generateLifeScript(entityId, config, rng)`
- `corruptPresentation(truth, corruptionType, severity, config, rng)`
- `synthesizeEvidence(truth, rng)`
- `generateAlignmentFindings(truth, presentation, evidence, metadata?)`
- `computeDecision(...)`
- `extractMLFeatures(caseObj)`
- `casesToCsv(cases)`
- `calculateStatistics(cases)`

---

## Statistical model

### Marginal distributions
- **Age**: truncated Normal
- **Salary base**: Lognormal
- **DTI**: Beta scaled to [0, 0.65]
- **Checking balance**: Lognormal
- **Credit score base**: truncated Normal

All are validated with Kolmogorov-Smirnov / chi-square tests in `validate.js`.

### Joint distribution: Gaussian copula
A 5-variable Gaussian copula controls correlations between age, salary, dti, checking_balance, and credit_score. The target correlation matrix is configurable in `src/distribution_config.json` under `copula`.

The copula is sampled with Cholesky decomposition and numerical inverse CDFs. A small residual latent `financial_health` variable is still applied (dampened ×0.25) so regime shifts (prime/subprime) continue to work.

### Regime mixture
Cases are drawn from three regimes:
- **PRIME** (≈55%): higher financial health, larger checking, credit floor
- **SUBPRIME** (≈30%): lower financial health, credit cap, DTI can extend
- **SELF_EMPLOYED** (≈15%): higher income volatility, unique employer name, more erratic tenure

### Adversarial corruption (optional)
When `adversarial.enabled` is `true`, corruption types target weak profiles:
- Income inflation when DTI ∈ [0.36, 0.47]
- Debt concealment when DTI > 0.40
- Fabrication when credit score < 620

---

## ML dataset

The UI includes tabs for Overview, Timeline, Alignment, Evidence, Metadata (application/device/document signals), Decision, and a full Data Table. Use the **Adversarial mode** checkbox to make blended fraud target weak profiles.

Click **Export ML Dataset CSV** in the UI, or run:

```bash
node batch_generate.js 10000 my_dataset 42
```

The CSV contains ~60 columns, including:
- Raw truth and presentation attributes
- Discrepancy amounts and percentages
- Evidence signals (W-2, bank, credit bureau differences)
- Alignment dimension flags
- Application / device / document metadata
- Targets: `is_fraud`, `outcome_approve/decline/manual_review`, `alignment_level_numeric`, `case_coherence_status`

---

## Validation

```bash
node validate.js [count] [seed]
```

Checks:
- Primitive distribution fits (KS / chi-square)
- Regime mixture proportions
- Latent correlation matrix
- Copula target vs achieved correlations
- Corruption unit checks
- Ledger accounting invariants
- Metadata signal separation (clean vs fraud)
- FCGS five-stage AI evaluation harness (extraction, reconciliation, reasoning, decision, explanation)

Example:

```bash
node validate.js 5000 42
```

Exit code is non-zero if any distribution or corruption check fails.

---

## Configuration

Edit `src/distribution_config.json` to change:
- Distribution parameters (means, medians, gini, alpha/beta, etc.)
- Income stream parameters (pay frequency, pretax deduction rate)
- Expense parameters (rent-to-income ratio, utilities, discretionary rate)
- Ledger parameters (statement months, overdraft fee)
- Fraud blend ratios
- Regime mix and regime-specific shifts
- Persona definitions, including persona-specific salary distributions (`salary_median`, `salary_gini`, `salary_min`, `salary_max`)
- Geography mix, zip prefixes, and cost-of-living multipliers
- Copula target correlation matrix
- Adversarial thresholds and weights

No code changes are required for most tuning.

---

## Tech stack

- React 19 + Vite
- Oxlint for linting
- Pure-JavaScript generator (no runtime math dependency in the browser bundle)
- Node scripts for batch generation and validation

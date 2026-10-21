# Credit tape (synthetic): Solar prime, seed 42

The funded book and application pool behind the Dealer View, Policy Sandbox and Findings numbers, exported as a reconciled loan tape. Every borrower, dealer and outcome is synthetic.

**Generated file.** `node scripts/export_credit_book.mjs` writes everything in this folder, this README included. Do not edit by hand. `--check` rebuilds in memory and fails if any file differs.

## How the data was produced

1. **Applications.** `generateBlendedCase(i, config, 42)` for i = 0, 1, 2, … under the Solar prime profile, with `src/distribution_config.json` at as-of date 2026-01-15 (generator 2.0.0, case schema 2.0.0, config `sha256:e984ec798bee…`).
2. **Decision.** Each application is scored by the credit policy on claimed values only (`assessCredit`; the pool's `decision` is `decide`, which matches it on every application).
3. **Book.** Applications the policy approves are funded, in seed order, until the book holds 10,000 loans. That took 18,674 applications.
4. **Outcomes.** Each funded loan is assigned to a synthetic dealer and simulated over 18 months from **true** FICO, **true** DTI, fraud and dealer quality (`simulateLoans`). PD is that simulation's probability of default.
5. **No shared randomness.** Every random stream is keyed by case or dealer id, so the export draws nothing that another view depends on.

## Files

| File | Rows | Role |
|---|---|---|
| `credit-tape-loans.csv` | 10,000 | one row per funded loan: presented values and simulated outcomes |
| `credit-tape-pool.csv` | 18,674 | one row per application generated to fund the book: presented values and the credit-policy decision |
| `credit-tape-oracle.csv` | 10,000 | **answer key — never a model input: world truth, the corruption label, dealer quality and PD for each funded loan** |
| `credit-tape-reconciliation.json` | | totals the tape must reconcile to |
| `manifest.json` | | SHA-256 of each data file, the seed, the profile and the generator version |

`loan_id` in the loans and oracle files equals `application_id` in the pool file.

## Field definitions

**credit-tape-loans.csv** (loan_id, dealer_id, ead, fico_presented, dti_presented, checking_presented, fraud_review, dpd30, charged_off)
- `dealer_id`: synthetic dealer ID, such as NC-19.
- `ead`: loan amount in dollars (exposure at default).
- `fico_presented`, `dti_presented`, `checking_presented`: the claimed FICO, back-end DTI (current housing payment plus the proposed solar loan payment, over claimed income) and claimed checking balance. These are what the credit policy saw.
- `fraud_review`: 1 if a high-severity underwriter-visible fraud rule fired. Funded loans never have it, because a fraud review routes to Review.
- `dpd30`, `charged_off`: 1 if the loan reached 30+ days past due, or charged off, within 18 months (simulated).

**credit-tape-pool.csv** (application_id, fico_presented, dti_presented, checking_presented, fraud_review, decision, funded)
- `decision`: APPROVE, REVIEW or DECLINE. `funded`: 1 for APPROVE (review is treated as not funded).

**credit-tape-oracle.csv** (loan_id, fico_true, dti_true, fraud_true, corruption_type, dealer_quality, pd)
- `fico_true`, `dti_true`: world-truth FICO and DTI. `fraud_true`: 1 if the case carries a fraud corruption. `corruption_type`: the generator's label (NONE for clean). `dealer_quality`: the dealer's hidden quality (0–1). `pd`: the simulated probability of default, computed from true values.
- **Answer key — never a model input.** A model trained on these columns would see facts no lender has.

## Reconciliation

| Total | Value |
|---|---|
| Funded loans | 10,000 |
| Σ EAD | $448,332,100 |
| Expected loss (Σ PD × LGD × EAD, LGD 0.85) | $4,413,431 |
| 30+ DPD | 225 (2.25%) |
| Charged off | 101 |
| Dealers with loans | 50 |
| Pool applications | 18,674 |
| Pool policy mix | APPROVE 10,000 (53.6%) · REVIEW 4,494 (24.1%) · DECLINE 4,180 (22.4%) |

The pool mix covers the 18,674 applications generated to fund the book. It is **not** the 54.6 / 24.7 / 20.7 mix, which comes from the separate 2,000-application `test:credit` sample.

## What the data looks like

No row is missing an ID or an outcome. Missing values appear only where the generator leaves a claimed field empty, and are counted below (empty cells in the CSVs).

**Funded loans**

| Column | n | Missing | Min | p25 | Median | p75 | Max | Mean |
|---|---|---|---|---|---|---|---|---|
| ead | 10,000 | 0 | 10,000 | 28,700 | 39,800 | 55,400 | 150,000 | 44,833 |
| fico_presented | 10,000 | 0 | 660 | 724 | 751 | 777 | 850 | 750 |
| dti_presented | 10,000 | 0 | 0.0612 | 0.1797 | 0.2285 | 0.2833 | 0.3600 | 0.2316 |
| checking_presented | 10,000 | 0 | 638 | 8,427 | 13,951 | 23,617 | 224,947 | 18,892 |

- `fraud_review`: 0 10,000
- `dpd30`: 0 9,775 · 1 225
- `charged_off`: 0 9,899 · 1 101

**Application pool**

| Column | n | Missing | Min | p25 | Median | p75 | Max | Mean |
|---|---|---|---|---|---|---|---|---|
| fico_presented | 18,674 | 0 | 485 | 703 | 738 | 768 | 850 | 733 |
| dti_presented | 18,674 | 0 | 0.0574 | 0.1978 | 0.2731 | 0.3895 | 1.7327 | 0.3134 |
| checking_presented | 18,674 | 0 | 482 | 7,392 | 12,929 | 23,398 | 316,421 | 19,382 |

- `decision`: APPROVE 10,000 · REVIEW 4,494 · DECLINE 4,180
- `fraud_review`: 0 15,542 · 1 3,132

**Oracle (answer key)**

| Column | n | Missing | Min | p25 | Median | p75 | Max | Mean |
|---|---|---|---|---|---|---|---|---|
| fico_true | 10,000 | 0 | 660 | 724 | 751 | 777 | 850 | 750 |
| dti_true | 10,000 | 0 | 0.0612 | 0.1803 | 0.2290 | 0.2837 | 0.3955 | 0.2322 |
| pd | 10,000 | 0 | 0.0054 | 0.0054 | 0.0098 | 0.0118 | 0.1234 | 0.0115 |
| dealer_quality | 10,000 | 0 | 0.336 | 0.526 | 0.573 | 0.759 | 0.971 | 0.647 |

- `fraud_true`: 0 9,523 · 1 477
- `corruption_type`: NONE 9,523 · INFLATION 357 · ASSET_SEASONING 113 · CONCEALMENT 7

**Before and after.** No cleaning was applied: the tape is the engine's output, unfiltered and unimputed. The only transformations are the join of presented values (pool) to simulated outcomes (loans) on the case ID, and the split of hidden fields into the oracle file.

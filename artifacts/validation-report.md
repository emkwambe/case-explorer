# Validation Report

Generated 2026-09-02T14:46:48.448Z · seed `42` · 1,500 blended + 1,200 stratified cases · generator 2.0.0 · commit `eb3c94bb` · config `5e52bfca3212`

## Release gates — **PASS**

| Gate | Layer | Required | Value | Status |
|---|---|---|---|---|
| Ledger invariants | generator | >= 1 | 1 | PASS |
| Evidence consistency (clean cases) | generator | >= 0.995 | 0.9992 | PASS |
| Distribution tests passing | generator | >= 0.95 | 1 | PASS |
| Correlation targets within tolerance | generator | >= 0.95 | 1 | PASS |
| Reproducibility (seeded) | generator | >= 1 | 1 | PASS |
| Missing required fields | generator | <= 0 | 0 | PASS |
| Ground-truth reconciliation | detection | >= 0.97 | 0.9995 | PASS |
| Decision-rule agreement | decision | >= 0.95 | 0.987 | PASS |
| Prohibited variables in decision inputs | decision | <= 0 | 0 | PASS |
| Declines without adverse-action reason | decision | <= 0 | 0 | PASS |
| Counterfactual fairness invariance | fairness | >= 1 | 1 | PASS |
| Independent scenario attribute selection ratio | fairness | >= 0.8 | 1 | PASS |
| Rule-baseline fraud recall | detection | >= 0.9 | 1 | PASS |
| Rule-baseline FPR on clean cases | detection | <= 0.05 | 0.0044 | PASS |

## Headline metrics

| Capability | Result |
|---|---|
| Generated cases | 2,700 |
| Ledger invariants | 100.0% |
| Evidence consistency | 99.9% |
| Distribution tests passing | 100.0% |
| Correlation targets within tolerance | 100.0% |
| Reproducibility | 100.0% |
| Missing required fields | 0.0% |
| Ground-truth reconciliation | 100.0% |
| Rule-baseline fraud precision / recall / F1 | 0.993 / 1.000 / 0.997 |
| Rule-baseline false-positive rate (clean) | 0.4% |
| Decision-rule agreement | 98.7% |
| Adverse-action reason overlap | 91.3% |
| Prohibited variables in decision inputs | 0 |
| Counterfactual invariance | 100.0% |
| Fairness checks | WARN |

## Layer 1 — Generator validation

Answers: are distributions correct, financial relationships coherent, evidence consistent, correlations realistic, seeds reproducible?

| Test | Family | Statistic | p | Grade |
|---|---|---|---|---|
| age | truncated normal | 2.988 | 0.5598 | PASS |
| salary_base | lognormal | 0.0208 | 0.026 | PASS |
| dti | scaled beta | 0.0165 | 0.1309 | PASS |
| credit_score_base | truncated normal | 0.0315 | 0.0001 | PASS |
| checking_balance | lognormal | 0.0125 | 0.4128 | PASS |
| regime_mixture | categorical mixture | 0.277 | 0.8706 | PASS |
| region_mixture | categorical mixture | 1.067 | 0.5866 | PASS |
| persona_salary_band:SOFTWARE_ENGINEER | range | 0 |  | PASS |
| persona_salary_band:TEACHER | range | 0 |  | PASS |
| persona_salary_band:NURSE | range | 0 |  | PASS |
| persona_salary_band:CONSTRUCTION_WORKER | range | 0 |  | PASS |
| persona_salary_band:ENTREPRENEUR | range | 0 |  | PASS |
| persona_salary_band:PHYSICIAN_ASSISTANT | range | 0 |  | PASS |
| persona_salary_band:RELOCATED_PROFESSIONAL | range | 0 |  | PASS |
| persona_salary_band:RETAIL_MANAGER | range | 0 |  | PASS |
| persona_salary_band:FINANCE_ANALYST | range | 0 |  | PASS |
| range:age | range | 0 |  | PASS |
| range:credit_score | range | 0 |  | PASS |
| range:dti | range | 0 |  | PASS |

| Pair | Source | Target | Achieved | OK |
|---|---|---|---|---|
| age vs salary_base | copula | 0.2 | 0.211 | yes |
| age vs dti | copula | -0.15 | -0.134 | yes |
| age vs checking_balance | copula | 0.1 | 0.055 | yes |
| age vs credit_score | copula | 0.05 | 0.028 | yes |
| salary_base vs dti | copula | -0.35 | -0.265 | yes |
| salary_base vs checking_balance | copula | 0.4 | 0.296 | yes |
| salary_base vs credit_score | copula | 0.3 | 0.225 | yes |
| dti vs checking_balance | copula | -0.25 | -0.257 | yes |
| dti vs credit_score | copula | -0.5 | -0.519 | yes |
| checking_balance vs credit_score | copula | 0.25 | 0.298 | yes |
| salary_base vs dti | sign-expectation | negative | -0.265 | yes |
| salary_base vs credit_score | sign-expectation | positive | 0.225 | yes |
| dti vs credit_score | sign-expectation | negative | -0.519 | yes |
| salary_base vs checking_balance | sign-expectation | positive | 0.296 | yes |

| Ledger invariant | Pass rate |
|---|---|
| accounting_identity | 100.0% (1500/1500) |
| obligations_equal_liability_sum | 100.0% (1500/1500) |
| loan_amount_rule | 100.0% (1500/1500) |
| backend_dti_identity | 100.0% (1500/1500) |
| evidence_sources_complete | 100.0% (1500/1500) |

Evidence consistency on 1276 clean cases: 99.9% (tolerance = 3.5σ of configured document-fidelity noise).

## Layer 2 — Detection evaluation (rule baseline, underwriter-visible data only)

Answers: can rules identify injected fraud, which types are missed, what is the false-positive rate, which evidence supports each alert?

| Metric | Value |
|---|---|
| Precision | 0.993 |
| Recall | 1.000 |
| F1 | 0.997 |
| FPR (all non-fraud) | 0.006 |
| FPR (clean only) | 0.004 |
| Specificity | 0.994 |
| Evidence-cited alerts | 100.0% |

| Fraud type | n | Alert rate | High-severity alert rate |
|---|---|---|---|
| NONE | 1356 | 0.4% | 0.0% |
| CONCEALMENT | 269 | 100.0% | 98.5% |
| FABRICATION | 126 | 100.0% | 100.0% |
| INFLATION | 299 | 100.0% | 26.8% |
| BUST_OUT | 90 | 100.0% | 100.0% |
| EVIDENCE_TAMPERING | 160 | 100.0% | 100.0% |
| INCOHERENT | 80 | 100.0% | 100.0% |
| OCCUPANCY_MISREPRESENTATION | 80 | 100.0% | 100.0% |
| GIFT_FUND_MISREPRESENTATION | 80 | 100.0% | 100.0% |
| ASSET_SEASONING | 80 | 100.0% | 0.0% |
| STRAW_BUYER | 80 | 100.0% | 100.0% |

| Ground-truth finding | Total | Recovered | Rate |
|---|---|---|---|
| LIABILITY_CONCEALMENT | 342 | 342 | 100.0% |
| INCOME_MISREPRESENTATION | 515 | 515 | 100.0% |
| ASSET_MISREPRESENTATION | 216 | 216 | 100.0% |
| EMPLOYER_FABRICATION | 216 | 216 | 100.0% |
| SYNTHETIC_IDENTITY | 90 | 89 | 98.9% |
| EVIDENCE_TAMPERING | 160 | 160 | 100.0% |
| INCOHERENT_WORLD | 80 | 80 | 100.0% |
| OCCUPANCY_MISREPRESENTATION | 80 | 80 | 100.0% |
| GIFT_FUND_MISREPRESENTATION | 80 | 80 | 100.0% |
| ASSET_SEASONING | 80 | 80 | 100.0% |
| STRAW_BUYER | 80 | 80 | 100.0% |

| Rule | Sev | Alerts | TP | FP | Precision | Target recall | FP rate (clean) |
|---|---|---|---|---|---|---|---|
| FR-001@1.2.0 | HIGH | 420 | 420 | 0 | 1.000 | 0.880 | 0.0% |
| FR-002@1.0.0 | HIGH | 216 | 216 | 0 | 1.000 | 1.000 | 0.0% |
| FR-003@1.2.0 | HIGH | 341 | 338 | 3 | 0.991 | 1.000 | 0.0% |
| FR-004@1.0.0 | HIGH | 209 | 209 | 0 | 1.000 | 0.984 | 0.0% |
| FR-005@1.0.0 | MEDIUM | 240 | 240 | 0 | 1.000 | 0.750 | 0.0% |
| FR-006@1.0.0 | HIGH | 163 | 163 | 0 | 1.000 | 1.000 | 0.0% |
| FR-007@1.0.0 | MEDIUM | 97 | 97 | 0 | 1.000 | 0.606 | 0.0% |
| FR-008@1.0.0 | LOW | 57 | 57 | 0 | 1.000 | 0.356 | 0.0% |
| FR-009@1.1.0 | HIGH | 91 | 91 | 0 | 1.000 | 0.989 | 0.0% |
| FR-010@1.0.0 | MEDIUM | 499 | 493 | 6 | 0.988 | 0.390 | 0.4% |
| FR-011@1.0.0 | MEDIUM | 536 | 536 | 0 | 1.000 | 0.424 | 0.0% |
| FR-012@1.0.0 | LOW | 618 | 589 | 29 | 0.953 | 0.466 | 1.9% |
| FR-013@1.0.0 | HIGH | 130 | 130 | 0 | 1.000 | 1.000 | 0.0% |
| FR-014@1.0.0 | HIGH | 80 | 80 | 0 | 1.000 | 1.000 | 0.0% |
| FR-015@1.0.0 | HIGH | 80 | 80 | 0 | 1.000 | 1.000 | 0.0% |
| FR-016@1.0.0 | MEDIUM | 234 | 234 | 0 | 1.000 | 0.963 | 0.0% |
| FR-017@1.0.0 | HIGH | 80 | 80 | 0 | 1.000 | 1.000 | 0.0% |

## Layer 3 — Decision evaluation

Answers: approve / decline / review agreement with the labelled outcome, permissible-variable audit, reason-code accuracy, calibration to risk.

| Fraud type | n | Agreement |
|---|---|---|
| NONE | 1356 | 97.4% |
| CONCEALMENT | 269 | 100.0% |
| FABRICATION | 126 | 100.0% |
| INFLATION | 299 | 100.0% |
| BUST_OUT | 90 | 100.0% |
| EVIDENCE_TAMPERING | 160 | 100.0% |
| INCOHERENT | 80 | 100.0% |
| OCCUPANCY_MISREPRESENTATION | 80 | 100.0% |
| GIFT_FUND_MISREPRESENTATION | 80 | 100.0% |
| ASSET_SEASONING | 80 | 100.0% |
| STRAW_BUYER | 80 | 100.0% |

Confusion (expected → policy): MANUAL_REVIEW->MANUAL_REVIEW: 550, DECLINE->DECLINE: 1719, APPROVE->APPROVE: 396, APPROVE->MANUAL_REVIEW: 26, DECLINE->MANUAL_REVIEW: 6, MANUAL_REVIEW->APPROVE: 1, MANUAL_REVIEW->DECLINE: 2

Reason codes — mean Jaccard 0.863, exact match 71.0%, adverse-action overlap 91.3%.

| Credit band (clean) | n | Approval rate | Decline rate |
|---|---|---|---|
| <600 | 173 | 0.0% | 100.0% |
| 600-639 | 236 | 0.0% | 31.8% |
| 640-679 | 395 | 29.4% | 27.3% |
| 680-719 | 260 | 45.8% | 19.6% |
| 720+ | 292 | 55.5% | 17.8% |

| DTI band (clean) | n | Approval rate | Decline rate |
|---|---|---|---|
| <=30 | 47 | 55.3% | 8.5% |
| 30-38 | 662 | 56.0% | 19.8% |
| 38-47 | 470 | 0.0% | 31.3% |
| >47 | 177 | 0.0% | 100.0% |

## Fairness controls — WARN

> Technical fairness-testing controls only. Does not establish legal compliance; supports human legal and compliance review.

Counterfactual pairs: 4311 tested on 300 cases; unchanged 4311; **changed 0**.

| Attribute | Class | Group | n | Approval | Review | Decline | Selection ratio | FPR | FNR |
|---|---|---|---|---|---|---|---|---|---|
| family_status_scenario | INDEPENDENT_SCENARIO | MARRIED | 530 | 26.2% | 32.5% | 41.3% | 0.890 | 0.007 | 0.000 |
| family_status_scenario | INDEPENDENT_SCENARIO | SINGLE | 514 | 25.5% | 31.5% | 43.0% | 0.865 | 0.005 | 0.000 |
| family_status_scenario | INDEPENDENT_SCENARIO | WITH_DEPENDENTS | 344 | 21.8% | 34.0% | 44.2% | 0.740 | 0.003 | 0.000 |
| family_status_scenario | INDEPENDENT_SCENARIO | SINGLE_PARENT | 112 | 29.5% | 27.7% | 42.9% | 1.000 | 0.000 | 0.000 |
| disability_income_scenario | INDEPENDENT_SCENARIO | 0 | 1444 | 25.2% | 32.2% | 42.6% | 1.000 | 0.005 | 0.000 |
| disability_income_scenario | INDEPENDENT_SCENARIO | 1 | 56 | 25.0% | 30.4% | 44.6% | 0.992 | 0.000 | 0.000 |
| age_band | DERIVED | 30-39 | 440 | 24.1% | 36.4% | 39.5% | 0.597 | 0.003 | 0.000 |
| age_band | DERIVED | 50-59 | 212 | 25.0% | 32.5% | 42.5% | 0.620 | 0.000 | 0.000 |
| age_band | DERIVED | 40-49 | 433 | 27.5% | 31.2% | 41.3% | 0.682 | 0.003 | 0.000 |
| age_band | DERIVED | 22-29 | 353 | 21.2% | 28.3% | 50.4% | 0.527 | 0.007 | 0.000 |
| age_band | DERIVED | 60+ | 62 | 40.3% | 29.0% | 30.6% | 1.000 | 0.036 | 0.000 |
| geography_group | DERIVED | MEDIUM_COST | 730 | 25.9% | 35.2% | 38.9% | 0.906 | 0.002 | 0.000 |
| geography_group | DERIVED | LOW_COST | 385 | 20.5% | 28.6% | 50.9% | 0.718 | 0.006 | 0.000 |
| geography_group | DERIVED | HIGH_COST | 385 | 28.6% | 29.9% | 41.6% | 1.000 | 0.009 | 0.000 |
| income_band | DERIVED | 180K+ | 399 | 33.3% | 34.8% | 31.8% | 1.000 | 0.003 | 0.000 |
| income_band | DERIVED | 80K-120K | 301 | 20.6% | 33.6% | 45.8% | 0.618 | 0.004 | 0.000 |
| income_band | DERIVED | 50K-80K | 303 | 12.5% | 34.3% | 53.1% | 0.376 | 0.004 | 0.000 |
| income_band | DERIVED | 120K-180K | 451 | 31.9% | 29.0% | 39.0% | 0.958 | 0.005 | 0.000 |
| income_band | DERIVED | <50K | 46 | 2.2% | 15.2% | 82.6% | 0.065 | 0.029 | 0.000 |
| persona | DERIVED | FINANCE_ANALYST | 218 | 32.1% | 26.6% | 41.3% | 1.000 | 0.000 | 0.000 |
| persona | DERIVED | PHYSICIAN_ASSISTANT | 82 | 30.5% | 30.5% | 39.0% | 0.949 | 0.000 | 0.000 |
| persona | DERIVED | ENTREPRENEUR | 114 | 21.9% | 35.1% | 43.0% | 0.683 | 0.010 | 0.000 |
| persona | DERIVED | TEACHER | 216 | 18.1% | 35.2% | 46.8% | 0.562 | 0.005 | 0.000 |
| persona | DERIVED | SOFTWARE_ENGINEER | 221 | 26.2% | 39.4% | 34.4% | 0.817 | 0.005 | 0.000 |
| persona | DERIVED | NURSE | 257 | 30.7% | 28.8% | 40.5% | 0.957 | 0.005 | 0.000 |
| persona | DERIVED | RELOCATED_PROFESSIONAL | 147 | 29.3% | 29.9% | 40.8% | 0.911 | 0.008 | 0.000 |
| persona | DERIVED | RETAIL_MANAGER | 154 | 15.6% | 27.3% | 57.1% | 0.485 | 0.008 | 0.000 |
| persona | DERIVED | CONSTRUCTION_WORKER | 91 | 16.5% | 39.6% | 44.0% | 0.513 | 0.000 | 0.000 |

Derived attributes below four-fifths (reported, expected to correlate with legitimate financial variables): age_band=30-39 (0.597); age_band=50-59 (0.62); age_band=40-49 (0.682); age_band=22-29 (0.527); geography_group=LOW_COST (0.718); income_band=80K-120K (0.618); income_band=50K-80K (0.376); income_band=<50K (0.065); persona=ENTREPRENEUR (0.683); persona=TEACHER (0.562); persona=RETAIL_MANAGER (0.485); persona=CONSTRUCTION_WORKER (0.513).

## Versions

| Component | Version |
|---|---|
| Generator | 2.0.0 |
| Case schema | 2.0.0 |
| Fraud ruleset | 1.3.0 |
| Underwriting policy | 2.1.0 |
| Reason-code catalog | 1.0.0 |
| Feature policy | 1.0.0 |

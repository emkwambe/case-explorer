# Validation Report

Generated 2026-09-02T15:01:52.847Z · seed `42` · 1,500 blended + 1,200 stratified cases · generator 2.0.0 · commit `93bf79b9` · config `570e1e0c7fda`

## Release gates — **PASS**

| Gate | Layer | Required | Value | Status |
|---|---|---|---|---|
| Ledger invariants | generator | >= 1 | 1 | PASS |
| Evidence consistency (clean cases) | generator | >= 0.995 | 1 | PASS |
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
| Rule-baseline FPR on clean cases | detection | <= 0.05 | 0.004 | PASS |
| Coordinated-ring recall (network analytics) | network | >= 0.8 | 1 | PASS |
| Non-ring cases linked into clusters | network | <= 0.05 | 0 | PASS |

## Headline metrics

| Capability | Result |
|---|---|
| Generated cases | 2,700 |
| Ledger invariants | 100.0% |
| Evidence consistency | 100.0% |
| Distribution tests passing | 100.0% |
| Correlation targets within tolerance | 100.0% |
| Reproducibility | 100.0% |
| Missing required fields | 0.0% |
| Ground-truth reconciliation | 100.0% |
| Rule-baseline fraud precision / recall / F1 | 0.994 / 1.000 / 0.997 |
| Rule-baseline false-positive rate (clean) | 0.4% |
| Decision-rule agreement | 98.7% |
| Adverse-action reason overlap | 90.6% |
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
| age vs dti | copula | -0.15 | -0.138 | yes |
| age vs checking_balance | copula | 0.1 | 0.036 | yes |
| age vs credit_score | copula | 0.05 | 0.028 | yes |
| salary_base vs dti | copula | -0.35 | -0.259 | yes |
| salary_base vs checking_balance | copula | 0.4 | 0.273 | yes |
| salary_base vs credit_score | copula | 0.3 | 0.225 | yes |
| dti vs checking_balance | copula | -0.25 | -0.207 | yes |
| dti vs credit_score | copula | -0.5 | -0.499 | yes |
| checking_balance vs credit_score | copula | 0.25 | 0.227 | yes |
| salary_base vs dti | sign-expectation | negative | -0.259 | yes |
| salary_base vs credit_score | sign-expectation | positive | 0.225 | yes |
| dti vs credit_score | sign-expectation | negative | -0.499 | yes |
| salary_base vs checking_balance | sign-expectation | positive | 0.273 | yes |

| Ledger invariant | Pass rate |
|---|---|
| accounting_identity | 100.0% (1500/1500) |
| obligations_equal_liability_sum | 100.0% (1500/1500) |
| loan_amount_rule | 100.0% (1500/1500) |
| backend_dti_identity | 100.0% (1500/1500) |
| evidence_sources_complete | 100.0% (1500/1500) |

Evidence consistency on 1184 clean cases: 100.0% (tolerance = 3.5σ of configured document-fidelity noise).

## Layer 2 — Detection evaluation (rule baseline, underwriter-visible data only)

Answers: can rules identify injected fraud, which types are missed, what is the false-positive rate, which evidence supports each alert?

| Metric | Value |
|---|---|
| Precision | 0.994 |
| Recall | 1.000 |
| F1 | 0.997 |
| FPR (all non-fraud) | 0.006 |
| FPR (clean only) | 0.004 |
| Specificity | 0.994 |
| Evidence-cited alerts | 100.0% |

| Fraud type | n | Alert rate | High-severity alert rate |
|---|---|---|---|
| NONE | 1264 | 0.4% | 0.0% |
| CONCEALMENT | 252 | 100.0% | 98.4% |
| INFLATION | 304 | 100.0% | 32.2% |
| ASSET_SEASONING | 97 | 100.0% | 0.0% |
| FABRICATION | 125 | 100.0% | 100.0% |
| OCCUPANCY_MISREPRESENTATION | 97 | 100.0% | 100.0% |
| GIFT_FUND_MISREPRESENTATION | 95 | 100.0% | 100.0% |
| INCOHERENT | 90 | 100.0% | 100.0% |
| EVIDENCE_TAMPERING | 193 | 100.0% | 100.0% |
| BUST_OUT | 89 | 100.0% | 100.0% |
| STRAW_BUYER | 94 | 100.0% | 100.0% |

| Ground-truth finding | Total | Recovered | Rate |
|---|---|---|---|
| LIABILITY_CONCEALMENT | 324 | 324 | 100.0% |
| INCOME_MISREPRESENTATION | 518 | 518 | 100.0% |
| ASSET_SEASONING | 97 | 97 | 100.0% |
| ASSET_MISREPRESENTATION | 214 | 214 | 100.0% |
| EMPLOYER_FABRICATION | 214 | 214 | 100.0% |
| OCCUPANCY_MISREPRESENTATION | 97 | 97 | 100.0% |
| GIFT_FUND_MISREPRESENTATION | 95 | 95 | 100.0% |
| INCOHERENT_WORLD | 90 | 90 | 100.0% |
| EVIDENCE_TAMPERING | 193 | 193 | 100.0% |
| SYNTHETIC_IDENTITY | 89 | 88 | 98.9% |
| STRAW_BUYER | 94 | 94 | 100.0% |

| Rule | Sev | Alerts | TP | FP | Precision | Target recall | FP rate (clean) |
|---|---|---|---|---|---|---|---|
| FR-001@1.2.0 | HIGH | 424 | 424 | 0 | 1.000 | 0.886 | 0.0% |
| FR-002@1.0.0 | HIGH | 214 | 214 | 0 | 1.000 | 1.000 | 0.0% |
| FR-003@1.2.0 | HIGH | 322 | 319 | 3 | 0.991 | 1.000 | 0.0% |
| FR-004@1.0.0 | HIGH | 208 | 208 | 0 | 1.000 | 0.992 | 0.0% |
| FR-005@1.0.0 | MEDIUM | 290 | 290 | 0 | 1.000 | 0.753 | 0.0% |
| FR-006@1.0.0 | HIGH | 195 | 195 | 0 | 1.000 | 1.000 | 0.0% |
| FR-007@1.0.0 | MEDIUM | 114 | 114 | 0 | 1.000 | 0.591 | 0.0% |
| FR-008@1.0.0 | LOW | 67 | 67 | 0 | 1.000 | 0.347 | 0.0% |
| FR-009@1.1.0 | HIGH | 90 | 90 | 0 | 1.000 | 0.989 | 0.0% |
| FR-010@1.0.0 | MEDIUM | 542 | 537 | 5 | 0.991 | 0.399 | 0.4% |
| FR-011@1.0.0 | MEDIUM | 582 | 582 | 0 | 1.000 | 0.432 | 0.0% |
| FR-012@1.0.0 | LOW | 661 | 635 | 26 | 0.961 | 0.472 | 1.8% |
| FR-013@1.0.0 | HIGH | 137 | 137 | 0 | 1.000 | 1.000 | 0.0% |
| FR-014@1.0.0 | HIGH | 97 | 97 | 0 | 1.000 | 1.000 | 0.0% |
| FR-015@1.0.0 | HIGH | 95 | 95 | 0 | 1.000 | 1.000 | 0.0% |
| FR-016@1.0.0 | MEDIUM | 280 | 280 | 0 | 1.000 | 0.969 | 0.0% |
| FR-017@1.0.0 | HIGH | 94 | 94 | 0 | 1.000 | 1.000 | 0.0% |

## Layer 3 — Decision evaluation

Answers: approve / decline / review agreement with the labelled outcome, permissible-variable audit, reason-code accuracy, calibration to risk.

| Fraud type | n | Agreement |
|---|---|---|
| NONE | 1264 | 97.3% |
| CONCEALMENT | 252 | 100.0% |
| INFLATION | 304 | 99.7% |
| ASSET_SEASONING | 97 | 100.0% |
| FABRICATION | 125 | 100.0% |
| OCCUPANCY_MISREPRESENTATION | 97 | 100.0% |
| GIFT_FUND_MISREPRESENTATION | 95 | 100.0% |
| INCOHERENT | 90 | 100.0% |
| EVIDENCE_TAMPERING | 193 | 100.0% |
| BUST_OUT | 89 | 100.0% |
| STRAW_BUYER | 94 | 100.0% |

Confusion (expected → policy): MANUAL_REVIEW->MANUAL_REVIEW: 530, DECLINE->DECLINE: 1765, APPROVE->APPROVE: 370, APPROVE->MANUAL_REVIEW: 25, DECLINE->MANUAL_REVIEW: 7, MANUAL_REVIEW->APPROVE: 1, MANUAL_REVIEW->DECLINE: 2

Reason codes — mean Jaccard 0.860, exact match 69.6%, adverse-action overlap 90.6%.

| Credit band (clean) | n | Approval rate | Decline rate |
|---|---|---|---|
| <600 | 155 | 0.0% | 100.0% |
| 600-639 | 218 | 0.0% | 30.7% |
| 640-679 | 369 | 28.2% | 26.8% |
| 680-719 | 247 | 46.2% | 19.4% |
| 720+ | 275 | 55.6% | 17.5% |

| DTI band (clean) | n | Approval rate | Decline rate |
|---|---|---|---|
| <=30 | 44 | 54.5% | 9.1% |
| 30-38 | 620 | 56.0% | 19.7% |
| 38-47 | 446 | 0.0% | 30.7% |
| >47 | 154 | 0.0% | 100.0% |

## Fairness controls — WARN

> Technical fairness-testing controls only. Does not establish legal compliance; supports human legal and compliance review.

Counterfactual pairs: 4311 tested on 300 cases; unchanged 4311; **changed 0**.

| Attribute | Class | Group | n | Approval | Review | Decline | Selection ratio | FPR | FNR |
|---|---|---|---|---|---|---|---|---|---|
| family_status_scenario | INDEPENDENT_SCENARIO | SINGLE | 527 | 24.1% | 30.0% | 45.9% | 0.964 | 0.007 | 0.000 |
| family_status_scenario | INDEPENDENT_SCENARIO | MARRIED | 540 | 22.4% | 31.1% | 46.5% | 0.896 | 0.002 | 0.000 |
| family_status_scenario | INDEPENDENT_SCENARIO | SINGLE_PARENT | 117 | 21.4% | 37.6% | 41.0% | 0.855 | 0.000 | 0.000 |
| family_status_scenario | INDEPENDENT_SCENARIO | WITH_DEPENDENTS | 316 | 25.0% | 30.1% | 44.9% | 1.000 | 0.004 | 0.000 |
| disability_income_scenario | INDEPENDENT_SCENARIO | 0 | 1450 | 23.0% | 31.2% | 45.9% | 0.604 | 0.004 | 0.000 |
| disability_income_scenario | INDEPENDENT_SCENARIO | 1 | 50 | 38.0% | 26.0% | 36.0% | 1.000 | 0.000 | 0.000 |
| age_band | DERIVED | 30-39 | 440 | 23.0% | 35.0% | 42.0% | 0.678 | 0.003 | 0.000 |
| age_band | DERIVED | 50-59 | 212 | 23.1% | 31.6% | 45.3% | 0.682 | 0.000 | 0.000 |
| age_band | DERIVED | 40-49 | 433 | 26.3% | 29.6% | 44.1% | 0.777 | 0.000 | 0.000 |
| age_band | DERIVED | 22-29 | 353 | 19.0% | 28.0% | 53.0% | 0.560 | 0.007 | 0.000 |
| age_band | DERIVED | 60+ | 62 | 33.9% | 27.4% | 38.7% | 1.000 | 0.040 | 0.000 |
| geography_group | DERIVED | MEDIUM_COST | 730 | 24.2% | 33.0% | 42.7% | 0.915 | 0.002 | 0.000 |
| geography_group | DERIVED | LOW_COST | 385 | 19.0% | 28.8% | 52.2% | 0.716 | 0.003 | 0.000 |
| geography_group | DERIVED | HIGH_COST | 385 | 26.5% | 29.4% | 44.2% | 1.000 | 0.010 | 0.000 |
| income_band | DERIVED | 180K+ | 399 | 30.3% | 32.8% | 36.8% | 0.991 | 0.003 | 0.000 |
| income_band | DERIVED | 80K-120K | 301 | 18.6% | 32.6% | 48.8% | 0.608 | 0.004 | 0.000 |
| income_band | DERIVED | 50K-80K | 303 | 11.9% | 32.7% | 55.4% | 0.388 | 0.004 | 0.000 |
| income_band | DERIVED | 120K-180K | 451 | 30.6% | 28.4% | 41.0% | 1.000 | 0.003 | 0.000 |
| income_band | DERIVED | <50K | 46 | 2.2% | 19.6% | 78.3% | 0.071 | 0.031 | 0.000 |
| persona | DERIVED | FINANCE_ANALYST | 218 | 29.8% | 28.0% | 42.2% | 1.000 | 0.000 | 0.000 |
| persona | DERIVED | PHYSICIAN_ASSISTANT | 82 | 28.0% | 26.8% | 45.1% | 0.941 | 0.000 | 0.000 |
| persona | DERIVED | ENTREPRENEUR | 114 | 21.9% | 32.5% | 45.6% | 0.735 | 0.011 | 0.000 |
| persona | DERIVED | TEACHER | 216 | 16.7% | 32.4% | 50.9% | 0.559 | 0.006 | 0.000 |
| persona | DERIVED | SOFTWARE_ENGINEER | 221 | 24.0% | 36.7% | 39.4% | 0.804 | 0.006 | 0.000 |
| persona | DERIVED | NURSE | 257 | 29.2% | 28.0% | 42.8% | 0.979 | 0.000 | 0.000 |
| persona | DERIVED | RELOCATED_PROFESSIONAL | 147 | 26.5% | 31.3% | 42.2% | 0.890 | 0.009 | 0.000 |
| persona | DERIVED | RETAIL_MANAGER | 154 | 13.6% | 26.6% | 59.7% | 0.457 | 0.009 | 0.000 |
| persona | DERIVED | CONSTRUCTION_WORKER | 91 | 16.5% | 38.5% | 45.1% | 0.553 | 0.000 | 0.000 |

Derived attributes below four-fifths (reported, expected to correlate with legitimate financial variables): age_band=30-39 (0.678); age_band=50-59 (0.682); age_band=40-49 (0.777); age_band=22-29 (0.56); geography_group=LOW_COST (0.716); income_band=80K-120K (0.608); income_band=50K-80K (0.388); income_band=<50K (0.071); persona=ENTREPRENEUR (0.735); persona=TEACHER (0.559); persona=RETAIL_MANAGER (0.457); persona=CONSTRUCTION_WORKER (0.553).

## Entity and network analytics

3 coordinated rings injected into a copy of the population; 3 recovered (ring recall 100.0%, member recall 100.0%, non-ring false-positive rate 0.0%). Shared devices 3, shared IPs 1, shared addresses 1, repeated document fingerprints 8, clusters 3 (1 high risk).

## Versions

| Component | Version |
|---|---|
| Generator | 2.0.0 |
| Case schema | 2.0.0 |
| Fraud ruleset | 1.3.0 |
| Underwriting policy | 2.1.0 |
| Reason-code catalog | 1.0.0 |
| Feature policy | 1.0.0 |

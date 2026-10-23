# Validation Report

Generated 2026-10-23T02:48:40.721Z · seed `42` · 2,000 blended + 2,250 stratified cases · generator 2.0.0 · commit `a748ae6a` · config `e984ec798bee`

## Release gates — **PASS**

| Gate | Layer | Required | Value | Status |
|---|---|---|---|---|
| Ledger invariants | generator | >= 1 | 1 | PASS |
| Evidence consistency (clean cases) | generator | >= 0.995 | 1 | PASS |
| Distribution tests passing | generator | >= 0.95 | 1 | PASS |
| Correlation targets within tolerance | generator | >= 0.95 | 1 | PASS |
| Reproducibility (seeded) | generator | >= 1 | 1 | PASS |
| Missing required fields | generator | <= 0 | 0 | PASS |
| Ground-truth reconciliation | detection | >= 0.97 | 0.9997 | PASS |
| Policy ranks actual defaults (AUC) | outcome | >= 0.65 | 0.6675 | PASS |
| Approved pool safer than population | outcome | >= 0.5 | 1 | PASS |
| Policy creates value over declining everyone | outcome | >= 1 | 1 | PASS |
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
| Generated cases | 4,250 |
| Ledger invariants | 100.0% |
| Evidence consistency | 100.0% |
| Distribution tests passing | 100.0% |
| Correlation targets within tolerance | 100.0% |
| Reproducibility | 100.0% |
| Missing required fields | 0.0% |
| Ground-truth reconciliation | 100.0% |
| Policy discrimination on outcomes (AUC) | 0.667 |
| Approved-pool risk separation | 100.0% |
| Population bad rate / approved bad rate | 7.2% / 0.0% |
| Rule-baseline fraud precision / recall / F1 | 0.995 / 1.000 / 0.998 |
| Rule-baseline false-positive rate (clean) | 0.4% |
| Decision-rule agreement | n/a |
| Adverse-action reason overlap | 89.8% |
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
| regime_mixture | categorical mixture | 1.06 | 0.5887 | PASS |
| region_mixture | categorical mixture | 0.192 | 0.9085 | PASS |
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
| age vs salary_base | copula | 0.2 | 0.196 | yes |
| age vs dti | copula | -0.15 | -0.131 | yes |
| age vs checking_balance | copula | 0.1 | 0.062 | yes |
| age vs credit_score | copula | 0.05 | 0.03 | yes |
| salary_base vs dti | copula | -0.35 | -0.23 | yes |
| salary_base vs checking_balance | copula | 0.4 | 0.258 | yes |
| salary_base vs credit_score | copula | 0.3 | 0.215 | yes |
| dti vs checking_balance | copula | -0.25 | -0.167 | yes |
| dti vs credit_score | copula | -0.5 | -0.484 | yes |
| checking_balance vs credit_score | copula | 0.25 | 0.229 | yes |
| salary_base vs dti | sign-expectation | negative | -0.23 | yes |
| salary_base vs credit_score | sign-expectation | positive | 0.215 | yes |
| dti vs credit_score | sign-expectation | negative | -0.484 | yes |
| salary_base vs checking_balance | sign-expectation | positive | 0.258 | yes |

| Ledger invariant | Pass rate |
|---|---|
| accounting_identity | 100.0% (2000/2000) |
| obligations_equal_liability_sum | 100.0% (2000/2000) |
| loan_amount_rule | 100.0% (2000/2000) |
| backend_dti_identity | 100.0% (2000/2000) |
| evidence_sources_complete | 100.0% (2000/2000) |

Evidence consistency on 1580 clean cases: 100.0% (tolerance = 3.5σ of configured document-fidelity noise).

## Layer 2 — Detection evaluation (rule baseline, underwriter-visible data only)

Answers: can rules identify injected fraud, which types are missed, what is the false-positive rate, which evidence supports each alert?

| Metric | Value |
|---|---|
| Precision | 0.995 |
| Recall | 1.000 |
| F1 | 0.998 |
| FPR (all non-fraud) | 0.006 |
| FPR (clean only) | 0.004 |
| Specificity | 0.994 |
| Evidence-cited alerts | 100.0% |

| Fraud type | n | Alert rate | High-severity alert rate |
|---|---|---|---|
| NONE | 1730 | 0.4% | 0.0% |
| CONCEALMENT | 420 | 100.0% | 98.8% |
| INFLATION | 531 | 100.0% | 33.1% |
| ASSET_SEASONING | 175 | 100.0% | 0.0% |
| FABRICATION | 213 | 100.0% | 100.0% |
| OCCUPANCY_MISREPRESENTATION | 172 | 100.0% | 100.0% |
| GIFT_FUND_MISREPRESENTATION | 168 | 100.0% | 100.0% |
| INCOHERENT | 162 | 100.0% | 100.0% |
| EVIDENCE_TAMPERING | 344 | 100.0% | 100.0% |
| BUST_OUT | 165 | 100.0% | 100.0% |
| STRAW_BUYER | 170 | 100.0% | 100.0% |

| Ground-truth finding | Total | Recovered | Rate |
|---|---|---|---|
| LIABILITY_CONCEALMENT | 550 | 550 | 100.0% |
| INCOME_MISREPRESENTATION | 909 | 909 | 100.0% |
| ASSET_SEASONING | 175 | 175 | 100.0% |
| ASSET_MISREPRESENTATION | 378 | 378 | 100.0% |
| EMPLOYER_FABRICATION | 378 | 378 | 100.0% |
| OCCUPANCY_MISREPRESENTATION | 172 | 172 | 100.0% |
| GIFT_FUND_MISREPRESENTATION | 168 | 168 | 100.0% |
| INCOHERENT_WORLD | 162 | 162 | 100.0% |
| EVIDENCE_TAMPERING | 344 | 344 | 100.0% |
| SYNTHETIC_IDENTITY | 165 | 164 | 99.4% |
| STRAW_BUYER | 170 | 170 | 100.0% |

| Rule | Sev | Alerts | TP | FP | Precision | Target recall | FP rate (clean) |
|---|---|---|---|---|---|---|---|
| FR-001@1.2.0 | HIGH | 729 | 729 | 0 | 1.000 | 0.878 | 0.0% |
| FR-002@1.0.0 | HIGH | 378 | 378 | 0 | 1.000 | 1.000 | 0.0% |
| FR-003@1.2.0 | HIGH | 548 | 544 | 4 | 0.993 | 1.000 | 0.0% |
| FR-004@1.0.0 | HIGH | 369 | 369 | 0 | 1.000 | 0.986 | 0.0% |
| FR-005@1.0.0 | MEDIUM | 519 | 519 | 0 | 1.000 | 0.755 | 0.0% |
| FR-006@1.0.0 | HIGH | 347 | 347 | 0 | 1.000 | 1.000 | 0.0% |
| FR-007@1.0.0 | MEDIUM | 201 | 201 | 0 | 1.000 | 0.584 | 0.0% |
| FR-008@1.0.0 | LOW | 130 | 130 | 0 | 1.000 | 0.378 | 0.0% |
| FR-009@1.1.0 | HIGH | 169 | 169 | 0 | 1.000 | 0.994 | 0.0% |
| FR-010@1.0.0 | MEDIUM | 980 | 972 | 8 | 0.992 | 0.412 | 0.4% |
| FR-011@1.0.0 | MEDIUM | 1015 | 1015 | 0 | 1.000 | 0.430 | 0.0% |
| FR-012@1.0.0 | LOW | 1156 | 1123 | 33 | 0.972 | 0.476 | 1.7% |
| FR-013@1.0.0 | HIGH | 257 | 257 | 0 | 1.000 | 1.000 | 0.0% |
| FR-014@1.0.0 | HIGH | 172 | 172 | 0 | 1.000 | 1.000 | 0.0% |
| FR-015@1.0.0 | HIGH | 168 | 168 | 0 | 1.000 | 1.000 | 0.0% |
| FR-016@1.0.0 | MEDIUM | 498 | 498 | 0 | 1.000 | 0.960 | 0.0% |
| FR-017@1.0.0 | HIGH | 170 | 170 | 0 | 1.000 | 1.000 | 0.0% |

## Layer 3 — Decision evaluation

Answers: approve / decline / review agreement with the labelled outcome, permissible-variable audit, reason-code accuracy, calibration to risk.

| Fraud type | n | Agreement |
|---|---|---|
| NONE | 1730 | 97.3% |
| CONCEALMENT | 420 | 100.0% |
| INFLATION | 531 | 99.8% |
| ASSET_SEASONING | 175 | 100.0% |
| FABRICATION | 213 | 100.0% |
| OCCUPANCY_MISREPRESENTATION | 172 | 100.0% |
| GIFT_FUND_MISREPRESENTATION | 168 | 100.0% |
| INCOHERENT | 162 | 100.0% |
| EVIDENCE_TAMPERING | 344 | 100.0% |
| BUST_OUT | 165 | 100.0% |
| STRAW_BUYER | 170 | 100.0% |

Confusion (expected → policy): MANUAL_REVIEW->MANUAL_REVIEW: 765, DECLINE->DECLINE: 2926, APPROVE->APPROVE: 512, APPROVE->MANUAL_REVIEW: 36, DECLINE->MANUAL_REVIEW: 7, MANUAL_REVIEW->APPROVE: 1, MANUAL_REVIEW->DECLINE: 3

Reason codes — mean Jaccard 0.848, exact match 66.9%, adverse-action overlap 89.8%.

| Credit band (clean) | n | Approval rate | Decline rate |
|---|---|---|---|
| <600 | 210 | 0.0% | 100.0% |
| 600-639 | 310 | 0.0% | 32.6% |
| 640-679 | 499 | 28.9% | 25.9% |
| 680-719 | 321 | 46.7% | 18.4% |
| 720+ | 390 | 56.2% | 17.7% |

| DTI band (clean) | n | Approval rate | Decline rate |
|---|---|---|---|
| <=30 | 59 | 50.8% | 13.6% |
| 30-38 | 856 | 56.4% | 19.2% |
| 38-47 | 607 | 0.0% | 31.0% |
| >47 | 208 | 0.0% | 100.0% |

## Outcome-grounded policy evaluation

The policy is graded against simulated loan performance, which no policy produced. Every case is simulated as if funded, including the ones the policy declines, so a false decline is measurable. This replaces the old "agreement with the generator's own label" metric, which compared two implementations of similar logic and could not tell a good policy from a shared mistake.

| Measure | Value |
|---|---|
| Horizon | 36 months |
| Population bad rate | 7.2% (307 defaults) |
| Mean loss given default | 28.9% |
| Approval / review / decline | 12.1% / 19.0% / 68.9% |
| Approved-pool bad rate | 0.0% |
| Risk separation | 1.000 |
| Discrimination (AUC of policy severity vs default) | 0.667 |
| False decline rate | 91.8% |

### Portfolio value on the blended book (2,000 cases, bad rate 2.5%)

| Strategy | Funded | Margin | Loss | Net value |
|---|---|---|---|---|
| Policy | 471 | 6,430,092 | 0 | 5,850,192 |
| Approve everyone | 2000 | 23,857,456 | 5,837,063 | 16,220,393 |
| Decline everyone | 0 | 0 | 0 | 0 |
| Oracle (funds only what performs) | 1949 | 23,857,456 | 0 | 22,103,356 |

The policy captures 26.5% of the achievable value. It avoids 5,837,063 of loss and forgoes 16,097,164 of margin on applicants who would have paid. Against funding everyone the net cost of that conservatism is 10,370,201.

| Typology | n | Bad rate | Approval rate | Approved bad rate | Mean loss |
|---|---|---|---|---|---|
| NONE | 1730 | 0.6% | 29.6% | 0.0% | 507 |
| CONCEALMENT | 420 | 0.7% | 0.0% | n/a | 829 |
| INFLATION | 531 | 0.9% | 0.0% | n/a | 1,009 |
| ASSET_SEASONING | 175 | 0.6% | 0.0% | n/a | 634 |
| FABRICATION | 213 | 3.8% | 0.0% | n/a | 4,287 |
| OCCUPANCY_MISREPRESENTATION | 172 | 0.6% | 0.0% | n/a | 249 |
| GIFT_FUND_MISREPRESENTATION | 168 | 1.2% | 0.0% | n/a | 1,394 |
| INCOHERENT | 162 | 21.6% | 0.0% | n/a | 26,057 |
| EVIDENCE_TAMPERING | 344 | 1.2% | 0.0% | n/a | 835 |
| BUST_OUT | 165 | 84.9% | 0.0% | n/a | 100,184 |
| STRAW_BUYER | 170 | 57.1% | 0.0% | n/a | 71,223 |

Reference-label agreement is 98.9%. That figure is a consistency diagnostic between the reference labeller and the policy. It is reported, not gated: agreement with another policy says nothing about whether either is right.

## Fairness controls — WARN

> Technical fairness-testing controls only. Does not establish legal compliance; supports human legal and compliance review.

Counterfactual pairs: 4311 tested on 300 cases; unchanged 4311; **changed 0**.

| Attribute | Class | Group | n | Approval | Review | Decline | Selection ratio | FPR | FNR |
|---|---|---|---|---|---|---|---|---|---|
| family_status_scenario | INDEPENDENT_SCENARIO | SINGLE | 705 | 24.0% | 30.1% | 46.0% | 0.948 | 0.007 | 0.000 |
| family_status_scenario | INDEPENDENT_SCENARIO | MARRIED | 725 | 22.9% | 30.8% | 46.3% | 0.905 | 0.002 | 0.000 |
| family_status_scenario | INDEPENDENT_SCENARIO | SINGLE_PARENT | 151 | 19.9% | 37.7% | 42.4% | 0.785 | 0.000 | 0.000 |
| family_status_scenario | INDEPENDENT_SCENARIO | WITH_DEPENDENTS | 419 | 25.3% | 31.5% | 43.2% | 1.000 | 0.003 | 0.000 |
| disability_income_scenario | INDEPENDENT_SCENARIO | 0 | 1926 | 23.3% | 31.1% | 45.6% | 0.784 | 0.004 | 0.000 |
| disability_income_scenario | INDEPENDENT_SCENARIO | 1 | 74 | 29.7% | 33.8% | 36.5% | 1.000 | 0.000 | 0.000 |
| age_band | DERIVED | 30-39 | 589 | 24.1% | 35.0% | 40.9% | 0.733 | 0.002 | 0.000 |
| age_band | DERIVED | 50-59 | 285 | 22.8% | 31.6% | 45.6% | 0.693 | 0.000 | 0.000 |
| age_band | DERIVED | 40-49 | 575 | 25.2% | 29.2% | 45.6% | 0.766 | 0.000 | 0.000 |
| age_band | DERIVED | 22-29 | 472 | 19.7% | 29.4% | 50.8% | 0.599 | 0.005 | 0.000 |
| age_band | DERIVED | 60+ | 79 | 32.9% | 26.6% | 40.5% | 1.000 | 0.048 | 0.000 |
| geography_group | DERIVED | MEDIUM_COST | 992 | 24.3% | 32.9% | 42.8% | 0.964 | 0.003 | 0.000 |
| geography_group | DERIVED | LOW_COST | 500 | 20.4% | 29.0% | 50.6% | 0.810 | 0.003 | 0.000 |
| geography_group | DERIVED | HIGH_COST | 508 | 25.2% | 30.1% | 44.7% | 1.000 | 0.007 | 0.000 |
| income_band | DERIVED | 180K+ | 548 | 29.7% | 33.0% | 37.2% | 0.985 | 0.005 | 0.000 |
| income_band | DERIVED | 80K-120K | 398 | 18.8% | 34.2% | 47.0% | 0.624 | 0.003 | 0.000 |
| income_band | DERIVED | 50K-80K | 389 | 12.3% | 32.9% | 54.8% | 0.409 | 0.003 | 0.000 |
| income_band | DERIVED | 120K-180K | 606 | 30.2% | 27.4% | 42.4% | 1.000 | 0.002 | 0.000 |
| income_band | DERIVED | <50K | 59 | 3.4% | 22.0% | 74.6% | 0.112 | 0.024 | 0.000 |
| persona | DERIVED | FINANCE_ANALYST | 295 | 27.5% | 29.8% | 42.7% | 0.929 | 0.000 | 0.000 |
| persona | DERIVED | PHYSICIAN_ASSISTANT | 115 | 29.6% | 25.2% | 45.2% | 1.000 | 0.000 | 0.000 |
| persona | DERIVED | ENTREPRENEUR | 150 | 19.3% | 33.3% | 47.3% | 0.654 | 0.008 | 0.000 |
| persona | DERIVED | TEACHER | 280 | 17.5% | 32.5% | 50.0% | 0.592 | 0.005 | 0.000 |
| persona | DERIVED | SOFTWARE_ENGINEER | 292 | 25.0% | 34.9% | 40.1% | 0.846 | 0.009 | 0.000 |
| persona | DERIVED | NURSE | 342 | 28.9% | 28.4% | 42.7% | 0.979 | 0.000 | 0.000 |
| persona | DERIVED | RELOCATED_PROFESSIONAL | 210 | 27.1% | 31.0% | 41.9% | 0.918 | 0.006 | 0.000 |
| persona | DERIVED | RETAIL_MANAGER | 203 | 14.3% | 29.6% | 56.2% | 0.483 | 0.006 | 0.000 |
| persona | DERIVED | CONSTRUCTION_WORKER | 113 | 17.7% | 37.2% | 45.1% | 0.599 | 0.000 | 0.000 |

Derived attributes below four-fifths (reported, expected to correlate with legitimate financial variables): age_band=30-39 (0.733); age_band=50-59 (0.693); age_band=40-49 (0.766); age_band=22-29 (0.599); income_band=80K-120K (0.624); income_band=50K-80K (0.409); income_band=<50K (0.112); persona=ENTREPRENEUR (0.654); persona=TEACHER (0.592); persona=RETAIL_MANAGER (0.483); persona=CONSTRUCTION_WORKER (0.599).

## Entity and network analytics

5 coordinated rings injected into a copy of the population; 5 recovered (ring recall 100.0%, member recall 100.0%, non-ring false-positive rate 0.0%). Shared devices 5, shared IPs 3, shared addresses 2, repeated document fingerprints 16, clusters 5 (3 high risk).

## Versions

| Component | Version |
|---|---|
| Generator | 2.0.0 |
| Case schema | 2.0.0 |
| Fraud ruleset | 1.3.0 |
| Underwriting policy | 2.1.0 |
| Reason-code catalog | 1.0.0 |
| Feature policy | 1.0.0 |

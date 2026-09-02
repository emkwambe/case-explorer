# Limitations

An honest statement of what the synthetic case generator does not do, and what conclusions drawn from its output cannot support. Code references are to the `src/` tree at generator version 2.0.0.

## 1. Parameters are hand-chosen, not fitted

No parameter in `src/distribution_config.json` is fitted to real data. Every row in PARAMETER_SOURCES.md is classified SIMPLIFYING_ASSUMPTION, STRESS_SCENARIO or FRAUD_INJECTION; none is EMPIRICALLY_CALIBRATED. Values that look like public statistics (persona salary medians, the 30-year rate, the 692 mean credit score) were chosen to be plausible, not checked against a source. `scripts/calibrate_copula.js` exists but its output has not been fed back into the config.

Consequences: marginal distributions, correlations, approval rates and fraud-rule alert rates measured on generated data describe the generator, not any lending population. Several configured parameters are dead (never read) or ineffective (bounded away by another parameter); see the summary table in PARAMETER_SOURCES.md. The realised salary distribution differs materially from the configured persona medians because of stacked multipliers and clamps (STATISTICAL_ASSUMPTIONS.md section 4).

## 2. Product scope: one mortgage product, loan fixed at 3x stated salary

- `loan_type` is always `MORTGAGE`; `purpose` is a coin flip between `PURCHASE` and `REFINANCE` with no effect on anything else.
- `loan_amount = floor(3.0 x stated salary)`. Loan size is not a borrower choice, is not linked to a property, and inflates automatically with income inflation.
- One rate (6.75%), one term (30 years), one tax-and-insurance proxy (1.5% of loan amount per year). No ARM, no 15-year, no FHA/VA/jumbo, no mortgage insurance, no points, no rate variation by score or date.

## 3. No property, appraisal or LTV

There is no property value, purchase price, down payment applied to the loan, LTV, CLTV, appraisal, comparable sales, or property type. `truth.down_payment` is computed but unused. Reserve requirements cannot be expressed in months of PITI by occupancy type as agency guides do, occupancy fraud has no property to be about, and every appraisal-related typology is out of scope.

## 4. No co-borrowers or household structure

Each case has exactly one applicant. There is no co-borrower income, no joint liabilities, no household size, and no non-applicant income. `family_status_scenario` is a label only; `WITH_DEPENDENTS` changes no expense line and `MARRIED` adds no second income.

## 5. Application metadata is synthetic and separable by construction

`generateApplicationMetadata` draws the metadata from one of two regimes: clean, or "signalled fraud". `fraud_signal_rate` (0.6) governs how many fraud cases fall in the signalled regime; the other 40% of fraud cases and all clean and INCOHERENT cases use the clean regime. Within the signalled regime the distributions are far from clean values (documents 0-3 days old versus 14-180; IP risk 0.55-1.00 versus 0.08-0.23), so a model can separate signalled fraud from clean cases almost perfectly on metadata alone, and the decision engine declines most signalled cases at its metadata step before any financial rule runs.

Consequences: metadata features will dominate any model trained on this data; measured lift from device or behavioural signals is an artefact of the injection design; the 0.6 rate is an assumption with no external source. Device fingerprints and IP addresses are unique per case, so velocity, reuse and linkage analytics have nothing to find.

## 6. Labels are policy-derived and circular with the rule baseline

`label.expected_outcome`, `reason_codes` and `alignment_level` are produced by `computeDecision`, which reads the corruption type and world truth directly. The fraud rules in `src/decisioning/fraud-rules/rules.js` were written to target the same corruption operators, using thresholds (15% income, 100 USD/month liabilities, 500 USD assets, 0.7 IP risk, 3 documents in 2 days) that match the thresholds in `computeDecision`.

Consequences: precision and recall of the rule baseline against these labels measure agreement between two hand-written descriptions of the same injection mechanism, not detection performance on real fraud. High scores are expected and uninformative; low scores indicate an inconsistency between the two specifications. Any "expected loss captured" figure inherits the same circularity. Some observable flags are planted (`synthetic_identity`, `retains_current_lease`, `third_party_will_occupy`, `donor_is_interested_party`), which further collapses the distinction between label and feature for those typologies.

## 7. No observed outcomes: bad rate and expected loss are proxies

No case has a repayment history, delinquency, default, loss given default or prepayment. "Bad rate" in any evaluation module means the share of cases with a fraud typology or a DECLINE label, and "expected loss" means a loan amount multiplied by an assumed rate. Neither can be validated. The generator cannot support credit-risk model development, loss forecasting, pricing, or any claim about default risk of approved or declined applicants.

## 8. Fairness attributes are synthetic scenario labels; the fairness module is a technical control only

`family_status_scenario` and `disability_income_scenario` are sampled independently of every financial variable and have no real-world meaning. `age_band`, `income_band`, `geography_group`, `persona` and `regime` are deterministic functions of the generated financial life and are correlated with outcomes by design. No race, ethnicity, sex, national origin, religion or other protected class is modelled, and no proxy structure for them exists in the data.

The fairness module (`src/evaluation/fairness`) carries its own disclaimer: it provides technical fairness-testing controls (subgroup slicing, counterfactual twins) and does not establish legal compliance under ECOA, the Fair Housing Act, Regulation B or any other regime. Passing its checks on synthetic data says nothing about disparate impact on real applicants.

## 9. Evidence documents are structured fields, not images or PDFs

Every evidence source is a small JSON object with exact numeric fields. There is no document image, no OCR, no layout, no page count, no handwriting, no signature, no PDF binary. `pdf_generator`, `created` and `modified` are random labels with no forensic content. Document-fidelity noise is a zero-mean Gaussian on three numeric fields (STATISTICAL_ASSUMPTIONS.md section 8). The generator cannot be used to develop or test document-forensics, OCR, or image-based tampering detection.

## 10. No temporal drift in the baseline population

The population is stationary. The as-of date moves evidence and metadata dates but not the underlying distributions; the interest rate, fraud mix, salary levels and thresholds do not change with time. Life-script events are anchored to 2024-01-01 regardless of the as-of date, so tenure and document staleness carry a fixed calendar offset (STATISTICAL_ASSUMPTIONS.md section 11). Concept drift, seasonality, rate-cycle effects and fraud-wave dynamics cannot be studied.

## 11. Small vocabularies

- Names: 10 first names x 10 last names = 100 combinations; unrelated to any other field.
- Employers: `<Industry> Corp` for seven industries, or `<one of four surnames> Consulting LLC`; fraud employers are `Global <industry>` or `Apex <industry>`. Employer identity is therefore nearly a label for corruption type and cannot support employer-level analytics.
- Addresses: 5 or 4 street names x 4 suffixes with a random number; ZIP codes are a two-digit regional prefix plus four random digits (six characters in total, which is not a valid US ZIP format).
- ISPs: 7 names; PDF generators: 5 names; both uninformative.

## 12. US-centric conventions

W-2 forms, SSN last-four, FICO-range credit scores (300-850), USD, US ZIP prefixes, US pay frequencies, US agency-style DTI and reserve thresholds, and a 30-year fixed-rate mortgage are assumed throughout. Nothing is localised.

## 13. Other known simplifications

- Employer verification is exact (fidelity 1.0) and always available; in practice VOE is often unavailable or delayed.
- The decision engine reads `truth.credit_score` and `truth.salary` directly as "verified" values rather than the bureau and VOE evidence fields, so evidence noise never reaches the decision.
- The W-2 model conflates taxes with pre-tax deductions, placing W-2 wages 12-36% below gross salary for everyone.
- Rent is uniform 1000-2200 times a regional multiplier and independent of income; the configured `rent_to_income_gross_ratio` is not used.
- Overdraft fees are recorded but never debited, so the ledger identity holds only because the fee is ignored.
- The blend produces INFLATION only at MEDIUM severity (10%), so the > 15% decline tier is never exercised by blended generation.
- Regime and persona are sampled independently, producing combinations (self-employed nurse, self-employed teacher) that are then relabelled `Professional Services`.
- The PRNG is 32-bit; large batches under related string seeds have a small but non-zero chance of stream collision, and there is no guard against a zero draw in Box-Muller.

## What the data can support

Within these limits the generator is suitable for: exercising the decision pipeline end to end; testing that the feature policy blocks label leakage; checking that rules fire on the typologies they were written for; regression-testing the ledger identity and evidence consistency; demonstrating counterfactual fairness controls on attributes that are independent by construction; and producing worked examples for training material. It is not suitable for estimating real-world fraud incidence, detection rates, loss, approval rates, or subgroup disparities.

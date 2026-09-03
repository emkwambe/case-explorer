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

There is no property value, purchase price, down payment applied to the loan, LTV, CLTV, appraisal, comparable sales, or property type. `truth.down_payment` is not applied to the loan; the only thing that reads it is the performance simulation, which subtracts it from liquid assets to set reserves at closing. Reserve requirements cannot be expressed in months of PITI by occupancy type as agency guides do, occupancy fraud has no property to be about, and every appraisal-related typology is out of scope.

## 4. No co-borrowers or household structure

Each case has exactly one applicant. There is no co-borrower income, no joint liabilities, no household size, and no non-applicant income. `family_status_scenario` is a label only; `WITH_DEPENDENTS` changes no expense line and `MARRIED` adds no second income.

## 5. Application metadata is synthetic and separable by construction

`generateApplicationMetadata` draws the metadata from one of two regimes: clean, or "signalled fraud". `fraud_signal_rate` (0.6) governs how many fraud cases fall in the signalled regime; the other 40% of fraud cases and all clean and INCOHERENT cases use the clean regime. Within the signalled regime the distributions are far from clean values (documents 0-3 days old versus 14-180; IP risk 0.55-1.00 versus 0.08-0.23), so a model can separate signalled fraud from clean cases almost perfectly on metadata alone, and the decision engine declines most signalled cases at its metadata step before any financial rule runs.

Consequences: metadata features will dominate any model trained on this data; measured lift from device or behavioural signals is an artefact of the injection design; the 0.6 rate is an assumption with no external source. Device fingerprints and IP addresses are unique per case, so velocity, reuse and linkage analytics have nothing to find.

## 6. Labels are policy-derived and circular with the rule baseline

`label.expected_outcome`, `reason_codes` and `alignment_level` are produced by `computeDecision`, which reads the corruption type and world truth directly. The fraud rules in `src/decisioning/fraud-rules/rules.js` were written to target the same corruption operators, using thresholds (15% income, 100 USD/month liabilities, 500 USD assets, 0.7 IP risk, 3 documents in 2 days) that match the thresholds in `computeDecision`.

Consequences: precision and recall of the rule baseline against these labels measure agreement between two hand-written descriptions of the same injection mechanism, not detection performance on real fraud. High scores are expected and uninformative; low scores indicate an inconsistency between the two specifications. Any "expected loss captured" figure inherits the same circularity. Some observable flags are planted (`synthetic_identity`, `retains_current_lease`, `third_party_will_occupy`, `donor_is_interested_party`), which further collapses the distinction between label and feature for those typologies.

## 7. Outcomes are simulated, not observed

Every case now carries a performance record (`case.performance`, from `src/simulation/performance.js`): the loan is simulated forward over a 36-month horizon on world-truth cash flows, and the result (`PERFORMING`, `DELINQUENT`, `DEFAULT`, months to default, loss given default, realised loss) is the observed label. It is produced without reading the policy, the rules, the reason codes or the findings, and it is produced for declined applications too, so a false decline is measurable. This removes the circularity of grading a policy against another policy's opinion, and it is the basis of the three outcome release gates that replaced the old `decision_rule_agreement` gate.

It does not make the outcomes real. No case has a repayment history from any real borrower. The hazard, volatility, shock and loss parameters are themselves hand-chosen assumptions (PARAMETER_SOURCES.md, `performance` section), so:

- Absolute default and loss levels are not credible and must not be quoted as risk estimates. The measured population bad rate of 7.2% and mean loss given default of 0.289 (`artifacts/validation-summary.json`) are properties of the configured hazard, not of any lending population.
- Only the relative ordering should be trusted, and only as far as the assumptions that produced it: which cases are riskier than which, and whether a policy ranks defaults above non-defaults.
- There is no macroeconomic factor, so defaults are independent across cases and portfolio tail risk is far too low. The simulated home-price path drifts upward for every borrower, so nobody defaults into a falling market.

## 8. The population has almost no post-closing reserves, and the expense model is incomplete

Reserves at closing are `(checking balance - down payment) x 0.85`, and the down payment is capped at the checking balance, so the down payment consumes nearly all liquid assets and many borrowers start the simulation with a zero or near-zero buffer. There are no savings, retirement or brokerage accounts to fall back on, because the model has only one account. Reserves are therefore not an independent risk dimension; they are the residue of the down payment.

Pulling the other way, the monthly expense model debits only PITI, true obligations, utilities and a discretionary line. Food, transport, healthcare and childcare are absent unless the discretionary line is read as standing in for them, so residual income after the mortgage is more comfortable than a real household's. The net effect is that capacity-driven default is rarer here than in reality: measured on the current corpus, non-fraud cases default at 0.64% over 36 months (`outcome.by_fraud_type`, key `NONE`).

## 9. Two typologies default by assertion, not by mechanism

`BUST_OUT` (0.85) and `STRAW_BUYER` (0.55) carry an explicit intent-to-default probability. When it fires the case defaults in the first three months and the cash-flow simulation never runs. This is a stated modelling assumption about intent, not an emergent result: for these two typologies the outcome label is written from the injection label. Their measured bad rates of 84.9% and 57.1% are the assumption reading itself back, and any model that separates them on outcome is partly recovering the injection. Every other typology gets its damage emergently, from the gap between the claim the lender underwrites and the truth the household lives on, with no performance term of its own.

## 10. The policy is materially over-conservative on this population

Measured against simulated performance (`artifacts/validation-summary.json`, `outcome`), on 4,250 scored cases the policy approves 12.1%, refers 19.0% to manual review and declines 68.9%, against a population bad rate of 7.2%. The approved pool has a bad rate of 0.0% and risk separation of 1.0, but 91.8% of the applicants it does not approve would in fact have paid, and 89.5% of those it declines outright would have paid.

On the blended 2,000-case book the policy realises a net value of 5,850,192 against 16,220,393 for funding everyone and 22,103,356 for an oracle that funds exactly the loans that perform: it captures 26.5% of the achievable value. It avoids 5,837,063 of loss and forgoes 16,097,164 of margin on applicants who would have paid, a net cost of conservatism of 10,370,201. The `policy_beats_decline_all` gate passes and `beats_approve_all` is false.

These figures are arithmetic on the value assumptions in `src/evaluation/outcome/index.js` (3% margin on a performing loan, 900 origination cost, 250 review cost) applied to simulated outcomes, so they are directional statements about this generator and its policy, not about lending economics. The direction is nonetheless clear and is not an artefact of the value assumptions: a false decline rate above 90% would be a finding under any pricing.

Label agreement between the policy and the generator's own `label.expected_outcome` is still computed (0.9889 on the current corpus) but is reported only as a consistency diagnostic, so that a refactor which silently changes one of them is visible. It is not gated and is not a quality measure: agreement with another policy says nothing about whether either is right.

## 11. Fairness attributes are synthetic scenario labels; the fairness module is a technical control only

`family_status_scenario` and `disability_income_scenario` are sampled independently of every financial variable and have no real-world meaning. `age_band`, `income_band`, `geography_group`, `persona` and `regime` are deterministic functions of the generated financial life and are correlated with outcomes by design. No race, ethnicity, sex, national origin, religion or other protected class is modelled, and no proxy structure for them exists in the data.

The fairness module (`src/evaluation/fairness`) carries its own disclaimer: it provides technical fairness-testing controls (subgroup slicing, counterfactual twins) and does not establish legal compliance under ECOA, the Fair Housing Act, Regulation B or any other regime. Passing its checks on synthetic data says nothing about disparate impact on real applicants.

## 12. Evidence documents are structured fields, not images or PDFs

Every evidence source is a small JSON object with exact numeric fields. There is no document image, no OCR, no layout, no page count, no handwriting, no signature, no PDF binary. `pdf_generator`, `created` and `modified` are random labels with no forensic content. Document-fidelity noise is a zero-mean Gaussian on three numeric fields (STATISTICAL_ASSUMPTIONS.md section 8). The generator cannot be used to develop or test document-forensics, OCR, or image-based tampering detection.

## 13. No temporal drift in the baseline population

The population is stationary. The as-of date moves evidence and metadata dates but not the underlying distributions; the interest rate, fraud mix, salary levels and thresholds do not change with time. Life-script events are anchored to 2024-01-01 regardless of the as-of date, so tenure and document staleness carry a fixed calendar offset (STATISTICAL_ASSUMPTIONS.md section 11). Concept drift, seasonality, rate-cycle effects and fraud-wave dynamics cannot be studied.

## 14. Small vocabularies

- Names: 10 first names x 10 last names = 100 combinations; unrelated to any other field.
- Employers: `<Industry> Corp` for seven industries, or `<one of four surnames> Consulting LLC`; fraud employers are `Global <industry>` or `Apex <industry>`. Employer identity is therefore nearly a label for corruption type and cannot support employer-level analytics.
- Addresses: 5 or 4 street names x 4 suffixes with a random number; ZIP codes are a two-digit regional prefix plus four random digits (six characters in total, which is not a valid US ZIP format).
- ISPs: 7 names; PDF generators: 5 names; both uninformative.

## 15. US-centric conventions

W-2 forms, SSN last-four, FICO-range credit scores (300-850), USD, US ZIP prefixes, US pay frequencies, US agency-style DTI and reserve thresholds, and a 30-year fixed-rate mortgage are assumed throughout. Nothing is localised.

## 16. Other known simplifications

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

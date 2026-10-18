# Fraud Scenario Methodology

How each corruption type is injected, what an underwriter can observe without ground truth, which governed rules target it, and what label the generator assigns. Sources: `src/core/corruption.js` (mutation operators), `src/core/case.js` (assembly order), `src/decisioning/fraud-rules/rules.js` (ruleset 1.3.0), `src/core/findings.js` (`computeDecision`).

## Layer model

| Layer | Symbol | Object | Mutated by |
|---|---|---|---|
| World truth | S_t | `truth` | INCOHERENT (`corruptWorldTruth`); side effects of gift, seasoning, straw buyer, occupancy |
| Claimed truth | C | `presentation` | INFLATION, CONCEALMENT, FABRICATION, BUST_OUT, occupancy, gift, seasoning, straw buyer (`corruptPresentation`) |
| Evidence | E | `evidence[]` | EVIDENCE_TAMPERING (`tamperEvidence`); gift, seasoning, straw buyer (`applyTypologyEvidence`) |

Assembly order matters: the presentation is deep-copied from truth, then `corruptPresentation` runs (and, for four typologies, also writes into truth), then evidence is synthesised from truth (using the ledger computed before any mutation), then `tamperEvidence` and `applyTypologyEvidence` run.

## Decision-engine precedence

`computeDecision` evaluates in this order; the first matching branch returns:

1. BUST_OUT, `presentation.synthetic_identity`, or alignment level A5: DECLINE.
2. INCOHERENT or `truth.incoherent`: DECLINE, label forced to A3 / MODERATE / INCOHERENT.
3. Metadata signals (network A4: IP risk > 0.7 or Tor; document_metadata A3: at least 3 documents within 2 days): DECLINE. This applies to every remaining type including NONE.
4. FABRICATION: DECLINE.
5. CONCEALMENT with hidden obligations >= 100 USD/month: DECLINE. Hidden 25-99 USD/month sets a review floor and continues.
6. INFLATION with overstatement > 15%: DECLINE. Overstatement > 2% sets a review floor and continues.
7. OCCUPANCY_MISREPRESENTATION, GIFT_FUND_MISREPRESENTATION, STRAW_BUYER: DECLINE, label forced to A4 / HIGH / FRAUDULENT.
8. ASSET_SEASONING: sets the review floor and continues.
9. EVIDENCE_TAMPERING: DECLINE.
10. Holistic underwriting on verified income (`truth.salary`), `max(disclosed, bureau)` obligations, bank-statement balance and truth credit score:
   - review floor set and all manual thresholds met (DTI <= 47%, score >= 600, reserves >= 0.1 months, tenure >= 6): MANUAL_REVIEW;
   - all approve thresholds met (DTI <= 38%, score >= 640, reserves >= 0.25 months, tenure >= 12): APPROVE;
   - all manual thresholds met: MANUAL_REVIEW;
   - otherwise DECLINE.

Because step 3 precedes steps 4-10, roughly half of fraud cases (the `fraud_signal_rate` 0.6 draw times the probability the signals cross a threshold) are labelled DECLINE for metadata reasons regardless of their typology's nominal expected decision. The typology-specific reason codes are still attached (`TYPE_CODES`), so the label records both.

Difficulty: BASIC for holistic APPROVE; INTERMEDIATE for MANUAL_REVIEW, material concealment and material inflation, and holistic DECLINE at LOW or MEDIUM severity; ADVANCED for every other DECLINE and for holistic DECLINE at HIGH severity.

## Rule catalogue summary

| Rule | Reads | Fires when | Severity | Reason code | Targets |
|---|---|---|---|---|---|
| FR-001 | claimed salary vs employer-verified salary (fallback W-2) | > 2% (MEDIUM, `INCOME_VARIANCE_REVIEW`); > 15% (HIGH) | HIGH / MEDIUM | `UNVERIFIABLE_INCOME` | INFLATION, FABRICATION |
| FR-002 | claimed employer vs verification employer | any mismatch | HIGH | `UNVERIFIABLE_EMPLOYMENT` | FABRICATION, BUST_OUT |
| FR-003 | bureau obligations minus disclosed | >= 25 (MEDIUM, `LIABILITY_VARIANCE_REVIEW`); >= 100 (HIGH) | HIGH / MEDIUM | `UNDISCLOSED_LIABILITIES` | CONCEALMENT |
| FR-004 | claimed checking minus bank checking | > 500 USD and > 10% | HIGH | `UNVERIFIABLE_ASSETS` | FABRICATION |
| FR-005 | unsourced deposits >= 50% of monthly claimed income | any | MEDIUM | `UNSOURCED_LARGE_DEPOSIT` | EVIDENCE_TAMPERING, GIFT, SEASONING |
| FR-006 | bank checking above claimed checking | > 15% | HIGH | `POTENTIAL_DOCUMENT_TAMPERING` | EVIDENCE_TAMPERING |
| FR-007 | statement payroll deposit vs employer net per check x checks / 12 | > 15% | MEDIUM | `POTENTIAL_DOCUMENT_TAMPERING` | EVIDENCE_TAMPERING |
| FR-008 | W-2 employer vs verification employer | any mismatch | LOW | `EMPLOYER_NAME_VARIATION` | EVIDENCE_TAMPERING |
| FR-009 | claimed minus bureau score > 40; claimed liabilities <= 3 opened within 120 days; claimed employment start vs hire date > 60 days | at least 2 of 3 | HIGH | `IDENTITY_UNVERIFIABLE` | BUST_OUT |
| FR-010 | IP risk > 0.7 or Tor | | MEDIUM | `HIGH_RISK_NETWORK_ORIGIN` | any |
| FR-011 | documents created within 2 days >= 3 | | MEDIUM | `SUSPICIOUS_DOCUMENT_METADATA` | any |
| FR-012 | copy-paste >= 4 or session <= 120 s | | LOW | `ANOMALOUS_APPLICATION_BEHAVIOR` | any |
| FR-013 | obligations > 80% of gross monthly; W-2 > 1.02 x salary; rent before lease; deposit before employment | any | HIGH | `DATA_INTEGRITY_FAILURE` | INCOHERENT |
| FR-014 | claimed PRIMARY_RESIDENCE, distance >= 100 miles, retains lease | all | HIGH | `MATERIAL_APPLICATION_DISCREPANCY` | OCCUPANCY |
| FR-015 | deposit described as Gift without donor letter or from interested party | any | HIGH | `UNVERIFIABLE_ASSETS` | GIFT |
| FR-016 | deposits within 60 days >= 50% of bank balance | | MEDIUM | `UNSOURCED_LARGE_DEPOSIT` | SEASONING |
| FR-017 | third-party-funded deposit and declaration that a third party will occupy | both | HIGH | `MATERIAL_APPLICATION_DISCREPANCY` | STRAW_BUYER |

Rules read only the decision view (`extractDecisionView`), never `truth`.

## NONE (clean)

- Narrative: an honest applicant with a coherent financial life.
- Mechanism: no mutation. Presentation equals truth; evidence is truth plus fidelity noise.
- Observable indicators: none expected. Fidelity noise gives up to about 2% W-2 and 1% bank and bureau variance; W-2 wages sit 12-36% below gross salary because of the deduction model.
- Evidence trail: all six documents agree with the claim.
- Rules: none should fire. FR-010 fires in about 0.5% of clean cases (Tor rate) and FR-012 can fire on the tail of the clean session-duration distribution.
- Investigator action: none; standard underwriting.
- Expected decision: APPROVE, MANUAL_REVIEW or DECLINE from the holistic thresholds; reason codes `ELEVATED_DTI`, `MARGINAL_CREDIT_SCORE`, `SHORT_EMPLOYMENT_TENURE`, `INSUFFICIENT_RESERVES`, `EXCESSIVE_DTI`, `INSUFFICIENT_CREDIT_SCORE`, `LIMITED_EMPLOYMENT_HISTORY`, `GENERAL_REVIEW_REQUIRED`. About 0.5% are declined for `HIGH_RISK_NETWORK_ORIGIN` via Tor.
- Difficulty: BASIC (approve), INTERMEDIATE (review or decline), ADVANCED (decline at HIGH severity, which cannot occur for NONE since the blend assigns LOW).
- `is_fraud`: 0.

## INFLATION

- Narrative: the applicant overstates salary to qualify for a larger loan or a lower DTI.
- Mechanism (claimed truth): `presentation.salary *= 1 + m` with m = 0.05 LOW, 0.10 MEDIUM, 0.20 HIGH, floored to an integer. The blend always uses MEDIUM. Loan amount and PITI are then computed from the inflated salary, so the claimed back-end DTI understates the verified one.
- Observable indicators: stated salary above employer-verified salary and W-2; loan-to-income of exactly 3.0 on the stated figure; payroll deposits consistent with the verified, not the stated, salary.
- Evidence trail: EMPLOYER_VERIFICATION.salary (exact truth), W2_DOCUMENT.w2_wages, BANK_STATEMENT.monthly_payroll_deposit.
- Rules: FR-001 (MEDIUM tier at 2-15%, HIGH above 15%).
- Investigator action: obtain written VOE and re-underwrite on verified income (`Obtain written VOE` condition).
- Expected decision: tiered. Overstatement <= 15% (all blended cases): re-underwritten on verified income with a manual-review floor, so MANUAL_REVIEW when the verified figures meet the manual thresholds, otherwise DECLINE; never APPROVE. Reason code `INCOME_VARIANCE_REVIEW`; alignment floor A1, fraud risk NONE. Overstatement > 15% (HIGH severity only): DECLINE with `UNVERIFIABLE_INCOME`, `MATERIAL_APPLICATION_DISCREPANCY`; alignment A4, fraud risk HIGH.
- Difficulty: INTERMEDIATE.

## CONCEALMENT

- Narrative: the applicant omits one or more debts from the application.
- Mechanism (claimed truth): remove the first 1 (MEDIUM) or 2 (HIGH) `LIABILITY_OPENED` events from `presentation.events`, then recompute `presentation.monthly_obligations` as the sum of the remaining event payments. Because truth obligations also include the non-event `REVOLVING_OTHER` residual, the recomputation drops that residual too, so the hidden amount is the removed payments plus the revolving residual. If the truth has no liability events, nothing is removed but the residual is still dropped.
- Observable indicators: bureau tradelines (including `REVOLVING_OTHER`) exceed disclosed accounts; bureau obligations exceed disclosed obligations; bank recurring debits show servicer payments not on the application.
- Evidence trail: CREDIT_BUREAU.liabilities, BANK_STATEMENT.recurring_debits.
- Rules: FR-003 (MEDIUM tier at 25-99 USD/month, HIGH at >= 100).
- Investigator action: explain undisclosed liabilities, provide updated debt schedule.
- Expected decision: tiered. Hidden >= 100 USD/month: DECLINE with `UNDISCLOSED_LIABILITIES`, `MATERIAL_APPLICATION_DISCREPANCY`, plus `EXCESSIVE_DTI` when the bureau-based DTI exceeds 47%. Hidden 25-99 USD/month: re-underwritten on bureau obligations with a manual-review floor (MANUAL_REVIEW or DECLINE, never APPROVE), `LIABILITY_VARIANCE_REVIEW`. Hidden < 25: treated as clean. Alignment finding for liabilities is A3 whenever any amount is hidden, so fraud risk is MODERATE even in the variance tier.
- Difficulty: INTERMEDIATE.

## FABRICATION

- Narrative: the applicant invents an employer, salary and assets.
- Mechanism (claimed truth): employer becomes `Global <random industry>`, salary uniform 120000-180000, checking uniform 40000-80000, and an `EMPLOYMENT_START` at that employer dated 2021-01-01 is prepended. Evidence is untouched and reflects the real employer, salary and balance.
- Observable indicators: employer name does not match verification or W-2; stated salary far above verified; stated checking far above the bank statement; claimed employment start differs from the verified hire date.
- Evidence trail: EMPLOYER_VERIFICATION (employer, salary, hire_date), W2_DOCUMENT (employer, wages), BANK_STATEMENT.checking_balance.
- Rules: FR-001 (HIGH), FR-002, FR-004; FR-009 may also fire when the start-date mismatch combines with another signal.
- Investigator action: escalate to fraud investigation; request source-of-funds documentation.
- Expected decision: DECLINE with `UNVERIFIABLE_EMPLOYMENT`, `UNVERIFIABLE_INCOME`, `UNVERIFIABLE_ASSETS`, `MATERIAL_APPLICATION_DISCREPANCY`. Alignment A4, fraud risk HIGH.
- Difficulty: ADVANCED.

## BUST_OUT (synthetic identity)

- Narrative: a synthetic identity has spent about two years building a thin but prime-looking credit profile before applying for a large loan.
- Mechanism (claimed truth): the presentation's employer (`Apex <industry>`), salary (110000-160000), checking (35000-70000), credit score (720-780) and DTI (Beta(2,8) x 0.25) are replaced; `presentation.events` is replaced with a compressed timeline starting 2022-01-01 (employment start, credit card and auto loan opened within 3 months, quarterly `PAYMENT_MADE` events); `presentation.synthetic_identity = true`. Evidence reflects the real thin-file truth.
- Observable indicators: claimed score exceeds bureau score; claimed accounts opened within a 90-120 day window; claimed employment start (2022-01-01) differs from the verified hire date; claimed employer and salary do not verify; claimed checking exceeds the statement.
- Evidence trail: CREDIT_BUREAU (score, liabilities), EMPLOYER_VERIFICATION (employer, hire_date), BANK_STATEMENT.checking_balance.
- Rules: FR-009 (needs 2 of 3 signals), FR-002, FR-001, FR-004.
- Investigator action: escalate to fraud investigation; request full credit report and identity verification.
- Expected decision: DECLINE with `IDENTITY_UNVERIFIABLE`, `RAPID_CREDIT_PROFILE_CONSTRUCTION`, `UNVERIFIABLE_EMPLOYMENT`, `UNVERIFIABLE_INCOME`, `MATERIAL_APPLICATION_DISCREPANCY`. Alignment A5, fraud risk CRITICAL.
- Difficulty: ADVANCED.
- Caveat: `synthetic_identity: true` sits in the claims layer and is read directly by `generateAlignmentFindings` and `computeDecision`. It is a label, not an observable. The rule engine does not read it; FR-009 is the observable path.

## EVIDENCE_TAMPERING

- Narrative: the applicant's stated figures are honest, but the submitted bank statement (and sometimes W-2 or VOE) has been altered.
- Mechanism (evidence): bank `checking_balance *= 1 + m` with m = 0.20 LOW, 0.35 MEDIUM, 0.50 HIGH; a `Wire transfer` deposit of 15-40% of annual salary with `source: "Unverified"` dated the as-of date is added; with probability 0.6 the statement payroll deposit is inflated by `1 + 0.8 m`; with probability 0.4 the W-2 employer gains an ` LLC` suffix; with probability 0.3 the VOE salary is inflated by `1 + 0.5 m`. Claim and truth are unchanged.
- Observable indicators: bank balance above the applicant's own stated balance; an unsourced large deposit; payroll deposits inconsistent with VOE net pay; employer-name variation between W-2 and VOE; VOE salary above stated salary.
- Evidence trail: BANK_STATEMENT (checking_balance, recent_large_deposits, monthly_payroll_deposit), W2_DOCUMENT.employer, EMPLOYER_VERIFICATION (employer, salary).
- Rules: FR-006, FR-005, FR-007 (when the payroll figure was altered), FR-008 (when the W-2 employer was altered).
- Investigator action: request original statements from the institution; verify large deposits with source documentation.
- Expected decision: DECLINE with `POTENTIAL_DOCUMENT_TAMPERING`, `UNSOURCED_LARGE_DEPOSIT`, `UNVERIFIABLE_ASSETS`, `MATERIAL_APPLICATION_DISCREPANCY`. Alignment level comes from the findings (assets and income compare claim to truth, which agree, so it may be as low as A0 unless metadata raises it); fraud risk follows the level.
- Difficulty: ADVANCED.

## INCOHERENT (data-quality negative control, not fraud)

- Narrative: the world itself is impossible and the applicant reports it honestly. Used to check that the pipeline declines for data integrity rather than labelling every anomaly fraud.
- Mechanism (world truth): one of four modes chosen uniformly. Mode 0: monthly obligations set to 95% of gross monthly income (first liability event or a new `PERSONAL_LOAN` carries the payment), `dti = 0.95`. Mode 1: a `RENT_PAYMENT` event 3 months before the first lease start. Mode 2: a `SALARY_DEPOSIT` event 2 months before employment start. Mode 3: `annual_w2_wages = 1.25 x salary`. `truth.incoherent = true`. Presentation is a copy of the corrupted truth; evidence is synthesised from it.
- Observable indicators: obligations exceed 80% of gross monthly income; a rent payment predates the lease; a salary deposit predates employment; W-2 wages exceed gross salary.
- Evidence trail: W2_DOCUMENT.w2_wages, EMPLOYER_VERIFICATION.salary, RENT_VERIFICATION.lease_start, the claimed events list.
- Rules: FR-013. Mode 0 also fires FR-003 in the alignment sense (bureau equals disclosed, so FR-003 itself does not fire) and produces cash-flow and affordability findings at A3/A4.
- Investigator action: review for data-entry errors or an impossible financial scenario.
- Expected decision: DECLINE with `DATA_INTEGRITY_FAILURE`, `MATERIAL_APPLICATION_DISCREPANCY`. Label forced to alignment A3, fraud risk MODERATE, coherence `MATERIALLY_INCOHERENT`, case status `INCOHERENT`. `is_fraud = 0`.
- Difficulty: ADVANCED.

## OCCUPANCY_MISREPRESENTATION

- Narrative: the applicant declares the subject property as a primary residence to obtain owner-occupied pricing while intending to rent it out and keep their current lease.
- Mechanism (claimed truth, with a truth side effect): an `OCCUPANCY_DECLARATION` event is added to the presentation with `stated: PRIMARY_RESIDENCE`, `subject_property_distance_miles` uniform 120-1500 and `retains_current_lease: true`; `presentation.stated_occupancy = PRIMARY_RESIDENCE`. Truth receives the same event with `stated: INVESTMENT` and `true_occupancy = INVESTMENT`. Evidence is unchanged; rent verification shows the current lease as `CURRENT`.
- Observable indicators: primary-residence declaration for a property more than 100 miles from an active lease the applicant retains.
- Evidence trail: RENT_VERIFICATION (lease_start, payment_history), the claimed `OCCUPANCY_DECLARATION`.
- Rules: FR-014.
- Investigator action: obtain an occupancy affidavit and verify intent to occupy; re-price as an investment property if the applicant elects.
- Expected decision: DECLINE with `MATERIAL_APPLICATION_DISCREPANCY`; label forced to A4 / HIGH / `INTENTIONALLY_ADVERSARIAL` / `FRAUDULENT`.
- Difficulty: ADVANCED.
- Caveat: `retains_current_lease` and the distance are self-declared claim fields, so the indicator is planted rather than inferred. There is no subject-property address to compare against.

## GIFT_FUND_MISREPRESENTATION

- Narrative: the down payment is presented as a gift but is really a loan or a contribution from an interested party (seller, agent, builder).
- Mechanism (claimed truth, truth and evidence): `gift = salary x 0.35` (MEDIUM) or `0.60` (HIGH), added to both presentation and truth checking balances (the money is really there); `presentation.gift_funds_claimed = gift`; `truth.undisclosed_loan_disguised_as_gift = gift`. Evidence: bank balance increased by the gift and a `Gift` deposit 3-25 days before submission with `donor_letter` true with probability 0.5 and `donor_is_interested_party: true`.
- Observable indicators: a large recent deposit labelled as a gift lacking a donor letter or from a party to the transaction; balance materially higher than the ledger history would support.
- Evidence trail: BANK_STATEMENT.recent_large_deposits.
- Rules: FR-015. FR-005 does not fire because the deposit source is `Gift`, not `Unverified`.
- Investigator action: obtain an executed donor letter and donor bank evidence; confirm the donor is not a party to the transaction.
- Expected decision: DECLINE with `UNVERIFIABLE_ASSETS`, `UNSOURCED_LARGE_DEPOSIT`, `MATERIAL_APPLICATION_DISCREPANCY`; label forced to A4 / HIGH / `FRAUDULENT`.
- Difficulty: ADVANCED.
- Caveat: `donor_is_interested_party` is always true and is an evidence field only an investigator could establish; as generated it is an oracle flag.

## ASSET_SEASONING

- Narrative: reserves were assembled inside the statement window (transfers from other accounts, short-term borrowing) so that the balance looks established.
- Mechanism (claimed truth, truth and evidence): `padding = salary x 0.30` (MEDIUM) or `0.50` (HIGH), added to presentation and truth balances; `presentation.recently_transferred_funds = padding`; `truth.unseasoned_funds = padding`. Evidence: bank balance increased by the padding and 2-4 `Transfer` deposits with `source: "Unverified"` dated 2-55 days before submission, summing to the padding.
- Observable indicators: several unsourced transfers inside the 60-day window making up a majority of the verified balance; balance inconsistent with the ledger's ending balance history.
- Evidence trail: BANK_STATEMENT.recent_large_deposits, BANK_STATEMENT.checking_balance.
- Rules: FR-016, FR-005 (for each transfer at least half of monthly claimed income).
- Investigator action: source and season all large deposits.
- Expected decision: MANUAL_REVIEW (`flagged for unseasoned reserves`, `UNSOURCED_LARGE_DEPOSIT`) when the verified figures meet the manual thresholds; DECLINE otherwise; never APPROVE. Label floor A3, fraud risk MODERATE. Note that the padded balance is what `computeDecision` uses for reserves, so the padding helps the case clear the reserves threshold.
- Difficulty: INTERMEDIATE.

## STRAW_BUYER

- Narrative: a third party who cannot qualify funds the purchase and will live in the property; the applicant is a nominee.
- Mechanism (claimed truth, truth and evidence): `contribution = salary x 0.50` added to both balances; `truth.third_party_contribution`, `truth.nominee_for_third_party = true`; an `OCCUPANCY_DECLARATION` with `stated: PRIMARY_RESIDENCE`, `third_party_will_occupy: true`, `third_party_funded_down_payment`. Evidence: bank balance increased and one `Transfer` deposit with `source: "Third party"`, `third_party_funded: true`, 5-40 days before submission.
- Observable indicators: down payment funded by a third party plus a declaration that a non-applicant will occupy.
- Evidence trail: BANK_STATEMENT.recent_large_deposits, the claimed `OCCUPANCY_DECLARATION`.
- Rules: FR-017.
- Investigator action: escalate to fraud investigation; verify source of the down payment and the intended occupant.
- Expected decision: DECLINE with `MATERIAL_APPLICATION_DISCREPANCY`, `UNSOURCED_LARGE_DEPOSIT`; label forced to A4 / HIGH / `FRAUDULENT`.
- Difficulty: ADVANCED.
- Caveat: as with occupancy, `third_party_will_occupy` and `third_party_funded` are planted flags; a real straw buyer would not declare them.

## Difficulty summary

| Type | Expected outcome | Difficulty | is_fraud |
|---|---|---|---|
| NONE | APPROVE / MANUAL_REVIEW / DECLINE by thresholds | BASIC / INTERMEDIATE | 0 |
| INFLATION <= 15% | MANUAL_REVIEW (floor) or DECLINE | INTERMEDIATE | 1 |
| INFLATION > 15% | DECLINE | INTERMEDIATE | 1 |
| CONCEALMENT >= 100/mo | DECLINE | INTERMEDIATE | 1 |
| CONCEALMENT 25-99/mo | MANUAL_REVIEW (floor) or DECLINE | INTERMEDIATE | 1 |
| FABRICATION | DECLINE | ADVANCED | 1 |
| BUST_OUT | DECLINE | ADVANCED | 1 |
| EVIDENCE_TAMPERING | DECLINE | ADVANCED | 1 |
| INCOHERENT | DECLINE | ADVANCED | 0 |
| OCCUPANCY_MISREPRESENTATION | DECLINE | ADVANCED | 1 |
| GIFT_FUND_MISREPRESENTATION | DECLINE | ADVANCED | 1 |
| ASSET_SEASONING | MANUAL_REVIEW (floor) or DECLINE | INTERMEDIATE | 1 |
| STRAW_BUYER | DECLINE | ADVANCED | 1 |

Any type except BUST_OUT and INCOHERENT can instead be declined at step 3 for metadata (`HIGH_RISK_NETWORK_ORIGIN`, `SUSPICIOUS_DOCUMENT_METADATA`), with difficulty ADVANCED.

## Not yet implemented

The archived planning memo [`docs/archive/Case Explorer.md`](../archive/Case%20Explorer.md) lists the following typologies that have no mutation operator, rule or label path in the current generator:

| Typology | Status | Nearest existing coverage |
|---|---|---|
| Undisclosed liabilities beyond concealment (new debt opened after the bureau pull, co-signed obligations, alimony or child support, business debt) | not implemented | CONCEALMENT removes existing bureau tradelines only; the bureau always shows everything. |
| Identity inconsistency (name, date-of-birth or SSN mismatches across documents, address history conflicts) | not implemented | The identity finding is always A0 unless BUST_OUT; the address finding is always `NOT_VERIFIED`; `name` and `ssn_last4` are not cross-checked against any evidence. |
| Rapid credit-profile construction beyond BUST_OUT (authorised-user piggybacking, credit-repair tradeline removal, seasoned tradeline purchase) | not implemented | BUST_OUT models one compressed timeline with a planted flag. |
| Document tampering variants (altered pay stubs, fabricated VOE letters, edited PDF metadata, template reuse across applications) | not implemented | EVIDENCE_TAMPERING alters bank-statement values and one employer-name suffix; `pdf_generator` and document dates carry no forensic content. |
| Repeated device or network identity across applications | not implemented | `device_fingerprint` and `ip_address` are random per case; no cross-case linkage exists. |
| Coordinated application patterns (fraud rings, shared employers or addresses, velocity) | not implemented | Cases are generated independently; employer names come from a 7-industry vocabulary so collisions are meaningless. |
| Property-value or appraisal anomalies (inflated appraisals, flips, comparable manipulation) | not implemented | There is no property, value, LTV or appraisal in the model; the loan is 3x stated salary. |

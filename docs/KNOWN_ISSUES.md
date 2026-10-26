# Known issues

## Open moderate dependency advisories (dev and test tooling only)

Last checked with `npm audit` on 2026-10-26, after `vitest` and `@vitest/coverage-v8` moved to 4.1.12, which cleared GHSA-82fw-gwwq-j7x9 and GHSA-qxg6-89mg-rqv8. CI gates on `npm audit --audit-level=high`, which passes. `npm audit` reports 2 moderate: the packages `qs` and `typed-rest-client`, which pulls it in. Together they cover three `qs` advisories, all in the copy of `qs` that Stryker uses through `typed-rest-client`.

| Package | Installed | Advisory | Pulled in by |
|---|---|---|---|
| `qs` | 6.15.1 | GHSA-q8mj-m7cp-5q26, GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g (denial of service) | `typed-rest-client` 2.3.1, a dependency of `@stryker-mutator/core` 10.0.0 |
| `typed-rest-client` | 2.3.1 | Flagged through its nested `qs` | `@stryker-mutator/core` (mutation testing) |

Neither package is in the browser bundle or the API server's runtime dependencies. The server's own `qs` and `proxy-addr` (through Express) are on fixed versions (6.16.1 and 2.0.8).

**Blocker.**

- Clearing them needs a Stryker release that moves to `typed-rest-client` 3.x (a major upgrade of that dependency). None exists yet: `@stryker-mutator/core` 10.1.1, the latest, still pins `~2.3.0`, and `typed-rest-client` 2.3.1 pins `qs` 6.15.1.

## Fixed (October 2026): rule outcome depended on process time zone

**Closed.** Every date calculation in the generator now uses UTC methods (15 sites in `src/core/life.js`, `src/core/corruption.js` and `src/core/metadata.js`). Both answer keys rebuild identical to the committed keys, field for field and with the same case hashes, under UTC, US Eastern and Japan time, so the key files and their SHA-256 values are unchanged. `npm run test:timezone` (in `test:all`) generates `case-gen-1042-6c72619a` and a 500-case sample under all three zones, without `scripts/lib/utc.mjs`, and asserts identical records; it fails on the old code. The tracked `artifacts/` were regenerated under UTC (FR-009: 169 alerts). `scripts/lib/utc.mjs` stays as a second safeguard. The history below is kept for reference.

The generator did date arithmetic on `Date` objects in the process's local time zone, so the same seed can give different dates, and occasionally different fraud-rule results, on machines in different zones. Example: `src/core/life.js` parses the employment start date as midnight UTC (`new Date(startDate)`), then adds months with `setMonth`, which works in local time, and writes the result with `toISOString`. In US Eastern time, midnight UTC on 2024-12-15 is 19:00 on 14 December; four months later, after daylight saving starts, 19:00 EDT on 14 April is 23:00 UTC, so the auto loan opens on 2025-04-14. In UTC it opens on 2025-04-15.

**Regression case.** `case-gen-1042-6c72619a` in the `mortgage-baseline` answer key (fabrication, HIGH). Its two liabilities open 120 days apart in US Eastern time and 121 in UTC. FR-009 (rapid credit-profile construction) treats accounts opened within 120 days as clustered, so it fires in Eastern time and not in UTC, and the case loses the IDENTITY_UNVERIFIABLE and RAPID_CREDIT_PROFILE_CONSTRUCTION reason codes. Its decision (DECLINE) and its fraud-review flag are the same in both zones. Across the 6,850 answer-key cases this is the only rule or reason-code difference; every case hash differs.

**Containment.** `npm run benchmark` pins the process to UTC (`scripts/lib/utc.mjs`, imported first), so the answer keys are the same on every machine and in CI. The browser app, the other script suites and the tracked `artifacts/` files still use the local time zone; the tracked artifacts were generated in US Eastern time (FR-009 fires on 170 cases there, 169 under UTC).

**Fix as planned then:** UTC date arithmetic throughout, and a test that generates `case-gen-1042-6c72619a` under several time zones and asserts identical rule results. Both done (above).

## Credit Risk Mode UI below the mutation-testing break threshold

Last measured 2026-10-14 with a scoped Stryker run over `src/creditRisk.js` and `src/ui/credit/**` (vitest runner, thresholds 60 / 70 / 85).

| File | Mutation score |
|---|---|
| `src/creditRisk.js` | 90.16% |
| `src/ui/credit/useCreditAssessments.js` | 68.42% |
| `src/ui/credit/CreditRisk.jsx` | 22.08% |
| Scope total | 56.33% (below the break threshold of 60) |

The policy logic itself is well covered; the gap is the React component. Most surviving `CreditRisk.jsx` mutants are style strings, placeholder text and conditional rendering that the UI tests do not assert on. Closing it needs rendering-level assertions for the sidebar, portfolio strip and benchmark panel. Excluding style strings from mutation would raise the number without testing anything, so it has not been done. Mutation testing runs in CI only on manual dispatch, so this does not block a push.

## Solar prime borrowers come from the mortgage generator

Under the Solar prime profile, Borrower profiles reuse the mortgage generator; mortgage-specific application fields are hidden. The Overview shows a "Proposed solar loan" block instead: the case's seeded loan amount from the profile's loan-amount distribution, at the profile's default 2.99% coupon and 25-year term, with the monthly payment the credit policy's DTI uses. The generator's integrity check (the Decision tab's underwriting factors, labelled "Integrity model (mortgage-based generator)") still underwrites the mortgage application, so it can disagree with the solar credit policy for reasons that come from the mortgage, not the solar loan.

**Planned fix.** A full solar borrower generator: applicants, applications and the integrity check generated for a solar loan, so no mortgage field is produced and nothing needs hiding.

## The integrity verdict is computed from hidden truth and is shown openly

The integrity verdict (`label.expected_outcome`, with `label.reason_codes`) comes from the generator's reference labeller, `computeDecision` in `src/core/findings.js`. It underwrites on world truth: verified income, the true credit score, the higher of claimed and true obligations, and the injected corruption type. It is an answer key, not a system decision. No decision function reads it as an input; the leakage audit in `scripts/test-spine.test.mjs` covers decision outputs only, and the verdict is truth-derived by design.

The case views show it under one name, "Reference label", with the note "uses the case's hidden truth; an answer key, not a system decision": the Decision tab, the Overview card, the case cards and their "Reference: decline" badge, the Data Table column, the Credit Risk sidebar and disagreement callouts, and the Mortgage header lens. The "Integrity model" wording that remains on the Decision tab names the underwriting policy's factors (`scoreCase`, permitted inputs only), not this verdict.

**Challenge mode hides it (Sprint 10).** A blind decision is meaningless while the verdict, its reason codes or the integrity badge is on screen. While challenge mode is on, the shell renders only the challenge view: the application as submitted and its documents, without the fidelity score or document metadata. The reference label and the other case views open for a case only after the learner commits. `src/ui/challenge/ChallengeView.test.jsx` checks all 79 teaching cases for leaks.

Challenge mode ships the teaching answers in the page (readable in devtools); fine for practice, graded assessment needs server-side scoring (Academy).

## Findings images are captured manually, not in CI

`npm run capture:findings` (scripts/capture-findings.mjs) builds the app, generates the seed-42 funded portfolio in headless Chromium and writes the seven Findings PNGs and their captions to `docs/findings/`. It runs only on demand: no CI job runs it, so the committed images can fall behind the app until someone re-runs the script. The script needs Playwright's Chromium on the machine (`npx playwright install chromium`) and takes a few minutes, most of it the 10,000-loan portfolio.

**Later option.** A manually dispatched CI job that installs Chromium, runs the capture and uploads the images as a build artifact, so a mismatch shows up without a local run.

## The phone-width check runs by hand, not in CI

`npm run check:mobile` (scripts/check-mobile.mjs) opens Findings, Public record, Dealer View, Funding & Rates and the case views with Credit Risk Mode at 375px in headless Chromium. It fails on page-level horizontal scrolling, on a chart wider than its frame, and on chart text below 8px. Screenshots go to a temporary directory outside the repository. Like the Findings capture, nothing runs it automatically, so a layout regression on phones shows up only when someone runs it.

**Charts scroll sideways on phones.** Below 700px each chart keeps a 600px minimum width inside its own scroll frame, so its text stays readable; the right-hand part of a chart is reached by swiping. Wide tables already work the same way. A narrower drawing with thinned axis labels would avoid the swipe and is a later option.

## Policy Sandbox: what it does not model

- Dealer ratings are not recomputed under the candidate policy. A rating depends on who is in the book, so a candidate's book would rate dealers differently; that is a later item.
- The pool is fixed: the applications the baseline needed to fund 10,000 loans (18,674 at seed 42). A looser candidate funds more of those applications, never more applications.
- Loan outcomes use the profile's default dealer-effect strength; a strength chosen in the Dealer View does not carry over.
- Review counts as not funded, as in the baseline book. A real review queue approves some of its cases.
- Swap-in performance is known here only because the data is synthetic. The conservative inferred view (swap-in PD × 1.5) is an assumption, not an estimate from data.
- Fair-lending review is out of scope for synthetic data; the app makes no legal claims.

## Findings from the mutation engine (recorded, not fixed)

These came out of the controlled mutations and the teaching set (`docs/MUTATIONS.md`, `benchmarks/case-sets/teaching-v1/`). They describe the engines as they are; none is changed here.

- **The Solar credit policy scores claimed values only.** `assessCredit` reads the presentation layer (claimed FICO, claimed obligations, claimed income), so a concealed or verified debt reaches its decision only through a HIGH-severity fraud rule, which sends the case to review (FRAUD_REVIEW, "Unable to verify information provided"). There is no verified-DTI decline: in every causal pair the fraud twin goes from APPROVE to REVIEW, even where the hidden debt takes the verified DTI past the 45% cap. In `teaching-v1` the three such twins (concealment pairs 1 to 3, verified DTI 47.0%) expect DECLINE on verified figures, so they are named gaps. Its reasons never name the debt either: every HIGH alert becomes FRAUD_REVIEW, so the five other cases with material hidden debt (concealment pairs 4 and 5, the three material conflicting cases) reach the right decision with incomplete reasons and are also named gaps. The underwriting policy (`scoreCase`) does underwrite on verified income and the higher of claimed and bureau obligations.
- **Neither engine requires a document to be present.** A missing bank statement never changes the credit decision. A missing credit-bureau report or employer verification changes it only when a fraud rule misreads the absent value: FR-009 takes a missing bureau score as 0 (so its score-gap signal fires), and FR-001 falls back to W-2 wages when employer verification is missing (on 18 of 20 test bases the W-2 wages sit more than 15% below the claimed salary, so it fires HIGH). In `teaching-v1` a missing document is judged by materiality: the two cases missing the bank statement, which the decision does not depend on, expect approval on the remaining evidence and agree with the engine; the four missing the bureau report or the employer verification expect review, and all four are named gaps (the engine approves the two bureau cases and sends the two employer cases to fraud review for the FR-001 reason).
- **Fixed (Sprint 10): the opening case taught concealment poorly.** Under Solar prime the app opened on `case-gen-0-9fed5fca` (CONCEALMENT, HIGH), whose claimed FICO of 648 declines it on LOW_FICO whatever the hidden debt, and whose concealed $1,011/mo leaves its true DTI at 31.4%, below the 36% watch line. The app now opens on `teaching-v1`'s concealment pair 1: the clean twin is selected, and the guided walkthrough's second step swaps in the fraud twin, whose hidden debt takes the verified DTI to 47.0%. `case-gen-0-9fed5fca` stays in the opening library as an ordinary case.

## Generator defects for a future version (recorded, not fixed)

Found while building the credit PD model (Sprint 11). Changing the generator would change every seeded draw, the locked numbers and both answer keys, so these wait for a future generator version.

- **The claimed FICO is the true score; the bureau's is a noisy copy.** The generator copies the applicant's true credit score into the application (`presentation.current_state.credit_score`) and builds the credit report's score as the true score plus noise (`fidelityNoise(state.credit_score, 0.99)`, `src/core/evidence.js`). On the funded seed-42 book the claimed FICO equals the true score on every loan, while the bureau score differs by up to 28 points (standard deviation about 7.5) and is exactly equal on about 5% of loans. Real underwriting works the other way round: applicants do not normally state a FICO at all, and the bureau pull is the score of record. A future generator version should make the bureau score the score of record (with noise, if any, on the applicant's side), and the credit policy should read it. Until then the policy reads the claimed score (44 funded loans have a bureau score below the 660 floor, all claiming 660 to 673), and the credit PD model reads the bureau score, so the model sees a noisier FICO than the policy does (see the model card's data section and policy view).
- **Bureau scores above 850.** The credit bureau's `credit_score` exceeds the FICO scale's 850 maximum on some cases (up to 882 in the funded training books, 867 in the funded seed-42 book). The bureau noise is added without clamping.
- **One extra bureau account on most loans.** The bureau lists one more account than the application on most clean loans (`undisclosed_accounts` = 1 on 59,550 of the 80,000 funded training loans), so the account-count gap is close to constant noise rather than a concealment signal. The credit model's `undisclosed_accounts` feature inherits it (`docs/MODEL-CARD-credit-pd.md`).

## The shared feature policy misses two audit attributes

`DEFAULT_POLICY.sensitive_attributes` (`analytics/src/case_analytics/features/policy.py`) lists `zip_code` but not its derivative `zip3`, and has no entry for `regime`, so the shared guard classifies both as PERMITTED. Found in Sprint 12, when a fairness test asked the credit model's guard to reject all eight audit attributes. The credit PD model is protected: `zip3` and `regime` are in its own `FORBIDDEN_INPUTS` (`analytics/src/case_analytics/credit/data.py`), and neither is one of its 14 features. Fixing the shared policy is deferred to a separate change, because the governed datasets and the model suite also read it; that change must run the benchmark and the answer-key checks first.

## The older fairness screens apply a four-fifths pass/fail rule

`analytics/src/case_analytics/fairness/analysis.py` applies its own four-fifths screen: `fairness_report` returns `status` PASS, WARN or FAIL from selection ratios below 0.8, with `derived_attributes_below_four_fifths` and `proxy_flags` lists, written to `analytics/artifacts/fairness-report.json` and to `fairness_status` in `model-summary.json`. Its JavaScript counterpart, `src/evaluation/fairness/index.js`, does the same for the benchmark (`derived_attributes_below_four_fifths`, `status`), and **that wording reaches the app**: the Validation tab's "Fairness" card shows `fairness_status` from `validation-summary.json` (currently WARN, in amber, because derived attributes such as income band, age band and persona fall below 0.8). `README.md`, `docs/MODEL_CARD.md` and `docs/DATASET_CARD.md` describe the same screen. The mandatory release gate `scenario_attribute_parity` (selection ratio of at least 0.8 on the independently sampled scenario attributes) is a separate defect check and is not affected. These screens need the same reference-only treatment as the credit model card's fairness tables, in a separate change: keep the ratios and their intervals, show 0.80 only as a reference line with its note, mark no row against it, and never mark income band, a legitimate credit factor.

## The public-record chunk is above Vite's 500 kB warning

`npm run build` warns that `publicRecordData-*.js` is about 517 kB (55 kB gzipped; 516.61 kB at the build of October 22, 2026), because the Public record tab's lazily loaded data now includes the peer-lender snapshot (`peers-quarterly.json`, about 600 kB of JSON with full lineage) and the complaint counts. It is a warning only: the chunk loads when the tab opens, not with the main bundle, and the build and every check pass. **Later option:** split the peer data into its own lazy chunk, loaded when the peer panel is shown.

## Rate paths are Treasury-only

The rate paths move the 10-year Treasury yield only. Credit spreads also widened in 2022, so these paths understate the loss on a loan sold into that market. The holding time (triangular, 30 to 90 days, most likely 60) is an assumption. Historical windows start on each 2022 business day; market holidays take the last prior observation and are not start dates. P50 and P95 are nearest-rank percentiles across start dates.

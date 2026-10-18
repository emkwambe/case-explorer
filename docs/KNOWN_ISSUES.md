# Known issues

## Open moderate dependency advisories (dev and test tooling only)

Last checked with `npm audit` on 2026-10-14. CI gates on `npm audit --audit-level=high`, which passes; the five moderate advisories below remain after a plain `npm audit fix`.

| Package | Installed | Advisory | Pulled in by |
|---|---|---|---|
| `vitest` | 4.1.10 | GHSA-82fw-gwwq-j7x9: path traversal / arbitrary file read via the `@vitest/mocker` redirect mock | devDependency (test runner) |
| `@vitest/mocker` | 4.1.10 | GHSA-82fw-gwwq-j7x9 | `vitest` |
| `@vitest/coverage-v8` | 4.1.10 | Flagged through `vitest` | devDependency (coverage) |
| `qs` | 6.15.1 | GHSA-q8mj-m7cp-5q26, GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g (denial of service) | `typed-rest-client` 2.3.1, a dependency of `@stryker-mutator/core` 10.0.0 |
| `typed-rest-client` | 2.3.1 | Flagged through its nested `qs` | `@stryker-mutator/core` (mutation testing) |

None of these packages is in the browser bundle or the API server's runtime dependencies. The server's own `qs` and `proxy-addr` (through Express) are on fixed versions (6.16.0 and 2.0.8).

**Blockers.**

- The nested `qs` can only be cleared with a major upgrade of a Stryker dependency: `typed-rest-client` 2.x to 3.x, which `@stryker-mutator/core` 10.0.0 pins. It needs a Stryker release that moves to `typed-rest-client` 3.x, or an override that has been tested against Stryker.
- The `vitest` advisory is fixed in 4.1.11, a patch release inside the `^4.1.10` range, but a plain `npm audit fix` does not apply it. Clearing it needs an explicit `npm update vitest @vitest/coverage-v8` and a full test run.

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

## Findings images are captured manually, not in CI

`npm run capture:findings` (scripts/capture-findings.mjs) builds the app, generates the seed-42 funded portfolio in headless Chromium and writes the seven Findings PNGs and their captions to `docs/findings/`. It runs only on demand: no CI job runs it, so the committed images can fall behind the app until someone re-runs the script. The script needs Playwright's Chromium on the machine (`npx playwright install chromium`) and takes a few minutes, most of it the 10,000-loan portfolio.

**Later option.** A manually dispatched CI job that installs Chromium, runs the capture and uploads the images as a build artifact, so a mismatch shows up without a local run.

## The phone-width check runs by hand, not in CI

`npm run check:mobile` (scripts/check-mobile.mjs) opens Findings, Public record, Dealer View, Funding & Rates and the case views with Credit Risk Mode at 375px in headless Chromium. It fails on page-level horizontal scrolling, on a chart wider than its frame, and on chart text below 8px. Screenshots go to a temporary directory outside the repository. Like the Findings capture, nothing runs it automatically, so a layout regression on phones shows up only when someone runs it.

**Charts scroll sideways on phones.** Below 700px each chart keeps a 600px minimum width inside its own scroll frame, so its text stays readable; the right-hand part of a chart is reached by swiping. Wide tables already work the same way. A narrower drawing with thinned axis labels would avoid the swipe and is a later option.

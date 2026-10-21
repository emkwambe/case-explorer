# Benchmarks: seed-pinned case sets and answer keys

`npm run benchmark` runs the release gates (unchanged), then regenerates each case set in `case-sets.json` and compares it, case by case, with its committed answer key. Any difference fails the command and CI. The keys record what the engine decides today; they are a regression baseline, not a statement of what is right.

## Files

| File | What it is |
|---|---|
| `case-sets.json` | The pinned sets: profile, seed, blended count, cases per stratum, as-of date, which decision is recorded |
| `answer-key-mortgage-baseline.json` | The benchmark's own population (2,000 blended + 15 strata × 150), no profile applied, underwriting policy (`scoreCase`) |
| `answer-key-solar-prime.json` | Solar prime: 2,000 blended (the `test:credit` sample) + 15 strata × 40, credit policy (`assessCredit`) |
| `CHANGELOG.md` | One line per accepted key change, naming the key's SHA-256 and the reason |

Each key starts with the set's parameters and the generator, ruleset, policy, reason-code catalog and configuration versions, then lists one case per line:

- `id`, `hash` (SHA-256 of the generated case, first 16 hex), `type` (corruption type) and `severity`;
- `integrity` and `integrity_codes`: the generator's reference label. It is computed from world truth at generation, so it is part of the answer key, never a decision;
- `decision` and `reason_codes`: what the policy decided;
- `fraud_rules`: every underwriter-visible fraud rule that fired, as `rule:severity`;
- `flagged`: whether the case counts as flagged for fraud (definitions below).

## Definitions the scorecard uses

- **Fraud case:** corruption type in the nine fraud typologies (INFLATION, CONCEALMENT, FABRICATION, BUST_OUT, EVIDENCE_TAMPERING, OCCUPANCY_MISREPRESENTATION, GIFT_FUND_MISREPRESENTATION, ASSET_SEASONING, STRAW_BUYER). INCOHERENT is a data-integrity failure, not fraud; NONE is clean. The scorecard reports all 11 types.
- **Flagged, Solar prime (credit policy):** the case is sent to fraud review, which means a HIGH-severity fraud rule fired.
- **Flagged, Mortgage (underwriting policy):** any fraud rule fired, at any severity.
- **Fraud caught / missed:** fraud cases flagged / not flagged.
- **False alarm:** a clean (NONE) case that is flagged. On Solar prime, LOW and MEDIUM alerts on clean cases do not send a case to fraud review, so the Solar figure counts only HIGH. The Mortgage figure counts every alert, LOW and MEDIUM included.
- **Review rate:** the share of cases decided REVIEW (credit policy) or MANUAL_REVIEW (underwriting policy).
- **Pass rate:** the share of cases whose record equals the key, overall, by type and by severity.

## Negative controls (scripts/test-spine.test.mjs)

The pinned clean controls are 750 cases per profile, built as `generateCase(i, config, "NONE", "LOW", "42-clean-i")`, the Python `clean_negative_control` construction. Each one must:

1. **never be sent to fraud review**: no HIGH-severity fraud alert. LOW and MEDIUM alerts can fire on clean cases (FR-012 and FR-010: 21 of 750 under Mortgage, 19 of 750 under Solar prime at baseline). They are not a negative-control failure; the scorecard counts them as false alarms under the Mortgage definition above;
2. **get exactly the credit decision its claimed values imply**, from a decision rule written out independently of `assessCredit` (FICO below 660 or DTI above 45% declines; DTI of 36% or more, or checking under $1,000 at DTI above 40%, reviews; otherwise approve).

The controls must produce all three decisions, so a policy that declines everything cannot pass.

## Baseline (October 21, 2026)

| Set | Cases | Fraud caught | False alarms on clean | Review rate |
|---|---|---|---|---|
| mortgage-baseline | 4,250 | 2,358 of 2,358 (any alert) | 36 of 1,730 (2.1%, any alert) | 19.0% |
| solar-prime | 2,600 | 726 of 928 (78.2%, sent to fraud review) | 0 of 1,620 | 33.6% |

These are recorded as they are. Nothing was tuned to improve them.

## Changing a key on purpose

1. Make the change and run `npm run benchmark`. The scorecard lists every changed case with its fields before and after.
2. If every change is intended, run `npm run benchmark -- --update-key`. It prints each new key's SHA-256.
3. Add one line per changed key to `CHANGELOG.md`, naming that SHA-256 and the reason. A key whose SHA-256 is not in the changelog fails the benchmark.
4. Never edit a key by hand, and never change a rule only to make a key match.

The keys apply only to a run with the pinned parameters (`--count 2000 --seed 42`, 150 per stratum, as-of 2026-01-15). Other runs, such as `npm run benchmark:quick`, skip them and say so.

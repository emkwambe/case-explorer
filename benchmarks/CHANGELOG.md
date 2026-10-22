# Answer-key changelog

`npm run benchmark` compares the pinned case sets in `case-sets.json` with the answer keys in this folder, case by case. Any difference fails it. To accept a change on purpose, run `npm run benchmark -- --update-key` and add one line below that names each new key's SHA-256 and says why it changed. A key whose SHA-256 appears nowhere in this file also fails the benchmark.

The keys record what the engine does, not what it should do. A key is never edited by hand, and a rule is never changed just to make a key match.

| Date | Set | SHA-256 | Reason |
|---|---|---|---|
| 2026-10-21 | mortgage-baseline | 2a0316b14f4f3b197dd344e97a23886eb36242e86a947fb2ac65989519e5c1a2 | Baseline: the benchmark's existing population (2,000 blended + 15 strata × 150) as decided at the time the key was created. |
| 2026-10-21 | solar-prime | c3228b94c761cd8ab1c45303e0451647ae0c88af2b25b1969e72d9ee1b890406 | Baseline: Solar prime, 2,000 blended (the test:credit sample) + 15 strata × 40, credit-policy decisions at the time the key was created. |
| 2026-10-21 | mortgage-baseline | e4a23966d20cafde3e4ba821a60d0b9208284d4760a4b607b807c81d5541b2b0 | Regenerated under UTC; decisions unchanged. The benchmark now pins the process time zone to UTC; the earlier key was made in US Eastern time, so every case hash changed. One case, case-gen-1042-6c72619a, no longer fires FR-009 under UTC and loses IDENTITY_UNVERIFIABLE and RAPID_CREDIT_PROFILE_CONSTRUCTION. Cause: the generator adds months in local time to a date parsed as midnight UTC, so across the daylight-saving change its second liability opens on 2025-04-14 in Eastern time and 2025-04-15 in UTC, 120 versus 121 days after the first, and FR-009 counts accounts opened within 120 days as clustered. Logged as a defect in docs/KNOWN_ISSUES.md. |
| 2026-10-21 | solar-prime | 7973d14a61291945eea23b97455876238426822b809a46fe293745fb896c55a0 | Regenerated under UTC; decisions unchanged. Every case hash changed (dates moved with the time zone); no decision, fraud rule, reason code or flag changed. |

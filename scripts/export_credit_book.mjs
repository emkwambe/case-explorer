#!/usr/bin/env node
// scripts/export_credit_book.mjs — Export the SOLAR_PRIME seed-42 funded book as a reconciled loan
// tape in data/credit-tape/. Read-only reuse of the engine (scripts/lib/solar-book.mjs).
//
//   node scripts/export_credit_book.mjs           write the tape, its manifest and its README
//   node scripts/export_credit_book.mjs --check   rebuild in memory; exit 1 if any file differs
//
// The files are deterministic, so the manifest's SHA-256 values are a lock: CI re-derives them in
// scripts/locked-numbers.test.mjs from its own build, and scripts/credit-tape.test.mjs checks the
// committed files against the manifest.

import fs from "node:fs";
import path from "node:path";
import { buildSolarBook, ROOT } from "./lib/solar-book.mjs";
import { tapeFiles, tapeProfile, COLUMNS, TAPE_FILES } from "./lib/credit-tape.mjs";

const OUT = path.join(ROOT, "data", "credit-tape");
const check = process.argv.includes("--check");

const started = performance.now();
const book = buildSolarBook();
const { files, manifest, rows } = tapeFiles(book);
const outputs = { ...files, "manifest.json": JSON.stringify(manifest, null, 2) + "\n", "README.md": readme(manifest, tapeProfile(rows), JSON.parse(files[TAPE_FILES.reconciliation])) };

if (check) {
  const differ = Object.entries(outputs).filter(([name, text]) => !fs.existsSync(path.join(OUT, name)) || fs.readFileSync(path.join(OUT, name), "utf8") !== text).map(([name]) => name);
  console.log(differ.length ? `Credit tape differs from a fresh build: ${differ.join(", ")}` : `Credit tape matches a fresh build (${Object.keys(outputs).length} files).`);
  process.exit(differ.length ? 1 : 0);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, text] of Object.entries(outputs)) fs.writeFileSync(path.join(OUT, name), text);
for (const [name, f] of Object.entries(manifest.files)) console.log(`  ${name.padEnd(34)} ${String(f.rows ?? "").padStart(6)} rows  ${Buffer.byteLength(files[name]).toLocaleString("en-US").padStart(10)} bytes  sha256 ${f.sha256.slice(0, 16)}`);
console.log(`Credit tape written to ${path.relative(ROOT, OUT)}/ in ${((performance.now() - started) / 1000).toFixed(1)}s`);

function readme(m, p, r) {
  const n = (v, d = 0) => (v === undefined || v === null ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const numRow = (name, s, d) => `| ${name} | ${n(s.n)} | ${n(s.missing)} | ${n(s.min, d)} | ${n(s.p25, d)} | ${n(s.median, d)} | ${n(s.p75, d)} | ${n(s.max, d)} | ${n(s.mean, d)} |`;
  const numTable = (rowsIn) => ["| Column | n | Missing | Min | p25 | Median | p75 | Max | Mean |", "|---|---|---|---|---|---|---|---|---|", ...rowsIn.map(([k, s, d]) => numRow(k, s, d))].join("\n");
  const catLine = (name, c) => `- \`${name}\`: ${Object.entries(c).map(([k, v]) => `${k === "" ? "(missing)" : k} ${n(v)}`).join(" · ")}`;
  const file = (key) => m.files[TAPE_FILES[key]];
  return `# Credit tape (synthetic): Solar prime, seed ${m.seed}

The funded book and application pool behind the Dealer View, Policy Sandbox and Findings numbers, exported as a reconciled loan tape. Every borrower, dealer and outcome is synthetic.

**Generated file.** \`node scripts/export_credit_book.mjs\` writes everything in this folder, this README included. Do not edit by hand. \`--check\` rebuilds in memory and fails if any file differs.

## How the data was produced

1. **Applications.** \`generateBlendedCase(i, config, ${m.seed})\` for i = 0, 1, 2, … under the Solar prime profile, with \`src/distribution_config.json\` at as-of date ${m.as_of_date} (generator ${m.generator_version}, case schema ${m.case_schema_version}, config \`${m.configuration_hash.slice(0, 19)}…\`).
2. **Decision.** Each application is scored by the credit policy on claimed values only (\`assessCredit\`; the pool's \`decision\` is \`decide\`, which matches it on every application).
3. **Book.** Applications the policy approves are funded, in seed order, until the book holds ${n(r.loans.count)} loans. That took ${n(r.pool.applications)} applications.
4. **Outcomes.** Each funded loan is assigned to a synthetic dealer and simulated over 18 months from **true** FICO, **true** DTI, fraud and dealer quality (\`simulateLoans\`). PD is that simulation's probability of default.
5. **No shared randomness.** Every random stream is keyed by case or dealer id, so the export draws nothing that another view depends on.

## Files

| File | Rows | Role |
|---|---|---|
| \`${TAPE_FILES.loans}\` | ${n(file("loans").rows)} | ${file("loans").role} |
| \`${TAPE_FILES.pool}\` | ${n(file("pool").rows)} | ${file("pool").role} |
| \`${TAPE_FILES.oracle}\` | ${n(file("oracle").rows)} | **${file("oracle").role}** |
| \`${TAPE_FILES.reconciliation}\` | | ${file("reconciliation").role} |
| \`manifest.json\` | | SHA-256 of each data file, the seed, the profile and the generator version |

\`loan_id\` in the loans and oracle files equals \`application_id\` in the pool file.

## Field definitions

**${TAPE_FILES.loans}** (${COLUMNS.loans.join(", ")})
- \`dealer_id\`: synthetic dealer ID, such as NC-19.
- \`ead\`: loan amount in dollars (exposure at default).
- \`fico_presented\`, \`dti_presented\`, \`checking_presented\`: the claimed FICO, back-end DTI (current housing payment plus the proposed solar loan payment, over claimed income) and claimed checking balance. These are what the credit policy saw.
- \`fraud_review\`: 1 if a high-severity underwriter-visible fraud rule fired. Funded loans never have it, because a fraud review routes to Review.
- \`dpd30\`, \`charged_off\`: 1 if the loan reached 30+ days past due, or charged off, within 18 months (simulated).

**${TAPE_FILES.pool}** (${COLUMNS.pool.join(", ")})
- \`decision\`: APPROVE, REVIEW or DECLINE. \`funded\`: 1 for APPROVE (review is treated as not funded).

**${TAPE_FILES.oracle}** (${COLUMNS.oracle.join(", ")})
- \`fico_true\`, \`dti_true\`: world-truth FICO and DTI. \`fraud_true\`: 1 if the case carries a fraud corruption. \`corruption_type\`: the generator's label (NONE for clean). \`dealer_quality\`: the dealer's hidden quality (0–1). \`pd\`: the simulated probability of default, computed from true values.
- **Answer key — never a model input.** A model trained on these columns would see facts no lender has.

## Reconciliation

| Total | Value |
|---|---|
| Funded loans | ${n(r.loans.count)} |
| Σ EAD | $${n(r.loans.sum_ead)} |
| Expected loss (Σ PD × LGD × EAD, LGD ${r.loans.lgd}) | $${n(r.loans.expected_loss)} |
| 30+ DPD | ${n(r.loans.dpd30_count)} (${(100 * r.loans.dpd30_rate).toFixed(2)}%) |
| Charged off | ${n(r.loans.charged_off_count)} |
| Dealers with loans | ${n(r.dealers.length)} |
| Pool applications | ${n(r.pool.applications)} |
| Pool policy mix | APPROVE ${n(r.pool.policy_mix.APPROVE)} (${(100 * r.pool.policy_mix_share.APPROVE).toFixed(1)}%) · REVIEW ${n(r.pool.policy_mix.REVIEW)} (${(100 * r.pool.policy_mix_share.REVIEW).toFixed(1)}%) · DECLINE ${n(r.pool.policy_mix.DECLINE)} (${(100 * r.pool.policy_mix_share.DECLINE).toFixed(1)}%) |

The pool mix covers the ${n(r.pool.applications)} applications generated to fund the book. It is **not** the 54.6 / 24.7 / 20.7 mix, which comes from the separate 2,000-application \`test:credit\` sample.

## What the data looks like

No row is missing an ID or an outcome. Missing values appear only where the generator leaves a claimed field empty, and are counted below (empty cells in the CSVs).

**Funded loans**

${numTable([["ead", p.loans.ead, 0], ["fico_presented", p.loans.fico_presented, 0], ["dti_presented", p.loans.dti_presented, 4], ["checking_presented", p.loans.checking_presented, 0]])}

${catLine("fraud_review", p.loans.fraud_review)}
${catLine("dpd30", p.loans.dpd30)}
${catLine("charged_off", p.loans.charged_off)}

**Application pool**

${numTable([["fico_presented", p.pool.fico_presented, 0], ["dti_presented", p.pool.dti_presented, 4], ["checking_presented", p.pool.checking_presented, 0]])}

${catLine("decision", p.pool.decision)}
${catLine("fraud_review", p.pool.fraud_review)}

**Oracle (answer key)**

${numTable([["fico_true", p.oracle.fico_true, 0], ["dti_true", p.oracle.dti_true, 4], ["pd", p.oracle.pd, 4], ["dealer_quality", p.oracle.dealer_quality, 3]])}

${catLine("fraud_true", p.oracle.fraud_true)}
${catLine("corruption_type", p.oracle.corruption_type)}

**Before and after.** No cleaning was applied: the tape is the engine's output, unfiltered and unimputed. The only transformations are the join of presented values (pool) to simulated outcomes (loans) on the case ID, and the split of hidden fields into the oracle file.
`;
}

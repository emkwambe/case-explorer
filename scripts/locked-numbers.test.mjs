// scripts/locked-numbers.test.mjs — Locks every Findings number that needs the seed-42 book.
// Run: npm run test:locked (also part of npm run test:all, which CI runs).
//
// Exits non-zero on the first failed assertion. A Node script, not a vitest file, so the full
// 18,674-application build does not run under coverage or once per Stryker mutant. The numbers that
// need no book (break-even, runway, correlation) are locked in src/locked-numbers.test.js.
// A change here is a change to a published figure: update the Findings brief and the handoff with it.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateBlendedCase } from "../src/generator.js";
import { applyProfile, getProfile } from "../src/profiles/index.js";
import { assessCredit, caseDti, ficoComparison } from "../src/creditRisk.js";
import { simulateDealerFailure } from "../src/dealers.js";
import { buildSolarBook, reconciliation, demoConfig, ROOT } from "./lib/solar-book.mjs";
import { tapeFiles } from "./lib/credit-tape.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const pct = (v, d) => (100 * v).toFixed(d);

console.log("locked-numbers tests");
const started = performance.now();

// Solar DTI invariant (claimed side): every pool record's DTI is caseDti on the presented layer, exactly.
let dtiChecked = 0;
const dtiMismatches = [];
const solar = getProfile("SOLAR_PRIME");
const book = buildSolarBook({
  onCase: (c, record) => {
    dtiChecked++;
    if (record.dti !== caseDti(c, solar, "presentation").dti) dtiMismatches.push(c.id);
  }
});
const buildSeconds = (performance.now() - started) / 1000;
const { loans, rows, pool, dealers, settings } = book;
const row = (id) => rows.find((r) => r.dealerId === id);
const recon = reconciliation(book);

check("funded book: 10,000 loans from 18,674 applications; 225 at 30+ DPD (2.25%); EAD $448,332,100; expected loss $4,413,431", () => {
  assert.equal(pool.length, 18_674);
  assert.equal(loans.length, 10_000);
  assert.equal(recon.loans.dpd30_count, 225);
  assert.equal(pct(recon.loans.dpd30_rate, 2), "2.25");
  assert.equal(recon.loans.sum_ead, 448_332_100);
  assert.equal(recon.loans.expected_loss, 4_413_431);
});

check("sandbox pool: 18,674 applications, 53.6% funded (10,000)", () => {
  assert.equal(recon.pool.applications, 18_674);
  assert.equal(recon.pool.funded, 10_000);
  assert.equal(pct(recon.pool.funded_share, 1), "53.6");
});

check("NC-19 (Wilmington): 1,885 loans, 2.44% 30+ DPD, p = 0.309, GREEN, 18.5% of exposure, $30M advance (30%), failure +$736,241", () => {
  const r = row("NC-19");
  assert.equal(r.dealer, "Dealer NC-19 (Wilmington)");
  assert.equal(r.loans, 1_885);
  assert.equal(pct(r.dpd30Rate, 2), "2.44");
  assert.equal(r.pValue.toFixed(3), "0.309");
  assert.equal(r.rating, "GREEN");
  assert.equal(pct(r.exposureShare, 1), "18.5");
  assert.equal(r.advanceBalance, 30_000_000);
  const totalAdvances = dealers.reduce((s, d) => s + d.advanceBalance, 0);
  assert.equal(pct(r.advanceBalance / totalAdvances, 0), "30");
  assert.equal(rows.reduce((a, b) => (b.loans > a.loans ? b : a)).dealerId, "NC-19");
  const failure = simulateDealerFailure({ loans, dealers }, "NC-19", settings.dealerFailure);
  assert.equal(Math.round(failure.deltaExpectedLoss), 736_241);
  assert.equal(Math.round(failure.baselineExpectedLoss), 4_413_431);
});

check("ratings: RED NC-30 and NC-20, YELLOW NC-18 (p = 0.0495), of 34 rated dealers", () => {
  const rated = rows.filter((r) => r.rating !== "INSUFFICIENT_DATA");
  assert.equal(rated.length, 34);
  assert.deepEqual(rows.filter((r) => r.rating === "RED").map((r) => r.dealerId).sort(), ["NC-20", "NC-30"]);
  assert.deepEqual(rows.filter((r) => r.rating === "YELLOW").map((r) => r.dealerId), ["NC-18"]);
  const nc30 = row("NC-30"), nc20 = row("NC-20"), nc18 = row("NC-18");
  assert.deepEqual([nc30.loans, pct(nc30.dpd30Rate, 2), nc30.pValue.toExponential(2)], [314, "8.92", "1.09e-9"]);
  assert.deepEqual([nc20.loans, pct(nc20.dpd30Rate, 2), nc20.pValue.toExponential(2)], [445, "5.84", "1.35e-5"]);
  assert.deepEqual([nc18.loans, pct(nc18.dpd30Rate, 2), nc18.pValue.toFixed(4)], [738, "3.25", "0.0495"]);
  assert.ok(nc30.pValue < 0.01 / 34 && nc20.pValue < 0.01 / 34 && nc18.pValue >= 0.01 / 34);
});

check("Solar DTI invariant: every pool record's DTI equals caseDti on the claimed layer, no tolerance", () => {
  assert.equal(dtiChecked, 18_674);
  assert.deepEqual(dtiMismatches, []);
});

check("the committed loan tape is this build: reconciliation equal, every file's SHA-256 equal to data/credit-tape/manifest.json", () => {
  const dir = path.join(ROOT, "data", "credit-tape");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "credit-tape-reconciliation.json"), "utf8")), recon);
  const committed = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.deepEqual(tapeFiles(book).manifest, committed, "re-export with node scripts/export_credit_book.mjs if the engine changed on purpose");
});

check("credit policy mix on the 2,000-application test:credit sample: 54.6 / 24.7 / 20.7; approved-only mean FICO 749.5", () => {
  const cfg = applyProfile(demoConfig(), "SOLAR_PRIME");
  const counts = { APPROVE: 0, REVIEW: 0, DECLINE: 0 };
  const cases = [];
  for (let i = 0; i < 2000; i++) {
    const c = generateBlendedCase(i, cfg, 42);
    cases.push(c);
    counts[assessCredit(c, solar).policyDecision]++;
  }
  assert.deepEqual([pct(counts.APPROVE / 2000, 1), pct(counts.REVIEW / 2000, 1), pct(counts.DECLINE / 2000, 1)], ["54.6", "24.7", "20.7"]);
  assert.equal(counts.APPROVE, 1_092);
  assert.equal(ficoComparison(cases, solar).approvedMean.toFixed(1), "749.5");
});

console.log(`\n${passed} checks passed (book build ${buildSeconds.toFixed(1)}s, total ${((performance.now() - started) / 1000).toFixed(1)}s)`);

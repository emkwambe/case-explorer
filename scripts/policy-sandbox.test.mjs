// scripts/policy-sandbox.test.mjs — Policy Sandbox engine checks. Run: npm run test:sandbox
//
// Exits non-zero on the first failed assertion. Builds the SOLAR_PRIME seed-42 application pool the
// same way the portfolio hook does (one pass, funded loans kept by isFundedLoan, a pool record for
// every application) and prints the swap set for each preset.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBlendedCase } from "../src/generator.js";
import { applyProfile, getProfile } from "../src/profiles/index.js";
import { assessCredit, CREDIT_POLICY } from "../src/creditRisk.js";
import { buildDealerNetwork, dealerSettings, isFundedLoan, loanInputs, simulateLoans } from "../src/dealers.js";
import { expectedLoss } from "../src/fundingStress.js";
import { poolRecord, decide, simulatePool, swapSet, maxFundedDti, applyPreset, POLICY_PRESETS, CELLS, SANDBOX_DEFAULTS } from "../src/policySandbox.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = JSON.parse(fs.readFileSync(path.join(root, "src", "distribution_config.json"), "utf8"));
const CONFIG = { ...BASE, generation: { ...BASE.generation, as_of_date: "2026-01-15" } };

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b}`);

console.log("policy sandbox tests");

const solar = getProfile("SOLAR_PRIME");
const settings = dealerSettings(solar.defaults.dealerView);
const dealers = buildDealerNetwork(settings.network);
const { count, seed } = settings.portfolio;
const solarConfig = applyProfile(CONFIG, solar);
const lgd = 1 - settings.dealerFailure.baseRecovery.value;

// One pass, as in useDealerPortfolio: the funded book's inputs and the application pool.
const inputs = [], pool = [], decisions = [];
for (let i = 0; inputs.length < count; i++) {
  const c = generateBlendedCase(i, solarConfig, seed);
  if (isFundedLoan(c, solar)) inputs.push(loanInputs(c, settings.loanAmount, solar));
  pool.push(poolRecord(c, solar, settings.loanAmount));
  decisions.push(assessCredit(c, solar).policyDecision);
}
const book = simulateLoans(inputs, dealers, settings);
const loans = simulatePool(pool, dealers, settings);
const run = (policyB, options = {}) => swapSet(pool, CREDIT_POLICY, policyB, { loans, lgd, dealers, ...options });
const swaps = (r) => ({ in: r.cells.swapIn.count, out: r.cells.swapOut.count });

check("the pool is every application the baseline generated to fund its book: 18,674 at seed 42", () => {
  assert.equal(pool.length, 18_674);
  assert.equal(inputs.length, 10_000);
  assert.equal(new Set(pool.map((a) => a.id)).size, pool.length);
  for (const a of pool) assert.deepEqual(Object.keys(a).sort(), ["checking", "dti", "fico", "fraudReview", "id", "loanInputs"]);
});

check("parity: decide equals assessCredit on every application in the pool under CREDIT_POLICY", () => {
  const mismatches = pool.filter((a, i) => decide(a, CREDIT_POLICY) !== decisions[i]);
  assert.equal(mismatches.length, 0, `${mismatches.length} mismatches, first ${mismatches[0]?.id}`);
  const tally = { APPROVE: 0, REVIEW: 0, DECLINE: 0 };
  for (const d of decisions) tally[d]++;
  console.log(`        ${pool.length.toLocaleString("en-US")} of ${pool.length.toLocaleString("en-US")} match: APPROVE ${tally.APPROVE}, REVIEW ${tally.REVIEW}, DECLINE ${tally.DECLINE}`);
});

check("decide: hand-built records, including missing fields and each rule's boundary", () => {
  const app = (o) => ({ fico: 700, dti: 0.30, checking: 5000, fraudReview: false, ...o });
  assert.equal(decide(app({})), "APPROVE");
  assert.equal(decide(app({ fico: 659 })), "DECLINE");
  assert.equal(decide(app({ fico: 660 })), "APPROVE");
  assert.equal(decide(app({ dti: 0.45 })), "REVIEW"); // at the cap: watch band, not a decline
  assert.equal(decide(app({ dti: 0.4501 })), "DECLINE");
  assert.equal(decide(app({ dti: 0.36 })), "REVIEW");
  assert.equal(decide(app({ dti: 0.3599 })), "APPROVE");
  assert.equal(decide(app({ fraudReview: true })), "REVIEW");
  assert.equal(decide(app({ fico: 640, fraudReview: true })), "DECLINE");
  assert.equal(decide(app({ checking: 999, dti: 0.41, })), "REVIEW");
  assert.equal(decide(app({ checking: 999, dti: 0.41 }), { ...CREDIT_POLICY, dtiWatchLow: 0.45 }), "REVIEW"); // liquidity rule alone
  assert.equal(decide(app({ checking: 999, dti: 0.40 }), { ...CREDIT_POLICY, dtiWatchLow: 0.45 }), "APPROVE");
  assert.equal(decide(app({ fico: null, dti: null, checking: null })), "APPROVE");
});

check("pool parity: re-simulating the baseline-funded subset reproduces the existing book exactly", () => {
  const funded = loans.filter((_, i) => decide(pool[i], CREDIT_POLICY) === "APPROVE");
  assert.equal(funded.length, 10_000);
  assert.deepEqual(funded, book);
  const dpd = funded.filter((l) => l.dpd30).length / funded.length;
  assert.equal((dpd * 100).toFixed(2), "2.25");
  assert.equal(Math.round(expectedLoss(funded, { lgd })), 4_413_431);
  assert.equal(Math.round(run(CREDIT_POLICY).totals.A.expectedLoss), 4_413_431);
});

check("swap-set invariants: cells sum to the pool; the baseline against itself gives zero swaps", () => {
  for (const preset of POLICY_PRESETS) {
    const r = run(applyPreset(preset));
    assert.equal(CELLS.reduce((s, k) => s + r.cells[k].count, 0), pool.length, preset.id);
    close(CELLS.reduce((s, k) => s + r.cells[k].share, 0), 1, 1e-9, preset.id);
    assert.equal(r.totals.A.funded, r.cells.keep.count + r.cells.swapOut.count);
    assert.equal(r.totals.B.funded, r.cells.keep.count + r.cells.swapIn.count);
    close(r.totals.B.volume, r.cells.keep.ead + r.cells.swapIn.ead, 1e-6);
  }
  const self = run(CREDIT_POLICY);
  assert.deepEqual(swaps(self), { in: 0, out: 0 });
  assert.deepEqual(self.moves, {});
  assert.deepEqual(self.totals.A, self.totals.B);
  assert.equal(self.cells.keep.count, 10_000);
});

check("tightening only the FICO floor creates swap-outs and no swap-ins", () => {
  for (const floor of [670, 680, 700]) {
    const s = swaps(run({ ...CREDIT_POLICY, ficoDecline: floor }));
    assert.ok(s.out > 0 && s.in === 0, `${floor}: ${JSON.stringify(s)}`);
  }
});

check("loosening the DTI cap alone creates no swap-outs; with the watch threshold it creates swap-ins and no swap-outs", () => {
  for (const cap of [0.48, 0.50, 0.55]) {
    const r = run({ ...CREDIT_POLICY, dtiDecline: cap });
    assert.equal(r.cells.swapOut.count, 0, `cap ${cap}`);
    // The 36% watch band still sends every newly allowed DTI to review: decline → review only.
    assert.equal(r.cells.swapIn.count, 0, `cap ${cap}`);
    assert.ok(r.unchangedFundingMoves > 0 && Object.keys(r.moves).every((m) => m === "DECLINE->REVIEW"), `cap ${cap}`);
  }
  const both = run(applyPreset(POLICY_PRESETS.find((p) => p.id === "dti50")));
  assert.ok(both.cells.swapIn.count > 0 && both.cells.swapOut.count === 0, JSON.stringify(swaps(both)));
  assert.ok(both.cells.swapIn.reviewA > 0, "some swap-ins come from review");
});

check("the watch threshold limits volume: every baseline-funded DTI is below 36%, so a 40% cap moves no funding", () => {
  const max = maxFundedDti(pool, CREDIT_POLICY);
  assert.ok(max < CREDIT_POLICY.dtiWatchLow, `${max}`);
  const r = run(applyPreset(POLICY_PRESETS.find((p) => p.id === "dti40")));
  assert.deepEqual(swaps(r), { in: 0, out: 0 });
  assert.ok(r.unchangedFundingMoves > 0);
  const watch = run(applyPreset(POLICY_PRESETS.find((p) => p.id === "watch33")));
  assert.ok(watch.cells.swapOut.count > 0 && watch.cells.swapIn.count === 0, JSON.stringify(swaps(watch)));
});

check("expected loss: the conservative inferred view is at least the synthetic truth when the multiplier is at least 1", () => {
  const policy = applyPreset(POLICY_PRESETS.find((p) => p.id === "dti50"));
  for (const m of [1, 1.2, SANDBOX_DEFAULTS.inferredMultiplier.value, 3]) {
    const r = run(policy, { inferredMultiplier: m });
    assert.ok(r.totals.B.expectedLossInferred >= r.totals.B.expectedLoss - 1e-6, `×${m}`);
    assert.ok(r.cells.swapIn.expectedLossInferred >= r.cells.swapIn.expectedLoss - 1e-6, `×${m}`);
    assert.equal(r.totals.A.expectedLossInferred, r.totals.A.expectedLoss);
    for (const k of ["keep", "swapOut", "neither"]) assert.equal(r.cells[k].expectedLossInferred, r.cells[k].expectedLoss);
    if (m === 1) close(r.totals.B.expectedLossInferred, r.totals.B.expectedLoss, 1e-6);
    else assert.ok(r.totals.B.expectedLossInferred > r.totals.B.expectedLoss);
  }
});

check("swapSet matches a hand calculation on a four-application pool", () => {
  const apps = [
    { id: "a", fico: 700, dti: 0.20, checking: 5000, fraudReview: false },
    { id: "b", fico: 665, dti: 0.20, checking: 5000, fraudReview: false },
    { id: "c", fico: 700, dti: 0.47, checking: 5000, fraudReview: false },
    { id: "d", fico: 700, dti: 0.40, checking: 5000, fraudReview: false }
  ];
  const ls = [
    { id: "a", dealerId: "D1", pd: 0.02, ead: 100 },
    { id: "b", dealerId: "D1", pd: 0.04, ead: 200 },
    { id: "c", dealerId: "D2", pd: 0.10, ead: 300 },
    { id: "d", dealerId: "D2", pd: 0.05, ead: 400 }
  ];
  // Candidate: FICO floor 670 (b out), cap and watch 50% (c and d in: c was declined, d in review).
  const r = swapSet(apps, CREDIT_POLICY, { ...CREDIT_POLICY, ficoDecline: 670, dtiDecline: 0.5, dtiWatchLow: 0.5 }, { loans: ls, lgd: 0.5, inferredMultiplier: 2, topDealers: 1, dealers: [{ id: "D1", name: "Dealer D1" }, { id: "D2", name: "Dealer D2" }] });
  assert.deepEqual(CELLS.map((k) => r.cells[k].count), [1, 1, 2, 0]);
  assert.equal(r.cells.swapIn.reviewA, 1);
  close(r.cells.swapIn.avgDti, 0.435, 1e-12);
  close(r.cells.swapIn.ead, 700, 1e-12);
  close(r.cells.swapIn.avgPd, 0.075, 1e-12);
  close(r.cells.swapIn.expectedLoss, (0.10 * 300 + 0.05 * 400) * 0.5, 1e-12);
  close(r.cells.swapIn.expectedLossInferred, (0.20 * 300 + 0.10 * 400) * 0.5, 1e-12);
  assert.equal(r.totals.A.funded, 2);
  assert.equal(r.totals.B.funded, 3);
  close(r.totals.A.expectedLoss, (0.02 * 100 + 0.04 * 200) * 0.5, 1e-12);
  close(r.totals.B.expectedLoss, (0.02 * 100 + 0.10 * 300 + 0.05 * 400) * 0.5, 1e-12);
  close(r.totals.B.expectedLossRate, r.totals.B.expectedLoss / 800, 1e-12);
  close(r.totals.A.avgFico, 682.5, 1e-12);
  assert.deepEqual(r.dealerMix.top.map((d) => [d.dealer, d.A.funded, d.B.funded]), [["Dealer D1", 2, 1]]);
  assert.deepEqual([r.dealerMix.rest.dealers, r.dealerMix.rest.A.funded, r.dealerMix.rest.B.funded], [1, 0, 2]);
  assert.deepEqual(r.moves, { "APPROVE->DECLINE": 1, "DECLINE->APPROVE": 1, "REVIEW->APPROVE": 1 });
});

check("dealer mix: the top 10 dealers by baseline volume plus the rest add up to each policy's totals", () => {
  const r = run(applyPreset(POLICY_PRESETS.find((p) => p.id === "fico680")));
  assert.equal(r.dealerMix.top.length, 10);
  const vols = r.dealerMix.top.map((d) => d.A.volume);
  assert.deepEqual(vols, [...vols].sort((a, b) => b - a));
  for (const side of ["A", "B"]) {
    const rows = [...r.dealerMix.top, r.dealerMix.rest];
    assert.equal(rows.reduce((s, d) => s + d[side].funded, 0), r.totals[side].funded);
    close(rows.reduce((s, d) => s + d[side].expectedLoss, 0), r.totals[side].expectedLoss, 1e-3);
  }
  assert.ok(r.dealerMix.top.every((d) => /^Dealer [A-Z]{2}-\d{2} \(/.test(d.dealer)), "dealers are synthetic IDs");
});

check("a policy change recomputes in under 100 ms over the pool (median of 7 runs)", () => {
  const times = [];
  for (let k = 0; k < 7; k++) {
    const t = performance.now();
    run({ ...CREDIT_POLICY, ficoDecline: 660 + 5 * k });
    times.push(performance.now() - t);
  }
  const median = [...times].sort((a, b) => a - b)[3];
  assert.ok(median < 100, `${median.toFixed(1)} ms`);
  console.log(`        median ${median.toFixed(1)} ms per policy over ${pool.length.toLocaleString("en-US")} applications`);
});

console.log(`\n${passed} checks passed\n`);
const fmt = (n) => n.toLocaleString("en-US");
for (const preset of POLICY_PRESETS) {
  const r = run(applyPreset(preset));
  const B = r.totals.B;
  console.log(`  ${preset.label.padEnd(32)} swap-in ${fmt(r.cells.swapIn.count).padStart(5)} (${fmt(r.cells.swapIn.reviewA)} from review) · swap-out ${fmt(r.cells.swapOut.count).padStart(5)} · funded ${fmt(B.funded)} · approval ${(B.approvalRate * 100).toFixed(1)}% · EL $${fmt(Math.round(B.expectedLoss))} (inferred $${fmt(Math.round(B.expectedLossInferred))})`);
}

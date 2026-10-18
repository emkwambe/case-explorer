// scripts/funding.test.mjs — Funding and rate-stress engine checks. Run: npm run test:funding
//
// Exits non-zero on the first failed assertion. Prints the break-even shock at the SOLAR_PRIME
// profile's default inputs.

import assert from "node:assert/strict";
import { loanPrice, annuityPrice, platformFee, breakEvenShockBps, backbookImpact, liquidityPath, loanCapStatus, expectedLoss } from "../src/fundingStress.js";
import { getProfile, PROFILES } from "../src/profiles/index.js";
import { RATE_PATH_DEFAULTS, triangularHolding, flatPath, linearPath, pathFee, feeAtSaleFn, historicalPath, windowStarts, quantile, historicalWindows } from "../src/ratePaths.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b}`);

console.log("funding tests");

const solar = getProfile("SOLAR_PRIME");
const d = Object.fromEntries(Object.entries(solar.defaults.fundingRates).map(([k, v]) => [k, v.value]));
const feeParams = { dealerFeePct: d.dealerFeePct, coupon: d.coupon, termYears: d.termYears, yieldAtApproval: d.investorYieldAtApproval, cpr: d.cpr };

check("at CPR 0, loanPrice equals the closed-form annuity present value within 1e-9", () => {
  for (const [coupon, termYears, yieldRate] of [[0.0299, 25, 0.05], [0.0199, 5, 0.08], [0.0999, 20, 0.04], [0.05, 10, 0.05], [0.03, 25, 0]]) {
    const n = termYears * 12, rc = coupon / 12, ry = yieldRate / 12;
    const payment = (100 * rc) / (1 - Math.pow(1 + rc, -n));
    const closedForm = ry === 0 ? payment * n : (payment * (1 - Math.pow(1 + ry, -n))) / ry;
    close(loanPrice({ coupon, termYears, yieldRate }).price, closedForm, 1e-9, `${coupon}/${termYears}/${yieldRate}`);
    close(annuityPrice({ coupon, termYears, yieldRate }), closedForm, 1e-9);
  }
  // 25 years at 2.99% priced at 5%: payment 0.473902… per $100, PV 81.0297 (hand-checked).
  close(loanPrice({ coupon: 0.0299, termYears: 25, yieldRate: 0.05 }).price, 81.02966581601791, 1e-8);
  close(annuityPrice({ coupon: 0, termYears: 10, yieldRate: 0 }), 100, 1e-12);
  close(loanPrice({ coupon: 0, termYears: 10, yieldRate: 0 }).price, 100, 1e-9);
});

check("price is 100 when the yield equals the coupon, with or without prepayment", () => {
  for (const cpr of [0, 0.05, 0.2]) {
    for (const [coupon, termYears] of [[0.0299, 25], [0.0999, 5], [0.06, 15]]) close(loanPrice({ coupon, termYears, yieldRate: coupon, cpr }).price, 100, 1e-9);
  }
});

check("WAL and modified duration behave: positive, shorter with prepayment, WAL of a 1-month loan is 1/12", () => {
  const slow = loanPrice({ coupon: 0.0299, termYears: 25, yieldRate: 0.05, cpr: 0 });
  const fast = loanPrice({ coupon: 0.0299, termYears: 25, yieldRate: 0.05, cpr: 0.15 });
  assert.ok(slow.wal > fast.wal && fast.wal > 0);
  assert.ok(slow.modDuration > fast.modDuration && fast.modDuration > 0);
  const oneMonth = loanPrice({ coupon: 0.06, termYears: 1 / 12, yieldRate: 0.06 });
  close(oneMonth.wal, 1 / 12, 1e-12);
  close(oneMonth.modDuration, (1 / 12) / (1 + 0.005), 1e-12);
  // A higher yield lowers the price; prepayment pulls a discount price toward par.
  assert.ok(loanPrice({ coupon: 0.03, termYears: 25, yieldRate: 0.06 }).price < loanPrice({ coupon: 0.03, termYears: 25, yieldRate: 0.05 }).price);
  assert.ok(fast.price > slow.price);
});

check("platform fee: dealer fee less the discount, at approval and at sale", () => {
  const f = platformFee({ ...feeParams, rateShockBps: 250 });
  const atApproval = loanPrice({ coupon: d.coupon, termYears: d.termYears, yieldRate: d.investorYieldAtApproval, cpr: d.cpr });
  const atSale = loanPrice({ coupon: d.coupon, termYears: d.termYears, yieldRate: d.investorYieldAtApproval + 0.025, cpr: d.cpr });
  close(f.feeAtApproval, d.dealerFeePct - (100 - atApproval.price), 1e-12);
  close(f.feeAtSale, d.dealerFeePct - (100 - atSale.price), 1e-12);
  close(f.feeChange, f.feeAtSale - f.feeAtApproval, 1e-12);
  close(f.priceAtApproval, atApproval.price, 1e-12);
  close(f.priceAtSale, atSale.price, 1e-12);
  close(f.modDuration, atApproval.modDuration, 1e-12);
  close(f.wal, atApproval.wal, 1e-12);
  // Par loan, no shock: the whole dealer fee is earned.
  const par = platformFee({ dealerFeePct: 20, coupon: 0.05, termYears: 25, yieldAtApproval: 0.05, rateShockBps: 0, cpr: 0.05 });
  close(par.feeAtApproval, 20, 1e-9);
  close(par.feeAtSale, 20, 1e-9);
  close(platformFee({ ...feeParams }).feeChange, 0, 1e-12);
});

check("fee at sale decreases strictly as the shock increases", () => {
  let previous = Infinity;
  for (let bps = 0; bps <= 1000; bps += 5) {
    const fee = platformFee({ ...feeParams, rateShockBps: bps }).feeAtSale;
    assert.ok(fee < previous, `${bps} bps`);
    previous = fee;
  }
});

check("break-even shock is within 0.5 bps of where the fee changes sign", () => {
  const be = breakEvenShockBps(feeParams);
  assert.ok(be > 0 && be < 1000);
  assert.ok(platformFee({ ...feeParams, rateShockBps: be - 0.5 }).feeAtSale > 0);
  assert.ok(platformFee({ ...feeParams, rateShockBps: be + 0.5 }).feeAtSale < 0);
  close(platformFee({ ...feeParams, rateShockBps: be }).feeAtSale, 0, 1e-6);
  // Already negative at approval: 0. Positive all the way to 1,000 bps: null.
  assert.equal(breakEvenShockBps({ ...feeParams, dealerFeePct: 5 }), 0);
  assert.equal(breakEvenShockBps({ ...feeParams, dealerFeePct: 99 }), null);
  const narrow = breakEvenShockBps(feeParams, { lo: 100, hi: 200 });
  close(narrow, be, 1e-3);
});

check("backbook impact matches a hand calculation", () => {
  // Par loan with no shock: fee at sale = dealer fee = $20 per $100, so $500M × 20 / 100 = $100M.
  close(backbookImpact({ unsoldBalance: 500_000_000, dealerFeePct: 20, coupon: 0.05, termYears: 25, yieldAtApproval: 0.05, rateShockBps: 0, cpr: 0 }), 100_000_000, 1e-3);
  // 25y 2.99% loan sold at 5%, no prepayment: price 81.0297, fee 20 − 18.9703 = 1.0297 per $100; × $200M / 100 = $2,059,331.
  close(backbookImpact({ unsoldBalance: 200_000_000, dealerFeePct: 20, coupon: 0.0299, termYears: 25, yieldAtApproval: 0.05, rateShockBps: 0, cpr: 0 }), 200_000_000 * (20 - (100 - 81.02966581601791)) / 100, 1e-3);
  const f = platformFee({ ...feeParams, rateShockBps: 250 });
  close(backbookImpact({ unsoldBalance: 500_000_000, ...feeParams, rateShockBps: 250 }), 5_000_000 * f.feeAtSale, 1e-3);
});

check("liquidity path breach month and runway match a hand calculation", () => {
  // $60M cash, $4M new fees, $6M opex, $30M loss over 6 months: −$7M a month for 6 months
  // (53, 46, 39, 32, 25, 18 → below the $20M minimum in month 6), then −$2M a month:
  // 16, 14, 12, 10, 8, 6, 4, 2, 0 (month 15), −2 in month 16 → runway 16.
  const r = liquidityPath({ cash: 60e6, monthlyOpex: 6e6, monthlyNewFees: 4e6, backbookLoss: 30e6, lossRecognitionMonths: 6, minLiquidity: 20e6, months: 18 });
  assert.deepEqual(r.path.map((p) => p.cash / 1e6), [53, 46, 39, 32, 25, 18, 16, 14, 12, 10, 8, 6, 4, 2, 0, -2, -4, -6]);
  assert.deepEqual(r.path.map((p) => p.month), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.equal(r.breachMonth, 6);
  assert.equal(r.runwayMonths, 16);
  const safe = liquidityPath({ cash: 60e6, monthlyOpex: 1e6, monthlyNewFees: 1e6, minLiquidity: 20e6 });
  assert.equal(safe.breachMonth, null);
  assert.equal(safe.runwayMonths, null);
  assert.equal(safe.path.length, 18);
  assert.ok(safe.path.every((p) => p.cash === 60e6));
  // Exactly at the minimum is not a breach.
  assert.equal(liquidityPath({ cash: 21e6, monthlyOpex: 1e6, minLiquidity: 20e6, months: 1 }).breachMonth, null);
  assert.equal(liquidityPath({ cash: 1e6, monthlyOpex: 1e6, months: 2 }).runwayMonths, 2);
  assert.equal(liquidityPath({ cash: 10e6, monthlyOpex: 0, backbookLoss: 12e6, lossRecognitionMonths: 0, months: 3 }).runwayMonths, null);
});

check("loan cap utilisation and breach", () => {
  assert.deepEqual(loanCapStatus({ unsoldBalance: 500e6, loanCap: 600e6 }), { utilisation: 500 / 600, breached: false });
  assert.deepEqual(loanCapStatus({ unsoldBalance: 600e6, loanCap: 600e6 }), { utilisation: 1, breached: false });
  assert.deepEqual(loanCapStatus({ unsoldBalance: 601e6, loanCap: 600e6 }), { utilisation: 601 / 600, breached: true });
  assert.equal(loanCapStatus({ unsoldBalance: 1, loanCap: 0 }).utilisation, Infinity);
});

check("expected loss: Σ PD × LGD × EAD; zero at LGD 0; dealer-failure scenarios applied", () => {
  const loans = [{ id: "a", pd: 0.1, ead: 100 }, { id: "b", pd: 0.2, ead: 50 }, { id: "c", pd: 0.5, ead: 10 }];
  assert.equal(expectedLoss(loans, { lgd: 0 }), 0);
  close(expectedLoss(loans, { lgd: 0.85 }), (0.1 * 100 + 0.2 * 50 + 0.5 * 10) * 0.85, 1e-12);
  close(expectedLoss({ loans }, { lgd: 1 }), 25, 1e-12);
  close(expectedLoss(loans, { lgd: 0.5, pdOverride: 0.02 }), 0.02 * 160 * 0.5, 1e-12);
  // Failure: b and c affected, PD × 3 capped at 1, LGD 1 on those.
  const scenario = { affectedIds: ["b", "c"], assumptions: { pdMultiplier: { value: 3 } } };
  close(expectedLoss(loans, { lgd: 0.85, scenario }), 0.1 * 100 * 0.85 + 0.6 * 50 * 1 + 1 * 10 * 1, 1e-12);
  close(expectedLoss(loans, { lgd: 0.85, scenario: { affectedIds: [] } }), expectedLoss(loans, { lgd: 0.85 }), 1e-12);
  close(expectedLoss(loans, { lgd: 0.85, scenario: { affectedIds: ["a"] } }), 0.1 * 100 + 0.2 * 50 * 0.85 + 0.5 * 10 * 0.85, 1e-12);
});

check("defaults come from the profile, every input is tagged, history facts are sourced", () => {
  const f = solar.defaults.fundingRates;
  for (const [key, entry] of Object.entries(f)) assert.ok(typeof entry.status === "string" && entry.status.length > 0, key);
  assert.equal(f.loanSize.value, 46_000);
  assert.equal(f.loanSize.status, "disclosed");
  assert.equal(f.loanSize.value, solar.defaults.dealerView.loanAmount.calibrationTarget.value);
  assert.equal(f.coupon.status, "disclosed range");
  assert.deepEqual(f.coupon.range, [0.0199, 0.0999]);
  assert.deepEqual(f.termYears.range, [5, 25]);
  const history = solar.caseStudies.find((cs) => cs.panel === "fundingRates");
  assert.equal(history.sources.length, 4);
  for (const fact of history.facts) assert.match(fact.source.url, /^https:\/\//);
  assert.equal(getProfile("MORTGAGE").defaults.fundingRates, null);
  assert.ok(PROFILES.every((p) => p.defaults && "fundingRates" in p.defaults));
});

const holding = triangularHolding(RATE_PATH_DEFAULTS.holding);

check("holding weights: triangular 30–90 days with mode 60, summing to 1", () => {
  assert.deepEqual([RATE_PATH_DEFAULTS.holding.min, RATE_PATH_DEFAULTS.holding.mode, RATE_PATH_DEFAULTS.holding.max], [30, 60, 90]);
  assert.equal(RATE_PATH_DEFAULTS.holding.status, "assumption");
  close(holding.reduce((s, h) => s + h.p, 0), 1, 1e-12);
  assert.equal(holding[0].days, 31);
  assert.equal(holding.at(-1).days, 89);
  const peak = holding.reduce((a, b) => (b.p > a.p ? b : a));
  assert.equal(peak.days, 60);
  // Symmetric about the mode; day 45 is half the density of day 60.
  for (const h of holding) close(h.p, holding.find((x) => x.days === 120 - h.days).p, 1e-15);
  close(holding.find((h) => h.days === 45).p, peak.p / 2, 1e-15);
  for (const spec of [{ min: 10, mode: 10, max: 40 }, { min: 5, mode: 30, max: 30 }, { min: 7, mode: 7, max: 7 }]) close(triangularHolding(spec).reduce((s, h) => s + h.p, 0), 1, 1e-12);
  assert.throws(() => triangularHolding({ min: 60, mode: 30, max: 90 }));
});

check("pathFee: a flat path equals platformFee with no shock; it is Σ p(t) × feeAtSale(path(t))", () => {
  const flat = pathFee(feeParams, flatPath(), holding);
  close(flat.expectedFeeAtSale, platformFee({ ...feeParams }).feeAtSale, 1e-12);
  close(flat.feeAtApproval, platformFee({ ...feeParams }).feeAtApproval, 1e-12);
  close(flat.expectedChange, 0, 1e-12);
  // Two holding days by hand.
  const two = [{ days: 30, p: 0.25 }, { days: 60, p: 0.75 }];
  const path = (t) => (t === 30 ? 50 : 150);
  const byHand = 0.25 * platformFee({ ...feeParams, rateShockBps: 50 }).feeAtSale + 0.75 * platformFee({ ...feeParams, rateShockBps: 150 }).feeAtSale;
  close(pathFee(feeParams, path, two).expectedFeeAtSale, byHand, 1e-12);
  close(pathFee(feeParams, path, two).expectedShockBps, 125, 1e-12);
});

check("straight-line paths are monotonic: a larger rise gives a lower expected fee, and each path falls over the hold", () => {
  const fees = [-100, 0, 100, 200, 300].map((bps) => pathFee(feeParams, linearPath(bps), holding).expectedFeeAtSale);
  for (let i = 1; i < fees.length; i++) assert.ok(fees[i] < fees[i - 1], `${fees}`);
  const up = linearPath(200);
  assert.equal(up(0), 0);
  assert.equal(up(30), 100);
  assert.equal(up(60), 200);
  assert.equal(up(90), 200);
  const fee = feeAtSaleFn(feeParams);
  let previous = Infinity;
  for (let t = 0; t <= 60; t += 5) {
    assert.ok(fee(up(t)) < previous, `day ${t}`);
    previous = fee(up(t));
  }
});

const dailyFile = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "public-record", "dgs10-daily.json"), "utf8"));
const obs = dailyFile.observations;

check("historical 2022 windows: forward-looking from each business day, carried days never a start, P50/P95 nearest rank", () => {
  const starts = windowStarts(obs, 2022);
  assert.equal(starts.length, 249);
  assert.ok(starts.every((s) => !s.carriedFrom));
  assert.equal(starts[0].date, "2022-01-03");
  assert.equal(starts.at(-1).date, "2022-12-30");
  // 2022-01-03 (1.63%) + 30 days = 2022-02-02; + 60 = 2022-03-04; a weekend end reads the Friday before.
  const p = historicalPath(obs, starts[0]);
  const at = (d) => obs.find((o) => o.date === d).value;
  close(p(30), Math.round((at("2022-02-02") - 1.63) * 10000) / 100, 1e-9);
  close(p(60), Math.round((at("2022-03-04") - 1.63) * 10000) / 100, 1e-9);
  const sat = historicalPath(obs, starts.find((s) => s.date === "2022-01-07"));
  assert.equal(sat(1), 0); // ends on Saturday 2022-01-08, which reads Friday's observation
  close(sat(3), Math.round((at("2022-01-10") - at("2022-01-07")) * 10000) / 100, 1e-9);
  assert.equal(historicalPath(obs, starts.at(-1))(91 + 30), null); // past the end of the file
  assert.equal(quantile([5, 1, 4, 2, 3], 0.5), 3);
  assert.equal(quantile([5, 1, 4, 2, 3], 0.95), 5);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.05), 1);
  const w = historicalWindows(obs, 2022, feeParams);
  assert.deepEqual(w.fixed.map((x) => [x.days, x.windows]), [[30, 249], [60, 249], [90, 249]]);
  assert.equal(w.weighted.windows, 249);
  for (const x of w.fixed) {
    assert.ok(x.p95Bps >= x.p50Bps);
    close(x.feeAtP95, platformFee({ ...feeParams, rateShockBps: x.p95Bps }).feeAtSale, 1e-12);
  }
  assert.ok(w.weighted.feeP95 <= w.weighted.feeP50);
  assert.equal(w.holidaysSkipped, 11);
});

const be = breakEvenShockBps(feeParams);
const f0 = platformFee({ ...feeParams });

check("unchanged: the single-shock break-even at the SOLAR_PRIME defaults is 112.8 bps", () => {
  assert.equal(be.toFixed(1), "112.8");
});
console.log(`\n${passed} checks passed\n`);
console.log(`SOLAR_PRIME defaults: coupon ${(d.coupon * 100).toFixed(2)}%, ${d.termYears}y, investor yield ${(d.investorYieldAtApproval * 100).toFixed(1)}%, dealer fee $${d.dealerFeePct}, CPR ${(d.cpr * 100).toFixed(0)}%`);
console.log(`  price at approval $${f0.priceAtApproval.toFixed(2)}, fee at approval $${f0.feeAtApproval.toFixed(2)} per $100, modified duration ${f0.modDuration.toFixed(2)} yrs`);
console.log(`  break-even shock ${be.toFixed(1)} bps`);
const hw = historicalWindows(obs, 2022, feeParams);
console.log(`  rate paths (holding ${RATE_PATH_DEFAULTS.holding.min}–${RATE_PATH_DEFAULTS.holding.max} days, mode ${RATE_PATH_DEFAULTS.holding.mode}): expected fee at sale per $100: ${[0, 100, 200, 300, -100].map((bps) => `${bps > 0 ? "+" : ""}${bps} bps $${pathFee(feeParams, linearPath(bps), holding).expectedFeeAtSale.toFixed(2)}`).join(", ")}`);
for (const x of hw.fixed) console.log(`  2022 ${x.days}-day windows (${x.windows}): P50 +${x.p50Bps} bps, P95 +${x.p95Bps} bps, fee at P95 $${x.feeAtP95.toFixed(2)}, negative fee in ${(x.negativeShare * 100).toFixed(1)}%`);
console.log(`  2022 holding-weighted (${hw.weighted.windows}): fee P50 $${hw.weighted.feeP50.toFixed(2)}, P95 $${hw.weighted.feeP95.toFixed(2)}, negative in ${(hw.weighted.negativeShare * 100).toFixed(1)}%`);

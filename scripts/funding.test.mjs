// scripts/funding.test.mjs — Funding and rate-stress engine checks. Run: npm run test:funding
//
// Exits non-zero on the first failed assertion. Prints the break-even shock at the SOLAR_PRIME
// profile's default inputs.

import assert from "node:assert/strict";
import { loanPrice, annuityPrice, platformFee, breakEvenShockBps, backbookImpact, liquidityPath, loanCapStatus, expectedLoss } from "../src/fundingStress.js";
import { getProfile, PROFILES } from "../src/profiles/index.js";

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

const be = breakEvenShockBps(feeParams);
const f0 = platformFee({ ...feeParams });
console.log(`\n${passed} checks passed\n`);
console.log(`SOLAR_PRIME defaults: coupon ${(d.coupon * 100).toFixed(2)}%, ${d.termYears}y, investor yield ${(d.investorYieldAtApproval * 100).toFixed(1)}%, dealer fee $${d.dealerFeePct}, CPR ${(d.cpr * 100).toFixed(0)}%`);
console.log(`  price at approval $${f0.priceAtApproval.toFixed(2)}, fee at approval $${f0.feeAtApproval.toFixed(2)} per $100, modified duration ${f0.modDuration.toFixed(2)} yrs`);
console.log(`  break-even shock ${be.toFixed(1)} bps`);

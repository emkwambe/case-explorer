// scripts/dealers.test.mjs — Dealer channel engine checks. Run: npm run test:dealers
//
// Exits non-zero on the first failed assertion. The dealer effect on loan outcomes is a set
// assumption (`dealerEffect.strength`), so the quintile checks here are construction checks:
// they verify the simulation does what it was told (quality matters at the default strength and
// stops mattering at 0). They are not evidence that dealer quality predicts real loan losses.
// Prints the quintile 30+ DPD rates and the signal-vs-noise false-flag counts for the
// 10,000-case SOLAR_PRIME portfolio at seed 42.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBlendedCase } from "../src/generator.js";
import { applyProfile, getProfile } from "../src/profiles/index.js";
import {
  DEALER_CONFIG, DEALER_DEFAULTS, buildDealerNetwork, assignDealer, simulatePerformance, monthlyHazard, dealerSignals,
  loanInputs, loanAmount, buildLoan, simulateLoans, aggregateDealers, portfolioAlerts, simulateDealerFailure, rateDealer,
  binomialUpperTail, dealerSettings, withDealerEffect, signalVsNoise
} from "../src/dealers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = JSON.parse(fs.readFileSync(path.join(root, "src", "distribution_config.json"), "utf8"));
const CONFIG = { ...BASE, generation: { ...BASE.generation, as_of_date: "2026-01-15" } };

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log("dealer tests");

const solar = getProfile("SOLAR_PRIME");
const settings = dealerSettings(solar.defaults.dealerView);
const dealers = buildDealerNetwork(settings.network);
const { count, seed } = settings.portfolio;
const solarConfig = applyProfile(CONFIG, solar);
const cases = Array.from({ length: count }, (_, i) => generateBlendedCase(i, solarConfig, seed));
const inputs = cases.map((c) => loanInputs(c, settings.loanAmount, solar));
const loans = simulateLoans(inputs, dealers, settings);
const rows = aggregateDealers(loans, dealers, settings);
const quality = new Map(dealers.map((d) => [d.id, d.quality]));
const sum = (xs) => xs.reduce((s, v) => s + v, 0);
const quintileRates = (ls) => {
  const sorted = [...ls].sort((a, b) => quality.get(a.dealerId) - quality.get(b.dealerId) || a.id.localeCompare(b.id));
  const n = sorted.length, k = Math.floor(n / 5);
  const rate = (xs) => xs.filter((l) => l.dpd30).length / xs.length;
  return { bottom: rate(sorted.slice(0, k)), top: rate(sorted.slice(n - k)), n: k };
};
const quintiles = {};
let noise = null;

check("dealer network: 50 fictional dealers, 60% of them in North Carolina, deterministic", () => {
  assert.equal(DEALER_CONFIG.length, 50);
  assert.equal(DEALER_CONFIG.filter((d) => d.state === "NC").length, 30);
  assert.deepEqual(buildDealerNetwork(), DEALER_CONFIG);
  assert.equal(new Set(DEALER_CONFIG.map((d) => d.id)).size, 50);
  for (const d of [...DEALER_CONFIG, ...dealers]) {
    assert.match(d.name, /^Dealer [A-Z]{2}-\d{2} \([A-Za-z ]+\)$/, d.name);
    assert.ok(d.quality > 0 && d.quality < 1);
    assert.ok(d.advanceBalance > 0);
  }
  const top3 = sum([...DEALER_CONFIG].sort((a, b) => b.volumeWeight - a.volumeWeight).slice(0, 3).map((d) => d.volumeWeight));
  assert.ok(top3 > 0.3, `top three dealers carry ${top3}`);
});

check("NC exposure share is a config value (default 45%)", () => {
  assert.equal(DEALER_DEFAULTS.network.homeExposureShare.value, 0.45);
  const ncVolume = sum(DEALER_CONFIG.filter((d) => d.state === "NC").map((d) => d.volumeWeight));
  assert.ok(Math.abs(ncVolume - 0.45) < 1e-12, `NC volume weight ${ncVolume}`);
  const ncExposure = sum(rows.filter((r) => r.state === "NC").map((r) => r.exposure)) / sum(rows.map((r) => r.exposure));
  assert.ok(Math.abs(ncExposure - 0.45) < 0.05, `NC exposure share ${ncExposure}`);
  const custom = buildDealerNetwork({ ...DEALER_DEFAULTS.network, homeExposureShare: { value: 0.3, status: "assumption" } });
  assert.ok(Math.abs(sum(custom.filter((d) => d.state === "NC").map((d) => d.volumeWeight)) - 0.3) < 1e-12);
});

check("SOLAR_PRIME top-four advances follow the disclosed amounts; the rest stay simulated and smaller", () => {
  const top = settings.network.topAdvances;
  assert.deepEqual(top.values, [30_000_000, 10_000_000, 7_000_000, 5_000_000]);
  assert.equal(top.status, "disclosed");
  assert.match(top.source.url, /^https:\/\//);
  const sorted = [...dealers].sort((a, b) => b.advanceBalance - a.advanceBalance);
  assert.deepEqual(sorted.slice(0, 4).map((d) => d.advanceBalance), top.values);
  assert.ok(sorted.slice(4).every((d) => d.advanceBalance <= 5_000_000));
  assert.ok(Math.abs(sum(dealers.map((d) => d.advanceBalance)) - settings.network.totalAdvances.value) <= dealers.length);
  assert.equal(DEALER_DEFAULTS.network.topAdvances, null);
  // Only advances change: volume, quality and assignment are identical to the default network.
  assert.deepEqual(dealers.map((d) => [d.id, d.quality, d.volumeWeight]), DEALER_CONFIG.map((d) => [d.id, d.quality, d.volumeWeight]));
});

check("dealer assignment and loan simulation are deterministic", () => {
  for (const c of cases.slice(0, 500)) {
    assert.equal(assignDealer(c, dealers).id, assignDealer(structuredClone(c), dealers).id);
    assert.equal(assignDealer(c, dealers, settings.assignment).id, loans.find((l) => l.id === c.id).dealerId);
  }
  assert.deepEqual(cases.slice(0, 200).map((c) => buildLoan(c, dealers, settings, solar)), loans.slice(0, 200));
});

check("construction check: fraud cases are steered toward low-quality dealers only when strength > 0", () => {
  const meanQuality = (ls) => sum(ls.map((l) => quality.get(l.dealerId))) / ls.length;
  assert.ok(meanQuality(loans.filter((l) => l.fraud)) < meanQuality(loans.filter((l) => !l.fraud)));
  const zero = simulateLoans(inputs, dealers, withDealerEffect(settings, 0));
  const c = cases.find((k) => loanInputs(k).fraud);
  const clean = { ...loanInputs(c), fraud: false };
  assert.equal(assignDealer(c, dealers, settings.assignment, 0).id, assignDealer(clean, dealers, settings.assignment, 0).id);
  assert.ok(zero.length === loans.length);
});

check("construction check: hazard follows FICO, DTI and, scaled by strength, dealer quality", () => {
  const c = cases.find((k) => k.meta.corruption_type === "NONE");
  const good = { ...dealers[0], quality: 0.95 }, bad = { ...dealers[0], quality: 0.3 };
  assert.ok(monthlyHazard(c, bad) > monthlyHazard(c, good));
  assert.equal(monthlyHazard(c, bad, settings.performance, 0), monthlyHazard(c, good, settings.performance, 0));
  const lowFico = structuredClone(c); lowFico.truth.current_state.credit_score = 560;
  assert.ok(monthlyHazard(lowFico, good) > monthlyHazard(c, good));
  const r = simulatePerformance(c, good);
  assert.deepEqual(simulatePerformance(c, good), r);
  assert.ok(!r.chargedOff || r.dpd30);
  assert.equal(dealerSignals(dealers[0]).label, "simulated public-record signal");
});

check("construction check, not evidence: the bottom quality quintile has the higher 30+ DPD rate at the default strength", () => {
  quintiles.atStrength = quintileRates(loans);
  assert.ok(quintiles.atStrength.bottom > quintiles.atStrength.top, JSON.stringify(quintiles.atStrength));
});

check("construction check: at strength 0 the quintile gap closes (no built-in dealer effect)", () => {
  quintiles.noEffect = quintileRates(simulateLoans(inputs, dealers, withDealerEffect(settings, 0)));
  const gapSet = quintiles.atStrength.bottom - quintiles.atStrength.top;
  const gapZero = quintiles.noEffect.bottom - quintiles.noEffect.top;
  assert.ok(Math.abs(gapZero) < gapSet / 4, `gap at strength 0 ${gapZero} vs ${gapSet}`);
});

check("signal vs noise: rating counts at the set strength and at strength 0, with and without the loan minimum", () => {
  noise = signalVsNoise(inputs, dealers, settings);
  for (const k of ["atStrength", "atStrengthNoMinimum", "noEffect", "noEffectNoMinimum"]) {
    const r = noise[k];
    assert.equal(r.RED + r.YELLOW + r.GREEN + r.INSUFFICIENT_DATA, dealers.length);
    assert.equal(r.rated, dealers.length - r.INSUFFICIENT_DATA);
  }
  assert.equal(noise.noEffect.strength, 0);
  assert.equal(noise.noEffectNoMinimum.minLoans, 0);
  assert.equal(noise.noEffectNoMinimum.INSUFFICIENT_DATA, 0);
  assert.ok(noise.noEffectNoMinimum.rated >= noise.noEffect.rated);
});

check("binomial upper tail matches a brute-force sum", () => {
  const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  const brute = (k, n, p) => { let t = 0; for (let j = k; j <= n; j++) t += choose(n, j) * p ** j * (1 - p) ** (n - j); return t; };
  for (const [k, n, p] of [[3, 10, 0.1], [8, 60, 0.05], [12, 120, 0.048], [40, 400, 0.05], [1, 1, 0.048], [5, 30, 0.2]]) {
    assert.ok(Math.abs(binomialUpperTail(k, n, p) - brute(k, n, p)) < 1e-12 * Math.max(1, brute(k, n, p)), `${k}/${n}@${p}`);
  }
  assert.equal(binomialUpperTail(0, 50, 0.05), 1);
  assert.equal(binomialUpperTail(51, 50, 0.05), 0);
  assert.equal(binomialUpperTail(3, 50, 0), 0);
  assert.equal(binomialUpperTail(3, 50, 1), 1);
});

check("rating: binomial test against the portfolio rate, Bonferroni for RED, 30-loan minimum", () => {
  const t = DEALER_DEFAULTS.rating;
  assert.deepEqual(t, { minLoans: 30, redAlpha: 0.01, redCorrection: "bonferroni", yellowAlpha: 0.05 });
  assert.equal(rateDealer({ loans: 29, pValue: 0 }, t, { ratedCount: 30 }), "INSUFFICIENT_DATA");
  assert.equal(rateDealer({ loans: 30, pValue: null }, t, { ratedCount: 30 }), "INSUFFICIENT_DATA");
  assert.equal(rateDealer({ loans: 30, pValue: 0.01 / 30 - 1e-9 }, t, { ratedCount: 30 }), "RED");
  assert.equal(rateDealer({ loans: 30, pValue: 0.01 / 30 }, t, { ratedCount: 30 }), "YELLOW");
  assert.equal(rateDealer({ loans: 30, pValue: 0.049 }, t, { ratedCount: 30 }), "YELLOW");
  assert.equal(rateDealer({ loans: 30, pValue: 0.05 }, t, { ratedCount: 30 }), "GREEN");
  assert.equal(rateDealer({ loans: 30, pValue: 0.005 }, { ...t, redCorrection: "none" }, { ratedCount: 30 }), "RED");
  const portfolioRate = loans.filter((l) => l.dpd30).length / loans.length;
  const rated = rows.filter((r) => r.loans >= t.minLoans);
  for (const r of rows) {
    assert.equal(r.portfolioDpd30Rate, portfolioRate);
    if (r.loans < t.minLoans) { assert.equal(r.pValue, null); assert.equal(r.rating, "INSUFFICIENT_DATA"); continue; }
    assert.equal(r.pValue, binomialUpperTail(r.dpd30Count, r.loans, portfolioRate));
    const expected = r.pValue < 0.01 / rated.length ? "RED" : r.pValue < 0.05 ? "YELLOW" : "GREEN";
    assert.equal(r.rating, expected, r.dealerId);
  }
});

check("SOLAR_PRIME loan amounts follow the disclosed $10k–$150k range with a mean near the disclosed $46k average", () => {
  const sizing = settings.loanAmount;
  assert.equal(sizing.min.value, 10_000);
  assert.equal(sizing.max.value, 150_000);
  assert.equal(sizing.min.status, "disclosed");
  assert.equal(sizing.median.status, "assumption");
  const amounts = inputs.map((l) => l.ead);
  assert.ok(amounts.every((a) => a >= 10_000 && a <= 150_000 && a % 100 === 0));
  const mean = sum(amounts) / amounts.length;
  assert.ok(Math.abs(mean - 46_000) < 1_500, `mean loan ${mean}`);
  assert.equal(loanAmount(cases[0], sizing), loanAmount(structuredClone(cases[0]), sizing));
  // Mortgage keeps the generator's own loan amounts.
  assert.equal(DEALER_DEFAULTS.loanAmount, null);
  assert.equal(loanInputs(cases[0]).ead, cases[0].application.loan_amount);
});

check("alert percentages match an independent recalculation from the loans", () => {
  const byId = new Map(dealers.map((d) => [d.id, d]));
  const total = sum(loans.map((l) => l.ead));
  const share = (key) => {
    const m = new Map();
    for (const l of loans) { const g = byId.get(l.dealerId)[key]; m.set(g, (m.get(g) ?? 0) + l.ead); }
    return new Map([...m].map(([g, v]) => [g, v / total]));
  };
  const cityShare = share("city"), stateShare = share("state");
  const topAdvance = Math.max(...dealers.map((d) => d.advanceBalance)) / sum(dealers.map((d) => d.advanceBalance));
  const alerts = portfolioAlerts(rows, settings.alerts);
  assert.ok(alerts.length > 0);
  for (const a of alerts) {
    const expected = a.kind === "CITY_CONCENTRATION" ? cityShare.get(a.subject) : a.kind === "STATE_CONCENTRATION" ? stateShare.get(a.subject) : topAdvance;
    assert.ok(Math.abs(a.value - expected) < 1e-9, `${a.text}: ${a.value} vs ${expected}`);
    assert.ok(a.text.includes(`${Math.round(expected * 100)}%`), a.text);
  }
  const expectedKinds = [
    ...[...cityShare].filter(([, v]) => v > settings.alerts.cityExposureShare).map(([g]) => `CITY_CONCENTRATION:${g}`),
    ...[...stateShare].filter(([, v]) => v > settings.alerts.stateExposureShare).map(([g]) => `STATE_CONCENTRATION:${g}`),
    ...(topAdvance > settings.alerts.topAdvanceShare ? ["TOP_ADVANCE"] : [])
  ].sort();
  assert.deepEqual(alerts.map((a) => (a.kind === "TOP_ADVANCE" ? a.kind : `${a.kind}:${a.subject}`)).sort(), expectedKinds);
});

check("dealer failure raises expected loss and writes off the full advance balance", () => {
  const portfolio = { loans, dealers };
  for (const r of rows.filter((x) => x.loans > 0)) {
    const f = simulateDealerFailure(portfolio, r.dealerId, settings.dealerFailure);
    assert.equal(f.advanceWriteOff, dealers.find((d) => d.id === r.dealerId).advanceBalance);
    assert.equal(f.dealerLoans, r.loans);
    if (f.affectedLoans > 0) assert.ok(f.deltaExpectedLoss > 0, `${r.dealerId}: ${f.deltaExpectedLoss}`);
    else assert.equal(f.deltaExpectedLoss, 0);
    assert.ok(Math.abs(f.stressedExpectedLoss - f.baselineExpectedLoss - f.deltaExpectedLoss) < 1e-6);
  }
  const largest = rows.reduce((a, b) => (b.loans > a.loans ? b : a));
  const f = simulateDealerFailure(portfolio, largest.dealerId, settings.dealerFailure);
  assert.ok(f.affectedLoans > 0 && f.deltaExpectedLoss > 0);
  const shareAffected = f.affectedLoans / f.dealerLoans;
  assert.ok(Math.abs(shareAffected - settings.dealerFailure.nonWorkingShare.value) < 0.05, `non-working share ${shareAffected}`);
  assert.throws(() => simulateDealerFailure(portfolio, "XX-99"), /Unknown dealer/);
});

check("lender content comes from the profile: SOLAR_PRIME has exactly two sourced dealer case-study facts, MORTGAGE none", () => {
  const studies = solar.caseStudies.filter((cs) => cs.panel === "dealerView");
  assert.equal(studies.length, 1);
  assert.equal(studies[0].facts.length, 2);
  for (const f of studies[0].facts) assert.match(f.source.url, /^https:\/\//);
  const mortgage = getProfile("MORTGAGE");
  assert.equal(mortgage.defaults.dealerView, null);
  assert.equal(mortgage.caseStudies.length, 0);
  assert.deepEqual(dealerSettings(mortgage.defaults.dealerView), DEALER_DEFAULTS);
});

check("real company names appear only under src/profiles/ (source grep)", () => {
  const src = path.join(root, "src"), profiles = path.join(src, "profiles");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return full === profiles ? [] : walk(full);
    return /\.test\.[cm]?[jt]sx?$/.test(e.name) || e.name === "test-setup.js" ? [] : [full];
  });
  const offenders = [];
  for (const file of walk(src)) {
    const text = fs.readFileSync(file, "utf8").toLowerCase();
    for (const name of ["Sunlight", "Pink Energy", "Cross River"]) if (text.includes(name.toLowerCase())) offenders.push(`${path.relative(root, file)}: ${name}`);
  }
  assert.deepEqual(offenders, []);
});

const fmt = (v) => `${(100 * v).toFixed(1)}%`;
const money = (v) => `$${Math.round(v).toLocaleString("en-US")}`;
const red = (r) => `${r.RED} RED, ${r.YELLOW} YELLOW of ${r.rated} rated`;
console.log(`\n${passed} checks passed\n`);
console.log(`SOLAR_PRIME portfolio: ${loans.length.toLocaleString("en-US")} loans at seed ${seed}, dealer effect strength ${settings.dealerEffect.strength} (assumption); ${fmt(loans.filter((l) => l.dpd30).length / loans.length)} 30+ DPD, ${fmt(loans.filter((l) => l.chargedOff).length / loans.length)} charged off`);
console.log(`  Construction check, 30+ DPD by dealer-quality quintile (n ${quintiles.atStrength.n} each): strength ${settings.dealerEffect.strength}: bottom ${fmt(quintiles.atStrength.bottom)} · top ${fmt(quintiles.atStrength.top)}; strength 0: bottom ${fmt(quintiles.noEffect.bottom)} · top ${fmt(quintiles.noEffect.top)}`);
console.log(`  Signal vs noise (minimum ${settings.rating.minLoans} loans): strength ${settings.dealerEffect.strength}: ${red(noise.atStrength)} · strength 0 false flags: ${red(noise.noEffect)}`);
console.log(`  Signal vs noise (no minimum):    strength ${settings.dealerEffect.strength}: ${red(noise.atStrengthNoMinimum)} · strength 0 false flags: ${red(noise.noEffectNoMinimum)}`);
const exposure = sum(loans.map((l) => l.ead));
const largest = rows.reduce((a, b) => (b.loans > a.loans ? b : a));
const failure = simulateDealerFailure({ loans, dealers }, largest.dealerId, settings.dealerFailure);
console.log(`  Scale: mean loan ${money(exposure / loans.length)}, portfolio exposure ${money(exposure)}, baseline expected loss ${money(failure.baselineExpectedLoss)}; failing ${largest.dealer}: advance write-off ${money(failure.advanceWriteOff)}, change in expected loss ${money(failure.deltaExpectedLoss)}`);
const ratings = {};
for (const r of rows) ratings[r.rating] = (ratings[r.rating] ?? 0) + 1;
console.log(`  ratings ${JSON.stringify(ratings)} · alerts: ${portfolioAlerts(rows, settings.alerts).map((a) => a.text).join(" | ")}`);

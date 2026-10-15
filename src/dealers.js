// src/dealers.js — Lender-agnostic dealer (installer) channel engine.
//
// Pure module, no React. Simulates a point-of-sale lender's dealer channel over generated cases:
// a fixed synthetic dealer network, deterministic dealer assignment, a simulated performance
// path per loan, dealer aggregation and ratings, concentration alerts, and a dealer-failure
// loss scenario covering both loss channels (contractor advances and asset-level losses).
//
// Rules:
//   * Every dealer is plainly synthetic: an ID with a city, never a business name.
//   * The lien signal is a simulated public-record signal, not a real filing.
//   * How much dealer quality drives loan outcomes is a set assumption, `dealerEffect.strength`
//     (0 = no effect, 1 = default). Every dealer metric is simulated under that assumption, so
//     a dealer rating shows what the model was told, not evidence about real dealers.
//     `signalVsNoise` reports how many dealers the rating flags at the set strength and at 0.
//   * A dealer is rated by a one-sided binomial test of its 30+ DPD count against the portfolio
//     rate, so a rating only fires when the excess is unlikely to be chance.
//   * The portfolio is the funded book: only applications the credit policy approves become
//     loans (`isFundedLoan`). Declined and review applications are never funded, so they carry
//     no exposure and no loan outcome.
//   * Nothing here is lender-specific. Lender defaults (failure assumptions, portfolio size,
//     disclosed advance amounts) come from a profile's `defaults.dealerView` and override
//     DEALER_DEFAULTS through `dealerSettings`.

import { createRng } from "./utils/prng.js";
import { randomBeta, randomLognormal } from "./utils/distributions.js";
import { assessCredit, caseDti } from "./creditRisk.js";
import { unitHash, loanAmount } from "./loanSizing.js";

export { loanAmount };
import { isFraudCase } from "./ml/decision_features.js";

export const DEALER_DEFAULTS = Object.freeze({
  network: {
    seed: "dealer-network-v1",
    count: 50,
    homeState: "NC",
    // 60% of dealers are in the home state; the home state's share of volume is set separately.
    homeShare: 0.6,
    homeExposureShare: { value: 0.45, status: "assumption" },
    cities: {
      NC: ["Charlotte", "Raleigh", "Greensboro", "Durham", "Wilmington", "Asheville", "Fayetteville"],
      SC: ["Charleston", "Columbia", "Greenville"],
      GA: ["Atlanta", "Savannah", "Augusta"],
      VA: ["Richmond", "Norfolk", "Roanoke"],
      TN: ["Nashville", "Knoxville", "Chattanooga"]
    },
    quality: { alpha: 5, beta: 2 },
    // Zipf-like volume weights within each group, so two or three dealers carry a large share.
    volumeExponent: 1.3,
    totalAdvances: { value: 100_000_000, status: "assumption" },
    advanceNoiseGini: 0.3,
    // Optional amounts for the largest advances, in descending order (a profile may set them).
    topAdvances: null
  },
  // How strongly hidden dealer quality drives loan outcomes: it scales both the quality term of
  // the hazard and the steering of fraud cases toward low-quality dealers. 0 = no dealer effect.
  dealerEffect: { strength: 1, status: "assumption" },
  assignment: {
    // A fraud case's weight at a dealer is multiplied by 1 + factor × strength × (1 − quality).
    fraudLowQualityFactor: 4
  },
  performance: {
    monthsOnBook: 18,
    // Logistic monthly hazard of a 30+ DPD event on true FICO, true back-end DTI, fraud and dealer quality.
    // The intercept is calibrated on 10,000 SOLAR_PRIME cases at seed 42 to roughly 6% 30+ DPD over 18 months.
    intercept: -7.3,
    ficoPer100Below700: 0.9,
    dtiPer10PointsAbove36: 0.35,
    fraud: 1.6,
    qualityPer10PointsBelow70: 0.45,
    chargeOffGivenDpd30: 0.45
  },
  signal: { base: 0.02, lowQualitySlope: 0.6 },
  // One-sided binomial test of each rated dealer's 30+ DPD count against the portfolio rate.
  // RED: p below redAlpha after Bonferroni across rated dealers. YELLOW: p below yellowAlpha, unadjusted.
  rating: {
    minLoans: 30,
    redAlpha: 0.01,
    redCorrection: "bonferroni",
    yellowAlpha: 0.05
  },
  alerts: { cityExposureShare: 0.15, topAdvanceShare: 0.20, stateExposureShare: 0.50 },
  dealerFailure: {
    nonWorkingShare: { value: 0.30, status: "assumption" },
    pdMultiplier: { value: 3, status: "assumption" },
    baseRecovery: { value: 0.15, status: "assumption" }
  },
  // `count` funded loans; applications are generated in seed order until that many are approved.
  portfolio: { count: 10000, seed: 42 },
  // Loan amount (exposure at default). null uses the generated case's application.loan_amount;
  // a profile can set a clipped lognormal: { median, sigma, min, max } with value/status entries.
  loanAmount: null
});

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function merge(base, overrides) {
  const out = { ...base };
  for (const [k, v] of Object.entries(overrides ?? {})) out[k] = isPlainObject(v) && isPlainObject(base[k]) ? merge(base[k], v) : v;
  return out;
}

/** Engine defaults with a profile's `defaults.dealerView` (which may be null) merged on top. */
export function dealerSettings(profileDealerDefaults) {
  return merge(DEALER_DEFAULTS, profileDealerDefaults ?? {});
}

/** The same settings with a different dealer-effect strength. */
export function withDealerEffect(settings, strength) {
  return { ...settings, dealerEffect: { ...settings.dealerEffect, strength } };
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const pad2 = (n) => String(n).padStart(2, "0");
const sum = (xs) => xs.reduce((s, v) => s + v, 0);

/**
 * Distributes `remaining` over dealers in proportion to their simulated advances, with no dealer
 * above `cap` (the smallest fixed top advance), so the fixed amounts stay the largest.
 */
function waterFill(weights, remaining, cap) {
  const out = new Map();
  let pool = [...weights];
  while (pool.length) {
    const total = sum(pool.map((p) => p.weight));
    const over = pool.filter((p) => (remaining * p.weight) / total > cap);
    if (over.length === 0) {
      for (const p of pool) out.set(p.id, (remaining * p.weight) / total);
      break;
    }
    for (const p of over) out.set(p.id, cap);
    remaining -= cap * over.length;
    pool = pool.filter((p) => !over.includes(p));
  }
  return out;
}

/** Synthetic dealers with deterministic IDs, hidden quality, skewed volume and advances. */
export function buildDealerNetwork(network = DEALER_DEFAULTS.network) {
  const rng = createRng(network.seed);
  const otherStates = Object.keys(network.cities).filter((s) => s !== network.homeState);
  const homeCount = Math.round(network.count * network.homeShare);
  const states = [];
  for (let i = 0; i < network.count; i++) states.push(i < homeCount ? network.homeState : otherStates[(i - homeCount) % otherStates.length]);

  // Volume rank is a seeded shuffle, so the largest dealers are not always the first IDs.
  const ranks = Array.from({ length: network.count }, (_, i) => i + 1);
  for (let i = ranks.length - 1; i > 0; i--) {
    const j = Math.floor(rng.random() * (i + 1));
    [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
  }
  const raw = ranks.map((r) => 1 / Math.pow(r, network.volumeExponent));
  // Rescale so the home state's dealers carry exactly the configured share of volume.
  const homeShare = network.homeExposureShare.value;
  const homeRaw = sum(raw.filter((_, i) => states[i] === network.homeState));
  const otherRaw = sum(raw) - homeRaw;
  const weights = raw.map((w, i) => (states[i] === network.homeState ? (w / homeRaw) * homeShare : (w / otherRaw) * (1 - homeShare)));

  const perState = {};
  const drafts = states.map((state, i) => {
    perState[state] = (perState[state] ?? 0) + 1;
    const cities = network.cities[state];
    const city = cities[(perState[state] - 1) % cities.length];
    const id = `${state}-${pad2(perState[state])}`;
    return {
      id,
      name: `Dealer ${id} (${city})`,
      city,
      state,
      quality: randomBeta(network.quality.alpha, network.quality.beta, rng),
      volumeWeight: weights[i],
      advanceWeight: weights[i] * randomLognormal(1, network.advanceNoiseGini, rng)
    };
  });

  const totalAdvances = network.totalAdvances.value;
  const advances = new Map();
  const top = network.topAdvances?.values ?? [];
  const byAdvance = [...drafts].sort((a, b) => b.advanceWeight - a.advanceWeight);
  top.forEach((amount, k) => advances.set(byAdvance[k].id, amount));
  const rest = byAdvance.slice(top.length).map((d) => ({ id: d.id, weight: d.advanceWeight }));
  const remaining = totalAdvances - sum(top);
  if (remaining < 0) throw new Error("topAdvances exceed totalAdvances");
  for (const [id, amount] of waterFill(rest, remaining, top.length ? top[top.length - 1] : Infinity)) advances.set(id, amount);

  return Object.freeze(drafts.map(({ id, name, city, state, quality, volumeWeight }) =>
    Object.freeze({ id, name, city, state, quality, volumeWeight, advanceBalance: Math.round(advances.get(id)) })));
}

export const DEALER_CONFIG = buildDealerNetwork();


/** True when the credit policy approves the application, so it is funded and enters the dealer book. */
export function isFundedLoan(caseObj, profile = undefined) {
  return assessCredit(caseObj, profile).policyDecision === "APPROVE";
}

/** The case facts the dealer simulation needs. Uses world truth: this simulates outcomes, it does not decide. */
export function loanInputs(caseObj, sizing = null, profile = undefined) {
  const truth = caseObj.truth?.current_state ?? {};
  return {
    id: caseObj.id,
    fico: Number.isFinite(truth.credit_score) ? truth.credit_score : null,
    dti: caseDti(caseObj, profile, "truth").dti,
    fraud: isFraudCase(caseObj),
    ead: loanAmount(caseObj, sizing)
  };
}

const asInput = (x) => (x?.truth || x?.meta ? loanInputs(x) : x);

/** Deterministic, hash-based, volume-weighted assignment; fraud cases lean toward low-quality dealers. */
export function assignDealer(caseOrInput, dealers = DEALER_CONFIG, assignment = DEALER_DEFAULTS.assignment, strength = DEALER_DEFAULTS.dealerEffect.strength) {
  const input = asInput(caseOrInput);
  const weights = dealers.map((d) => d.volumeWeight * (input.fraud ? 1 + assignment.fraudLowQualityFactor * strength * (1 - d.quality) : 1));
  const total = sum(weights);
  const u = unitHash(`dealer-assignment-${input.id}`) * total;
  let acc = 0;
  for (let i = 0; i < dealers.length; i++) {
    acc += weights[i];
    if (u < acc) return dealers[i];
  }
  return dealers[dealers.length - 1];
}

/** Monthly hazard of a 30+ DPD event for a loan at a dealer. */
export function monthlyHazard(caseOrInput, dealer, performance = DEALER_DEFAULTS.performance, strength = DEALER_DEFAULTS.dealerEffect.strength) {
  const input = asInput(caseOrInput);
  const fico = input.fico ?? 700;
  const dti = input.dti ?? 0.36;
  const x = performance.intercept
    + performance.ficoPer100Below700 * Math.max(0, 700 - fico) / 100
    + performance.dtiPer10PointsAbove36 * Math.max(0, dti - 0.36) * 10
    + (input.fraud ? performance.fraud : 0)
    + strength * performance.qualityPer10PointsBelow70 * Math.max(0, 0.7 - dealer.quality) * 10;
  return sigmoid(x);
}

/** Simulated 30+ DPD and charge-off over `monthsOnBook`, seeded from the case ID unless an rng is given. */
export function simulatePerformance(caseOrInput, dealer, monthsOnBook = DEALER_DEFAULTS.performance.monthsOnBook, rng, performance = DEALER_DEFAULTS.performance, strength = DEALER_DEFAULTS.dealerEffect.strength) {
  const input = asInput(caseOrInput);
  const r = rng ?? createRng(`dealer-performance-${input.id}`);
  const h = monthlyHazard(input, dealer, performance, strength);
  let dpd30 = false;
  for (let m = 0; m < monthsOnBook && !dpd30; m++) dpd30 = r.random() < h;
  const chargedOff = dpd30 && r.random() < performance.chargeOffGivenDpd30;
  const pd = (1 - Math.pow(1 - h, monthsOnBook)) * performance.chargeOffGivenDpd30;
  return { dpd30, chargedOff, pd };
}

/** Simulated public-record (lien) signal; its probability rises as dealer quality falls. */
export function dealerSignals(dealer, rng, signal = DEALER_DEFAULTS.signal) {
  const r = rng ?? createRng(`dealer-signal-${dealer.id}`);
  const probability = Math.min(1, signal.base + signal.lowQualitySlope * Math.pow(1 - dealer.quality, 2));
  return { lienSignal: r.random() < probability, probability, label: "simulated public-record signal" };
}

/** One loan row: the case inputs plus its dealer, simulated outcome and PD. */
export function simulateLoan(input, dealers = DEALER_CONFIG, settings = DEALER_DEFAULTS) {
  const strength = settings.dealerEffect.strength;
  const dealer = assignDealer(input, dealers, settings.assignment, strength);
  return { ...input, dealerId: dealer.id, ...simulatePerformance(input, dealer, settings.performance.monthsOnBook, undefined, settings.performance, strength) };
}

export function simulateLoans(inputs, dealers = DEALER_CONFIG, settings = DEALER_DEFAULTS) {
  return inputs.map((input) => simulateLoan(input, dealers, settings));
}

export function buildLoan(caseObj, dealers = DEALER_CONFIG, settings = DEALER_DEFAULTS, profile = undefined) {
  return simulateLoan(loanInputs(caseObj, settings.loanAmount, profile), dealers, settings);
}

const expectedLoss = (loans, recoveryOf, pdOf) => loans.reduce((s, l) => s + pdOf(l) * (1 - recoveryOf(l)) * l.ead, 0);

/**
 * Dealer failure: the dealer's whole advance balance is written off, and a share of its borrowers
 * have non-working systems, so their PD rises by a multiplier and their recovery falls to 0.
 * Which borrowers are affected is a deterministic hash of the loan ID.
 */
export function simulateDealerFailure(portfolio, dealerId, params = {}) {
  const { loans, dealers } = portfolio;
  const dealer = dealers.find((d) => d.id === dealerId);
  if (!dealer) throw new Error(`Unknown dealer: ${dealerId}`);
  const p = merge(DEALER_DEFAULTS.dealerFailure, params);
  const share = p.nonWorkingShare.value, mult = p.pdMultiplier.value, baseRecovery = p.baseRecovery.value;
  const affected = new Set(loans.filter((l) => l.dealerId === dealerId && unitHash(`non-working-${l.id}`) < share).map((l) => l.id));
  const baseline = expectedLoss(loans, () => baseRecovery, (l) => l.pd);
  const stressed = expectedLoss(
    loans,
    (l) => (affected.has(l.id) ? 0 : baseRecovery),
    (l) => (affected.has(l.id) ? Math.min(1, l.pd * mult) : l.pd)
  );
  return {
    dealerId,
    advanceWriteOff: dealer.advanceBalance,
    baselineExpectedLoss: baseline,
    stressedExpectedLoss: stressed,
    deltaExpectedLoss: stressed - baseline,
    affectedLoans: affected.size,
    affectedIds: [...affected],
    dealerLoans: loans.filter((l) => l.dealerId === dealerId).length,
    assumptions: p
  };
}

/** log C(n, k), summed term by term (exact enough for portfolio-sized n). */
function logChoose(n, k) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** One-sided binomial p-value: P(X >= k) for X ~ Binomial(n, p). */
export function binomialUpperTail(k, n, p) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  // Start at the k term and walk up with the pmf ratio; the terms fall away fast past the mean.
  let term = Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  let total = term;
  for (let j = k; j < n; j++) {
    term *= ((n - j) / (j + 1)) * (p / (1 - p));
    total += term;
    if (term < total * 1e-16) break;
  }
  return Math.min(1, total);
}

/**
 * Rating for a dealer row: INSUFFICIENT_DATA below the loan minimum; otherwise RED when the
 * dealer's one-sided binomial p-value is below redAlpha / (number of rated dealers), YELLOW
 * when it is below yellowAlpha, GREEN otherwise.
 */
export function rateDealer(row, rating = DEALER_DEFAULTS.rating, { ratedCount = 1 } = {}) {
  if (row.loans < rating.minLoans || row.pValue === null) return "INSUFFICIENT_DATA";
  const redThreshold = rating.redCorrection === "bonferroni" ? rating.redAlpha / Math.max(1, ratedCount) : rating.redAlpha;
  if (row.pValue < redThreshold) return "RED";
  if (row.pValue < rating.yellowAlpha) return "YELLOW";
  return "GREEN";
}

/** One row per dealer over the loans in the portfolio. */
export function aggregateDealers(loans, dealers = DEALER_CONFIG, settings = DEALER_DEFAULTS) {
  const totalExposure = sum(loans.map((l) => l.ead));
  const byDealer = new Map(dealers.map((d) => [d.id, []]));
  for (const l of loans) byDealer.get(l.dealerId)?.push(l);
  const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
  const portfolioRate = loans.length ? loans.filter((l) => l.dpd30).length / loans.length : 0;
  const ratedCount = dealers.filter((d) => byDealer.get(d.id).length >= settings.rating.minLoans).length;
  const rows = dealers.map((d) => {
    const ls = byDealer.get(d.id);
    const exposure = sum(ls.map((l) => l.ead));
    const signal = dealerSignals(d, undefined, settings.signal).lienSignal;
    const dpd30Count = ls.filter((l) => l.dpd30).length;
    return {
      dealerId: d.id,
      dealer: d.name,
      city: d.city,
      state: d.state,
      quality: d.quality,
      loans: ls.length,
      avgFico: mean(ls.map((l) => l.fico).filter(Number.isFinite)),
      avgDti: mean(ls.map((l) => l.dti).filter(Number.isFinite)),
      dpd30Count,
      dpd30Rate: ls.length ? dpd30Count / ls.length : 0,
      chargeOffRate: ls.length ? ls.filter((l) => l.chargedOff).length / ls.length : 0,
      exposure,
      exposureShare: totalExposure > 0 ? exposure / totalExposure : 0,
      advanceBalance: d.advanceBalance,
      signal,
      pValue: ls.length >= settings.rating.minLoans ? binomialUpperTail(dpd30Count, ls.length, portfolioRate) : null,
      portfolioDpd30Rate: portfolioRate
    };
  });
  return rows.map((row) => ({ ...row, rating: rateDealer(row, settings.rating, { ratedCount }) }));
}

/** Rating counts for a portfolio simulated at a given dealer-effect strength and loan minimum. */
export function ratingCounts(inputs, dealers, settings, { strength, minLoans }) {
  const s = withDealerEffect(settings, strength);
  const rows = aggregateDealers(simulateLoans(inputs, dealers, s), dealers, { ...s, rating: { ...s.rating, minLoans } });
  const counts = { RED: 0, YELLOW: 0, GREEN: 0, INSUFFICIENT_DATA: 0 };
  for (const r of rows) counts[r.rating]++;
  return { strength, minLoans, ...counts, rated: rows.length - counts.INSUFFICIENT_DATA };
}

/**
 * Signal vs noise: how many dealers the rating flags RED when dealer quality drives outcomes at
 * the set strength, and how many it flags when quality has no effect at all (strength 0), where
 * every RED is a false flag produced by chance and borrower mix. Both with and without the
 * minimum-loans rule.
 */
export function signalVsNoise(inputs, dealers, settings) {
  const strength = settings.dealerEffect.strength;
  const minLoans = settings.rating.minLoans;
  return {
    atStrength: ratingCounts(inputs, dealers, settings, { strength, minLoans }),
    atStrengthNoMinimum: ratingCounts(inputs, dealers, settings, { strength, minLoans: 0 }),
    noEffect: ratingCounts(inputs, dealers, settings, { strength: 0, minLoans }),
    noEffectNoMinimum: ratingCounts(inputs, dealers, settings, { strength: 0, minLoans: 0 })
  };
}

const pct = (v) => `${Math.round(v * 100)}%`;

/** Concentration alerts computed from dealer rows. Each alert carries the value it states. */
export function portfolioAlerts(rows, alerts = DEALER_DEFAULTS.alerts) {
  const out = [];
  const total = sum(rows.map((r) => r.exposure));
  if (total <= 0) return out;

  const groupBy = (key) => {
    const m = new Map();
    for (const r of rows) {
      const g = m.get(r[key]) ?? { exposure: 0, dealers: 0 };
      g.exposure += r.exposure;
      if (r.exposure > 0) g.dealers += 1;
      m.set(r[key], g);
    }
    return m;
  };

  for (const [city, g] of groupBy("city")) {
    const share = g.exposure / total;
    if (share > alerts.cityExposureShare) out.push({ kind: "CITY_CONCENTRATION", subject: city, value: share, dealers: g.dealers, text: `${city}: ${pct(share)} of loan exposure in ${g.dealers} dealer${g.dealers === 1 ? "" : "s"}` });
  }
  const totalAdvances = sum(rows.map((r) => r.advanceBalance));
  const top = rows.reduce((a, b) => (b.advanceBalance > a.advanceBalance ? b : a), rows[0]);
  const topShare = totalAdvances > 0 ? top.advanceBalance / totalAdvances : 0;
  if (topShare > alerts.topAdvanceShare) out.push({ kind: "TOP_ADVANCE", subject: top.dealer, value: topShare, text: `Top dealer advance = ${pct(topShare)} of all advances (${top.dealer})` });
  for (const [state, g] of groupBy("state")) {
    const share = g.exposure / total;
    if (share > alerts.stateExposureShare) out.push({ kind: "STATE_CONCENTRATION", subject: state, value: share, text: `${state}: ${pct(share)} of loan exposure` });
  }
  return out.sort((a, b) => b.value - a.value);
}

// src/ratePaths.js — Lender-agnostic rate paths over the holding period.
//
// Pure module, no React. The single-shock model in fundingStress.js moves the investor yield once
// between approval and sale. Here the yield follows a path while the loan waits to be sold, and
// the holding time itself is uncertain: the expected fee at sale is Σ p(t) × feeAtSale(path(t))
// over holding days t. platformFee is called unchanged; nothing here alters it or its defaults.
//
// Historical windows use daily 10-year Treasury yields: each start date's change over the next
// 30, 60 or 90 calendar days. The daily series arrives with missing days already filled with the
// last prior observation (flagged), never interpolated; a window ending on a weekend or holiday
// reads the last observation on or before its end date.

import { platformFee } from "./fundingStress.js";

export const RATE_PATH_DEFAULTS = Object.freeze({
  holding: Object.freeze({ min: 30, mode: 60, max: 90, status: "assumption", note: "Days from credit approval to loan sale: triangular, 30 to 90 days, most likely 60." }),
  horizons: Object.freeze([30, 60, 90]),
  rampDays: 60
});

/**
 * Triangular holding-time distribution over whole days min..max, weights proportional to the
 * triangular density at each day and normalised to sum to 1. A degenerate range is one day.
 */
export function triangularHolding({ min, mode, max }) {
  if (!(min <= mode && mode <= max)) throw new Error("holding needs min ≤ mode ≤ max");
  if (min === max) return [{ days: min, p: 1 }];
  const density = (t) => (t <= mode ? (mode === min ? 1 : (t - min) / (mode - min)) : (max === mode ? 1 : (max - t) / (max - mode)));
  const days = [];
  for (let t = Math.ceil(min); t <= Math.floor(max); t++) days.push({ days: t, w: Math.max(0, density(t)) });
  const total = days.reduce((s, d) => s + d.w, 0);
  return days.filter((d) => d.w > 0).map((d) => ({ days: d.days, p: d.w / total }));
}

/** A constant path: the yield never moves. */
export const flatPath = () => () => 0;

/** A straight-line move of `totalBps` over `overDays`, then held at `totalBps`. */
export function linearPath(totalBps, overDays = RATE_PATH_DEFAULTS.rampDays) {
  return (t) => totalBps * Math.min(1, Math.max(0, t) / overDays);
}

/** feeAtSale per $100 as a function of the shock in bps, memoised on the shock. */
export function feeAtSaleFn(feeParams) {
  const cache = new Map();
  return (bps) => {
    if (!cache.has(bps)) cache.set(bps, platformFee({ ...feeParams, rateShockBps: bps }).feeAtSale);
    return cache.get(bps);
  };
}

/**
 * Expected platform fee per $100 when the yield follows `path` (days → shock in bps) and the sale
 * happens after `holding` days ([{ days, p }]). `feeAtSale` may be passed to share a memo.
 */
export function pathFee(feeParams, path, holding, feeAtSale = feeAtSaleFn(feeParams)) {
  let expectedFeeAtSale = 0, expectedShockBps = 0;
  for (const { days, p } of holding) {
    const bps = path(days);
    expectedFeeAtSale += p * feeAtSale(bps);
    expectedShockBps += p * bps;
  }
  const feeAtApproval = feeAtSale(0);
  return { expectedFeeAtSale, feeAtApproval, expectedChange: expectedFeeAtSale - feeAtApproval, expectedShockBps };
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The observation on or before `date` (the series is sorted by date), or null before the first. */
function valueOnOrBefore(observations, date) {
  let lo = 0, hi = observations.length - 1, found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (observations[mid].date <= date) { found = observations[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** Yield change in bps from `start` to `days` calendar days later; null past the end of the data. */
export function historicalPath(observations, start) {
  const s = valueOnOrBefore(observations, start.date);
  const last = observations.at(-1).date;
  return (t) => {
    const end = addDays(start.date, Math.round(t));
    if (end > last) return null;
    return Math.round((valueOnOrBefore(observations, end).value - s.value) * 10000) / 100;
  };
}

/**
 * Start dates for historical windows: every business day in `year` with its own observation. Days
 * the series fills from an earlier date (market holidays) are not starts.
 */
export function windowStarts(observations, year) {
  return observations.filter((o) => o.date.startsWith(`${year}-`) && !o.carriedFrom);
}

/** Nearest-rank quantile of a list of numbers (q in 0..1). */
export function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

/**
 * Historical windows from each start date in `year`: for every fixed horizon the yield changes, the
 * fee at sale after that many days, and their P50 and P95 (P95 of the rise, so the fee at the
 * 95th-worst percent of start dates); plus the holding-weighted expected fee per start date.
 */
export function historicalWindows(observations, year, feeParams, { horizons = RATE_PATH_DEFAULTS.horizons, holding = triangularHolding(RATE_PATH_DEFAULTS.holding) } = {}) {
  const feeAtSale = feeAtSaleFn(feeParams);
  const starts = windowStarts(observations, year);
  const fixed = horizons.map((days) => {
    const changes = starts.map((s) => ({ start: s.date, bps: historicalPath(observations, s)(days) })).filter((c) => c.bps !== null);
    const bps = changes.map((c) => c.bps);
    const fees = bps.map(feeAtSale);
    const p50 = quantile(bps, 0.5), p95 = quantile(bps, 0.95);
    return {
      days,
      windows: changes.length,
      p50Bps: p50,
      p95Bps: p95,
      maxBps: bps.length ? Math.max(...bps) : null,
      feeAtP50: p50 === null ? null : feeAtSale(p50),
      feeAtP95: p95 === null ? null : feeAtSale(p95),
      negativeShare: fees.length ? fees.filter((f) => f < 0).length / fees.length : null
    };
  });
  const weightedFees = starts
    .map((s) => {
      const path = historicalPath(observations, s);
      return holding.every((h) => path(h.days) !== null) ? pathFee(feeParams, path, holding, feeAtSale).expectedFeeAtSale : null;
    })
    .filter((f) => f !== null);
  const weighted = {
    windows: weightedFees.length,
    // Lower fees are worse, so the P95 loss is the 5th percentile of the fee.
    feeP50: quantile(weightedFees, 0.5),
    feeP95: quantile(weightedFees, 0.05),
    negativeShare: weightedFees.length ? weightedFees.filter((f) => f < 0).length / weightedFees.length : null
  };
  return { year, starts: starts.length, firstStart: starts[0]?.date ?? null, lastStart: starts.at(-1)?.date ?? null, holidaysSkipped: observations.filter((o) => o.date.startsWith(`${year}-`) && o.carriedFrom).length, fixed, weighted, feeAtApproval: feeAtSale(0) };
}

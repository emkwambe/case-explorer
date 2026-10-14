// src/profiles/sunlight/publicRecord.js — Analyses over the pinned public-record snapshot.
//
// Pure module, no React. Reads the quarterly table built by scripts/fetch-public-record.mjs
// (SEC XBRL, FRED and hand extractions). Nothing is estimated: a missing input gives
// "insufficient data". The only arithmetic on filed figures is the approved quarter derivation
// done at build time, and the trailing-twelve-month sums here, which never cross the July 2021
// Predecessor/Successor break and never use the third-quarter 2021 stubs.

export const QUARTER_ORDER = ["2021Q1", "2021Q2", "2021Q3", "2021Q4", "2022Q1", "2022Q2", "2022Q3", "2022Q4", "2023Q1", "2023Q2"];
const PREDECESSOR_QUARTERS = new Set(["2021Q1", "2021Q2"]);
export const INSUFFICIENT = "insufficient data";

const metricOf = (row, name) => {
  const m = row?.metrics?.[name];
  return m && !m.stubs && Number.isFinite(m.value) ? m : null;
};

/** Pearson correlation of paired values; null below three pairs or with no variance. */
export function pearson(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n, my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

/** Take rate (platform fees ÷ funded volume) by quarter, the rate averages, and their correlation. */
export function unitEconomics(rows) {
  const quarters = rows.map((row) => {
    const volume = metricOf(row, "funded_volume");
    const fees = metricOf(row, "platform_fees");
    const sameUnit = volume && fees && volume.unit === fees.unit;
    return {
      quarter: row.quarter,
      fundedVolume: volume,
      platformFees: fees,
      takeRate: sameUnit && volume.value !== 0 ? { value: fees.value / volume.value, inputs: [fees, volume] } : null,
      fedFunds: metricOf(row, "DFF"),
      tenYear: metricOf(row, "DGS10"),
      stubs: row.metrics?.funded_volume?.stubs || row.metrics?.platform_fees?.stubs ? true : false
    };
  });
  const pairs = quarters.filter((q) => q.takeRate && q.fedFunds).map((q) => [q.takeRate.value, q.fedFunds.value]);
  return {
    quarters,
    correlation: { value: pearson(pairs), n: pairs.length, label: "Descriptive, not causal: a correlation across quarters does not show that rates drove the take rate." }
  };
}

/**
 * Sum of four consecutive discrete quarters ending at `index`, or a reason it cannot be formed:
 * a missing quarter, a window that includes the third-quarter 2021 stubs, or one that crosses
 * the Predecessor/Successor break.
 */
export function trailingFour(rows, index, metric) {
  if (index < 3) return { value: null, reason: "fewer than four quarters available" };
  const window = rows.slice(index - 3, index + 1);
  if (window.some((r) => r.quarter === "2021Q3")) return { value: null, reason: "window includes the Q3 2021 Predecessor/Successor stubs" };
  const pred = window.filter((r) => PREDECESSOR_QUARTERS.has(r.quarter)).length;
  if (pred > 0 && pred < window.length) return { value: null, reason: "window crosses the July 2021 Predecessor/Successor break" };
  const parts = window.map((r) => metricOf(r, metric));
  const missing = window.filter((_, i) => !parts[i]).map((r) => r.quarter);
  if (missing.length) return { value: null, reason: `${metric} missing for ${missing.join(", ")}` };
  return { value: parts.reduce((s, m) => s + m.value, 0), inputs: parts, quarters: window.map((r) => r.quarter) };
}

/** Cash, TTM operating cash flow, burn per month and runway by quarter. */
export function liquidityRunway(rows) {
  return rows.map((row, i) => {
    const cash = metricOf(row, "cash");
    const ttm = trailingFour(rows, i, "operatingCashFlow");
    const base = { quarter: row.quarter, cash, ttmOperatingCashFlow: ttm.value === null ? null : ttm };
    if (!cash) return { ...base, status: INSUFFICIENT, reason: "no cash balance at quarter end", burnPerMonth: null, runwayMonths: null };
    if (ttm.value === null) return { ...base, status: INSUFFICIENT, reason: `TTM operating cash flow unavailable: ${ttm.reason}`, burnPerMonth: null, runwayMonths: null };
    if (ttm.value >= 0) return { ...base, status: "not burning", reason: "TTM operating cash flow is not negative", burnPerMonth: null, runwayMonths: null };
    const burnPerMonth = -ttm.value / 12;
    return { ...base, status: "ok", burnPerMonth, runwayMonths: cash.value / burnPerMonth };
  });
}

export const Z_WEIGHTS = Object.freeze({ x1: 6.56, x2: 3.26, x3: 6.72, x4: 1.05 });
export const Z_ZONES = Object.freeze({ safeAbove: 2.6, distressBelow: 1.1 });

export function zZone(z) {
  if (z > Z_ZONES.safeAbove) return "safe";
  if (z < Z_ZONES.distressBelow) return "distress";
  return "grey";
}

/** Altman Z″ from its inputs, with each component and its contribution. */
export function zDoublePrime({ workingCapital, totalAssets, retainedEarnings, ebitTtm, bookEquity, totalLiabilities }) {
  const x1 = workingCapital / totalAssets, x2 = retainedEarnings / totalAssets, x3 = ebitTtm / totalAssets, x4 = bookEquity / totalLiabilities;
  const components = {
    x1: { label: "Working capital ÷ total assets", value: x1, weight: Z_WEIGHTS.x1, contribution: Z_WEIGHTS.x1 * x1 },
    x2: { label: "Retained earnings ÷ total assets", value: x2, weight: Z_WEIGHTS.x2, contribution: Z_WEIGHTS.x2 * x2 },
    x3: { label: "TTM EBIT ÷ total assets", value: x3, weight: Z_WEIGHTS.x3, contribution: Z_WEIGHTS.x3 * x3 },
    x4: { label: "Book equity ÷ total liabilities", value: x4, weight: Z_WEIGHTS.x4, contribution: Z_WEIGHTS.x4 * x4 }
  };
  const z = Object.values(components).reduce((s, c) => s + c.contribution, 0);
  return { z, zone: zZone(z), components };
}

/** Quarterly Z″ (EBIT = operating income), or the inputs that are missing. */
export function altmanZDoublePrime(rows) {
  return rows.map((row, i) => {
    const need = { currentAssets: metricOf(row, "currentAssets"), currentLiabilities: metricOf(row, "currentLiabilities"), totalAssets: metricOf(row, "totalAssets"), retainedEarnings: metricOf(row, "retainedEarnings"), equity: metricOf(row, "equity"), totalLiabilities: metricOf(row, "totalLiabilities") };
    const ebit = trailingFour(rows, i, "operatingIncome");
    const missing = Object.entries(need).filter(([, v]) => !v).map(([k]) => k);
    if (ebit.value === null) missing.push(`TTM EBIT (${ebit.reason})`);
    if (missing.length) return { quarter: row.quarter, status: INSUFFICIENT, missing, z: null, zone: null };
    return {
      quarter: row.quarter,
      status: "ok",
      ...zDoublePrime({
        workingCapital: need.currentAssets.value - need.currentLiabilities.value,
        totalAssets: need.totalAssets.value,
        retainedEarnings: need.retainedEarnings.value,
        ebitTtm: ebit.value,
        bookEquity: need.equity.value,
        totalLiabilities: need.totalLiabilities.value
      }),
      inputs: { ...need, ebitTtm: ebit }
    };
  });
}

/** First quarter in the distress zone, or null. */
export function firstDistressQuarter(scores) {
  return scores.find((s) => s.zone === "distress")?.quarter ?? null;
}

const quarterEndMonthIndex = (code) => Number(code.slice(0, 4)) * 12 + Number(code.slice(5)) * 3;

/** One sentence stating what the backtest found, whatever it is. */
export function backtestSentence(scores, chapter11 = { date: "2023-10-30", label: "the October 30, 2023 Chapter 11 filing" }) {
  const scored = scores.filter((s) => s.status === "ok");
  if (scored.length === 0) {
    return `Z″ could not be computed for any quarter from the public data, so the backtest cannot say whether the score warned before ${chapter11.label}.`;
  }
  const first = firstDistressQuarter(scores);
  if (!first) {
    return `Z″ was computed for ${scored.length} of ${scores.length} quarters and never entered the distress zone (below ${Z_ZONES.distressBelow}) before ${chapter11.label}.`;
  }
  const [y, m] = chapter11.date.split("-").map(Number);
  const filingQuarterEnd = y * 12 + Math.ceil(m / 3) * 3;
  const quartersBefore = (filingQuarterEnd - quarterEndMonthIndex(first)) / 3;
  return `Z″ first entered the distress zone in Q${first.slice(5)} ${first.slice(0, 4)}, ${quartersBefore} quarter${quartersBefore === 1 ? "" : "s"} before the quarter of ${chapter11.label} (computed for ${scored.length} of ${scores.length} quarters).`;
}

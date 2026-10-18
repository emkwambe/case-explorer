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

/** A ratio of two filed balances with its inputs, or why it cannot be formed. Never estimated. */
function balanceRatio(num, den, numName, denName) {
  if (!num || !den) return { value: null, status: INSUFFICIENT, reason: `${[!num && numName, !den && denName].filter(Boolean).join(" and ")} not filed for the quarter` };
  if (num.unit !== den.unit) return { value: null, status: INSUFFICIENT, reason: `${numName} and ${denName} are in different units` };
  if (den.value === 0) return { value: null, status: INSUFFICIENT, reason: `${denName} is zero` };
  return { value: num.value / den.value, status: "ok", inputs: [num, den] };
}

/**
 * Leverage and liquidity by quarter: total liabilities ÷ total assets, cash ÷ total liabilities, and
 * cash ÷ the quarter's operating outflow (quarters of outflow the cash covers). A quarter whose
 * operating cash flow is not negative is "not burning"; one filed only as Predecessor and Successor
 * stubs is insufficient data, because the stubs are never combined.
 */
export function leverageLiquidity(rows) {
  return rows.map((row) => {
    const cash = metricOf(row, "cash"), liabilities = metricOf(row, "totalLiabilities"), assets = metricOf(row, "totalAssets");
    const ocf = metricOf(row, "operatingCashFlow");
    let cashToOutflow;
    if (!cash) cashToOutflow = { value: null, status: INSUFFICIENT, reason: "cash not filed for the quarter" };
    else if (row.metrics?.operatingCashFlow?.stubs) cashToOutflow = { value: null, status: INSUFFICIENT, reason: "operating cash flow filed only as Predecessor and Successor stubs, which are not combined" };
    else if (!ocf) cashToOutflow = { value: null, status: INSUFFICIENT, reason: "operating cash flow not available for the quarter" };
    else if (ocf.value >= 0) cashToOutflow = { value: null, status: "not burning", reason: "operating cash flow for the quarter is not negative" };
    else if (cash.unit !== ocf.unit) cashToOutflow = { value: null, status: INSUFFICIENT, reason: "cash and operating cash flow are in different units" };
    else cashToOutflow = { value: cash.value / -ocf.value, status: "ok", inputs: [cash, ocf] };
    return {
      quarter: row.quarter,
      liabilitiesToAssets: balanceRatio(liabilities, assets, "total liabilities", "total assets"),
      cashToLiabilities: balanceRatio(cash, liabilities, "cash", "total liabilities"),
      cashToOutflow
    };
  });
}

export const LEVERAGE_RATIOS = Object.freeze([
  { key: "liabilitiesToAssets", label: "Total liabilities ÷ total assets", computed: "total liabilities ÷ total assets at quarter end" },
  { key: "cashToLiabilities", label: "Cash ÷ total liabilities", computed: "cash and cash equivalents ÷ total liabilities at quarter end" },
  { key: "cashToOutflow", label: "Cash ÷ quarterly operating outflow", computed: "cash at quarter end ÷ −operating cash flow for the quarter" }
]);

/** Every ratio and quarter that could not be computed, with the reason. */
export function leverageGaps(results) {
  return results.flatMap((r) => LEVERAGE_RATIOS.filter((d) => r[d.key].value === null).map((d) => ({ quarter: r.quarter, ratio: d.label, status: r[d.key].status, reason: r[d.key].reason })));
}

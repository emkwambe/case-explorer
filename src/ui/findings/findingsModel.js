// src/ui/findings/findingsModel.js — Figures for the Findings tab, each computed by the module that
// owns it: the public-record analyses that travel with the snapshot, breakEvenShockBps from
// src/fundingStress.js at the profile's Funding & Rates defaults, and the dealer functions in
// src/dealers.js over the shared funded portfolio. No figure is typed in here.

import { breakEvenShockBps } from "../../fundingStress.js";
import { aggregateDealers, simulateDealerFailure, simulateLoans, withDealerEffect } from "../../dealers.js";

const MONTH_MS = (365.25 / 12) * 86_400_000;

/** ISO date of a quarter's last day, for example "2022Q4" is "2022-12-31". */
export function quarterEndIso(code) {
  const y = Number(code.slice(0, 4)), q = Number(code.slice(5));
  return new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10);
}

/** Pricing inputs from a profile's fundingRates defaults, in the shape breakEvenShockBps takes. */
export function feeParamsFromDefaults(d) {
  return { dealerFeePct: d.dealerFeePct.value, coupon: d.coupon.value, termYears: d.termYears.value, yieldAtApproval: d.investorYieldAtApproval.value, cpr: d.cpr.value };
}

/** Finding 1: take rate against fed funds, their correlation, and the break-even rate shock. */
export function pricingLagFigures(record, fundingDefaults) {
  const ue = record.analyses.unitEconomics(record.quarterly.quarters);
  const withRate = ue.quarters.filter((q) => q.takeRate);
  const feeParams = fundingDefaults ? feeParamsFromDefaults(fundingDefaults) : null;
  return {
    quarters: ue.quarters,
    correlation: ue.correlation,
    firstTakeRate: withRate[0] ?? null,
    lastTakeRate: withRate.at(-1) ?? null,
    feeParams,
    breakEvenBps: feeParams ? breakEvenShockBps(feeParams) : null
  };
}

/** Finding 2: dealer rows, the largest-advance dealer, the RED dealers and the failure scenario. */
export function concentrationFigures({ inputs, dealers, settings }) {
  const s = withDealerEffect(settings, settings.dealerEffect.strength);
  const loans = simulateLoans(inputs, dealers, s);
  const rows = aggregateDealers(loans, dealers, s);
  const totalAdvances = rows.reduce((t, r) => t + r.advanceBalance, 0);
  const largest = rows.reduce((a, b) => (b.advanceBalance > a.advanceBalance ? b : a));
  const red = rows.filter((r) => r.rating === "RED").sort((a, b) => a.pValue - b.pValue);
  return {
    loans: loans.length,
    strength: s.dealerEffect.strength,
    portfolioRate: rows[0]?.portfolioDpd30Rate ?? 0,
    ratedCount: rows.filter((r) => r.rating !== "INSUFFICIENT_DATA").length,
    rows,
    largest,
    totalAdvances,
    largestAdvanceShare: totalAdvances > 0 ? largest.advanceBalance / totalAdvances : 0,
    red,
    failure: simulateDealerFailure({ loans, dealers }, largest.dealerId, s.dealerFailure)
  };
}

/**
 * Finding 3: runway by quarter, the last quarter with a computable runway, the quarters after it,
 * and the months from that quarter's end to the named event.
 */
export function runwayFigures(record, eventId) {
  const runway = record.analyses.liquidityRunway(record.quarterly.quarters);
  const okRows = runway.filter((r) => r.status === "ok");
  const last = okRows.at(-1) ?? null;
  const event = record.events.find((e) => e.id === eventId) ?? null;
  const asOf = last ? quarterEndIso(last.quarter) : null;
  return {
    runway,
    last,
    asOf,
    later: last ? runway.slice(runway.indexOf(last) + 1) : [],
    event,
    monthsToEvent: last && event ? (Date.parse(event.date) - Date.parse(asOf)) / MONTH_MS : null
  };
}

/** Data-section counts from the snapshot. */
export function dataFigures(record) {
  const { eda, gaps, reconciliation } = record.quarterly;
  return {
    quarters: record.quarterly.quarters.length,
    firstQuarter: record.quarterly.quarters[0]?.quarter ?? null,
    lastQuarter: record.quarterly.quarters.at(-1)?.quarter ?? null,
    xbrlFilings: eda.xbrl.filings.length,
    manualRows: eda.manual.rows,
    manualDocuments: eda.manual.documents,
    gaps: gaps.length + record.declaredGaps.length,
    reconciliationChecks: reconciliation.length,
    reconciliationMatches: reconciliation.filter((r) => r.status === "match").length
  };
}

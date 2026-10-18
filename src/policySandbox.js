// src/policySandbox.js — Lender-agnostic policy sandbox engine.
//
// Pure module, no React. Scores one fixed pool of applications under a baseline credit policy and
// a candidate policy and reports the swap set: who is funded under both, who swaps in, who swaps
// out, and what that does to volume, presented credit quality and expected loss.
//
// Rules:
//   * The pool is the applications the baseline needed to fund its book, in generation order. Each
//     record keeps only the presented fields the credit policy reads, the policy-independent
//     fraud-review flag, and the world-truth loan inputs the dealer simulation reads.
//   * `decide` reproduces assessCredit's decision on those fields; a parity test holds it to that.
//   * Funded means credit-policy APPROVE. REVIEW counts as not funded, matching the baseline book,
//     so a swap-in is not funded (DECLINE or REVIEW) → funded and a swap-out the reverse.
//   * Dealer, PD and outcome come from simulateLoan on the loan inputs, seeded by application ID,
//     so the baseline-funded subset re-simulates to the existing book exactly.
//   * Swap-in performance is never observed by a real lender. "Synthetic truth" uses the model PD;
//     "conservative inferred" multiplies swap-in PDs by a labelled assumption.

import { assessCredit, CREDIT_POLICY } from "./creditRisk.js";
import { loanInputs, simulateLoans } from "./dealers.js";

export const SANDBOX_DEFAULTS = Object.freeze({
  inferredMultiplier: Object.freeze({ value: 1.5, status: "assumption", note: "Swap-in PD × this multiplier: a conservative adjustment for performance a lender cannot observe." }),
  topDealers: 10
});

/** Editable ranges for the candidate policy. DTI watch runs from its minimum up to the decline cap. */
export const CANDIDATE_RANGES = Object.freeze({
  ficoDecline: { min: 600, max: 720, step: 5 },
  dtiDecline: { min: 0.35, max: 0.55, step: 0.01 },
  dtiWatchLow: { min: 0.30, step: 0.01 },
  liquidityCheckingMin: { min: 0, max: 5000, step: 250 },
  liquidityDtiMin: { min: 0.30, max: 0.55, step: 0.01 }
});

export const POLICY_PRESETS = Object.freeze([
  { id: "fico680", label: "Tighten FICO to 680", changes: { ficoDecline: 680 } },
  { id: "dti50", label: "Loosen DTI cap and watch to 50%", changes: { dtiDecline: 0.50, dtiWatchLow: 0.50 } },
  { id: "dti40", label: "Tighten DTI cap to 40%", changes: { dtiDecline: 0.40 } },
  { id: "watch33", label: "Tighten DTI watch to 33%", changes: { dtiWatchLow: 0.33 } },
  { id: "reset", label: "Reset", changes: {} }
]);

/** The candidate policy a preset produces from the baseline. */
export function applyPreset(preset, baseline = CREDIT_POLICY) {
  return { ...baseline, ...preset.changes };
}

/** One pool record for an application: the fields `decide` and the dealer simulation read. */
export function poolRecord(caseObj, profile, sizing = null) {
  const a = assessCredit(caseObj, profile);
  return {
    id: caseObj.id,
    fico: a.fico,
    dti: a.dti,
    checking: a.checking,
    fraudReview: a.fraudFlag === "REVIEW",
    loanInputs: loanInputs(caseObj, sizing, profile)
  };
}

/** assessCredit's policy decision on a pool record's cached fields. */
export function decide(app, policy = CREDIT_POLICY) {
  const lowFico = app.fico !== null && app.fico < policy.ficoDecline;
  const highDti = app.dti !== null && app.dti > policy.dtiDecline;
  if (lowFico || highDti) return "DECLINE";
  const watch = app.dti !== null && app.dti >= policy.dtiWatchLow;
  const liquidity = app.checking !== null && app.checking < policy.liquidityCheckingMin && app.dti !== null && app.dti > policy.liquidityDtiMin;
  return app.fraudReview || liquidity || watch ? "REVIEW" : "APPROVE";
}

/**
 * Simulated loan rows for every pool application, aligned with the pool: dealer, PD and outcome
 * from the dealer simulation. Depends only on the dealer settings, so a caller can compute it once
 * per settings change and re-filter it for every policy.
 */
export function simulatePool(pool, dealers, settings) {
  return simulateLoans(pool.map((a) => a.loanInputs), dealers, settings);
}

export const CELLS = Object.freeze(["keep", "swapOut", "swapIn", "neither"]);
export const CELL_LABELS = Object.freeze({
  keep: "Funded under both",
  swapOut: "Swap-out: funded → not funded",
  swapIn: "Swap-in: not funded → funded",
  neither: "Not funded under either"
});

const cellOf = (fundedA, fundedB) => (fundedA ? (fundedB ? "keep" : "swapOut") : (fundedB ? "swapIn" : "neither"));
const mean = (s, n) => (n ? s / n : null);

function emptyCell() {
  return { count: 0, reviewA: 0, reviewB: 0, sumFico: 0, nFico: 0, sumDti: 0, nDti: 0, ead: 0, sumPd: 0, expectedLoss: 0, expectedLossInferred: 0 };
}

function finishCell(c, poolSize) {
  return {
    count: c.count,
    share: poolSize ? c.count / poolSize : 0,
    reviewA: c.reviewA,
    reviewB: c.reviewB,
    avgFico: mean(c.sumFico, c.nFico),
    avgDti: mean(c.sumDti, c.nDti),
    ead: c.ead,
    avgPd: mean(c.sumPd, c.count),
    expectedLoss: c.expectedLoss,
    expectedLossInferred: c.expectedLossInferred
  };
}

function emptyTotals() {
  return { funded: 0, volume: 0, sumFico: 0, nFico: 0, expectedLoss: 0, expectedLossInferred: 0 };
}

function finishTotals(t, poolSize) {
  return {
    funded: t.funded,
    approvalRate: poolSize ? t.funded / poolSize : 0,
    volume: t.volume,
    avgFico: mean(t.sumFico, t.nFico),
    expectedLoss: t.expectedLoss,
    expectedLossInferred: t.expectedLossInferred,
    expectedLossRate: t.volume ? t.expectedLoss / t.volume : null,
    expectedLossRateInferred: t.volume ? t.expectedLossInferred / t.volume : null
  };
}

/**
 * Swap set of policy B against policy A over the pool. `loans` are simulatePool's rows (aligned with
 * the pool); `lgd` is 1 − recovery. Returns the four cells, each policy's totals (both risk views;
 * the inferred view changes only swap-in PDs, so it equals the synthetic truth for policy A), the
 * decision moves between review and decline that change no funding, and the dealer mix: the
 * `topDealers` dealers with the largest baseline funded volume, plus all other dealers together.
 */
export function swapSet(pool, policyA, policyB, { loans, lgd, inferredMultiplier = SANDBOX_DEFAULTS.inferredMultiplier.value, topDealers = SANDBOX_DEFAULTS.topDealers, dealers = [] }) {
  if (loans.length !== pool.length) throw new Error("loans must be aligned with the pool");
  const cells = Object.fromEntries(CELLS.map((k) => [k, emptyCell()]));
  const totals = { A: emptyTotals(), B: emptyTotals() };
  const byDealer = new Map();
  const dealerRow = (id) => {
    if (!byDealer.has(id)) byDealer.set(id, { dealerId: id, A: { funded: 0, volume: 0, expectedLoss: 0 }, B: { funded: 0, volume: 0, expectedLoss: 0, expectedLossInferred: 0 } });
    return byDealer.get(id);
  };
  const moves = {};
  let unchangedFundingMoves = 0;

  for (let i = 0; i < pool.length; i++) {
    const app = pool[i], loan = loans[i];
    const dA = decide(app, policyA), dB = decide(app, policyB);
    const fundedA = dA === "APPROVE", fundedB = dB === "APPROVE";
    const key = cellOf(fundedA, fundedB);
    const pdInferred = key === "swapIn" ? Math.min(1, loan.pd * inferredMultiplier) : loan.pd;
    const el = loan.pd * lgd * loan.ead, elInferred = pdInferred * lgd * loan.ead;

    const c = cells[key];
    c.count++;
    if (dA === "REVIEW") c.reviewA++;
    if (dB === "REVIEW") c.reviewB++;
    if (app.fico !== null) { c.sumFico += app.fico; c.nFico++; }
    if (app.dti !== null) { c.sumDti += app.dti; c.nDti++; }
    c.ead += loan.ead;
    c.sumPd += loan.pd;
    c.expectedLoss += el;
    c.expectedLossInferred += elInferred;

    if (dA !== dB) {
      const move = `${dA}->${dB}`;
      moves[move] = (moves[move] ?? 0) + 1;
      if (fundedA === fundedB) unchangedFundingMoves++;
    }
    for (const [side, funded] of [["A", fundedA], ["B", fundedB]]) {
      if (!funded) continue;
      const t = totals[side];
      t.funded++;
      t.volume += loan.ead;
      if (app.fico !== null) { t.sumFico += app.fico; t.nFico++; }
      t.expectedLoss += el;
      t.expectedLossInferred += side === "B" ? elInferred : el;
      const d = dealerRow(loan.dealerId)[side];
      d.funded++;
      d.volume += loan.ead;
      d.expectedLoss += el;
      if (side === "B") d.expectedLossInferred += elInferred;
    }
  }

  const names = new Map(dealers.map((d) => [d.id, d.name]));
  const ranked = [...byDealer.values()].sort((a, b) => b.A.volume - a.A.volume || a.dealerId.localeCompare(b.dealerId));
  const top = ranked.slice(0, topDealers).map((r) => ({ ...r, dealer: names.get(r.dealerId) ?? r.dealerId }));
  const rest = ranked.slice(topDealers).reduce((acc, r) => {
    for (const side of ["A", "B"]) for (const k of Object.keys(acc[side])) acc[side][k] += r[side][k];
    acc.dealers++;
    return acc;
  }, { dealerId: "OTHER", dealer: "All other dealers", dealers: 0, A: { funded: 0, volume: 0, expectedLoss: 0 }, B: { funded: 0, volume: 0, expectedLoss: 0, expectedLossInferred: 0 } });

  return {
    poolSize: pool.length,
    cells: Object.fromEntries(CELLS.map((k) => [k, finishCell(cells[k], pool.length)])),
    totals: { A: finishTotals(totals.A, pool.length), B: finishTotals(totals.B, pool.length) },
    moves,
    unchangedFundingMoves,
    dealerMix: { top, rest },
    inferredMultiplier,
    lgd
  };
}

/** Highest presented back-end DTI among applications a policy funds (null when none or no DTI). */
export function maxFundedDti(pool, policy = CREDIT_POLICY) {
  let max = null;
  for (const app of pool) if (app.dti !== null && decide(app, policy) === "APPROVE" && (max === null || app.dti > max)) max = app.dti;
  return max;
}

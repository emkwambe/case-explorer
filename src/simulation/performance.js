// src/simulation/performance.js — Simulated loan performance: the observed outcome label.
//
// WHY THIS EXISTS
// ---------------
// The generator used to label each case with the decision its own rule engine thought was
// right. Evaluating a policy against that label measured whether two implementations of
// similar logic agreed, not whether the decision was any good. That is circular.
//
// This module replaces it. Every case is simulated forward as if the loan were funded, and
// the resulting performance (performing, delinquent, default, and the loss) becomes the
// observed label. It is produced by a cash-flow and hazard simulation that never reads the
// policy, the rules, the reason codes or the alignment findings.
//
// THE COUNTERFACTUAL
// ------------------
// Performance is simulated for every case, including the ones a policy would decline. That
// is deliberate: without the counterfactual for declined applications there is no way to
// measure a false decline, and a policy that declines everything would look perfect.
//
// WHERE FRAUD DAMAGE COMES FROM
// -----------------------------
// The simulation runs on WORLD TRUTH: real income, real obligations, real reserves. An
// applicant who overstated income is underwritten by the lender on the claim but lives on
// the truth, so their residual income is worse than the file suggests and they fail more
// often. Concealed debt, tampered balances and unseasoned reserves work the same way. None
// of that is asserted anywhere in this file; it falls out of using truth instead of claims.
//
// Two typologies need an explicit term because the damage is intent, not capacity:
// synthetic identity (bust-out) and straw buyer. Both are modelled as an elevated
// first-payment-default probability, which is a stated modelling assumption about intent
// and is documented in docs/methodology/PARAMETER_SOURCES.md.

import { randomNormal, clamp, roundToInt } from "../utils/distributions.js";

export const PERFORMANCE_SIMULATION_VERSION = "1.0.0";

export const PERFORMANCE_STATUS = Object.freeze(["PERFORMING", "DELINQUENT", "DEFAULT"]);

export const DEFAULT_PERFORMANCE_CONFIG = Object.freeze({
  horizon_months: 36,
  months_missed_to_default: 3,          // 90+ days past due is the default trigger
  discretionary_compression_floor: 0.55, // households cut discretionary spend under stress
  reserve_share_available: 0.85,         // share of post-closing cash actually reachable
  income_volatility: { stable: 0.03, recent: 0.05, seasonal: 0.14, variable: 0.20 },
  self_employed_volatility_multiplier: 1.5,
  job_loss: {                            // monthly hazard of an income interruption
    base_monthly_prob: 0.004,
    credit_score_pivot: 700,             // hazard scales as scores fall below the pivot
    credit_score_slope: 0.9,
    tenure_protection_months: 24,
    duration_months: { min: 1, max: 5 },
    income_retained: 0.35                // unemployment or partial replacement income
  },
  expense_shock: { monthly_prob: 0.02, share_of_monthly_income: 0.6 },
  intent_default: {                      // ability is not the mechanism for these typologies
    BUST_OUT: 0.85,
    STRAW_BUYER: 0.55
  },
  gift_fund_repayment_share: 0.02,       // an undisclosed "gift" is really a loan, repaid monthly
  loss_given_default: {
    base: 0.22,                          // share of loan lost after sale, costs and time
    foreclosure_cost_share: 0.08,
    home_price_drift_monthly: 0.0025,
    home_price_volatility_monthly: 0.012,
    min: 0.02,
    max: 0.65
  }
});

function volatilityFor(truth, cfg) {
  const state = truth.current_state;
  const byStability = cfg.income_volatility[state.tenure_stability] ?? cfg.income_volatility.stable;
  return state.regime === "SELF_EMPLOYED" ? byStability * cfg.self_employed_volatility_multiplier : byStability;
}

/** Monthly job-loss hazard: worse credit and shorter tenure raise it. */
function jobLossHazard(truth, cfg) {
  const j = cfg.job_loss;
  const score = truth.current_state.credit_score ?? j.credit_score_pivot;
  const creditFactor = Math.max(0.25, 1 + ((j.credit_score_pivot - score) / 100) * j.credit_score_slope);
  const tenureFactor = (truth.current_state.tenure_months ?? 0) >= j.tenure_protection_months ? 0.7 : 1.35;
  return clamp(j.base_monthly_prob * creditFactor * tenureFactor, 0, 0.08);
}

/**
 * Simulate performance of the loan if it were funded.
 *
 * @param {object} truth          world truth (never the presentation)
 * @param {string} corruptionType typology, used only for the two intent-driven cases
 * @param {object} config         distribution config
 * @param {object} rng            seeded RNG
 */
export function simulateLoanPerformance(truth, corruptionType = "NONE", config = {}, rng = { random: () => Math.random() }) {
  const cfg = { ...DEFAULT_PERFORMANCE_CONFIG, ...(config.performance || {}) };
  const s = truth.current_state;
  const loanAmount = s.loan_amount ?? 0;
  const piti = s.monthly_mortgage_payment ?? 0;
  const drivers = [];

  // ── Position at closing, from truth ──────────────────────────────────
  const monthlyNetIncome = s.income_stream?.monthly_net_deposit ?? Math.round((s.salary ?? 0) / 12 * 0.72);
  const downPayment = Math.min(s.down_payment ?? 0, s.checking_balance ?? 0);
  const reservesAtClose = Math.max(0, ((s.checking_balance ?? 0) - downPayment)) * cfg.reserve_share_available;

  // Recurring true obligations. Rent is replaced by the mortgage payment on a purchase.
  const utilities = s.expense_obligations?.utilities ?? 0;
  const baseDiscretionary = s.expense_obligations?.discretionary ?? 0;
  let trueObligations = s.monthly_obligations ?? 0;

  // An undisclosed loan dressed up as a gift still has to be repaid.
  if (s.undisclosed_loan_disguised_as_gift) {
    const repayment = roundToInt(s.undisclosed_loan_disguised_as_gift * cfg.gift_fund_repayment_share);
    trueObligations += repayment;
    drivers.push({ driver: "undisclosed_gift_repayment", monthly_amount: repayment });
  }

  const baselineResidual = monthlyNetIncome - piti - trueObligations - utilities - baseDiscretionary;
  if (baselineResidual < 0) drivers.push({ driver: "negative_residual_at_origination", monthly_amount: roundToInt(baselineResidual) });
  if (piti > monthlyNetIncome * 0.45) drivers.push({ driver: "payment_shock", piti_share_of_net_income: +(piti / Math.max(1, monthlyNetIncome)).toFixed(3) });

  // ── Intent-driven default, where capacity is not the mechanism ───────
  const intentProb = cfg.intent_default[corruptionType] ?? 0;
  if (intentProb > 0 && rng.random() < intentProb) {
    const month = 1 + Math.floor(rng.random() * 3);
    drivers.push({ driver: "intent_not_to_repay", typology: corruptionType });
    return finish({
      status: "DEFAULT", monthsToDefault: month, maxMissed: cfg.months_missed_to_default,
      firstPaymentDefault: month <= 1, loanAmount, cfg, rng, drivers,
      horizon: cfg.horizon_months, monthsPaid: month - 1, piti
    });
  }

  // ── Month-by-month cash-flow simulation ──────────────────────────────
  const volatility = volatilityFor(truth, cfg);
  const hazard = jobLossHazard(truth, cfg);
  let reserves = reservesAtClose;
  let consecutiveMissed = 0;
  let maxMissed = 0;
  let monthsPaid = 0;
  let jobLossMonthsRemaining = 0;

  for (let month = 1; month <= cfg.horizon_months; month++) {
    if (jobLossMonthsRemaining === 0 && rng.random() < hazard) {
      const j = cfg.job_loss;
      jobLossMonthsRemaining = j.duration_months.min + Math.floor(rng.random() * (j.duration_months.max - j.duration_months.min + 1));
      drivers.push({ driver: "income_interruption", month, months: jobLossMonthsRemaining });
    }

    const employed = jobLossMonthsRemaining === 0;
    if (!employed) jobLossMonthsRemaining--;
    const incomeThisMonth = monthlyNetIncome
      * (employed ? 1 : cfg.job_loss.income_retained)
      * (1 + randomNormal(0, volatility, rng));

    // Under stress a household compresses discretionary spending before missing the mortgage.
    const stressed = reserves < piti || !employed;
    const discretionary = baseDiscretionary * (stressed ? cfg.discretionary_compression_floor : 1);

    let outflow = piti + trueObligations + utilities + discretionary;
    if (rng.random() < cfg.expense_shock.monthly_prob) {
      const shock = monthlyNetIncome * cfg.expense_shock.share_of_monthly_income;
      outflow += shock;
      drivers.push({ driver: "expense_shock", month, amount: roundToInt(shock) });
    }

    const net = incomeThisMonth - outflow;
    if (reserves + net >= 0) {
      reserves += net;
      consecutiveMissed = 0;
      monthsPaid++;
    } else {
      // Not enough cash to cover the month including the mortgage payment.
      reserves = Math.max(0, reserves + (net + piti));
      consecutiveMissed++;
      maxMissed = Math.max(maxMissed, consecutiveMissed);
      if (consecutiveMissed >= cfg.months_missed_to_default) {
        return finish({
          status: "DEFAULT", monthsToDefault: month, maxMissed, firstPaymentDefault: month <= 1,
          loanAmount, cfg, rng, drivers, horizon: cfg.horizon_months, monthsPaid, piti
        });
      }
    }
  }

  return finish({
    status: maxMissed > 0 ? "DELINQUENT" : "PERFORMING",
    monthsToDefault: null, maxMissed, firstPaymentDefault: false,
    loanAmount, cfg, rng, drivers, horizon: cfg.horizon_months, monthsPaid, piti
  });
}

/**
 * Loss given default from a simulated home-price path. An early default loses more: little
 * principal has been repaid and the carrying and foreclosure costs are the same.
 */
function lossGivenDefault(loanAmount, monthsToDefault, cfg, rng) {
  const l = cfg.loss_given_default;
  const months = monthsToDefault ?? cfg.horizon_months;
  let priceIndex = 1;
  for (let m = 0; m < months; m++) priceIndex *= 1 + l.home_price_drift_monthly + randomNormal(0, l.home_price_volatility_monthly, rng);
  const equityBuilt = Math.min(0.06, months * 0.0012);
  const raw = l.base + l.foreclosure_cost_share - (priceIndex - 1) - equityBuilt;
  return clamp(raw, l.min, l.max);
}

function finish({ status, monthsToDefault, maxMissed, firstPaymentDefault, loanAmount, cfg, rng, drivers, horizon, monthsPaid, piti }) {
  const defaulted = status === "DEFAULT";
  const lgd = defaulted ? lossGivenDefault(loanAmount, monthsToDefault, cfg, rng) : 0;
  return {
    simulation_version: PERFORMANCE_SIMULATION_VERSION,
    horizon_months: horizon,
    counterfactual: "Performance if the loan were funded. Simulated for every case, including those a policy would decline, so false declines are measurable.",
    status,
    defaulted: defaulted ? 1 : 0,
    seriously_delinquent: status !== "PERFORMING" ? 1 : 0,
    first_payment_default: firstPaymentDefault ? 1 : 0,
    months_to_default: monthsToDefault,
    max_consecutive_missed_payments: maxMissed,
    months_paid: monthsPaid,
    payments_received: roundToInt(monthsPaid * piti),
    loss_given_default: +lgd.toFixed(4),
    realized_loss: roundToInt(defaulted ? loanAmount * lgd : 0),
    drivers: drivers.slice(0, 8)
  };
}

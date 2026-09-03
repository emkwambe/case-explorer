// src/evaluation/outcome/index.js — Outcome-grounded decision evaluation.
//
// This replaces "does the policy agree with the label the generator's own rule engine
// produced". That comparison measured whether two implementations of similar logic agreed.
// It could not distinguish a good policy from a policy that shared the labeller's mistakes.
//
// Here the policy is scored against simulated loan performance, which no policy produced:
//
//   Discrimination      does policy severity rank actual defaults?
//   Risk separation     is the approved pool materially safer than the population?
//   False declines      how many rejected applicants would have performed?
//   Portfolio value     realised margin minus realised loss, against naive baselines
//
// Manual review is deliberately NOT modelled as an outcome. Inventing a reviewer would put
// an assumption where the measurement should be. The review pool's counterfactual
// performance is reported instead, so the cost of routing a case to a human is visible.

import { scoreCase } from "../../decisioning/index.js";
import { round, mean } from "../stats.js";

export const OUTCOME_EVALUATION_VERSION = "1.0.0";

export const DEFAULT_VALUE_ASSUMPTIONS = Object.freeze({
  // Lifetime net margin on a performing loan, as a share of the amount, over the simulated
  // horizon. A modelling assumption, not a fitted value.
  margin_on_performing: 0.03,
  // Cost of putting one application through manual underwriting.
  manual_review_cost: 250,
  // Cost of originating any funded loan.
  origination_cost: 900
});

/** Rank order of how adversely the policy treated the case. */
const SEVERITY = { APPROVE: 0, MANUAL_REVIEW: 1, DECLINE: 2 };

/**
 * Area under the ROC curve for an ordinal score against a binary outcome, computed exactly
 * with a tie correction. Small sets and heavy ties make an approximation unsafe here.
 */
export function ordinalAuc(scores, labels) {
  const pos = [], neg = [];
  for (let i = 0; i < scores.length; i++) (labels[i] ? pos : neg).push(scores[i]);
  if (pos.length === 0 || neg.length === 0) return null;
  // Rank-sum form so the cost stays linearithmic rather than quadratic.
  const all = scores.map((s, i) => ({ s, y: labels[i] })).sort((a, b) => a.s - b.s);
  let i = 0, rankSumPos = 0;
  while (i < all.length) {
    let j = i;
    while (j < all.length && all[j].s === all[i].s) j++;
    const avgRank = (i + 1 + j) / 2; // average of 1-based ranks in the tie group
    for (let k = i; k < j; k++) if (all[k].y) rankSumPos += avgRank;
    i = j;
  }
  return (rankSumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

/**
 * @param {Array}  cases
 * @param {object} config
 * @param {object} opts
 *   assumptions   value assumptions override
 *   portfolioIds  Set of case ids that form a realistic book. Discrimination and separation
 *                 use every case (a stratified set gives the statistics more defaults to
 *                 rank), but portfolio value is only meaningful on a representative mix, so
 *                 it is computed over this subset. Defaults to all cases.
 */
export function evaluateOutcomes(cases, config, opts = {}) {
  const { assumptions = {}, portfolioIds = null } = opts;
  const v = { ...DEFAULT_VALUE_ASSUMPTIONS, ...(config.value_assumptions || {}), ...assumptions };
  const rows = [];

  for (const c of cases) {
    const scored = scoreCase(c, config, { now: "outcome" });
    const p = c.performance;
    if (!p) continue;
    rows.push({
      case_id: c.id,
      fraud_type: c.meta?.corruption_type ?? "UNKNOWN",
      regime: c.truth?.current_state?.regime,
      policy_outcome: scored.decision.outcome,
      severity: SEVERITY[scored.decision.outcome],
      reference_label: c.label?.expected_outcome ?? null,
      loan_amount: c.application?.loan_amount ?? 0,
      defaulted: p.defaulted,
      status: p.status,
      months_to_default: p.months_to_default,
      realized_loss: p.realized_loss,
      first_payment_default: p.first_payment_default
    });
  }

  const n = rows.length;
  const defaults = rows.filter(r => r.defaulted);
  const populationBadRate = n ? defaults.length / n : 0;

  const approved = rows.filter(r => r.policy_outcome === "APPROVE");
  const reviewed = rows.filter(r => r.policy_outcome === "MANUAL_REVIEW");
  const declined = rows.filter(r => r.policy_outcome === "DECLINE");

  const rate = (set) => (set.length ? set.filter(r => r.defaulted).length / set.length : 0);
  const approvedBadRate = rate(approved);
  const declinedBadRate = rate(declined);
  const reviewedBadRate = rate(reviewed);

  // How much of the population's risk the approval boundary removes. 1 means the approved
  // pool is clean; 0 means approval is no better than accepting everyone.
  const riskSeparation = populationBadRate > 0 ? 1 - approvedBadRate / populationBadRate : null;

  // Of everyone the policy did not approve, how many would in fact have paid.
  const notApproved = [...reviewed, ...declined];
  const falseDeclineRate = notApproved.length ? notApproved.filter(r => !r.defaulted).length / notApproved.length : 0;
  const declineOnlyFalseRate = declined.length ? declined.filter(r => !r.defaulted).length / declined.length : 0;

  const discrimination = ordinalAuc(rows.map(r => r.severity), rows.map(r => r.defaulted));

  // ── Portfolio value under each strategy ──────────────────────────────
  const valueOf = (funded, reviewedSet = []) => {
    const margin = funded.filter(r => !r.defaulted).reduce((s, r) => s + r.loan_amount * v.margin_on_performing, 0);
    const loss = funded.reduce((s, r) => s + r.realized_loss, 0);
    const origination = funded.length * v.origination_cost;
    const review = reviewedSet.length * v.manual_review_cost;
    return {
      funded: funded.length,
      margin_earned: Math.round(margin),
      loss_incurred: Math.round(loss),
      origination_cost: Math.round(origination),
      review_cost: Math.round(review),
      net_value: Math.round(margin - loss - origination - review)
    };
  };

  const book = portfolioIds ? rows.filter(r => portfolioIds.has(r.case_id)) : rows;
  const bookApproved = book.filter(r => r.policy_outcome === "APPROVE");
  const bookReviewed = book.filter(r => r.policy_outcome === "MANUAL_REVIEW");
  const bookNotApproved = book.filter(r => r.policy_outcome !== "APPROVE");
  const policyValue = valueOf(bookApproved, bookReviewed);
  const approveAll = valueOf(book);
  const declineAll = valueOf([]);
  // An oracle funds exactly the loans that perform. The realistic ceiling, not achievable.
  const oracle = valueOf(book.filter(r => !r.defaulted));

  const captureOfCeiling = oracle.net_value > 0 ? policyValue.net_value / oracle.net_value : null;
  const foregoneMargin = Math.round(
    bookNotApproved.filter(r => !r.defaulted).reduce((s, r) => s + r.loan_amount * v.margin_on_performing - v.origination_cost, 0)
  );
  const lossAvoided = Math.round(bookNotApproved.reduce((s, r) => s + r.realized_loss, 0));

  // ── Slices ───────────────────────────────────────────────────────────
  const by = (keyFn) => {
    const groups = {};
    for (const r of rows) {
      const k = keyFn(r);
      const g = groups[k] ||= { key: k, n: 0, defaults: 0, approved: 0, approved_defaults: 0, loss: 0 };
      g.n++; g.defaults += r.defaulted; g.loss += r.realized_loss;
      if (r.policy_outcome === "APPROVE") { g.approved++; g.approved_defaults += r.defaulted; }
    }
    return Object.values(groups).map(g => ({
      ...g,
      bad_rate: round(g.defaults / g.n, 4),
      approval_rate: round(g.approved / g.n, 4),
      approved_bad_rate: g.approved ? round(g.approved_defaults / g.approved, 4) : null,
      mean_loss: Math.round(g.loss / g.n)
    }));
  };

  // Consistency between the reference labeller and the policy. Reported as a diagnostic so a
  // refactor that silently changes one of them is visible. It is NOT a quality measure and
  // is not gated: agreement with another policy says nothing about whether either is right.
  const withRef = rows.filter(r => r.reference_label);
  const referenceAgreement = withRef.length ? withRef.filter(r => r.reference_label === r.policy_outcome).length / withRef.length : null;

  return {
    version: OUTCOME_EVALUATION_VERSION,
    n,
    horizon_months: cases[0]?.performance?.horizon_months ?? null,
    value_assumptions: v,
    population: {
      bad_rate: round(populationBadRate, 4),
      defaults: defaults.length,
      total_loss: Math.round(defaults.reduce((s, r) => s + r.realized_loss, 0)),
      mean_loss_given_default: defaults.length ? round(mean(defaults.map(r => r.realized_loss / Math.max(1, r.loan_amount))), 4) : null,
      first_payment_defaults: rows.filter(r => r.first_payment_default).length
    },
    policy: {
      approval_rate: round(approved.length / Math.max(1, n), 4),
      manual_review_rate: round(reviewed.length / Math.max(1, n), 4),
      decline_rate: round(declined.length / Math.max(1, n), 4),
      approved_bad_rate: round(approvedBadRate, 4),
      reviewed_bad_rate: round(reviewedBadRate, 4),
      declined_bad_rate: round(declinedBadRate, 4),
      risk_separation: riskSeparation === null ? null : round(riskSeparation, 4),
      discrimination_auc: discrimination === null ? null : round(discrimination, 4),
      false_decline_rate: round(falseDeclineRate, 4),
      decline_only_false_rate: round(declineOnlyFalseRate, 4)
    },
    value: {
      book_size: book.length,
      book_bad_rate: round(book.length ? book.filter(r => r.defaulted).length / book.length : 0, 4),
      book_note: portfolioIds
        ? "Portfolio value is computed on the blended population only. The stratified detection set over-samples fraud and would misstate the economics."
        : "Portfolio value is computed on every scored case.",
      policy: policyValue,
      approve_all: approveAll,
      decline_all: declineAll,
      oracle,
      capture_of_ceiling: captureOfCeiling === null ? null : round(captureOfCeiling, 4),
      beats_approve_all: policyValue.net_value > approveAll.net_value,
      beats_decline_all: policyValue.net_value > declineAll.net_value,
      foregone_margin_on_good_declines: foregoneMargin,
      loss_avoided_on_declines: lossAvoided,
      net_cost_of_conservatism: Math.round(approveAll.net_value - policyValue.net_value)
    },
    by_fraud_type: by(r => r.fraud_type),
    by_regime: by(r => r.regime ?? "UNKNOWN"),
    reference_label_agreement: referenceAgreement === null ? null : round(referenceAgreement, 4),
    rows
  };
}

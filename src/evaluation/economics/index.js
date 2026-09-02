// src/evaluation/economics/index.js — Decision economics: threshold simulator.
//
//   Expected Value = fraud loss avoided − false-positive review cost − customer friction cost − model operating cost
//
// Works on any set of (score, is_fraud, loan_amount) triples: rule scores, model scores or
// the policy's alert magnitude. Used by the API, the UI threshold simulator and the benchmark.

export const ECONOMICS_VERSION = "1.0.0";

export const DEFAULT_ASSUMPTIONS = Object.freeze({
  fraud_prevalence: null,          // null = use observed prevalence in the scored set
  average_loss_given_fraud: 0.25,  // share of loan amount lost when fraud is funded (proxy)
  average_loan_amount: null,       // null = observed mean loan amount
  manual_review_cost: 85,          // cost per reviewed alert (analyst time)
  review_minutes_per_alert: 35,
  false_decline_cost: 1200,        // lost margin + acquisition cost of a wrongly declined good customer
  customer_friction_cost: 40,      // friction cost per legitimate customer sent to review
  model_operating_cost_per_case: 0.15,
  investigation_capacity: null     // max alerts reviewable per period; null = unlimited
});

/**
 * @param {Array<{score:number,is_fraud:0|1,loan_amount:number}>} scored
 * @param {number} threshold
 * @param {object} assumptions
 */
export function simulateThreshold(scored, threshold, assumptions = {}) {
  const a = { ...DEFAULT_ASSUMPTIONS, ...assumptions };
  const n = scored.length;
  const observedPrev = n ? scored.filter(s => s.is_fraud).length / n : 0;
  const prevalence = a.fraud_prevalence ?? observedPrev;
  const meanLoan = a.average_loan_amount ?? (n ? scored.reduce((s, x) => s + (x.loan_amount || 0), 0) / n : 0);
  // Re-weight to the target prevalence so the user can ask "what if fraud were 2%?".
  const wFraud = observedPrev > 0 ? prevalence / observedPrev : 0;
  const wClean = observedPrev < 1 ? (1 - prevalence) / (1 - observedPrev) : 0;

  let alerts = 0, tp = 0, fp = 0, fn = 0, tn = 0, lossAvoided = 0, lossMissed = 0;
  const flagged = scored.filter(s => s.score >= threshold).sort((x, y) => y.score - x.score);
  const capacity = a.investigation_capacity ?? Infinity;
  const reviewed = new Set(flagged.slice(0, Math.min(flagged.length, capacity)).map((_, i) => i));
  flagged.forEach((s, i) => {
    const w = s.is_fraud ? wFraud : wClean;
    alerts += w;
    if (!reviewed.has(i)) { if (s.is_fraud) { fn += w; lossMissed += w * (s.loan_amount || meanLoan) * a.average_loss_given_fraud; } else tn += w; return; }
    if (s.is_fraud) { tp += w; lossAvoided += w * (s.loan_amount || meanLoan) * a.average_loss_given_fraud; } else fp += w;
  });
  for (const s of scored) if (s.score < threshold) {
    const w = s.is_fraud ? wFraud : wClean;
    if (s.is_fraud) { fn += w; lossMissed += w * (s.loan_amount || meanLoan) * a.average_loss_given_fraud; } else tn += w;
  }
  const reviewedAlerts = Math.min(alerts, capacity);
  const reviewCost = reviewedAlerts * a.manual_review_cost;
  const frictionCost = fp * a.customer_friction_cost;
  const falseDeclineCost = fp * a.false_decline_cost * 0.1; // assume 10% of false alerts end in a wrongful decline
  const operatingCost = n * a.model_operating_cost_per_case;
  const net = lossAvoided - reviewCost - frictionCost - falseDeclineCost - operatingCost;
  return {
    threshold,
    alerts: round(alerts), fraud_captured: round(tp), fraud_missed: round(fn), false_positives: round(fp), true_negatives: round(tn),
    precision: alerts ? round(tp / alerts, 4) : null,
    recall: tp + fn ? round(tp / (tp + fn), 4) : null,
    alert_rate: n ? round(alerts / n, 4) : 0,
    review_hours: round(reviewedAlerts * a.review_minutes_per_alert / 60, 1),
    capacity_exceeded: alerts > capacity,
    fraud_loss_avoided: round(lossAvoided), fraud_loss_missed: round(lossMissed),
    review_cost: round(reviewCost), customer_friction_cost: round(frictionCost), false_decline_cost: round(falseDeclineCost), model_operating_cost: round(operatingCost),
    net_expected_benefit: round(net)
  };
}

export function thresholdSweep(scored, assumptions = {}, thresholds = defaultThresholds()) {
  const rows = thresholds.map(t => simulateThreshold(scored, t, assumptions));
  const best = rows.reduce((b, r) => (r.net_expected_benefit > (b?.net_expected_benefit ?? -Infinity) ? r : b), null);
  return { version: ECONOMICS_VERSION, assumptions: { ...DEFAULT_ASSUMPTIONS, ...assumptions }, rows, optimal_threshold: best?.threshold ?? null, optimal: best };
}

export function defaultThresholds() { return Array.from({ length: 19 }, (_, i) => +((i + 1) * 0.05).toFixed(2)); }

/** Convert rule alerts to a [0,1] score so the simulator can run on the rule baseline. */
export function alertsToScore(alerts) {
  const w = { HIGH: 1.0, MEDIUM: 0.5, LOW: 0.2 };
  const raw = alerts.reduce((s, a) => s + (w[a.severity] || 0), 0);
  return 1 - Math.exp(-raw);
}

function round(x, d = 0) { const m = 10 ** d; return Math.round(x * m) / m; }

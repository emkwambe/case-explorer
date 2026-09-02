// src/evaluation/detection/index.js — Layer 2: can rules (or a model) identify injected fraud?
//
// Answers: Which fraud types are missed? What is the false-positive rate on clean cases?
// Which evidence supports each alert? How does each rule perform (champion/challenger)?
// Uses ONLY the underwriter-visible decision view — never `truth`.

import { extractDecisionView, isFraudCase } from "../../ml/decision_features.js";
import { runFraudRules, FRAUD_RULES, FRAUD_RULESET_VERSION } from "../../decisioning/fraud-rules/rules.js";
import { confusion, round } from "../stats.js";

export const DETECTION_EVALUATION_VERSION = "1.0.0";

/** Ground-truth finding type → reason codes that count as recovering it. */
export const RECOVERY_MAP = {
  INCOME_MISREPRESENTATION: ["UNVERIFIABLE_INCOME", "INCOME_VARIANCE_REVIEW", "UNVERIFIABLE_EMPLOYMENT", "IDENTITY_UNVERIFIABLE"],
  ASSET_MISREPRESENTATION: ["UNVERIFIABLE_ASSETS", "POTENTIAL_DOCUMENT_TAMPERING", "UNVERIFIABLE_EMPLOYMENT", "IDENTITY_UNVERIFIABLE"],
  EMPLOYER_FABRICATION: ["UNVERIFIABLE_EMPLOYMENT", "IDENTITY_UNVERIFIABLE"],
  LIABILITY_CONCEALMENT: ["UNDISCLOSED_LIABILITIES", "LIABILITY_VARIANCE_REVIEW", "IDENTITY_UNVERIFIABLE"],
  EVIDENCE_TAMPERING: ["POTENTIAL_DOCUMENT_TAMPERING", "UNSOURCED_LARGE_DEPOSIT"],
  SYNTHETIC_IDENTITY: ["IDENTITY_UNVERIFIABLE", "RAPID_CREDIT_PROFILE_CONSTRUCTION"],
  OCCUPANCY_MISREPRESENTATION: ["MATERIAL_APPLICATION_DISCREPANCY"],
  GIFT_FUND_MISREPRESENTATION: ["UNVERIFIABLE_ASSETS", "UNSOURCED_LARGE_DEPOSIT"],
  ASSET_SEASONING: ["UNSOURCED_LARGE_DEPOSIT"],
  STRAW_BUYER: ["MATERIAL_APPLICATION_DISCREPANCY", "UNSOURCED_LARGE_DEPOSIT"],
  INCOHERENT_WORLD: ["DATA_INTEGRITY_FAILURE"]
};

const ALERTING_SEVERITIES = new Set(["HIGH", "MEDIUM"]);

/**
 * Evaluate the fraud-rule engine on labelled cases.
 * @param {Array} cases
 * @param {object} opts  { rules?: FraudRule[], alertingSeverities?: Set<string>, materialOnly?: boolean }
 */
export function evaluateDetection(cases, { rules = FRAUD_RULES, alertingSeverities = ALERTING_SEVERITIES } = {}) {
  const perCase = cases.map(c => {
    const view = extractDecisionView(c);
    const { alerts } = runFraudRules(view, { rules });
    const alerting = alerts.filter(a => alertingSeverities.has(a.severity));
    return { c, alerts, alerting, is_fraud: isFraudCase(c), type: c.meta?.corruption_type ?? "UNKNOWN", loan: c.application?.loan_amount ?? 0 };
  });

  // Fraud metrics exclude the INCOHERENT negative control (data-quality, not fraud).
  const scoreable = perCase.map(r => ({ ...r, is_fraud_alert: r.alerting.some(a => a.reason_code !== "DATA_INTEGRITY_FAILURE") }));
  const yTrue = scoreable.map(r => r.is_fraud ? 1 : 0);
  const yPred = scoreable.map(r => r.is_fraud_alert ? 1 : 0);
  const overall = confusion(yTrue, yPred);

  const clean = scoreable.filter(r => r.type === "NONE");
  const fprClean = clean.length ? clean.filter(r => r.alerting.length > 0).length / clean.length : 0;

  const byType = {};
  for (const r of scoreable) {
    const t = byType[r.type] ||= { fraud_type: r.type, n: 0, alerted: 0, high_alerted: 0, is_fraud_scenario: r.is_fraud, missed_examples: [] };
    t.n++;
    if (r.alerting.length > 0) t.alerted++;
    if (r.alerting.some(a => a.severity === "HIGH")) t.high_alerted++;
    else if (r.is_fraud && t.missed_examples.length < 5) t.missed_examples.push(r.c.id);
  }
  const by_fraud_type = Object.values(byType).map(t => ({ ...t, alert_rate: round(t.alerted / t.n), high_alert_rate: round(t.high_alerted / t.n), missed_examples: t.missed_examples.join("|") }));

  // Ground-truth reconciliation: was each injected delta recovered by a rule alert?
  let gtTotal = 0, gtHit = 0;
  const gtByType = {};
  for (const r of perCase) {
    const codes = new Set(r.alerts.map(a => a.reason_code));
    for (const gt of r.c.ground_truth_findings || []) {
      gtTotal++;
      const g = gtByType[gt.type] ||= { finding_type: gt.type, total: 0, recovered: 0 };
      g.total++;
      const recoverers = RECOVERY_MAP[gt.type] || [];
      if (recoverers.some(code => codes.has(code))) { gtHit++; g.recovered++; }
    }
  }
  const reconciliation = { total: gtTotal, recovered: gtHit, rate: gtTotal ? round(gtHit / gtTotal) : 1, by_type: Object.values(gtByType).map(g => ({ ...g, rate: round(g.recovered / g.total) })) };

  // Per-rule analytics for the strategy workbench.
  const by_rule = rules.map(rule => {
    let alerts = 0, tp = 0, fp = 0, lossCaptured = 0, reviewVolume = 0;
    for (const r of perCase) {
      const fired = r.alerts.find(a => a.rule_id === rule.id);
      if (!fired) continue;
      alerts++;
      reviewVolume++;
      const targeted = rule.target_scenarios.includes("*") || rule.target_scenarios.includes(r.type);
      if (r.is_fraud || (r.type === "INCOHERENT" && rule.target_scenarios.includes("INCOHERENT"))) { tp++; if (targeted) lossCaptured += r.loan; } else fp++;
    }
    const targetN = perCase.filter(r => rule.target_scenarios.includes("*") ? r.is_fraud : rule.target_scenarios.includes(r.type)).length;
    const targetHit = perCase.filter(r => (rule.target_scenarios.includes("*") ? r.is_fraud : rule.target_scenarios.includes(r.type)) && r.alerts.some(a => a.rule_id === rule.id)).length;
    return {
      rule_id: rule.id, version: rule.version, severity: rule.severity, reason_code: rule.reason_code,
      target_scenarios: rule.target_scenarios.join("|"), owner: rule.owner, approval_status: rule.approval_status, effective_date: rule.effective_date,
      alerts, true_positives: tp, false_positives: fp,
      precision: alerts ? round(tp / alerts) : null,
      target_recall: targetN ? round(targetHit / targetN) : null,
      target_population: targetN,
      loss_captured_proxy: lossCaptured,
      review_volume: reviewVolume,
      customer_impact_fp_rate: clean.length ? round(clean.filter(r => r.alerts.some(a => a.rule_id === rule.id)).length / clean.length) : 0
    };
  });

  // Evidence support: share of alerting cases with at least one evidence citation.
  const alertingCases = perCase.filter(r => r.alerting.length > 0);
  const cited = alertingCases.filter(r => r.alerting.some(a => a.evidence_citations.length > 0)).length;

  return {
    version: DETECTION_EVALUATION_VERSION,
    ruleset_version: FRAUD_RULESET_VERSION,
    n: cases.length,
    fraud_n: yTrue.filter(Boolean).length,
    overall: Object.fromEntries(Object.entries(overall).map(([k, v]) => [k, typeof v === "number" && !Number.isInteger(v) ? round(v) : v])),
    fpr_on_clean: round(fprClean),
    by_fraud_type,
    reconciliation,
    by_rule,
    evidence_support_rate: alertingCases.length ? round(cited / alertingCases.length) : 1
  };
}

/** Champion/challenger: compare two rulesets on the same cases. */
export function compareRulesets(cases, championRules, challengerRules) {
  const a = evaluateDetection(cases, { rules: championRules });
  const b = evaluateDetection(cases, { rules: challengerRules });
  const delta = (k) => round((b.overall[k] ?? 0) - (a.overall[k] ?? 0));
  return {
    champion: a.overall, challenger: b.overall,
    deltas: { precision: delta("precision"), recall: delta("recall"), f1: delta("f1"), fpr: delta("fpr") },
    fpr_on_clean: { champion: a.fpr_on_clean, challenger: b.fpr_on_clean }
  };
}

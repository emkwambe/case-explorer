// src/decisioning/index.js — Score a case end to end: view → fraud rules → policy → explanation.

import { extractDecisionView } from "../ml/decision_features.js";
import { runFraudRules, FRAUD_RULESET_VERSION } from "./fraud-rules/rules.js";
import { decideCase, UNDERWRITING_POLICY_VERSION, policyThresholds } from "./underwriting/policy.js";
import { REASON_CODES, REASON_CODE_CATALOG_VERSION } from "./reason-codes/catalog.js";

export { extractDecisionView, runFraudRules, decideCase, FRAUD_RULESET_VERSION, UNDERWRITING_POLICY_VERSION, REASON_CODE_CATALOG_VERSION };

/**
 * Produce a full, citable decision record for a case using only underwriter-visible data.
 * @param {object} c       a generated case
 * @param {object} config  distribution config (underwriting thresholds)
 * @param {object} opts    { modelScore?: number, modelVersion?: string } optional ML overlay
 */
export function scoreCase(c, config = {}, opts = {}) {
  const view = extractDecisionView(c);
  const { alerts } = runFraudRules(view);
  const decision = decideCase(view, alerts, config);
  const explanation = buildExplanation(view, alerts, decision, config, opts);
  return {
    case_ref: c.id,
    scored_at: opts.now ?? new Date().toISOString(),
    versions: {
      ruleset: FRAUD_RULESET_VERSION,
      policy: UNDERWRITING_POLICY_VERSION,
      reason_code_catalog: REASON_CODE_CATALOG_VERSION,
      model: opts.modelVersion ?? null
    },
    alerts,
    decision,
    explanation
  };
}

/**
 * Answer, for every decision:
 *   What was detected? Which inputs contributed? Which evidence supports it?
 *   Which rule/model version was used? What would have changed the outcome? Automated or reviewed?
 */
export function buildExplanation(view, alerts, decision, config = {}, opts = {}) {
  const th = policyThresholds(config);
  const detected = alerts.map(a => ({
    rule: `${a.rule_id}@${a.rule_version}`,
    reason_code: a.reason_code,
    category: REASON_CODES[a.reason_code]?.category,
    severity: a.severity,
    detail: a.detail,
    evidence_citations: a.evidence_citations
  }));

  const contributing = decision.factors.map(f => {
    const status = factorStatus(f);
    return { ...f, status };
  });

  const counterfactuals = [];
  if (decision.outcome !== "APPROVE") {
    for (const f of decision.factors) {
      if (f.factor === "backend_dti_pct" && f.value > th.dti_approve_max) {
        const monthlyIncome = (view.claims.salary ?? 0) / 12;
        const obligations = (view.claims.monthly_obligations ?? 0) + (view.loan.proposed_piti ?? 0);
        const neededIncome = obligations / (th.dti_approve_max / 100) * 12;
        counterfactuals.push({ change: "backend_dti_pct", to: th.dti_approve_max, note: `Reduce back-end DTI to ${th.dti_approve_max}% (e.g. verified income of ${Math.round(neededIncome)} or ${Math.round(obligations - monthlyIncome * th.dti_approve_max / 100)}/mo less debt).` });
      }
      if (f.factor === "credit_score" && f.value < th.credit_approve_min) counterfactuals.push({ change: "credit_score", to: th.credit_approve_min, note: `Credit score of at least ${th.credit_approve_min} required for automated approval.` });
      if (f.factor === "reserves_months" && f.value < th.reserves_approve_min) counterfactuals.push({ change: "reserves_months", to: th.reserves_approve_min, note: `Verified reserves of at least ${th.reserves_approve_min} months of income required.` });
      if (f.factor === "tenure_months" && f.value < th.tenure_approve_min) counterfactuals.push({ change: "tenure_months", to: th.tenure_approve_min, note: `At least ${th.tenure_approve_min} months of verified employment required.` });
    }
    for (const a of alerts.filter(a => a.severity === "HIGH")) {
      counterfactuals.push({ change: a.rule_id, to: "not fired", note: `Resolve: ${REASON_CODES[a.reason_code]?.description ?? a.reason_code}` });
    }
  }

  return {
    what_was_detected: detected,
    which_inputs_contributed: contributing,
    which_evidence_supports: dedupeCitations(alerts.flatMap(a => a.evidence_citations)),
    which_versions_were_used: {
      ruleset: FRAUD_RULESET_VERSION,
      policy: UNDERWRITING_POLICY_VERSION,
      reason_code_catalog: REASON_CODE_CATALOG_VERSION,
      model: opts.modelVersion ?? null,
      model_score: opts.modelScore ?? null
    },
    what_would_change_the_outcome: counterfactuals,
    automated_or_reviewed: decision.outcome === "MANUAL_REVIEW" ? "REQUIRES_HUMAN_REVIEW" : "AUTOMATED",
    reason_codes: decision.reason_codes.map(code => ({ code, category: REASON_CODES[code]?.category, description: REASON_CODES[code]?.description, adverse_action: REASON_CODES[code]?.adverse_action ?? false }))
  };
}

function factorStatus(f) {
  if (f.approve_max !== undefined) return f.value <= f.approve_max ? "PASS" : f.value <= f.review_max ? "REVIEW" : "FAIL";
  if (f.approve_min !== undefined) return f.value >= f.approve_min ? "PASS" : f.value >= f.review_min ? "REVIEW" : "FAIL";
  return "INFO";
}

function dedupeCitations(citations) {
  const seen = new Set();
  const out = [];
  for (const c of citations) {
    const key = `${c.source}:${c.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

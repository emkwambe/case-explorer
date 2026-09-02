// src/evaluation/decision/index.js — Layer 3: are the decisions right, permissible and explainable?
//
// Answers: Should the case be approved, declined or reviewed? Was the decision based on
// permissible variables only? Are the reason codes accurate? Is the decision calibrated to risk?

import { scoreCase } from "../../decisioning/index.js";
import { extractDecisionFeatures } from "../../ml/decision_features.js";
import { REASON_CODES } from "../../decisioning/reason-codes/catalog.js";
import { jaccard, round } from "../stats.js";

export const DECISION_EVALUATION_VERSION = "1.0.0";
const OUTCOMES = ["APPROVE", "MANUAL_REVIEW", "DECLINE"];

export function evaluateDecisions(cases, config) {
  const rows = [];
  let agree = 0;
  const confusionM = {};
  const byType = {};
  const byOutcome = {};
  let jSum = 0, aaOverlap = 0, exact = 0;
  let governanceViolations = 0;
  let permissibleViolations = 0;
  const permissibleErrors = [];

  for (const c of cases) {
    // Permissible-variable audit: the feature extractor throws if a prohibited field is present.
    try { extractDecisionFeatures(c); } catch (e) { permissibleViolations++; if (permissibleErrors.length < 5) permissibleErrors.push(e.message); }

    const scored = scoreCase(c, config, { now: "benchmark" });
    const expected = c.label.expected_outcome;
    const got = scored.decision.outcome;
    const ok = expected === got;
    if (ok) agree++;
    const key = `${expected}->${got}`;
    confusionM[key] = (confusionM[key] || 0) + 1;

    const t = c.meta?.corruption_type ?? "UNKNOWN";
    const bt = byType[t] ||= { fraud_type: t, n: 0, agree: 0 };
    bt.n++; if (ok) bt.agree++;
    const bo = byOutcome[expected] ||= { expected_outcome: expected, n: 0, agree: 0 };
    bo.n++; if (ok) bo.agree++;

    const labelCodes = c.label.reason_codes || [];
    const gotCodes = scored.decision.reason_codes || [];
    const j = jaccard(labelCodes, gotCodes);
    jSum += j;
    if (j === 1) exact++;
    const labelAA = labelCodes.filter(x => REASON_CODES[x]?.adverse_action);
    const gotAA = gotCodes.filter(x => REASON_CODES[x]?.adverse_action);
    const aaOk = labelAA.length === 0 ? gotAA.length === 0 || got !== "DECLINE" : labelAA.some(x => gotAA.includes(x));
    if (aaOk) aaOverlap++;
    if (!scored.decision.governance.valid) governanceViolations++;

    rows.push({
      case_id: c.id, fraud_type: t, severity: c.meta?.severity, expected_outcome: expected, policy_outcome: got, agree: ok ? 1 : 0,
      pathway: scored.decision.pathway,
      label_reason_codes: labelCodes.join("|"), policy_reason_codes: gotCodes.join("|"), reason_code_jaccard: round(j, 3),
      adverse_action_overlap: aaOk ? 1 : 0, alerts: scored.alerts.length,
      backend_dti_pct: scored.decision.factors.find(f => f.factor === "backend_dti_pct")?.value,
      credit_score: scored.decision.factors.find(f => f.factor === "credit_score")?.value
    });
  }

  // Calibration to risk: approval rate should fall monotonically with verified credit-risk bands (clean cases only).
  const clean = rows.filter(r => r.fraud_type === "NONE");
  const bands = [["<600", s => s < 600], ["600-639", s => s >= 600 && s < 640], ["640-679", s => s >= 640 && s < 680], ["680-719", s => s >= 680 && s < 720], ["720+", s => s >= 720]];
  const calibration = bands.map(([band, f]) => {
    const sub = clean.filter(r => f(r.credit_score ?? 0));
    return { credit_band: band, n: sub.length, approval_rate: sub.length ? round(sub.filter(r => r.policy_outcome === "APPROVE").length / sub.length, 3) : null, decline_rate: sub.length ? round(sub.filter(r => r.policy_outcome === "DECLINE").length / sub.length, 3) : null };
  });
  const dtiBands = [["<=30", d => d <= 30], ["30-38", d => d > 30 && d <= 38], ["38-47", d => d > 38 && d <= 47], [">47", d => d > 47]];
  const calibrationDti = dtiBands.map(([band, f]) => {
    const sub = clean.filter(r => f(r.backend_dti_pct ?? 0));
    return { dti_band: band, n: sub.length, approval_rate: sub.length ? round(sub.filter(r => r.policy_outcome === "APPROVE").length / sub.length, 3) : null, decline_rate: sub.length ? round(sub.filter(r => r.policy_outcome === "DECLINE").length / sub.length, 3) : null };
  });

  const n = cases.length;
  const outcomeCounts = Object.fromEntries(OUTCOMES.map(o => [o, rows.filter(r => r.policy_outcome === o).length]));
  return {
    version: DECISION_EVALUATION_VERSION,
    n,
    agreement_rate: round(agree / n),
    confusion: confusionM,
    by_fraud_type: Object.values(byType).map(b => ({ ...b, agreement_rate: round(b.agree / b.n) })),
    by_expected_outcome: Object.values(byOutcome).map(b => ({ ...b, agreement_rate: round(b.agree / b.n) })),
    reason_codes: { mean_jaccard: round(jSum / n), exact_match_rate: round(exact / n), adverse_action_overlap_rate: round(aaOverlap / n) },
    permissible_variables: { violations: permissibleViolations, errors: permissibleErrors, audited: n },
    governance: { invalid_decisions: governanceViolations },
    outcome_distribution: Object.fromEntries(Object.entries(outcomeCounts).map(([k, v]) => [k, round(v / n, 3)])),
    calibration_by_credit_band: calibration,
    calibration_by_dti_band: calibrationDti,
    rows
  };
}

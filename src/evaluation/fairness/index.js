// src/evaluation/fairness/index.js — Technical fairness-testing controls.
//
// This module does NOT establish legal compliance. It provides subgroup outcome analysis and
// deterministic counterfactual tests that support human legal and compliance review.
//
//  * Subgroup analysis slices policy outcomes by SENSITIVE audit attributes.
//  * Counterfactual testing changes ONLY a sensitive attribute on an otherwise identical case
//    and requires the outcome and reason codes to be unchanged. Any difference is a critical finding.

import { scoreCase } from "../../decisioning/index.js";
import { AGE_BANDS, INCOME_BANDS, FAMILY_STATUS_SCENARIOS } from "../../core/audit_attributes.js";
import { isFraudCase } from "../../ml/decision_features.js";
import { round } from "../stats.js";

export const FAIRNESS_EVALUATION_VERSION = "1.0.0";

/** Attributes sampled independently of financial variables — any disparity is a defect. */
export const INDEPENDENT_SCENARIO_ATTRIBUTES = ["family_status_scenario", "disability_income_scenario"];
/** Attributes derived from (or correlated with) legitimate financial variables — reported, not gated. */
export const DERIVED_ATTRIBUTES = ["age_band", "geography_group", "income_band", "persona"];

function attrValue(c, attr) {
  if (attr === "age_band" || attr === "income_band" || attr === "geography_group" || attr === "persona" || attr === "family_status_scenario" || attr === "disability_income_scenario") return c.audit_attributes?.[attr];
  return undefined;
}

export function subgroupAnalysis(cases, config, scored) {
  const attrs = [...INDEPENDENT_SCENARIO_ATTRIBUTES, ...DERIVED_ATTRIBUTES];
  const out = [];
  for (const attr of attrs) {
    const groups = {};
    cases.forEach((c, i) => {
      const g = String(attrValue(c, attr));
      const s = scored[i];
      const row = groups[g] ||= { attribute: attr, group: g, n: 0, approve: 0, review: 0, decline: 0, alerts: 0, fraud: 0, fraud_alerted: 0, clean: 0, clean_alerted: 0, codes: {} };
      row.n++;
      if (s.decision.outcome === "APPROVE") row.approve++;
      else if (s.decision.outcome === "MANUAL_REVIEW") row.review++;
      else row.decline++;
      const alerted = s.alerts.some(a => a.severity !== "LOW");
      if (alerted) row.alerts++;
      const fraud = isFraudCase(c);
      if (fraud) { row.fraud++; if (alerted) row.fraud_alerted++; } else if (c.meta?.corruption_type === "NONE") { row.clean++; if (alerted) row.clean_alerted++; }
      for (const code of s.decision.reason_codes) row.codes[code] = (row.codes[code] || 0) + 1;
    });
    const rows = Object.values(groups);
    const maxApproval = Math.max(...rows.map(r => r.approve / r.n));
    const pooledN = rows.reduce((s, r) => s + r.n, 0);
    const pooledApproval = rows.reduce((s, r) => s + r.approve, 0) / Math.max(1, pooledN);
    for (const r of rows) {
      const approval = r.approve / r.n;
      out.push({
        attribute: attr,
        attribute_class: INDEPENDENT_SCENARIO_ATTRIBUTES.includes(attr) ? "INDEPENDENT_SCENARIO" : "DERIVED",
        group: r.group, n: r.n,
        approval_rate: round(approval, 3),
        manual_review_rate: round(r.review / r.n, 3),
        decline_rate: round(r.decline / r.n, 3),
        selection_rate_ratio: maxApproval ? round(approval / maxApproval, 3) : null,
        selection_ratio_vs_pooled: pooledApproval ? round(approval / pooledApproval, 3) : null,
        z_p_value: round(twoProportionP(r.approve, r.n, rows.reduce((s, x) => s + x.approve, 0) - r.approve, pooledN - r.n), 4),
        alert_rate: round(r.alerts / r.n, 3),
        false_positive_rate: r.clean ? round(r.clean_alerted / r.clean, 3) : null,
        false_negative_rate: r.fraud ? round(1 - r.fraud_alerted / r.fraud, 3) : null,
        top_reason_codes: Object.entries(r.codes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v}`).join("|")
      });
    }
  }
  return out;
}

/**
 * Build a counterfactual twin: identical financial profile, different sensitive attribute.
 * Mutates every place the attribute surfaces (applicant block, audit attributes, evidence).
 */
export function makeCounterfactual(c, attr, newValue) {
  const twin = JSON.parse(JSON.stringify(c));
  twin.audit_attributes = { ...twin.audit_attributes };
  switch (attr) {
    case "age_band": {
      const age = { "22-29": 25, "30-39": 35, "40-49": 45, "50-59": 55, "60+": 65 }[newValue];
      twin.applicant.age = age;
      twin.truth.demographics.age = age;
      twin.presentation.demographics.age = age;
      twin.audit_attributes.age_band = newValue;
      break;
    }
    case "geography_group": {
      twin.applicant.region = newValue;
      twin.truth.demographics.region = newValue;
      twin.presentation.demographics.region = newValue;
      twin.truth.current_state.region = newValue;
      twin.presentation.current_state.region = newValue;
      twin.audit_attributes.geography_group = newValue;
      const geo = twin.evidence.find(e => e.source === "GEOGRAPHIC_VERIFICATION");
      if (geo) geo.fields.region = newValue;
      break;
    }
    case "family_status_scenario":
      twin.audit_attributes.family_status_scenario = newValue;
      break;
    case "disability_income_scenario":
      twin.audit_attributes.disability_income_scenario = newValue;
      break;
    case "persona":
      twin.audit_attributes.persona = newValue;
      twin.truth.current_state.persona = newValue;
      twin.presentation.current_state.persona = newValue;
      { const bureau = twin.evidence.find(e => e.source === "CREDIT_BUREAU"); if (bureau) bureau.fields.persona = newValue; }
      break;
    default:
      throw new Error(`Unsupported counterfactual attribute ${attr}`);
  }
  return twin;
}

const CANDIDATES = {
  age_band: AGE_BANDS,
  geography_group: ["HIGH_COST", "MEDIUM_COST", "LOW_COST"],
  family_status_scenario: FAMILY_STATUS_SCENARIOS,
  disability_income_scenario: [0, 1],
  persona: ["TEACHER", "NURSE", "SOFTWARE_ENGINEER", "RELOCATED_PROFESSIONAL", "ENTREPRENEUR"]
};

export function counterfactualTests(cases, config, { maxCases = 500 } = {}) {
  const sample = cases.slice(0, maxCases);
  let pairs = 0, unchanged = 0;
  const findings = [];
  for (const c of sample) {
    const base = scoreCase(c, config, { now: "cf" });
    for (const [attr, values] of Object.entries(CANDIDATES)) {
      const current = attrValue(c, attr);
      for (const v of values) {
        if (String(v) === String(current)) continue;
        const twin = makeCounterfactual(c, attr, v);
        const alt = scoreCase(twin, config, { now: "cf" });
        pairs++;
        const same = alt.decision.outcome === base.decision.outcome
          && JSON.stringify([...alt.decision.reason_codes].sort()) === JSON.stringify([...base.decision.reason_codes].sort());
        if (same) unchanged++;
        else if (findings.length < 50) findings.push({ case_id: c.id, attribute: attr, from: current, to: v, base_outcome: base.decision.outcome, alt_outcome: alt.decision.outcome, base_codes: base.decision.reason_codes.join("|"), alt_codes: alt.decision.reason_codes.join("|"), severity: "CRITICAL" });
      }
    }
  }
  return { cases_tested: sample.length, pairs, unchanged, changed: pairs - unchanged, invariance_rate: pairs ? round(unchanged / pairs) : 1, findings };
}

/** Two-sided two-proportion z-test p-value (group vs rest). */
export function twoProportionP(x1, n1, x2, n2) {
  if (!n1 || !n2) return 1;
  const p1 = x1 / n1, p2 = x2 / n2, p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return 1;
  const z = Math.abs(p1 - p2) / se;
  return 2 * (1 - normalCdf(z));
}
function normalCdf(z) { return 0.5 * (1 + erfApprox(z / Math.SQRT2)); }
function erfApprox(x) {
  const sign = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

export function evaluateFairness(cases, config, { maxCounterfactualCases = 300 } = {}) {
  const scored = cases.map(c => scoreCase(c, config, { now: "fair" }));
  const subgroups = subgroupAnalysis(cases, config, scored);
  const counterfactual = counterfactualTests(cases, config, { maxCases: maxCounterfactualCases });

  // Gate only on things that can only be defects: independent scenario attributes and counterfactual invariance.
  // A disparity on an independent attribute is a defect only if it is both practically (four-fifths vs pooled)
  // and statistically (p < 0.005, group vs rest) significant — this keeps the gate free of sampling noise.
  const independent = subgroups.filter(r => r.attribute_class === "INDEPENDENT_SCENARIO" && r.n >= 50);
  const significantDisparities = independent.filter(r => (r.selection_ratio_vs_pooled ?? 1) < 0.8 && r.z_p_value < 0.005);
  const minRatio = significantDisparities.length ? Math.min(...significantDisparities.map(r => r.selection_ratio_vs_pooled)) : 1;
  const derivedBelow = subgroups.filter(r => r.attribute_class === "DERIVED" && r.n >= 30 && (r.selection_rate_ratio ?? 1) < 0.8);

  const status = counterfactual.invariance_rate < 1 ? "FAIL" : minRatio < 0.8 ? "FAIL" : derivedBelow.length ? "WARN" : "PASS";
  return {
    version: FAIRNESS_EVALUATION_VERSION,
    disclaimer: "Technical fairness-testing controls only. Does not establish legal compliance; supports human legal and compliance review.",
    n: cases.length,
    subgroups,
    independent_attribute_min_selection_ratio: round(minRatio, 3),
    independent_attribute_significant_disparities: significantDisparities.map(r => `${r.attribute}=${r.group} (ratio ${r.selection_ratio_vs_pooled}, p=${r.z_p_value})`),
    independent_attribute_ratios: independent.map(r => ({ attribute: r.attribute, group: r.group, n: r.n, ratio_vs_pooled: r.selection_ratio_vs_pooled, p_value: r.z_p_value })),
    derived_attributes_below_four_fifths: derivedBelow.map(r => `${r.attribute}=${r.group} (${r.selection_rate_ratio})`),
    counterfactual,
    status
  };
}

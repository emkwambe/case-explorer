// src/decisioning/policies/feature_policy.js — Three-class data governance for decision inputs.
//
//   PERMITTED  : may be used by rules and models to make a decision.
//   SENSITIVE  : never used to make decisions; available only to controlled fairness testing.
//   PROHIBITED : blocked from model training and scoring entirely (identity, ground truth, labels).
//
// The pipeline rejects prohibited fields automatically (see enforceFeaturePolicy) and the
// Python analytics layer re-implements the same policy from feature_policy.json so both
// runtimes agree on a single source of truth.

export const FEATURE_POLICY_VERSION = "1.0.0";

export const FEATURE_CLASSES = Object.freeze({
  PERMITTED: "PERMITTED",
  SENSITIVE: "SENSITIVE",
  PROHIBITED: "PROHIBITED"
});

/** Attributes that are never decision inputs but drive subgroup / counterfactual fairness tests. */
export const SENSITIVE_ATTRIBUTES = Object.freeze([
  "age",
  "age_band",
  "zip_code",
  "region",
  "geography_group",
  "income_band",
  "family_status_scenario",
  "disability_income_scenario",
  "persona",
  "cost_of_living_index"
]);

/** Prefixes / names that leak ground truth, labels or identity. */
export const PROHIBITED_PREFIXES = Object.freeze(["truth_", "label_", "outcome_", "gt_", "performance_"]);
export const PROHIBITED_FIELDS = Object.freeze([
  "case_id",
  "name",
  "ssn_last4",
  "seed",
  "alignment_level",
  "alignment_level_numeric",
  "fraud_risk_level",
  "coherence_status",
  "case_coherence_status",
  "expected_outcome",
  "decision_reason",
  "difficulty",
  "is_fraud",
  "corruption_type",
  "corruption_severity",
  // Simulated loan performance is what happens after the decision. Using any of it to make
  // the decision would be looking into the future.
  "defaulted",
  "seriously_delinquent",
  "first_payment_default",
  "months_to_default",
  "months_paid",
  "payments_received",
  "realized_loss",
  "loss_given_default",
  "performance_status",
  // Alignment flags are computed *from* truth-vs-claim comparisons in the generator; a real
  // underwriter only sees claim-vs-evidence, so these are label leakage.
  "identity_aligned", "employment_aligned", "income_aligned", "assets_aligned",
  "liabilities_aligned", "address_aligned", "timeline_aligned", "cash_flow_aligned",
  "affordability_aligned", "document_metadata_aligned", "network_aligned", "behavioral_aligned",
  // Any *_diff computed against truth_* is leakage; the permitted equivalents are claim-vs-evidence.
  "salary_diff", "salary_diff_pct", "checking_diff", "checking_diff_pct", "obligations_diff",
  "obligations_diff_pct", "salary_inflated", "checking_inflated", "employer_changed",
  "obligations_understated", "w2_salary_diff", "bank_checking_diff", "bureau_credit_score_diff",
  "employer_name_mismatch", "w2_vs_gross_diff"
]);

export function classifyFeature(name) {
  if (PROHIBITED_FIELDS.includes(name)) return FEATURE_CLASSES.PROHIBITED;
  if (PROHIBITED_PREFIXES.some(p => name.startsWith(p))) return FEATURE_CLASSES.PROHIBITED;
  if (SENSITIVE_ATTRIBUTES.includes(name)) return FEATURE_CLASSES.SENSITIVE;
  return FEATURE_CLASSES.PERMITTED;
}

/**
 * Split a flat feature row into permitted / sensitive / prohibited groups.
 * Throws when `strict` is set and any prohibited field is present — this is the
 * runtime guard that stops label leakage entering a model.
 */
export function enforceFeaturePolicy(row, { strict = true, allowSensitive = false } = {}) {
  const permitted = {};
  const sensitive = {};
  const prohibited = [];
  for (const [k, v] of Object.entries(row)) {
    const cls = classifyFeature(k);
    if (cls === FEATURE_CLASSES.PROHIBITED) prohibited.push(k);
    else if (cls === FEATURE_CLASSES.SENSITIVE) sensitive[k] = v;
    else permitted[k] = v;
  }
  if (strict && prohibited.length > 0) {
    throw new Error(`Feature policy violation: prohibited fields present in decision inputs: ${prohibited.join(", ")}`);
  }
  return { permitted, sensitive: allowSensitive ? sensitive : {}, prohibited };
}

/** Serialisable policy used by the Python layer (analytics/src/case_analytics/features/policy.py). */
export function exportPolicy() {
  return {
    version: FEATURE_POLICY_VERSION,
    sensitive_attributes: [...SENSITIVE_ATTRIBUTES],
    prohibited_prefixes: [...PROHIBITED_PREFIXES],
    prohibited_fields: [...PROHIBITED_FIELDS]
  };
}

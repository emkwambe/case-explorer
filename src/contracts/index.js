// src/contracts/index.js — Versioned domain contracts (Zod) validated at system boundaries.
//
// Explicit types for: world truth, claimed truth, evidence, finding, decision, explanation,
// model output, review action, audit event, and the assembled case. Boundaries (API requests
// and responses, batch export, persistence) call `parseOrThrow`/`safeParse` so schema drift
// fails loudly instead of silently.

import { z } from "zod";

export const CONTRACT_VERSION = "2.0.0";

const money = z.number().finite();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "expected ISO date");
const level = z.enum(["A0", "A1", "A2", "A3", "A4", "A5"]);
export const OUTCOMES = ["APPROVE", "MANUAL_REVIEW", "DECLINE"];
export const CORRUPTION_TYPES = ["NONE", "TIMING_DRIFT", "INFLATION", "CONCEALMENT", "FABRICATION", "BUST_OUT", "EVIDENCE_TAMPERING", "INCOHERENT", "OCCUPANCY_MISREPRESENTATION", "GIFT_FUND_MISREPRESENTATION", "ASSET_SEASONING", "STRAW_BUYER"];
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH"];

export const LifeEvent = z.object({ t: z.string(), type: z.string() }).passthrough();

export const CurrentState = z.object({
  employment_status: z.string().optional(),
  employer: z.string(),
  salary: money.nonnegative(),
  tenure_months: z.number().int().nonnegative().optional(),
  checking_balance: money,
  monthly_obligations: money.nonnegative(),
  dti: z.number().min(0).max(2),
  credit_score: z.number().int().min(300).max(850),
  backend_dti: z.number().nonnegative().optional(),
  monthly_mortgage_payment: money.nonnegative().optional(),
  loan_amount: money.nonnegative().optional()
}).passthrough();

export const WorldTruth = z.object({
  entityId: z.string(),
  demographics: z.object({ age: z.number().int().min(18).max(100), ssn_last4: z.string().length(4), zip_code: z.string(), region: z.string() }).passthrough(),
  events: z.array(LifeEvent),
  current_state: CurrentState
}).passthrough();

export const ClaimedTruth = WorldTruth; // same shape, different provenance

export const EvidenceDocument = z.object({
  source: z.enum(["W2_DOCUMENT", "EMPLOYER_VERIFICATION", "BANK_STATEMENT", "CREDIT_BUREAU", "RENT_VERIFICATION", "GEOGRAPHIC_VERIFICATION"]),
  date: isoDate,
  fields: z.record(z.string(), z.any()),
  fidelity: z.number().min(0).max(1)
});

export const AlignmentFinding = z.object({ dimension: z.string(), level, status: z.string(), details: z.string() });

export const Citation = z.object({ source: z.string(), field: z.string(), value: z.any().optional() });

export const GroundTruthFinding = z.object({
  type: z.string(),
  target_layer: z.enum(["CLAIMED_TRUTH", "WORLD", "EVIDENCE"]),
  claimed_value: z.any(),
  true_value: z.any(),
  classification: level,
  evidence_citations: z.array(Citation),
  details: z.string()
});

export const Label = z.object({
  alignment_level: level,
  fraud_risk_level: z.enum(["NONE", "LOW", "MODERATE", "HIGH", "CRITICAL"]),
  coherence_status: z.string(),
  case_coherence_status: z.string(),
  expected_outcome: z.enum(OUTCOMES),
  difficulty: z.enum(["BASIC", "INTERMEDIATE", "ADVANCED"]),
  conditions: z.array(z.string()),
  reason: z.string(),
  reason_codes: z.array(z.string()),
  reason_code_catalog_version: z.string()
});

export const ApplicationMetadata = z.object({
  submitted: z.string(),
  hour_of_day: z.number().int().min(0).max(23),
  day_of_week: z.number().int().min(0).max(6),
  is_business_hours: z.number().int().min(0).max(1),
  device_fingerprint: z.string().length(32),
  ip_address: z.string(),
  ip_risk_score: z.number().min(0).max(1),
  is_vpn: z.number().int(), is_tor: z.number().int(),
  documents: z.array(z.object({ source: z.string(), created: isoDate, modified: isoDate, pdf_generator: z.string(), days_before_submission: z.number().int().nonnegative() }))
}).passthrough();

export const AuditAttributes = z.object({
  age_band: z.string(), geography_group: z.string(), income_band: z.string(),
  family_status_scenario: z.string(), disability_income_scenario: z.number().int().min(0).max(1),
  policy_class: z.literal("SENSITIVE")
}).passthrough();

export const Case = z.object({
  id: z.string(),
  schema_version: z.string(),
  applicant: z.object({ name: z.string(), age: z.number().int(), ssn_last4: z.string(), zip_code: z.string(), region: z.string() }),
  application: z.object({ loan_type: z.literal("MORTGAGE"), loan_amount: money.nonnegative(), purpose: z.enum(["PURCHASE", "REFINANCE"]), submitted: isoDate }),
  application_metadata: ApplicationMetadata,
  audit_attributes: AuditAttributes,
  truth: WorldTruth,
  presentation: ClaimedTruth,
  evidence: z.array(EvidenceDocument).min(1),
  alignment_findings: z.array(AlignmentFinding),
  ground_truth_findings: z.array(GroundTruthFinding),
  label: Label,
  meta: z.object({ seed: z.union([z.string(), z.number()]).nullable(), generator_version: z.string(), corruption_type: z.enum(CORRUPTION_TYPES), severity: z.enum(SEVERITIES), as_of_date: isoDate }).passthrough()
});

export const Alert = z.object({
  rule_id: z.string(), rule_version: z.string(), severity: z.enum(SEVERITIES), reason_code: z.string(),
  target_scenarios: z.array(z.string()), detail: z.string(), magnitude: z.number().nullable(), evidence_citations: z.array(Citation)
});

export const Decision = z.object({
  policy_version: z.string(),
  outcome: z.enum(OUTCOMES),
  pathway: z.string(),
  reason_codes: z.array(z.string()),
  adverse_action_reasons: z.array(z.object({ code: z.string(), description: z.string() })),
  conditions: z.array(z.string()),
  factors: z.array(z.object({ factor: z.string(), value: z.number(), source: z.string() }).passthrough()),
  thresholds: z.record(z.string(), z.number()),
  governance: z.object({ valid: z.boolean(), problems: z.array(z.string()) })
});

export const Explanation = z.object({
  what_was_detected: z.array(z.any()),
  which_inputs_contributed: z.array(z.any()),
  which_evidence_supports: z.array(Citation),
  which_versions_were_used: z.object({ ruleset: z.string(), policy: z.string(), reason_code_catalog: z.string(), model: z.string().nullable(), model_score: z.number().nullable() }),
  what_would_change_the_outcome: z.array(z.any()),
  automated_or_reviewed: z.enum(["AUTOMATED", "REQUIRES_HUMAN_REVIEW"]),
  reason_codes: z.array(z.object({ code: z.string(), category: z.string().optional(), description: z.string().optional(), adverse_action: z.boolean() }))
});

export const ModelOutput = z.object({
  model_id: z.string(), model_version: z.string(), score: z.number().min(0).max(1), threshold: z.number().min(0).max(1),
  predicted_fraud: z.boolean(), top_contributions: z.array(z.object({ feature: z.string(), contribution: z.number(), reason_code: z.string().optional() })).optional(),
  scored_at: z.string()
});

export const ScoreRecord = z.object({
  case_ref: z.string(), scored_at: z.string(),
  versions: z.object({ ruleset: z.string(), policy: z.string(), reason_code_catalog: z.string(), model: z.string().nullable() }),
  alerts: z.array(Alert), decision: Decision, explanation: Explanation
});

export const REVIEW_ACTION_TYPES = ["TRIAGE", "START_REVIEW", "ADD_NOTE", "CITE_EVIDENCE", "REQUEST_INFORMATION", "RECEIVE_INFORMATION", "ESCALATE", "CLEAR", "CONFIRM", "APPROVE_DISPOSITION", "REJECT_DISPOSITION", "CLOSE", "REOPEN"];
export const ReviewAction = z.object({
  action: z.enum(REVIEW_ACTION_TYPES),
  actor: z.string().min(1),
  role: z.enum(["INVESTIGATOR", "SENIOR_INVESTIGATOR", "REVIEWER", "SYSTEM"]).default("INVESTIGATOR"),
  note: z.string().max(4000).optional(),
  citations: z.array(Citation).optional(),
  reason: z.string().max(1000).optional(),
  disposition: z.enum(["CLEARED", "CONFIRMED_MISREPRESENTATION", "CONFIRMED_DATA_ERROR", "INCONCLUSIVE"]).optional()
});

export const AuditEvent = z.object({
  event_id: z.string(), event_type: z.string(), actor: z.string(), timestamp: z.string(),
  case_version: z.string().nullable(), model_version: z.string().nullable(), policy_version: z.string().nullable(),
  previous_state: z.string().nullable(), new_state: z.string().nullable(), reason: z.string().nullable(),
  payload: z.record(z.string(), z.any()).optional(), previous_hash: z.string().nullable(), hash: z.string()
});

// ── API request contracts ────────────────────────────────────────────────
export const GenerateDatasetRequest = z.object({
  count: z.number().int().min(1).max(10000),
  seed: z.union([z.string().min(1).max(128), z.number()]).optional(),
  adversarial: z.boolean().default(false),
  as_of_date: isoDate.optional(),
  population_regime: z.enum(["baseline", "out_of_time_rate_shock", "high_cost_markets", "subprime_heavy_rate_shock"]).default("baseline"),
  name: z.string().max(120).optional()
});
export const GenerateCaseRequest = z.object({
  corruptionType: z.enum(CORRUPTION_TYPES).default("NONE"),
  severity: z.enum(SEVERITIES).default("LOW"),
  seed: z.union([z.string().min(1).max(128), z.number()]).optional(),
  as_of_date: isoDate.optional()
});
export const TrainModelRequest = z.object({
  strategies: z.array(z.enum(["rules", "logistic_regression", "random_forest", "gradient_boosting"])).default(["rules", "logistic_regression", "random_forest", "gradient_boosting"]),
  dataset_id: z.string().optional(),
  quick: z.boolean().default(true)
});
export const EvaluateModelRequest = z.object({ split: z.enum(["test", "out_of_time", "geography_stress", "economic_regime_stress", "adversarial_fraud", "clean_negative_control"]).default("test") });
export const ScoreCaseRequest = z.object({ model_id: z.string().optional() });

export function parseOrThrow(schema, data, label = "payload") {
  const r = schema.safeParse(data);
  if (!r.success) {
    const err = new Error(`${label} failed contract validation: ${r.error.issues.slice(0, 5).map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
    err.status = 400;
    err.issues = r.error.issues;
    throw err;
  }
  return r.data;
}

export function validateCase(c) { return Case.safeParse(c); }

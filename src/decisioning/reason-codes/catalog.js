// src/decisioning/reason-codes/catalog.js — Governed adverse-action / review reason-code catalog.
//
// Every decision emitted by the decision engine cites zero or more codes from this catalog.
// Codes are versioned, categorised and mapped to the evidence dimension that supports them.
// "Fraud" is never used as a decline reason on its own; fraud indicators drive investigation
// and the decline (if any) is expressed through verification failures or material
// application discrepancies that the evidence actually supports.

export const REASON_CODE_CATALOG_VERSION = "1.0.0";

export const REASON_CATEGORIES = Object.freeze({
  CREDIT_RISK: "CREDIT_RISK",
  FRAUD_INDICATOR: "FRAUD_INDICATOR",
  DATA_QUALITY: "DATA_QUALITY",
  VERIFICATION_FAILURE: "VERIFICATION_FAILURE",
  MANUAL_REVIEW_TRIGGER: "MANUAL_REVIEW_TRIGGER"
});

/**
 * @typedef {Object} ReasonCodeDefinition
 * @property {string} code
 * @property {string} category
 * @property {string} description         Plain-language description suitable for an adverse-action notice.
 * @property {boolean} adverse_action     Whether the code may appear on an adverse-action notice.
 * @property {string[]} dimensions        Alignment dimensions that can support this code.
 * @property {string[]} permitted_inputs  Decision inputs this code may be derived from (feature-policy names).
 */

/** @type {Record<string, ReasonCodeDefinition>} */
export const REASON_CODES = Object.freeze({
  // ── Credit risk (permissible adverse-action reasons) ────────────────────
  INSUFFICIENT_INCOME: {
    code: "INSUFFICIENT_INCOME",
    category: REASON_CATEGORIES.CREDIT_RISK,
    description: "Income is insufficient to support the requested obligation.",
    adverse_action: true,
    dimensions: ["cash_flow", "affordability"],
    permitted_inputs: ["claimed_salary", "evidence_w2_wages", "evidence_monthly_payroll_deposit", "proposed_piti"]
  },
  EXCESSIVE_DTI: {
    code: "EXCESSIVE_DTI",
    category: REASON_CATEGORIES.CREDIT_RISK,
    description: "Debt-to-income ratio exceeds policy limits.",
    adverse_action: true,
    dimensions: ["affordability"],
    permitted_inputs: ["backend_dti", "claimed_monthly_obligations", "evidence_bureau_liabilities"]
  },
  INSUFFICIENT_RESERVES: {
    code: "INSUFFICIENT_RESERVES",
    category: REASON_CATEGORIES.CREDIT_RISK,
    description: "Verified liquid reserves are below the required number of months of housing payment.",
    adverse_action: true,
    dimensions: ["assets"],
    permitted_inputs: ["evidence_checking_balance", "proposed_piti"]
  },
  INSUFFICIENT_CREDIT_SCORE: {
    code: "INSUFFICIENT_CREDIT_SCORE",
    category: REASON_CATEGORIES.CREDIT_RISK,
    description: "Credit score is below the minimum required for this product.",
    adverse_action: true,
    dimensions: ["credit"],
    permitted_inputs: ["evidence_credit_score"]
  },
  LIMITED_EMPLOYMENT_HISTORY: {
    code: "LIMITED_EMPLOYMENT_HISTORY",
    category: REASON_CATEGORIES.CREDIT_RISK,
    description: "Length of verified employment is below policy minimum.",
    adverse_action: true,
    dimensions: ["employment"],
    permitted_inputs: ["claimed_tenure_months", "evidence_hire_date"]
  },

  // ── Verification failures (permissible adverse-action reasons) ──────────
  UNVERIFIABLE_INCOME: {
    code: "UNVERIFIABLE_INCOME",
    category: REASON_CATEGORIES.VERIFICATION_FAILURE,
    description: "Stated income could not be verified against W-2, employer verification or payroll deposits.",
    adverse_action: true,
    dimensions: ["income"],
    permitted_inputs: ["claimed_salary", "evidence_w2_wages", "evidence_employer_salary", "evidence_monthly_payroll_deposit"]
  },
  UNVERIFIABLE_EMPLOYMENT: {
    code: "UNVERIFIABLE_EMPLOYMENT",
    category: REASON_CATEGORIES.VERIFICATION_FAILURE,
    description: "Stated employer could not be verified.",
    adverse_action: true,
    dimensions: ["employment", "timeline"],
    permitted_inputs: ["claimed_employer", "evidence_employer_name", "evidence_w2_employer"]
  },
  UNVERIFIABLE_ASSETS: {
    code: "UNVERIFIABLE_ASSETS",
    category: REASON_CATEGORIES.VERIFICATION_FAILURE,
    description: "Stated assets could not be verified against bank statements.",
    adverse_action: true,
    dimensions: ["assets"],
    permitted_inputs: ["claimed_checking_balance", "evidence_checking_balance"]
  },
  IDENTITY_UNVERIFIABLE: {
    code: "IDENTITY_UNVERIFIABLE",
    category: REASON_CATEGORIES.VERIFICATION_FAILURE,
    description: "Applicant identity could not be verified across bureau and application records.",
    adverse_action: true,
    dimensions: ["identity"],
    permitted_inputs: ["evidence_bureau_file_depth", "evidence_credit_score", "claimed_liability_count"]
  },

  // ── Material discrepancies (permissible adverse-action reasons) ─────────
  MATERIAL_APPLICATION_DISCREPANCY: {
    code: "MATERIAL_APPLICATION_DISCREPANCY",
    category: REASON_CATEGORIES.VERIFICATION_FAILURE,
    description: "Information on the application materially differs from verified documentation.",
    adverse_action: true,
    dimensions: ["income", "assets", "liabilities", "employment"],
    permitted_inputs: ["claimed_salary", "claimed_checking_balance", "claimed_monthly_obligations", "evidence_w2_wages", "evidence_checking_balance", "evidence_bureau_liabilities"]
  },
  UNDISCLOSED_LIABILITIES: {
    code: "UNDISCLOSED_LIABILITIES",
    category: REASON_CATEGORIES.VERIFICATION_FAILURE,
    description: "Credit report shows obligations not disclosed on the application.",
    adverse_action: true,
    dimensions: ["liabilities"],
    permitted_inputs: ["claimed_monthly_obligations", "evidence_bureau_liabilities"]
  },

  // ── Fraud indicators (investigation triggers, NOT standalone decline reasons) ──
  POTENTIAL_DOCUMENT_TAMPERING: {
    code: "POTENTIAL_DOCUMENT_TAMPERING",
    category: REASON_CATEGORIES.FRAUD_INDICATOR,
    description: "Document-level inconsistencies suggest the supporting documentation may have been altered.",
    adverse_action: false,
    dimensions: ["document_metadata", "assets", "income"],
    permitted_inputs: ["evidence_checking_balance", "evidence_monthly_payroll_deposit", "evidence_w2_wages", "evidence_recent_large_deposits", "doc_age_days"]
  },
  UNSOURCED_LARGE_DEPOSIT: {
    code: "UNSOURCED_LARGE_DEPOSIT",
    category: REASON_CATEGORIES.FRAUD_INDICATOR,
    description: "Bank statement shows a large deposit with no documented source.",
    adverse_action: false,
    dimensions: ["assets", "cash_flow"],
    permitted_inputs: ["evidence_recent_large_deposits", "claimed_salary"]
  },
  RAPID_CREDIT_PROFILE_CONSTRUCTION: {
    code: "RAPID_CREDIT_PROFILE_CONSTRUCTION",
    category: REASON_CATEGORIES.FRAUD_INDICATOR,
    description: "Credit profile was built unusually quickly relative to its depth and score.",
    adverse_action: false,
    dimensions: ["identity"],
    permitted_inputs: ["evidence_bureau_file_depth", "evidence_credit_score", "claimed_liability_count"]
  },
  HIGH_RISK_NETWORK_ORIGIN: {
    code: "HIGH_RISK_NETWORK_ORIGIN",
    category: REASON_CATEGORIES.FRAUD_INDICATOR,
    description: "Application originated from an anonymised or high-risk network location.",
    adverse_action: false,
    dimensions: ["network"],
    permitted_inputs: ["ip_risk_score", "is_tor", "is_vpn"]
  },
  SUSPICIOUS_DOCUMENT_METADATA: {
    code: "SUSPICIOUS_DOCUMENT_METADATA",
    category: REASON_CATEGORIES.FRAUD_INDICATOR,
    description: "Supporting documents were created implausibly close to submission.",
    adverse_action: false,
    dimensions: ["document_metadata"],
    permitted_inputs: ["doc_age_days"]
  },
  ANOMALOUS_APPLICATION_BEHAVIOR: {
    code: "ANOMALOUS_APPLICATION_BEHAVIOR",
    category: REASON_CATEGORIES.FRAUD_INDICATOR,
    description: "Application session behaviour is inconsistent with a natural applicant.",
    adverse_action: false,
    dimensions: ["behavioral"],
    permitted_inputs: ["fields_copy_pasted", "session_duration_seconds", "typing_speed_wpm"]
  },
  SHARED_ENTITY_LINKAGE: {
    code: "SHARED_ENTITY_LINKAGE",
    category: REASON_CATEGORIES.FRAUD_INDICATOR,
    description: "Application shares devices, addresses, employers or documents with other applications.",
    adverse_action: false,
    dimensions: ["network"],
    permitted_inputs: ["device_fingerprint", "ip_address", "claimed_employer", "document_fingerprint"]
  },

  // ── Data-quality problems ────────────────────────────────────────────────
  DATA_INTEGRITY_FAILURE: {
    code: "DATA_INTEGRITY_FAILURE",
    category: REASON_CATEGORIES.DATA_QUALITY,
    description: "Submitted information is internally impossible or violates accounting/timeline invariants.",
    adverse_action: false,
    dimensions: ["timeline", "cash_flow", "affordability", "income"],
    permitted_inputs: ["claimed_salary", "claimed_monthly_obligations", "evidence_w2_wages", "event_timeline"]
  },
  MISSING_REQUIRED_DOCUMENT: {
    code: "MISSING_REQUIRED_DOCUMENT",
    category: REASON_CATEGORIES.DATA_QUALITY,
    description: "A required supporting document is missing.",
    adverse_action: false,
    dimensions: ["document_metadata"],
    permitted_inputs: ["evidence_sources_present"]
  },

  // ── Manual-review triggers ───────────────────────────────────────────────
  ELEVATED_DTI: {
    code: "ELEVATED_DTI",
    category: REASON_CATEGORIES.MANUAL_REVIEW_TRIGGER,
    description: "Debt-to-income ratio is above the automatic-approval limit but within the manual-review band.",
    adverse_action: false,
    dimensions: ["affordability"],
    permitted_inputs: ["backend_dti"]
  },
  MARGINAL_CREDIT_SCORE: {
    code: "MARGINAL_CREDIT_SCORE",
    category: REASON_CATEGORIES.MANUAL_REVIEW_TRIGGER,
    description: "Credit score is within the manual-review band.",
    adverse_action: false,
    dimensions: ["credit"],
    permitted_inputs: ["evidence_credit_score"]
  },
  SHORT_EMPLOYMENT_TENURE: {
    code: "SHORT_EMPLOYMENT_TENURE",
    category: REASON_CATEGORIES.MANUAL_REVIEW_TRIGGER,
    description: "Employment tenure is within the manual-review band.",
    adverse_action: false,
    dimensions: ["employment"],
    permitted_inputs: ["claimed_tenure_months", "evidence_hire_date"]
  },
  EMPLOYER_NAME_VARIATION: {
    code: "EMPLOYER_NAME_VARIATION",
    category: REASON_CATEGORIES.MANUAL_REVIEW_TRIGGER,
    description: "Employer name differs slightly across supporting documents.",
    adverse_action: false,
    dimensions: ["employment"],
    permitted_inputs: ["claimed_employer", "evidence_w2_employer", "evidence_employer_name"]
  },
  TIGHT_RESIDUAL_INCOME: {
    code: "TIGHT_RESIDUAL_INCOME",
    category: REASON_CATEGORIES.MANUAL_REVIEW_TRIGGER,
    description: "Residual income after obligations and proposed housing payment is thin.",
    adverse_action: false,
    dimensions: ["cash_flow"],
    permitted_inputs: ["claimed_salary", "claimed_monthly_obligations", "proposed_piti"]
  },
  INCOME_VARIANCE_REVIEW: {
    code: "INCOME_VARIANCE_REVIEW",
    category: REASON_CATEGORIES.MANUAL_REVIEW_TRIGGER,
    description: "Stated income differs from verified income by a non-material amount; re-underwrite on verified income.",
    adverse_action: false,
    dimensions: ["income"],
    permitted_inputs: ["claimed_salary", "evidence_employer_salary", "evidence_w2_wages"]
  },
  LIABILITY_VARIANCE_REVIEW: {
    code: "LIABILITY_VARIANCE_REVIEW",
    category: REASON_CATEGORIES.MANUAL_REVIEW_TRIGGER,
    description: "Bureau obligations differ from disclosed obligations by a non-material amount; re-underwrite on bureau obligations.",
    adverse_action: false,
    dimensions: ["liabilities"],
    permitted_inputs: ["claimed_monthly_obligations", "evidence_bureau_liabilities"]
  },
  ASSET_VARIANCE_REVIEW: {
    code: "ASSET_VARIANCE_REVIEW",
    category: REASON_CATEGORIES.MANUAL_REVIEW_TRIGGER,
    description: "Stated assets differ from bank statement by a non-material amount; use verified balance.",
    adverse_action: false,
    dimensions: ["assets"],
    permitted_inputs: ["claimed_checking_balance", "evidence_checking_balance"]
  },
  GENERAL_REVIEW_REQUIRED: {
    code: "GENERAL_REVIEW_REQUIRED",
    category: REASON_CATEGORIES.MANUAL_REVIEW_TRIGGER,
    description: "Case requires underwriter review for reasons not covered by a specific trigger.",
    adverse_action: false,
    dimensions: [],
    permitted_inputs: []
  }
});

export const REASON_CODE_LIST = Object.freeze(Object.keys(REASON_CODES));

export function getReasonCode(code) {
  const def = REASON_CODES[code];
  if (!def) throw new Error(`Unknown reason code: ${code}`);
  return def;
}

export function isValidReasonCode(code) {
  return Object.prototype.hasOwnProperty.call(REASON_CODES, code);
}

/** Codes permitted on an adverse-action notice (credit-risk + verification failures). */
export function adverseActionCodes(codes) {
  return codes.filter(c => REASON_CODES[c]?.adverse_action);
}

/** Codes that only trigger investigation and must never be stated as the decline reason. */
export function investigationCodes(codes) {
  return codes.filter(c => REASON_CODES[c]?.category === REASON_CATEGORIES.FRAUD_INDICATOR);
}

export function groupByCategory(codes) {
  const out = {};
  for (const c of codes) {
    const def = REASON_CODES[c];
    if (!def) continue;
    (out[def.category] ||= []).push(c);
  }
  return out;
}

/**
 * Validate a decision's reason codes against governance rules:
 *  - every code exists in the catalog
 *  - a DECLINE must cite at least one adverse-action-eligible code
 *  - a DECLINE may not be justified *only* by fraud indicators
 */
export function validateDecisionReasonCodes(outcome, codes) {
  const problems = [];
  for (const c of codes) if (!isValidReasonCode(c)) problems.push(`unknown reason code ${c}`);
  if (outcome === "DECLINE") {
    const aa = adverseActionCodes(codes);
    if (aa.length === 0) problems.push("DECLINE must cite at least one adverse-action-eligible reason code");
    if (codes.length > 0 && investigationCodes(codes).length === codes.length) {
      problems.push("DECLINE cannot be justified solely by fraud indicators");
    }
  }
  return { valid: problems.length === 0, problems };
}

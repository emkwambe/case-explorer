// src/decisioning/underwriting/policy.js — Rule-based underwriting decision policy.
//
// Input: decision view + fraud alerts. Output: outcome, governed reason codes, conditions,
// and the factor table used for explanations. Uses PERMITTED inputs only — it never reads
// `truth`, `label` or `audit_attributes`.

import { validateDecisionReasonCodes, REASON_CODES } from "../reason-codes/catalog.js";

export const UNDERWRITING_POLICY_VERSION = "2.1.0";

export function policyThresholds(config = {}) {
  const u = config.underwriting || {};
  return {
    dti_approve_max: (u.dti?.approve_max ?? 0.38) * 100,
    dti_manual_max: (u.dti?.manual_review_max ?? 0.47) * 100,
    credit_approve_min: u.credit_score?.approve_min ?? 640,
    credit_manual_min: u.credit_score?.manual_review_min ?? 600,
    reserves_approve_min: u.reserves?.approve_min_months ?? 0.25,
    reserves_manual_min: u.reserves?.manual_review_min_months ?? 0.1,
    tenure_approve_min: u.tenure?.approve_min_months ?? 12,
    tenure_manual_min: u.tenure?.manual_review_min_months ?? 6
  };
}

/**
 * @param {object} view    from extractDecisionView
 * @param {Array}  alerts  from runFraudRules(view).alerts
 * @param {object} config  distribution_config (for underwriting thresholds)
 */
export function decideCase(view, alerts, config = {}) {
  const th = policyThresholds(config);
  const cl = view.claims, ev = view.evidence;
  const reasonCodes = new Set();
  const conditions = [];
  const factors = [];

  // Underwrite on VERIFIED income and the HIGHER of disclosed vs bureau obligations.
  const verifiedSalary = ev.employer_salary ?? ev.w2_wages ?? cl.salary ?? 0;
  const monthlyIncome = verifiedSalary / 12;
  const obligations = Math.max(cl.monthly_obligations ?? 0, ev.bureau_monthly_obligations ?? 0);
  const backendDti = ((obligations) + (view.loan.proposed_piti ?? 0)) / Math.max(1, monthlyIncome);
  const dtiPct = backendDti * 100;
  const creditScore = ev.credit_score ?? cl.credit_score ?? 0;
  const reservesMonths = monthlyIncome > 0 ? (ev.checking_balance ?? cl.checking_balance ?? 0) / monthlyIncome : 0;
  const tenureMonths = cl.tenure_months ?? 0;

  factors.push(
    { factor: "backend_dti_pct", value: round(dtiPct, 1), approve_max: th.dti_approve_max, review_max: th.dti_manual_max, source: "EMPLOYER_VERIFICATION.salary + max(claims.monthly_obligations, CREDIT_BUREAU.liabilities) + proposed PITI" },
    { factor: "credit_score", value: creditScore, approve_min: th.credit_approve_min, review_min: th.credit_manual_min, source: "CREDIT_BUREAU.credit_score" },
    { factor: "reserves_months", value: round(reservesMonths, 2), approve_min: th.reserves_approve_min, review_min: th.reserves_manual_min, source: "BANK_STATEMENT.checking_balance" },
    { factor: "tenure_months", value: tenureMonths, approve_min: th.tenure_approve_min, review_min: th.tenure_manual_min, source: "claims.tenure_months" }
  );

  const high = alerts.filter(a => a.severity === "HIGH");
  const medium = alerts.filter(a => a.severity === "MEDIUM");
  const low = alerts.filter(a => a.severity === "LOW");
  const integrity = high.find(a => a.reason_code === "DATA_INTEGRITY_FAILURE");
  const networkOrDocs = medium.filter(a => ["HIGH_RISK_NETWORK_ORIGIN", "SUSPICIOUS_DOCUMENT_METADATA"].includes(a.reason_code));

  let outcome;
  let pathway;

  if (integrity) {
    // Data-quality failure: cannot decision on impossible data.
    outcome = "DECLINE";
    pathway = "DATA_INTEGRITY";
    reasonCodes.add("DATA_INTEGRITY_FAILURE");
    reasonCodes.add("MATERIAL_APPLICATION_DISCREPANCY");
    conditions.push("Review for data entry errors or impossible financial scenario");
  } else if (high.length > 0) {
    // Verification failures / material discrepancies supported by evidence → decline-eligible.
    outcome = "DECLINE";
    pathway = "VERIFICATION_FAILURE";
    for (const a of high) reasonCodes.add(a.reason_code);
    for (const a of medium) reasonCodes.add(a.reason_code);
    // Investigation triggers travel with the decision but never justify it alone.
    if (high.some(a => a.reason_code === "IDENTITY_UNVERIFIABLE")) reasonCodes.add("RAPID_CREDIT_PROFILE_CONSTRUCTION");
    if (high.some(a => a.reason_code === "POTENTIAL_DOCUMENT_TAMPERING")) reasonCodes.add("UNVERIFIABLE_ASSETS");
    if (high.some(a => ["UNVERIFIABLE_INCOME", "UNVERIFIABLE_ASSETS", "UNDISCLOSED_LIABILITIES"].includes(a.reason_code))) reasonCodes.add("MATERIAL_APPLICATION_DISCREPANCY");
    if (dtiPct > th.dti_manual_max) reasonCodes.add("EXCESSIVE_DTI");
    conditions.push("Escalate to fraud investigation unit");
    conditions.push("Request original source documents");
  } else if (networkOrDocs.length > 0) {
    // Generator policy: high-risk origin or implausible document ages block automated approval.
    outcome = "DECLINE";
    pathway = "NETWORK_OR_DOCUMENT_RISK";
    for (const a of networkOrDocs) reasonCodes.add(a.reason_code);
    reasonCodes.add("IDENTITY_UNVERIFIABLE");
    conditions.push("Verify applicant identity and device provenance");
    conditions.push("Request original source documents");
  } else {
    const failDti = dtiPct > th.dti_manual_max;
    const failCredit = creditScore < th.credit_manual_min;
    const failReserves = reservesMonths < th.reserves_manual_min;
    const failTenure = tenureMonths < th.tenure_manual_min;

    if (dtiPct <= th.dti_approve_max && creditScore >= th.credit_approve_min && reservesMonths >= th.reserves_approve_min && tenureMonths >= th.tenure_approve_min && medium.length === 0) {
      outcome = "APPROVE";
      pathway = "AUTOMATED_APPROVAL";
    } else if (!failDti && !failCredit && !failReserves && !failTenure) {
      outcome = "MANUAL_REVIEW";
      pathway = medium.length ? "REVIEW_TRIGGERED_BY_ALERT" : "MANUAL_REVIEW_BAND";
      if (dtiPct > th.dti_approve_max) reasonCodes.add("ELEVATED_DTI");
      if (creditScore < th.credit_approve_min) reasonCodes.add("MARGINAL_CREDIT_SCORE");
      if (tenureMonths < th.tenure_approve_min) reasonCodes.add("SHORT_EMPLOYMENT_TENURE");
      if (reservesMonths < th.reserves_approve_min) reasonCodes.add("INSUFFICIENT_RESERVES");
      for (const a of medium) reasonCodes.add(a.reason_code);
      for (const a of low) reasonCodes.add(a.reason_code);
      if (reasonCodes.size === 0) reasonCodes.add("GENERAL_REVIEW_REQUIRED");
      conditions.push("Verify large deposits");
      conditions.push("Obtain written VOE");
    } else {
      outcome = "DECLINE";
      pathway = "CREDIT_RISK";
      if (failDti) reasonCodes.add("EXCESSIVE_DTI");
      if (failCredit) reasonCodes.add("INSUFFICIENT_CREDIT_SCORE");
      if (failReserves) reasonCodes.add("INSUFFICIENT_RESERVES");
      if (failTenure) reasonCodes.add("LIMITED_EMPLOYMENT_HISTORY");
      for (const a of medium) reasonCodes.add(a.reason_code);
      conditions.push("Reduce DTI or increase income");
    }
  }

  const codes = [...reasonCodes];
  const governance = validateDecisionReasonCodes(outcome, codes);
  if (!governance.valid) {
    // Fail closed: a decline that governance rejects becomes a manual review with the finding attached.
    outcome = "MANUAL_REVIEW";
    codes.push("GENERAL_REVIEW_REQUIRED");
    pathway = "GOVERNANCE_FALLBACK";
  }

  return {
    policy_version: UNDERWRITING_POLICY_VERSION,
    outcome,
    pathway,
    reason_codes: codes,
    adverse_action_reasons: codes.filter(c => REASON_CODES[c]?.adverse_action).map(c => ({ code: c, description: REASON_CODES[c].description })),
    conditions,
    factors,
    thresholds: th,
    governance
  };
}

function round(x, d) { const m = Math.pow(10, d); return Math.round(x * m) / m; }

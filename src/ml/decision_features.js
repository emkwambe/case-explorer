// src/ml/decision_features.js — The underwriter-visible view of a case.
//
// A real decision system never sees `truth`. It sees what the applicant CLAIMED, the
// EVIDENCE that was collected, and the application METADATA. Everything here is derived
// from those three layers only. `extractMLFeatures` (features.js) still exists for
// generator diagnostics, but it contains truth_* columns and is therefore PROHIBITED as
// model input by the feature policy.

import { enforceFeaturePolicy } from "../decisioning/policies/feature_policy.js";

export const DECISION_FEATURE_SCHEMA_VERSION = "1.0.0";

function safeDiv(n, d) { return d ? n / d : 0; }
function findSource(evidence, source) { return evidence.find(e => e.source === source); }
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

/**
 * Structured decision view. Used by fraud rules, the underwriting policy and explanations.
 * Every value carries a provenance so findings can cite it.
 */
export function extractDecisionView(c) {
  const p = c.presentation?.current_state || {};
  const claimedEvents = c.presentation?.events || [];
  const evidence = c.evidence || [];
  const md = c.application_metadata || {};

  const w2Doc = findSource(evidence, "W2_DOCUMENT");
  const empDoc = findSource(evidence, "EMPLOYER_VERIFICATION");
  const bankDoc = findSource(evidence, "BANK_STATEMENT");
  const bureauDoc = findSource(evidence, "CREDIT_BUREAU");
  const rentDoc = findSource(evidence, "RENT_VERIFICATION");
  const w2 = w2Doc?.fields || {};
  const emp = empDoc?.fields || {};
  const bank = bankDoc?.fields || {};
  const bureau = bureauDoc?.fields || {};
  const rent = rentDoc?.fields || {};

  const claimedLiabilities = claimedEvents.filter(e => e.type === "LIABILITY_OPENED");
  const claimedEmpStart = claimedEvents.find(e => e.type === "EMPLOYMENT_START");
  const bureauLiabilities = bureau.liabilities || [];
  const bureauMonthlyObligations = bureauLiabilities.reduce((s, l) => s + (l.payment || 0), 0);
  const docs = md.documents || [];
  const docAges = docs.map(d => d.days_before_submission);

  const liabDates = claimedLiabilities.map(e => new Date(e.t).getTime()).sort((a, b) => a - b);
  const liabilityClusterDays = liabDates.length >= 2 ? (liabDates[liabDates.length - 1] - liabDates[0]) / 86400000 : null;

  const checksPerYear = emp.pay_frequency === "BIWEEKLY" ? 26 : emp.pay_frequency === "SEMIMONTHLY" ? 24 : 12;
  const expectedMonthlyNet = emp.net_per_check ? emp.net_per_check * checksPerYear / 12 : null;

  return {
    schema_version: DECISION_FEATURE_SCHEMA_VERSION,
    case_ref: c.id,
    submitted: c.application?.submitted,
    loan: {
      amount: c.application?.loan_amount,
      purpose: c.application?.purpose,
      proposed_piti: p.monthly_mortgage_payment ?? 0
    },
    claims: {
      salary: p.salary,
      employer: p.employer,
      employment_start: claimedEmpStart?.t ?? null,
      tenure_months: p.tenure_months,
      checking_balance: p.checking_balance,
      monthly_obligations: p.monthly_obligations,
      liability_count: claimedLiabilities.length,
      liability_cluster_days: liabilityClusterDays,
      credit_score: p.credit_score,
      backend_dti: p.backend_dti,
      stated_dti: p.dti,
      events: claimedEvents
    },
    evidence: {
      sources_present: evidence.map(e => e.source),
      w2_wages: w2.w2_wages,
      w2_employer: w2.employer,
      employer_name: emp.employer,
      employer_salary: emp.salary,
      employer_hire_date: emp.hire_date,
      employer_net_per_check: emp.net_per_check,
      employer_pay_frequency: emp.pay_frequency,
      expected_monthly_net_deposit: expectedMonthlyNet,
      checking_balance: bank.checking_balance,
      monthly_payroll_deposit: bank.monthly_payroll_deposit,
      recent_large_deposits: bank.recent_large_deposits || [],
      overdraft_count: bank.overdraft_count ?? 0,
      months_of_statements: bank.months_of_statements,
      recurring_debits_total: (bank.recurring_debits || []).reduce((s, d) => s + (d.amount || 0), 0),
      credit_score: bureau.credit_score,
      open_accounts: bureau.open_accounts,
      bureau_liability_count: bureauLiabilities.length,
      bureau_monthly_obligations: bureauMonthlyObligations,
      rent_monthly: rent.monthly_rent,
      lease_start: rent.lease_start
    },
    metadata: {
      hour_of_day: md.hour_of_day,
      day_of_week: md.day_of_week,
      is_business_hours: md.is_business_hours,
      ip_risk_score: md.ip_risk_score,
      is_vpn: md.is_vpn,
      is_tor: md.is_tor,
      typing_speed_wpm: md.typing_speed_wpm,
      fields_copy_pasted: md.fields_copy_pasted,
      session_duration_seconds: md.session_duration_seconds,
      used_autofill: md.used_autofill,
      device_fingerprint: md.device_fingerprint,
      ip_address: md.ip_address,
      min_doc_age_days: docAges.length ? Math.min(...docAges) : null,
      max_doc_age_days: docAges.length ? Math.max(...docAges) : null,
      docs_created_within_2_days: docAges.filter(d => d <= 2).length,
      document_count: docs.length
    },
    // Provenance map so explanations can cite the document a value came from.
    citations: {
      w2_wages: { source: "W2_DOCUMENT", field: "w2_wages" },
      employer_salary: { source: "EMPLOYER_VERIFICATION", field: "salary" },
      employer_name: { source: "EMPLOYER_VERIFICATION", field: "employer" },
      employer_hire_date: { source: "EMPLOYER_VERIFICATION", field: "hire_date" },
      checking_balance: { source: "BANK_STATEMENT", field: "checking_balance" },
      monthly_payroll_deposit: { source: "BANK_STATEMENT", field: "monthly_payroll_deposit" },
      recent_large_deposits: { source: "BANK_STATEMENT", field: "recent_large_deposits" },
      credit_score: { source: "CREDIT_BUREAU", field: "credit_score" },
      bureau_liabilities: { source: "CREDIT_BUREAU", field: "liabilities" },
      lease_start: { source: "RENT_VERIFICATION", field: "lease_start" },
      ip_risk_score: { source: "APPLICATION_METADATA", field: "ip_risk_score" },
      documents: { source: "APPLICATION_METADATA", field: "documents" }
    },
    _timeline: {
      claimed_employment_start_vs_hire_date_days: (claimedEmpStart?.t && emp.hire_date) ? daysBetween(emp.hire_date, claimedEmpStart.t) : null,
      rent_before_lease: claimedEvents.some(e => e.type === "RENT_PAYMENT" && rent.lease_start && new Date(e.t) < new Date(rent.lease_start)),
      deposit_before_employment: claimedEvents.some(e => e.type === "SALARY_DEPOSIT" && claimedEmpStart?.t && new Date(e.t) < new Date(claimedEmpStart.t))
    }
  };
}

/**
 * Flat, numeric, PERMITTED-only feature row for models. Discrepancies are claim-vs-evidence,
 * never claim-vs-truth. Sensitive attributes are returned separately and never mixed in.
 */
export function extractDecisionFeatures(c) {
  const v = extractDecisionView(c);
  const cl = v.claims, ev = v.evidence, md = v.metadata;
  const verifiedSalary = ev.employer_salary ?? ev.w2_wages ?? cl.salary ?? 0;
  const claimedSalary = cl.salary ?? 0;
  const monthlyIncome = claimedSalary / 12;
  const verifiedMonthlyIncome = verifiedSalary / 12;

  const row = {
    loan_amount: v.loan.amount ?? 0,
    proposed_piti: v.loan.proposed_piti ?? 0,
    purpose_refinance: v.loan.purpose === "REFINANCE" ? 1 : 0,

    claimed_salary: claimedSalary,
    claimed_checking_balance: cl.checking_balance ?? 0,
    claimed_monthly_obligations: cl.monthly_obligations ?? 0,
    claimed_tenure_months: cl.tenure_months ?? 0,
    claimed_liability_count: cl.liability_count,
    claimed_liability_cluster_days: cl.liability_cluster_days ?? 9999,
    claimed_backend_dti: cl.backend_dti ?? 0,

    evidence_w2_wages: ev.w2_wages ?? 0,
    evidence_employer_salary: ev.employer_salary ?? 0,
    evidence_checking_balance: ev.checking_balance ?? 0,
    evidence_monthly_payroll_deposit: ev.monthly_payroll_deposit ?? 0,
    evidence_expected_monthly_net: ev.expected_monthly_net_deposit ?? 0,
    evidence_credit_score: ev.credit_score ?? 0,
    evidence_open_accounts: ev.open_accounts ?? 0,
    evidence_bureau_liability_count: ev.bureau_liability_count,
    evidence_bureau_monthly_obligations: ev.bureau_monthly_obligations,
    evidence_overdraft_count: ev.overdraft_count,
    evidence_large_deposit_count: ev.recent_large_deposits.length,
    evidence_large_deposit_total: ev.recent_large_deposits.reduce((s, d) => s + (d.amount || 0), 0),
    evidence_rent_monthly: ev.rent_monthly ?? 0,

    // Claim-vs-evidence discrepancies (legitimate underwriting signals)
    disc_salary_vs_employer_pct: safeDiv(claimedSalary - (ev.employer_salary ?? claimedSalary), ev.employer_salary ?? 1),
    disc_salary_vs_w2_pct: safeDiv(claimedSalary - (ev.w2_wages ?? claimedSalary), ev.w2_wages ?? 1),
    disc_checking_vs_bank_pct: safeDiv((cl.checking_balance ?? 0) - (ev.checking_balance ?? cl.checking_balance ?? 0), ev.checking_balance ?? 1),
    disc_obligations_vs_bureau: (ev.bureau_monthly_obligations ?? 0) - (cl.monthly_obligations ?? 0),
    disc_obligations_vs_bureau_pct: safeDiv((ev.bureau_monthly_obligations ?? 0) - (cl.monthly_obligations ?? 0), Math.max(1, ev.bureau_monthly_obligations ?? 1)),
    disc_liability_count: (ev.bureau_liability_count ?? 0) - (cl.liability_count ?? 0),
    disc_employer_name_mismatch: (cl.employer && ev.employer_name && cl.employer !== ev.employer_name) ? 1 : 0,
    disc_w2_employer_variation: (ev.w2_employer && ev.employer_name && ev.w2_employer !== ev.employer_name) ? 1 : 0,
    disc_payroll_vs_expected_pct: safeDiv((ev.monthly_payroll_deposit ?? 0) - (ev.expected_monthly_net_deposit ?? ev.monthly_payroll_deposit ?? 0), ev.expected_monthly_net_deposit ?? 1),
    disc_credit_score_claim_vs_bureau: (cl.credit_score ?? ev.credit_score ?? 0) - (ev.credit_score ?? 0),
    disc_employment_start_vs_hire_days: v._timeline.claimed_employment_start_vs_hire_date_days ?? 0,
    disc_w2_exceeds_gross: (ev.w2_wages ?? 0) > claimedSalary * 1.02 ? 1 : 0,
    timeline_rent_before_lease: v._timeline.rent_before_lease ? 1 : 0,
    timeline_deposit_before_employment: v._timeline.deposit_before_employment ? 1 : 0,

    // Ratios an underwriter would compute
    reserves_months_verified: safeDiv(ev.checking_balance ?? 0, Math.max(1, v.loan.proposed_piti || 1)),
    backend_dti_verified: safeDiv((cl.monthly_obligations ?? 0) + (v.loan.proposed_piti ?? 0), verifiedMonthlyIncome || 1),
    backend_dti_bureau: safeDiv((ev.bureau_monthly_obligations ?? 0) + (v.loan.proposed_piti ?? 0), verifiedMonthlyIncome || 1),
    residual_income_claimed: monthlyIncome - (cl.monthly_obligations ?? 0) - (v.loan.proposed_piti ?? 0),
    obligations_to_income: safeDiv(cl.monthly_obligations ?? 0, monthlyIncome || 1),
    rent_to_income: safeDiv(ev.rent_monthly ?? 0, monthlyIncome || 1),
    loan_to_income: safeDiv(v.loan.amount ?? 0, claimedSalary || 1),

    // Application metadata
    hour_of_day: md.hour_of_day ?? 12,
    is_business_hours: md.is_business_hours ?? 1,
    ip_risk_score: md.ip_risk_score ?? 0,
    is_vpn: md.is_vpn ?? 0,
    is_tor: md.is_tor ?? 0,
    typing_speed_wpm: md.typing_speed_wpm ?? 40,
    fields_copy_pasted: md.fields_copy_pasted ?? 0,
    session_duration_seconds: md.session_duration_seconds ?? 300,
    used_autofill: md.used_autofill ?? 0,
    min_doc_age_days: md.min_doc_age_days ?? 30,
    docs_created_within_2_days: md.docs_created_within_2_days ?? 0
  };

  // Runtime guard: throws if anything prohibited slipped in.
  enforceFeaturePolicy(row, { strict: true });

  const sensitive = {
    age: c.applicant?.age,
    age_band: c.audit_attributes?.age_band,
    region: c.applicant?.region,
    geography_group: c.audit_attributes?.geography_group,
    income_band: c.audit_attributes?.income_band,
    family_status_scenario: c.audit_attributes?.family_status_scenario,
    disability_income_scenario: c.audit_attributes?.disability_income_scenario,
    persona: c.audit_attributes?.persona
  };

  const labels = {
    case_id: c.id,
    // Injection ground truth: whether a typology was actually applied. Not policy-derived.
    is_fraud: isFraudCase(c) ? 1 : 0,
    fraud_type: c.meta?.corruption_type ?? "UNKNOWN",
    severity: c.meta?.severity ?? "UNKNOWN",
    // Observed outcome ground truth: simulated loan performance if funded. Not policy-derived.
    defaulted: c.performance?.defaulted ?? null,
    seriously_delinquent: c.performance?.seriously_delinquent ?? null,
    first_payment_default: c.performance?.first_payment_default ?? null,
    performance_status: c.performance?.status ?? null,
    months_to_default: c.performance?.months_to_default ?? null,
    realized_loss: c.performance?.realized_loss ?? null,
    loan_amount: c.application?.loan_amount ?? null,
    // Reference policy opinion, kept for diagnostics. This one IS policy-derived and must
    // not be used as a training target.
    reference_outcome: c.label?.expected_outcome,
    reason_codes: (c.label?.reason_codes || []).join("|"),
    regime: c.truth?.current_state?.regime,
    split_hint: null
  };

  return { features: row, sensitive, labels };
}

export const FRAUD_CORRUPTION_TYPES = Object.freeze([
  "INFLATION", "CONCEALMENT", "FABRICATION", "BUST_OUT", "EVIDENCE_TAMPERING",
  "OCCUPANCY_MISREPRESENTATION", "GIFT_FUND_MISREPRESENTATION", "ASSET_SEASONING", "STRAW_BUYER"
]);

export function isFraudCase(c) {
  const t = c.meta?.corruption_type;
  if (t) return FRAUD_CORRUPTION_TYPES.includes(t);
  return ["LOW", "MODERATE", "HIGH", "CRITICAL"].includes(c.label?.fraud_risk_level) && c.label?.alignment_level !== "A3";
}

export function decisionRowsToCsv(rows) {
  if (rows.length === 0) return "";
  const featureKeys = Object.keys(rows[0].features);
  const sensitiveKeys = Object.keys(rows[0].sensitive).map(k => `sensitive__${k}`);
  const labelKeys = Object.keys(rows[0].labels).map(k => `label__${k}`);
  const headers = [...featureKeys, ...sensitiveKeys, ...labelKeys];
  const esc = (val) => {
    const s = val === undefined || val === null ? "" : String(val);
    return (s.includes(",") || s.includes('"') || s.includes("\n")) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map(r => [
    ...featureKeys.map(k => esc(r.features[k])),
    ...Object.keys(r.sensitive).map(k => esc(r.sensitive[k])),
    ...Object.keys(r.labels).map(k => esc(r.labels[k]))
  ].join(","));
  return headers.join(",") + "\n" + lines.join("\n");
}

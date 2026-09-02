// src/ml/features.js — ML feature extraction and CSV export utilities.

const ALIGNMENT_LEVEL_ORDER = { A0: 0, A1: 1, A2: 2, A3: 3, A4: 4, A5: 5 };

function safeDiv(numer, denom) { return denom ? numer / denom : 0; }

export function extractMLFeatures(c) {
  const t = c.truth?.current_state || {};
  const p = c.presentation?.current_state || {};
  const label = c.label || {};
  const findings = c.alignment_findings || [];
  const evidence = c.evidence || [];

  const w2 = evidence.find(e => e.source === "W2_DOCUMENT")?.fields || {};
  const bank = evidence.find(e => e.source === "BANK_STATEMENT")?.fields || {};
  const bureau = evidence.find(e => e.source === "CREDIT_BUREAU")?.fields || {};
  const employerVerif = evidence.find(e => e.source === "EMPLOYER_VERIFICATION")?.fields || {};

  const salaryDiff = (p.salary ?? t.salary ?? 0) - (t.salary ?? 0);
  const checkingDiff = (p.checking_balance ?? t.checking_balance ?? 0) - (t.checking_balance ?? 0);
  const obligationsDiff = (t.monthly_obligations ?? 0) - (p.monthly_obligations ?? 0);

  const dimensionAligned = (dim) => {
    const f = findings.find(x => x.dimension === dim);
    return f ? (f.level === "A0" ? 1 : 0) : 1;
  };

  const outcome = label.expected_outcome || "DECLINE";
  const fraudRisk = label.fraud_risk_level || "NONE";

  return {
    // Identifiers & demographics
    case_id: c.id,
    name: c.applicant?.name,
    age: c.applicant?.age,
    zip_code: c.applicant?.zip_code,
    region: c.applicant?.region,
    cost_of_living_index: t.cost_of_living_index,
    loan_amount: c.application?.loan_amount,
    purpose: c.application?.purpose,
    regime: t.regime || "UNKNOWN",
    persona: t.persona || "UNKNOWN",
    tenure_stability: t.tenure_stability || "UNKNOWN",
    seed: c.meta?.seed,

    // Truth state
    truth_salary: t.salary,
    truth_dti: t.dti,
    truth_credit_score: t.credit_score,
    truth_checking: t.checking_balance,
    truth_tenure_months: t.tenure_months,
    truth_monthly_obligations: t.monthly_obligations,

    // Presentation state
    pres_salary: p.salary,
    pres_checking: p.checking_balance,
    pres_tenure_months: p.tenure_months,
    pres_monthly_obligations: p.monthly_obligations,
    pres_stated_dti: p.stated_dti ?? p.dti ?? t.dti,

    // Discrepancy numeric features
    salary_diff: salaryDiff,
    salary_diff_pct: safeDiv(salaryDiff, t.salary ?? 1),
    checking_diff: checkingDiff,
    checking_diff_pct: safeDiv(checkingDiff, t.checking_balance ?? 1),
    obligations_diff: obligationsDiff,
    obligations_diff_pct: safeDiv(obligationsDiff, Math.max(1, t.monthly_obligations ?? 1)),

    // Discrepancy binary flags
    salary_inflated: salaryDiff > 0 ? 1 : 0,
    checking_inflated: checkingDiff > 0 ? 1 : 0,
    employer_changed: p.employer !== t.employer ? 1 : 0,
    obligations_understated: obligationsDiff > 0 ? 1 : 0,

    // Evidence signals
    w2_salary: w2.w2_wages,
    w2_salary_diff: (w2.w2_wages ?? t.salary ?? 0) - (t.salary ?? 0),
    bank_checking: bank.checking_balance,
    bank_checking_diff: (bank.checking_balance ?? t.checking_balance ?? 0) - (t.checking_balance ?? 0),
    bureau_credit_score: bureau.credit_score,
    bureau_credit_score_diff: (bureau.credit_score ?? t.credit_score ?? 0) - (t.credit_score ?? 0),
    bureau_liabilities_count: bureau.open_accounts,
    employer_verified_name: employerVerif.employer,
    employer_name_mismatch: (employerVerif.employer && employerVerif.employer !== t.employer) ? 1 : 0,

    // Ledger-derived cash-flow features
    pay_frequency: t.income_stream?.pay_frequency,
    pretax_deduction_rate: t.income_stream?.pretax_deduction_rate,
    net_per_check: t.income_stream?.net_per_check,
    avg_monthly_deposit: bank.monthly_payroll_deposit ?? t.income_stream?.monthly_net_deposit,
    deposit_variance: t.monthly_ledger?.length
      ? Math.sqrt(t.monthly_ledger.reduce((sum, m) => sum + Math.pow(m.salary_deposits - (t.income_stream?.monthly_net_deposit || 0), 2), 0) / t.monthly_ledger.length)
      : null,
    rent_to_income_ratio: safeDiv(t.expense_obligations?.rent, (t.salary ?? 1) / 12),
    monthly_obligations_to_income: safeDiv(t.monthly_obligations, (t.salary ?? 1) / 12),
    discretionary_to_income: safeDiv(t.expense_obligations?.discretionary, (t.salary ?? 1) / 12),
    overdraft_count: t.overdraft_count ?? 0,
    w2_vs_gross_diff: (w2.w2_wages ?? t.salary ?? 0) - (t.salary ?? 0),

    // Alignment dimensions (binary aligned flags)
    identity_aligned: dimensionAligned("identity"),
    employment_aligned: dimensionAligned("employment"),
    income_aligned: dimensionAligned("income"),
    assets_aligned: dimensionAligned("assets"),
    liabilities_aligned: dimensionAligned("liabilities"),
    address_aligned: dimensionAligned("address"),
    timeline_aligned: dimensionAligned("timeline"),
    cash_flow_aligned: dimensionAligned("cash_flow"),
    affordability_aligned: dimensionAligned("affordability"),
    document_metadata_aligned: dimensionAligned("document_metadata"),
    network_aligned: dimensionAligned("network"),
    behavioral_aligned: dimensionAligned("behavioral"),

    // Application / device / behavioral metadata
    hour_of_day: c.application_metadata?.hour_of_day,
    day_of_week: c.application_metadata?.day_of_week,
    is_business_hours: c.application_metadata?.is_business_hours,
    ip_risk_score: c.application_metadata?.ip_risk_score,
    is_vpn: c.application_metadata?.is_vpn,
    is_tor: c.application_metadata?.is_tor,
    typing_speed_wpm: c.application_metadata?.typing_speed_wpm,
    fields_copy_pasted: c.application_metadata?.fields_copy_pasted,
    session_duration_seconds: c.application_metadata?.session_duration_seconds,
    used_autofill: c.application_metadata?.used_autofill,
    min_doc_age_days: c.application_metadata?.documents ? Math.min(...c.application_metadata.documents.map(d => d.days_before_submission)) : null,
    max_doc_age_days: c.application_metadata?.documents ? Math.max(...c.application_metadata.documents.map(d => d.days_before_submission)) : null,
    avg_doc_age_days: c.application_metadata?.documents
      ? c.application_metadata.documents.reduce((s, d) => s + d.days_before_submission, 0) / c.application_metadata.documents.length
      : null,
    docs_created_within_2_days: c.application_metadata?.documents
      ? c.application_metadata.documents.filter(d => d.days_before_submission <= 2).length
      : null,

    // Labels / targets
    alignment_level: label.alignment_level,
    alignment_level_numeric: ALIGNMENT_LEVEL_ORDER[label.alignment_level] ?? 0,
    fraud_risk_level: fraudRisk,
    coherence_status: label.coherence_status,
    case_coherence_status: label.case_coherence_status,
    expected_outcome: outcome,
    decision_reason: label.reason,
    difficulty: label.difficulty,
    is_fraud: ["LOW", "MODERATE", "HIGH", "CRITICAL"].includes(fraudRisk) ? 1 : 0,
    outcome_approve: outcome === "APPROVE" ? 1 : 0,
    outcome_decline: outcome === "DECLINE" ? 1 : 0,
    outcome_manual_review: outcome === "MANUAL_REVIEW" ? 1 : 0
  };
}

export function calculateStatistics(cases) {
  const stats = { age: { values: [] }, salary: { values: [] }, dti: { values: [] }, credit_score: { values: [] } };
  cases.forEach(c => {
    if (c.truth.demographics) stats.age.values.push(c.truth.demographics.age);
    if (c.truth.current_state) {
      stats.salary.values.push(c.truth.current_state.salary);
      stats.dti.values.push(c.truth.current_state.dti);
      stats.credit_score.values.push(c.truth.current_state.credit_score);
    }
  });
  const calc = (arr) => arr.length
    ? { mean: arr.reduce((a, b) => a + b, 0) / arr.length, min: Math.min(...arr), max: Math.max(...arr) }
    : { mean: 0, min: 0, max: 0 };
  return {
    age: calc(stats.age.values),
    salary: calc(stats.salary.values),
    dti: calc(stats.dti.values),
    credit_score: calc(stats.credit_score.values)
  };
}

function escapeCsv(val) {
  const s = val === undefined || val === null ? "" : String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function casesToCsv(cases) {
  if (cases.length === 0) return "";
  const features = cases.map(extractMLFeatures);
  const headers = Object.keys(features[0]);
  const rows = features.map(f => headers.map(h => escapeCsv(f[h])).join(","));
  return headers.join(",") + "\n" + rows.join("\n");
}

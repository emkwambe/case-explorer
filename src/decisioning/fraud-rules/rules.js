// src/decisioning/fraud-rules/rules.js — Governed fraud-rule catalog and rule engine.
//
// Each rule is a versioned, owned, approved object with declared inputs and a target
// scenario. Rules read ONLY the decision view (claims + evidence + metadata). The rule
// engine emits alerts with evidence citations; the underwriting policy decides what an
// alert means for the outcome. Rule analytics (alerts, TP/FP, loss captured) are computed
// by src/evaluation/detection over labelled datasets.

export const FRAUD_RULESET_VERSION = "1.3.0";

/** A rule may return `severity_override` / `reason_code_override` for tiered materiality. */

/**
 * @typedef {Object} FraudRule
 * @property {string} id
 * @property {string} version
 * @property {string} description
 * @property {string[]} features_used         Decision-view paths this rule reads.
 * @property {Object}  threshold
 * @property {string[]} target_scenarios      Corruption types this rule is designed to catch.
 * @property {string}  severity               HIGH => decline-eligible verification failure; MEDIUM => review; LOW => informational.
 * @property {string}  reason_code            Governed reason code emitted when the rule fires.
 * @property {string}  effective_date
 * @property {string}  owner
 * @property {string}  approval_status
 * @property {(v: any) => (null | {citations: any[], detail: string, magnitude?: number})} test
 */

const cite = (v, key, value) => ({ ...v.citations[key], value });

/** @type {FraudRule[]} */
export const FRAUD_RULES = [
  {
    id: "FR-001", version: "1.2.0",
    description: "Stated income exceeds employer-verified salary. Above the material threshold the income is unverifiable; between the variance and material thresholds the case is re-underwritten on verified income.",
    features_used: ["claims.salary", "evidence.employer_salary", "evidence.w2_wages"],
    threshold: { pct: 0.15, variance_pct: 0.02 },
    target_scenarios: ["INFLATION", "FABRICATION"],
    severity: "HIGH",
    reason_code: "UNVERIFIABLE_INCOME",
    effective_date: "2026-01-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      const verified = v.evidence.employer_salary ?? v.evidence.w2_wages;
      if (!verified || !v.claims.salary) return null;
      const pct = (v.claims.salary - verified) / verified;
      if (pct <= this.threshold.variance_pct) return null;
      if (pct <= this.threshold.pct) {
        return {
          magnitude: pct, severity_override: "MEDIUM", reason_code_override: "INCOME_VARIANCE_REVIEW",
          detail: `Stated income ${v.claims.salary} is ${(pct * 100).toFixed(1)}% above employer-verified ${verified}; re-underwrite on verified income.`,
          citations: [cite(v, "employer_salary", v.evidence.employer_salary)]
        };
      }
      return {
        magnitude: pct,
        detail: `Stated income ${v.claims.salary} is ${(pct * 100).toFixed(1)}% above employer-verified ${verified}.`,
        citations: [cite(v, "employer_salary", v.evidence.employer_salary), cite(v, "w2_wages", v.evidence.w2_wages)]
      };
    }
  },
  {
    id: "FR-002", version: "1.0.0",
    description: "Stated employer does not match employer verification.",
    features_used: ["claims.employer", "evidence.employer_name"],
    threshold: {},
    target_scenarios: ["FABRICATION", "BUST_OUT"],
    severity: "HIGH",
    reason_code: "UNVERIFIABLE_EMPLOYMENT",
    effective_date: "2026-01-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      if (!v.claims.employer || !v.evidence.employer_name) return null;
      if (v.claims.employer === v.evidence.employer_name) return null;
      return {
        magnitude: 1,
        detail: `Application lists employer "${v.claims.employer}"; verification returned "${v.evidence.employer_name}".`,
        citations: [cite(v, "employer_name", v.evidence.employer_name)]
      };
    }
  },
  {
    id: "FR-003", version: "1.2.0",
    description: "Credit bureau shows monthly obligations above those disclosed. Material gaps are undisclosed liabilities; small gaps are re-underwritten on bureau obligations.",
    features_used: ["claims.monthly_obligations", "evidence.bureau_monthly_obligations", "claims.liability_count", "evidence.bureau_liability_count"],
    threshold: { min_hidden_monthly: 100, variance_monthly: 25 },
    target_scenarios: ["CONCEALMENT"],
    severity: "HIGH",
    reason_code: "UNDISCLOSED_LIABILITIES",
    effective_date: "2026-01-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      const hidden = (v.evidence.bureau_monthly_obligations ?? 0) - (v.claims.monthly_obligations ?? 0);
      const countGap = (v.evidence.bureau_liability_count ?? 0) - (v.claims.liability_count ?? 0);
      if (hidden < this.threshold.variance_monthly) return null;
      if (hidden < this.threshold.min_hidden_monthly) {
        return {
          magnitude: hidden, severity_override: "MEDIUM", reason_code_override: "LIABILITY_VARIANCE_REVIEW",
          detail: `Bureau obligations ${v.evidence.bureau_monthly_obligations}/mo exceed disclosed ${v.claims.monthly_obligations}/mo by ${hidden}/mo; re-underwrite on bureau obligations.`,
          citations: [cite(v, "bureau_liabilities", v.evidence.bureau_liability_count)]
        };
      }
      return {
        magnitude: hidden,
        detail: `Bureau obligations ${v.evidence.bureau_monthly_obligations}/mo exceed disclosed ${v.claims.monthly_obligations}/mo by ${hidden}/mo (${countGap} undisclosed account(s)).`,
        citations: [cite(v, "bureau_liabilities", v.evidence.bureau_liability_count)]
      };
    }
  },
  {
    id: "FR-004", version: "1.0.0",
    description: "Stated checking balance exceeds bank-statement balance.",
    features_used: ["claims.checking_balance", "evidence.checking_balance"],
    threshold: { abs: 500, pct: 0.10 },
    target_scenarios: ["FABRICATION"],
    severity: "HIGH",
    reason_code: "UNVERIFIABLE_ASSETS",
    effective_date: "2026-01-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      if (v.evidence.checking_balance === undefined || v.claims.checking_balance === undefined) return null;
      const diff = v.claims.checking_balance - v.evidence.checking_balance;
      if (diff <= this.threshold.abs || diff / Math.max(1, v.evidence.checking_balance) <= this.threshold.pct) return null;
      return {
        magnitude: diff,
        detail: `Stated checking ${v.claims.checking_balance} exceeds bank statement ${v.evidence.checking_balance}.`,
        citations: [cite(v, "checking_balance", v.evidence.checking_balance)]
      };
    }
  },
  {
    id: "FR-005", version: "1.0.0",
    description: "Bank statement contains a large deposit with no documented source.",
    features_used: ["evidence.recent_large_deposits", "claims.salary"],
    threshold: { min_pct_of_monthly_income: 0.5 },
    target_scenarios: ["EVIDENCE_TAMPERING", "GIFT_FUND_MISREPRESENTATION", "ASSET_SEASONING"],
    severity: "MEDIUM",
    reason_code: "UNSOURCED_LARGE_DEPOSIT",
    effective_date: "2026-01-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      const deps = v.evidence.recent_large_deposits || [];
      const monthly = (v.claims.salary ?? 0) / 12;
      const big = deps.filter(d => d.amount >= monthly * this.threshold.min_pct_of_monthly_income && (d.source === "Unverified" || !d.source));
      if (big.length === 0) return null;
      return {
        magnitude: big.reduce((s, d) => s + d.amount, 0),
        detail: `${big.length} unsourced deposit(s) totalling ${big.reduce((s, d) => s + d.amount, 0)}.`,
        citations: [cite(v, "recent_large_deposits", big)]
      };
    }
  },
  {
    id: "FR-006", version: "1.0.0",
    description: "Bank statement balance materially exceeds stated balance (possible statement alteration).",
    features_used: ["claims.checking_balance", "evidence.checking_balance"],
    threshold: { pct: 0.15 },
    target_scenarios: ["EVIDENCE_TAMPERING"],
    severity: "HIGH",
    reason_code: "POTENTIAL_DOCUMENT_TAMPERING",
    effective_date: "2026-01-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      if (!v.evidence.checking_balance || !v.claims.checking_balance) return null;
      const pct = (v.evidence.checking_balance - v.claims.checking_balance) / v.claims.checking_balance;
      if (pct <= this.threshold.pct) return null;
      return {
        magnitude: pct,
        detail: `Bank statement balance ${v.evidence.checking_balance} is ${(pct * 100).toFixed(0)}% above the applicant's own stated ${v.claims.checking_balance}.`,
        citations: [cite(v, "checking_balance", v.evidence.checking_balance)]
      };
    }
  },
  {
    id: "FR-007", version: "1.0.0",
    description: "Payroll deposits on bank statement inconsistent with employer-verified net pay.",
    features_used: ["evidence.monthly_payroll_deposit", "evidence.expected_monthly_net_deposit"],
    threshold: { pct: 0.15 },
    target_scenarios: ["EVIDENCE_TAMPERING"],
    severity: "MEDIUM",
    reason_code: "POTENTIAL_DOCUMENT_TAMPERING",
    effective_date: "2026-01-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      const actual = v.evidence.monthly_payroll_deposit, expected = v.evidence.expected_monthly_net_deposit;
      if (!actual || !expected) return null;
      const pct = Math.abs(actual - expected) / expected;
      if (pct <= this.threshold.pct) return null;
      return {
        magnitude: pct,
        detail: `Statement payroll deposits ${actual}/mo differ from employer-verified net ${Math.round(expected)}/mo by ${(pct * 100).toFixed(0)}%.`,
        citations: [cite(v, "monthly_payroll_deposit", actual), cite(v, "employer_salary", v.evidence.employer_salary)]
      };
    }
  },
  {
    id: "FR-008", version: "1.0.0",
    description: "Employer name varies between W-2 and employer verification.",
    features_used: ["evidence.w2_employer", "evidence.employer_name"],
    threshold: {},
    target_scenarios: ["EVIDENCE_TAMPERING"],
    severity: "LOW",
    reason_code: "EMPLOYER_NAME_VARIATION",
    effective_date: "2026-01-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      if (!v.evidence.w2_employer || !v.evidence.employer_name || v.evidence.w2_employer === v.evidence.employer_name) return null;
      return { magnitude: 1, detail: `W-2 employer "${v.evidence.w2_employer}" vs verification "${v.evidence.employer_name}".`, citations: [cite(v, "employer_name", v.evidence.employer_name)] };
    }
  },
  {
    id: "FR-009", version: "1.1.0",
    description: "Rapid credit-profile construction: claimed prime score with a thin, tightly-clustered file and employment start that contradicts verification.",
    features_used: ["claims.credit_score", "evidence.credit_score", "claims.liability_cluster_days", "claims.liability_count", "_timeline.claimed_employment_start_vs_hire_date_days"],
    threshold: { score_gap: 40, cluster_days: 120, max_liabilities: 3 },
    target_scenarios: ["BUST_OUT"],
    severity: "HIGH",
    reason_code: "IDENTITY_UNVERIFIABLE",
    effective_date: "2026-01-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      const gap = (v.claims.credit_score ?? 0) - (v.evidence.credit_score ?? 0);
      const clustered = v.claims.liability_cluster_days !== null && v.claims.liability_cluster_days <= this.threshold.cluster_days && v.claims.liability_count <= this.threshold.max_liabilities;
      const startMismatch = Math.abs(v._timeline.claimed_employment_start_vs_hire_date_days ?? 0) > 60;
      const signals = [gap > this.threshold.score_gap, clustered, startMismatch].filter(Boolean).length;
      if (signals < 2) return null;
      return {
        magnitude: signals,
        detail: `Claimed score exceeds bureau by ${gap}; ${clustered ? "credit accounts opened within " + Math.round(v.claims.liability_cluster_days) + " days; " : ""}${startMismatch ? "claimed employment start differs from verified hire date." : ""}`,
        citations: [cite(v, "credit_score", v.evidence.credit_score), cite(v, "employer_hire_date", v.evidence.employer_hire_date)]
      };
    }
  },
  {
    id: "FR-010", version: "1.0.0",
    description: "Application originated from a high-risk or anonymised network location.",
    features_used: ["metadata.ip_risk_score", "metadata.is_tor"],
    threshold: { ip_risk: 0.7 },
    target_scenarios: ["*"],
    severity: "MEDIUM",
    reason_code: "HIGH_RISK_NETWORK_ORIGIN",
    effective_date: "2026-01-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      if (!((v.metadata.ip_risk_score ?? 0) > this.threshold.ip_risk || v.metadata.is_tor)) return null;
      return { magnitude: v.metadata.ip_risk_score, detail: `IP risk ${v.metadata.ip_risk_score}${v.metadata.is_tor ? " via Tor" : ""}.`, citations: [cite(v, "ip_risk_score", v.metadata.ip_risk_score)] };
    }
  },
  {
    id: "FR-011", version: "1.0.0",
    description: "Three or more supporting documents created within two days of submission.",
    features_used: ["metadata.docs_created_within_2_days"],
    threshold: { docs: 3 },
    target_scenarios: ["*"],
    severity: "MEDIUM",
    reason_code: "SUSPICIOUS_DOCUMENT_METADATA",
    effective_date: "2026-01-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      if ((v.metadata.docs_created_within_2_days ?? 0) < this.threshold.docs) return null;
      return { magnitude: v.metadata.docs_created_within_2_days, detail: `${v.metadata.docs_created_within_2_days} documents created within 2 days of submission.`, citations: [cite(v, "documents", v.metadata.docs_created_within_2_days)] };
    }
  },
  {
    id: "FR-012", version: "1.0.0",
    description: "Session behaviour inconsistent with a natural applicant (heavy copy-paste, very short session).",
    features_used: ["metadata.fields_copy_pasted", "metadata.session_duration_seconds"],
    threshold: { copy_paste: 4, session_seconds: 120 },
    target_scenarios: ["*"],
    severity: "LOW",
    reason_code: "ANOMALOUS_APPLICATION_BEHAVIOR",
    effective_date: "2026-01-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      const cp = v.metadata.fields_copy_pasted ?? 0, dur = v.metadata.session_duration_seconds ?? 999;
      if (cp < this.threshold.copy_paste && dur > this.threshold.session_seconds) return null;
      return { magnitude: cp, detail: `${cp} fields copy-pasted; session ${dur}s.`, citations: [] };
    }
  },
  {
    id: "FR-013", version: "1.0.0",
    description: "Submitted information violates accounting or timeline invariants (data integrity).",
    features_used: ["claims.monthly_obligations", "claims.salary", "evidence.w2_wages", "_timeline.rent_before_lease", "_timeline.deposit_before_employment"],
    threshold: { obligations_share: 0.8 },
    target_scenarios: ["INCOHERENT"],
    severity: "HIGH",
    reason_code: "DATA_INTEGRITY_FAILURE",
    effective_date: "2026-01-01", owner: "data-quality", approval_status: "APPROVED",
    test(v) {
      const monthly = (v.claims.salary ?? 0) / 12;
      const problems = [];
      if (monthly > 0 && (v.claims.monthly_obligations ?? 0) > monthly * this.threshold.obligations_share) problems.push("obligations exceed 80% of gross monthly income");
      if ((v.evidence.w2_wages ?? 0) > (v.claims.salary ?? 0) * 1.02) problems.push("W-2 wages exceed gross salary");
      if (v._timeline.rent_before_lease) problems.push("rent paid before lease start");
      if (v._timeline.deposit_before_employment) problems.push("salary deposit before employment start");
      if (problems.length === 0) return null;
      return { magnitude: problems.length, detail: problems.join("; ") + ".", citations: [cite(v, "w2_wages", v.evidence.w2_wages), cite(v, "lease_start", v.evidence.lease_start)] };
    }
  },
  {
    id: "FR-014", version: "1.0.0",
    description: "Occupancy misrepresentation: stated primary residence while rent verification shows an active lease elsewhere at distance.",
    features_used: ["claims.occupancy", "evidence.rent_monthly", "claims.events"],
    threshold: {},
    target_scenarios: ["OCCUPANCY_MISREPRESENTATION"],
    severity: "HIGH",
    reason_code: "MATERIAL_APPLICATION_DISCREPANCY",
    effective_date: "2026-03-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      const occ = v.claims.events.find(e => e.type === "OCCUPANCY_DECLARATION");
      if (!occ || occ.stated !== "PRIMARY_RESIDENCE") return null;
      if (!occ.subject_property_distance_miles || occ.subject_property_distance_miles < 100) return null;
      if (!occ.retains_current_lease) return null;
      return { magnitude: occ.subject_property_distance_miles, detail: `Primary-residence declaration for a property ${occ.subject_property_distance_miles} miles away while retaining current lease.`, citations: [cite(v, "lease_start", v.evidence.lease_start)] };
    }
  },
  {
    id: "FR-015", version: "1.0.0",
    description: "Gift funds: large deposit labelled as gift without donor letter or with donor matching a party to the transaction.",
    features_used: ["evidence.recent_large_deposits"],
    threshold: {},
    target_scenarios: ["GIFT_FUND_MISREPRESENTATION"],
    severity: "HIGH",
    reason_code: "UNVERIFIABLE_ASSETS",
    effective_date: "2026-03-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      const gifts = (v.evidence.recent_large_deposits || []).filter(d => d.description === "Gift" && (!d.donor_letter || d.donor_is_interested_party));
      if (gifts.length === 0) return null;
      return { magnitude: gifts.reduce((s, d) => s + d.amount, 0), detail: `${gifts.length} gift deposit(s) lacking a valid donor letter or from an interested party.`, citations: [cite(v, "recent_large_deposits", gifts)] };
    }
  },
  {
    id: "FR-016", version: "1.0.0",
    description: "Asset seasoning: majority of stated reserves arrived within the statement window.",
    features_used: ["evidence.recent_large_deposits", "evidence.checking_balance"],
    threshold: { share: 0.5 },
    target_scenarios: ["ASSET_SEASONING"],
    severity: "MEDIUM",
    reason_code: "UNSOURCED_LARGE_DEPOSIT",
    effective_date: "2026-03-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      const recent = (v.evidence.recent_large_deposits || []).filter(d => d.days_before_submission !== undefined && d.days_before_submission <= 60);
      const total = recent.reduce((s, d) => s + d.amount, 0);
      if (!v.evidence.checking_balance || total / v.evidence.checking_balance < this.threshold.share) return null;
      return { magnitude: total / v.evidence.checking_balance, detail: `${((total / v.evidence.checking_balance) * 100).toFixed(0)}% of verified balance deposited within 60 days.`, citations: [cite(v, "recent_large_deposits", recent)] };
    }
  },
  {
    id: "FR-017", version: "1.0.0",
    description: "Straw-buyer indicators: third party funds the down payment and applicant's stated occupancy is inconsistent with their housing history.",
    features_used: ["claims.events", "evidence.recent_large_deposits"],
    threshold: {},
    target_scenarios: ["STRAW_BUYER"],
    severity: "HIGH",
    reason_code: "MATERIAL_APPLICATION_DISCREPANCY",
    effective_date: "2026-03-01", owner: "fraud-strategy", approval_status: "APPROVED",
    test(v) {
      const thirdParty = (v.evidence.recent_large_deposits || []).filter(d => d.source === "Third party" || d.third_party_funded);
      const occ = v.claims.events.find(e => e.type === "OCCUPANCY_DECLARATION");
      if (thirdParty.length === 0 || !occ?.third_party_will_occupy) return null;
      return { magnitude: thirdParty.length, detail: `Down payment funded by third party and a non-applicant is declared as the occupant.`, citations: [cite(v, "recent_large_deposits", thirdParty)] };
    }
  }
];

export function getRule(id) {
  return FRAUD_RULES.find(r => r.id === id);
}

/**
 * Run all approved rules against a decision view.
 * @returns {{ruleset_version: string, alerts: Array}}
 */
export function runFraudRules(view, { rules = FRAUD_RULES, includeUnapproved = false } = {}) {
  const alerts = [];
  for (const rule of rules) {
    if (!includeUnapproved && rule.approval_status !== "APPROVED") continue;
    let result = null;
    try { result = rule.test(view); } catch { result = null; }
    if (result) {
      alerts.push({
        rule_id: rule.id,
        rule_version: rule.version,
        severity: result.severity_override ?? rule.severity,
        reason_code: result.reason_code_override ?? rule.reason_code,
        target_scenarios: rule.target_scenarios,
        detail: result.detail,
        magnitude: result.magnitude ?? null,
        evidence_citations: result.citations || []
      });
    }
  }
  return { ruleset_version: FRAUD_RULESET_VERSION, alerts };
}

/** Compact rule metadata for the workbench / registry. */
export function describeRules() {
  return FRAUD_RULES.map(({ test: _test, ...meta }) => ({ ...meta }));
}

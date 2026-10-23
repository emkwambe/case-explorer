// src/mutationTable.js — The expected-change table: for each mutation, which outputs must change,
// which may, and which must not. Machine-readable; docs/MUTATIONS.md is generated from it
// (scripts/mutations-md.mjs) and scripts/mutations.test.mjs asserts every row on a sample of bases.
//
// Every row places each output of observeCase (src/mutations.js) in exactly one list. A must-change
// entry can say how it changes: `to` (the value after), `includes` (a member present after and absent
// before), `increases`/`decreases` (numeric), or just that it changes.

import { AGE_BANDS } from "./core/audit_attributes.js";

export const OUTPUTS = Object.freeze([
  "credit.decision", "credit.flags", "underwriting.decision", "underwriting.reason_codes", "fraud_rules",
  "claimed_dti", "true_dti", "claimed_fico", "claims", "truth", "evidence", "evidence_sources",
  "application_metadata", "audit_attributes", "reference_label"
]);

/**
 * The base every row starts from: a clean case that the credit policy and the underwriting policy
 * both approve with no fraud alert, with margin (FICO >= 680, claimed DTI <= 30%, checking >= $1,000)
 * and every evidence document present. Rows that need another starting point list `setup` mutations.
 */
export const BASE_RULE = "Clean case approved by the credit policy (no flags) and the underwriting policy, no fraud alert, claimed FICO ≥ 680, claimed DTI ≤ 30%, claimed checking ≥ $1,000, all six evidence documents present.";

export function isEligibleBase(c, obs) {
  return c.meta?.corruption_type === "NONE" && !(c.meta?.mutations?.length)
    && obs["credit.decision"] === "APPROVE" && obs["credit.flags"].length === 0
    && obs["underwriting.decision"] === "APPROVE" && obs.fraud_rules.length === 0
    && obs.claimed_fico >= 680 && obs.claimed_dti !== null && obs.claimed_dti <= 0.30
    && (c.presentation?.current_state?.checking_balance ?? 0) >= 1000
    && obs.evidence_sources.length === 6;
}

const employerSalary = (c) => c.evidence.find((e) => e.source === "EMPLOYER_VERIFICATION")?.fields?.salary;
/** inflate_income pct that puts the claimed salary at `ratio` × the employer-verified salary. */
export const pctForRatio = (c, ratio) => Math.round((ratio * employerSalary(c) / c.presentation.current_state.salary - 1) * 1e4) / 1e4;
const nextAgeBand = (c) => AGE_BANDS[(AGE_BANDS.indexOf(c.audit_attributes.age_band) + 1) % AGE_BANDS.length];

const rest = (lists) => OUTPUTS.filter((o) => !lists.flat().some((x) => (typeof x === "string" ? x : x.output) === o));
function row(r) {
  const must = r.must, may = r.may ?? [];
  return Object.freeze({ ...r, may, mustNot: rest([must, may]) });
}

export const MUTATION_TABLE = Object.freeze([
  row({
    id: "hide-debt-material", mutation: "hide_debt", when: "a hidden debt of $300/mo (at least the $100/mo FR-003 threshold)",
    params: () => ({ monthly: 300 }),
    must: [{ output: "fraud_rules", includes: "FR-003:HIGH" }, { output: "credit.decision", to: "REVIEW" }, { output: "credit.flags", includes: "FRAUD_REVIEW" },
      { output: "underwriting.decision", to: "DECLINE" }, { output: "underwriting.reason_codes", includes: "UNDISCLOSED_LIABILITIES" },
      { output: "true_dti", increases: true }, { output: "truth" }, { output: "evidence" }],
    may: ["reference_label"]
  }),
  row({
    id: "hide-debt-variance", mutation: "hide_debt", when: "a hidden debt of $60/mo (between the $25 variance and $100 material thresholds)",
    params: () => ({ monthly: 60 }),
    must: [{ output: "fraud_rules", includes: "FR-003:MEDIUM" }, { output: "true_dti", increases: true }, { output: "truth" }, { output: "evidence" }],
    may: ["underwriting.decision", "underwriting.reason_codes", "reference_label"]
  }),
  row({
    id: "inflate-income-material", mutation: "inflate_income", when: "claimed salary raised to 1.35 × the employer-verified salary (FR-001 HIGH above 15%)",
    params: (c) => ({ pct: pctForRatio(c, 1.35) }),
    must: [{ output: "fraud_rules", includes: "FR-001:HIGH" }, { output: "credit.decision", to: "REVIEW" }, { output: "credit.flags", includes: "FRAUD_REVIEW" },
      { output: "underwriting.decision", to: "DECLINE" }, { output: "underwriting.reason_codes", includes: "UNVERIFIABLE_INCOME" },
      { output: "claimed_dti", decreases: true }, { output: "claims" }],
    may: ["reference_label"]
  }),
  row({
    id: "inflate-income-variance", mutation: "inflate_income", when: "claimed salary raised to 1.08 × the employer-verified salary (FR-001 MEDIUM between 2% and 15%)",
    params: (c) => ({ pct: pctForRatio(c, 1.08) }),
    must: [{ output: "fraud_rules", includes: "FR-001:MEDIUM" }, { output: "claimed_dti", decreases: true }, { output: "claims" }],
    may: ["underwriting.decision", "underwriting.reason_codes", "reference_label"]
  }),
  row({
    id: "fabricate-assets", mutation: "fabricate_assets", when: "claimed checking raised by at least 50% and $1,200 above the statement (FR-004 HIGH)",
    params: (c) => ({ pct: Math.max(0.5, Math.round((1200 / c.presentation.current_state.checking_balance) * 1e4) / 1e4) }),
    must: [{ output: "fraud_rules", includes: "FR-004:HIGH" }, { output: "credit.decision", to: "REVIEW" }, { output: "credit.flags", includes: "FRAUD_REVIEW" },
      { output: "underwriting.decision", to: "DECLINE" }, { output: "underwriting.reason_codes", includes: "UNVERIFIABLE_ASSETS" }, { output: "claims" }],
    may: ["reference_label"]
  }),
  row({
    id: "conflict-bank-balance", mutation: "conflict_document", when: "bank-statement balance raised 30% above the claim (FR-006 HIGH above 15%)",
    params: () => ({ field: "BANK_STATEMENT.checking_balance", pct: 0.3 }),
    must: [{ output: "fraud_rules", includes: "FR-006:HIGH" }, { output: "credit.decision", to: "REVIEW" }, { output: "credit.flags", includes: "FRAUD_REVIEW" },
      { output: "underwriting.decision", to: "DECLINE" }, { output: "underwriting.reason_codes", includes: "POTENTIAL_DOCUMENT_TAMPERING" }, { output: "evidence" }],
    may: ["reference_label"]
  }),
  row({
    id: "conflict-employer", mutation: "conflict_document", when: "employer verification names another employer (FR-002 HIGH)",
    params: () => ({ field: "EMPLOYER_VERIFICATION.employer", value: "Unrelated Holdings Corp" }),
    must: [{ output: "fraud_rules", includes: "FR-002:HIGH" }, { output: "credit.decision", to: "REVIEW" }, { output: "credit.flags", includes: "FRAUD_REVIEW" },
      { output: "underwriting.decision", to: "DECLINE" }, { output: "underwriting.reason_codes", includes: "UNVERIFIABLE_EMPLOYMENT" }, { output: "evidence" }],
    may: ["reference_label"]
  }),
  row({
    id: "conflict-w2-employer", mutation: "conflict_document", when: "the W-2 names another employer (FR-008 LOW only)",
    params: () => ({ field: "W2_DOCUMENT.employer", value: "Unrelated Holdings Corp" }),
    must: [{ output: "fraud_rules", includes: "FR-008:LOW" }, { output: "evidence" }],
    may: ["underwriting.decision", "underwriting.reason_codes", "reference_label"]
  }),
  row({
    id: "fico-below-minimum", mutation: "shift_fico", when: "the real score moves to 655, below the 660 minimum",
    params: (c) => ({ points: 655 - c.presentation.current_state.credit_score }),
    must: [{ output: "claimed_fico", to: 655 }, { output: "credit.decision", to: "DECLINE" }, { output: "credit.flags", includes: "LOW_FICO" },
      { output: "claims" }, { output: "truth" }, { output: "evidence" }],
    may: ["underwriting.decision", "underwriting.reason_codes", "reference_label"]
  }),
  row({
    id: "fico-up", mutation: "shift_fico", when: "the real score rises 20 points",
    params: () => ({ points: 20 }),
    must: [{ output: "claimed_fico", increases: true }, { output: "claims" }, { output: "truth" }, { output: "evidence" }],
    may: ["underwriting.decision", "underwriting.reason_codes", "reference_label"]
  }),
  row({
    id: "dti-watch-band", mutation: "shift_dti_to", when: "a disclosed debt takes the DTI to 40% (the 36–45% watch band)",
    params: () => ({ target: 0.40 }),
    must: [{ output: "claimed_dti", increases: true }, { output: "true_dti", increases: true }, { output: "credit.decision", to: "REVIEW" },
      { output: "credit.flags", includes: "ELEVATED_DTI" }, { output: "claims" }, { output: "truth" }, { output: "evidence" }],
    may: ["underwriting.decision", "underwriting.reason_codes", "reference_label"]
  }),
  row({
    id: "dti-over-cap", mutation: "shift_dti_to", when: "a disclosed debt takes the DTI to 47%, over the 45% cap",
    params: () => ({ target: 0.47 }),
    must: [{ output: "claimed_dti", increases: true }, { output: "true_dti", increases: true }, { output: "credit.decision", to: "DECLINE" },
      { output: "credit.flags", includes: "HIGH_DTI" }, { output: "claims" }, { output: "truth" }, { output: "evidence" }],
    may: ["underwriting.decision", "underwriting.reason_codes", "reference_label"]
  }),
  row({
    id: "dti-below-watch", mutation: "shift_dti_to", when: "a disclosed debt takes the DTI to 34%, still under the 36% watch line",
    params: () => ({ target: 0.34 }),
    must: [{ output: "claimed_dti", increases: true }, { output: "true_dti", increases: true }, { output: "claims" }, { output: "truth" }, { output: "evidence" }],
    may: ["underwriting.decision", "underwriting.reason_codes", "reference_label"]
  }),
  row({
    id: "checking-below-liquidity", mutation: "set_checking", when: "at DTI 41%, checking set to $900 (the liquidity rule: under $1,000 with DTI over 40%)",
    setup: [{ type: "shift_dti_to", params: { target: 0.41 } }],
    params: () => ({ amount: 900 }),
    must: [{ output: "credit.flags", includes: "LIQUIDITY_RISK" }, { output: "claims" }, { output: "truth" }, { output: "evidence" }],
    may: ["underwriting.decision", "underwriting.reason_codes", "reference_label"]
  }),
  row({
    id: "checking-above-liquidity", mutation: "set_checking", when: "at DTI 41%, checking set to $5,000",
    setup: [{ type: "shift_dti_to", params: { target: 0.41 } }],
    params: () => ({ amount: 5000 }),
    must: [{ output: "claims" }, { output: "truth" }, { output: "evidence" }],
    may: ["underwriting.decision", "underwriting.reason_codes", "reference_label"]
  }),
  // Neither engine requires a document to be present. A missing bank statement never changes the
  // credit decision. A missing bureau or employer verification can, but only because a fraud rule then
  // reads the absent value (FR-009 takes a missing bureau score as 0; FR-001 falls back to W-2 wages).
  row({
    id: "remove-bank-statement", mutation: "remove_statement", when: "the BANK_STATEMENT document is missing",
    params: () => ({ source: "BANK_STATEMENT" }),
    must: [{ output: "evidence_sources" }, { output: "evidence" }, { output: "application_metadata" }],
    may: ["fraud_rules", "underwriting.decision", "underwriting.reason_codes", "reference_label"]
  }),
  ...["CREDIT_BUREAU", "EMPLOYER_VERIFICATION"].map((s) => row({
    id: `remove-${s.toLowerCase().replace(/_/g, "-")}`, mutation: "remove_statement", when: `the ${s} document is missing (a fraud rule may then misread the absent value)`,
    params: () => ({ source: s }),
    must: [{ output: "evidence_sources" }, { output: "evidence" }, { output: "application_metadata" }],
    may: ["credit.decision", "credit.flags", "fraud_rules", "underwriting.decision", "underwriting.reason_codes", "reference_label"]
  })),
  row({
    id: "flip-age-band", mutation: "flip_sensitive", when: "the age band takes the next value",
    params: (c) => ({ attribute: "age_band", value: nextAgeBand(c) }),
    must: [{ output: "audit_attributes" }],
    may: []
  })
]);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Check one row: returns [] when it held, else the list of what did not. */
export function checkRow(r, before, after) {
  const problems = [];
  for (const m of r.must) {
    const b = before[m.output], a = after[m.output];
    if (m.to !== undefined) { if (!same(a, m.to) || same(b, m.to)) problems.push(`${m.output} should become ${JSON.stringify(m.to)} (was ${JSON.stringify(b)}, now ${JSON.stringify(a)})`); }
    else if (m.includes !== undefined) { if (!a?.includes(m.includes) || b?.includes(m.includes)) problems.push(`${m.output} should gain ${m.includes} (was ${JSON.stringify(b)}, now ${JSON.stringify(a)})`); }
    else if (m.increases) { if (!(a > b)) problems.push(`${m.output} should increase (${b} → ${a})`); }
    else if (m.decreases) { if (!(a < b)) problems.push(`${m.output} should decrease (${b} → ${a})`); }
    else if (same(a, b)) problems.push(`${m.output} should change`);
  }
  for (const o of r.mustNot) if (!same(before[o], after[o])) problems.push(`${o} must not change (was ${String(JSON.stringify(before[o])).slice(0, 80)}, now ${String(JSON.stringify(after[o])).slice(0, 80)})`);
  return problems;
}

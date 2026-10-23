// src/challenge/evidence.js — The "strongest evidence" choices and which of them carry a teaching
// case's deciding value. Pure functions of the case data; no React or browser dependency.
//
// An item scores when it carries the deciding value (owner decision, Sprint 10): for a fraud twin, the
// document that contradicts the application; for a near-threshold case, the field the threshold reads,
// on the application or on the document that shows the same value; for a conflicting case, either key
// fact. Clean twins, and a missing document the decision does not depend on, map to "supports".

/** Every item; `source` is the evidence document it needs, or null when it is always offered. */
export const EVIDENCE_ITEMS = Object.freeze([
  { id: "application.income", label: "Application: stated income", source: null },
  { id: "application.debts", label: "Application: stated monthly debts", source: null },
  { id: "application.checking", label: "Application: stated checking balance", source: null },
  { id: "application.credit_score", label: "Application: stated credit score", source: null },
  { id: "application.dti", label: "Application: debt-to-income ratio (stated figures)", source: null },
  { id: "employer.salary", label: "Employer verification: salary", source: "EMPLOYER_VERIFICATION" },
  { id: "w2.wages", label: "W-2: wages", source: "W2_DOCUMENT" },
  { id: "bank.checking", label: "Bank statement: checking balance", source: "BANK_STATEMENT" },
  { id: "bank.debits", label: "Bank statement: recurring debits", source: "BANK_STATEMENT" },
  { id: "bureau.credit_score", label: "Credit bureau: credit score", source: "CREDIT_BUREAU" },
  { id: "bureau.obligations", label: "Credit bureau: monthly obligations (tradelines)", source: "CREDIT_BUREAU" },
  { id: "rent.monthly", label: "Rent verification: monthly rent", source: "RENT_VERIFICATION" },
  { id: "missing", label: "A document the decision needs is missing", source: null },
  { id: "supports", label: "The evidence supports the stated figures", source: null }
]);

const BY_ID = new Map(EVIDENCE_ITEMS.map((i) => [i.id, i]));
export const evidenceLabel = (id) => BY_ID.get(id)?.label ?? id;

/** The items offered for a case: those whose document is present, plus the always-offered ones. */
export function evidenceItemsFor(caseObj) {
  const present = new Set((caseObj?.evidence ?? []).map((e) => e.source));
  return EVIDENCE_ITEMS.filter((i) => i.source === null || present.has(i.source));
}

/** Evidence fields a document-conflict mutation can alter, mapped to the item that shows them. */
const CONFLICT_ITEM = { "BANK_STATEMENT.checking_balance": "bank.checking", "EMPLOYER_VERIFICATION.salary": "employer.salary" };

/** The item ids that carry the teaching case's deciding value (any one of them earns the evidence points). */
export function keyEvidence(teachingCase) {
  const { group, role, mutations = [] } = teachingCase;
  const types = new Set(mutations.map((m) => m.type));
  if (role === "clean") return ["supports"];
  if (group === "thin-evidence") return mutations[0].params.source === "BANK_STATEMENT" ? ["supports"] : ["missing"];
  if (group === "conflicting") return ["employer.salary", "bureau.obligations"];
  if (types.has("set_checking")) return ["application.checking", "bank.checking"];
  if (types.has("shift_fico")) return ["application.credit_score", "bureau.credit_score"];
  if (types.has("shift_dti_to")) return ["application.dti"];
  if (types.has("hide_debt")) return ["bureau.obligations"];
  if (types.has("inflate_income")) return ["employer.salary"];
  if (types.has("fabricate_assets")) return ["bank.checking"];
  if (types.has("conflict_document")) {
    const item = CONFLICT_ITEM[mutations.find((m) => m.type === "conflict_document").params.field];
    if (item) return [item];
  }
  throw new Error(`keyEvidence: no evidence mapping for ${teachingCase.id}`);
}

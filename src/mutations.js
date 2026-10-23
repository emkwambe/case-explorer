// src/mutations.js — Controlled case mutations: change exactly one thing about a case and see which
// outputs move. Pure and deterministic: applyMutation never changes its input, draws no shared
// randomness, and returns the same case for the same input.
//
// Two kinds of mutation, matching the case's layers:
//   * A world mutation describes an honest applicant. Truth, the claims and the evidence copied from
//     truth change together, so no claim-versus-evidence gap appears (shift_fico, shift_dti_to,
//     set_checking, remove_statement, flip_sensitive).
//   * A fraud mutation changes one layer only: the claim (inflate_income, fabricate_assets), the truth
//     together with the evidence that copies it (hide_debt), or one evidence field (conflict_document).
//
// The loan is held fixed: no mutation re-sizes the loan or its payment. A mutated case keeps its base
// case's id (loan sizing is seeded by the id); its lineage is recorded in meta.mutations.

import { createRng } from "./utils/prng.js";
import { generateAlignmentFindings, generateGroundTruthFindings, computeDecision } from "./core/findings.js";
import { simulateLoanPerformance } from "./simulation/performance.js";
import { assessCredit, caseDti } from "./creditRisk.js";
import { scoreCase, runFraudRules, extractDecisionView } from "./decisioning/index.js";

/** Evidence fields conflict_document can alter, with how the parameter is applied. */
export const CONFLICT_FIELDS = Object.freeze({
  "BANK_STATEMENT.checking_balance": { param: "pct", description: "statement balance raised by pct" },
  "EMPLOYER_VERIFICATION.employer": { param: "value", description: "verified employer name replaced" },
  "W2_DOCUMENT.employer": { param: "value", description: "W-2 employer name replaced" }
});

export const SENSITIVE_ATTRIBUTES = Object.freeze(["age_band", "geography_group", "income_band", "family_status_scenario", "disability_income_scenario", "persona"]);

/** The mutation types. `layers` names what changes; `typology` is the fraud a fraud mutation models. */
export const MUTATIONS = Object.freeze({
  hide_debt: { kind: "fraud", layers: ["truth", "evidence"], typology: "CONCEALMENT", params: ["monthly"], label: "Hide a debt", description: "The applicant has a monthly debt the application leaves out: it is in the truth and on the credit bureau and bank statement, not in the claims." },
  inflate_income: { kind: "fraud", layers: ["presentation"], typology: "INFLATION", params: ["pct"], label: "Inflate income", description: "The claimed salary is raised by pct; truth and the employer and W-2 evidence keep the real salary." },
  fabricate_assets: { kind: "fraud", layers: ["presentation"], typology: "FABRICATION", params: ["pct"], label: "Overstate assets", description: "The claimed checking balance is raised by pct; the bank statement keeps the real balance." },
  conflict_document: { kind: "fraud", layers: ["evidence"], typology: "EVIDENCE_TAMPERING", params: ["field", "pct|value"], label: "Alter a document", description: "One evidence field is altered; the claims and the truth are unchanged." },
  remove_statement: { kind: "world", layers: ["evidence"], typology: null, params: ["source"], label: "Remove a document", description: "One evidence document (and its metadata entry) is missing." },
  shift_fico: { kind: "world", layers: ["truth", "presentation", "evidence"], typology: null, params: ["points"], label: "Shift the credit score", description: "The applicant's real credit score moves by points; the claim and the bureau move with it." },
  shift_dti_to: { kind: "world", layers: ["truth", "presentation", "evidence"], typology: null, params: ["target"], label: "Set the DTI", description: "A disclosed monthly debt is added so the profile's back-end DTI reaches target (raises only)." },
  set_checking: { kind: "world", layers: ["truth", "presentation", "evidence"], typology: null, params: ["amount"], label: "Set the checking balance", description: "The real checking balance becomes amount; the claim and the bank statement agree with it." },
  flip_sensitive: { kind: "world", layers: ["audit"], typology: null, params: ["attribute", "value"], label: "Change a sensitive attribute", description: "One audit attribute (never a decision input) takes another value." }
});

const roundToInt = (x) => Math.round(x);
const source = (c, name) => c.evidence?.find((e) => e.source === name);
const ageDate = (asOf, months) => {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

/** Recompute the ratios the generator derives, in one layer, with the loan payment held fixed. */
function recomputeRatios(layer) {
  const s = layer.current_state;
  const monthlyIncome = (s.salary ?? 0) / 12;
  const obligations = s.monthly_obligations || 0;
  s.backend_dti = monthlyIncome > 0 ? (obligations + (s.monthly_mortgage_payment ?? 0)) / monthlyIncome : 0;
  s.dti = monthlyIncome > 0 ? obligations / monthlyIncome : 0;
}

/** Add a disclosed or hidden debt: a truth tradeline, the bureau line and the bank debit that copy it. */
function addTradeline(c, monthly, { claimed }) {
  const asOf = c.meta?.as_of_date ?? c.application?.submitted;
  const event = { t: ageDate(asOf, 30), type: "LIABILITY_OPENED", type_detail: "PERSONAL_LOAN", payment: monthly };
  c.truth.events.push({ ...event });
  c.truth.current_state.monthly_obligations = (c.truth.current_state.monthly_obligations || 0) + monthly;
  if (claimed) {
    c.presentation.events.push({ ...event });
    c.presentation.current_state.monthly_obligations = (c.presentation.current_state.monthly_obligations || 0) + monthly;
  }
  const bureau = source(c, "CREDIT_BUREAU");
  if (bureau) {
    bureau.fields.liabilities = [...(bureau.fields.liabilities ?? []), { type: "PERSONAL_LOAN", payment: monthly }];
    bureau.fields.open_accounts = (bureau.fields.open_accounts ?? 0) + 1;
  }
  const bank = source(c, "BANK_STATEMENT");
  if (bank) bank.fields.recurring_debits = [...(bank.fields.recurring_debits ?? []), { payee: "Personal Loan Servicer", amount: monthly }];
}

const APPLY = {
  hide_debt(c, { monthly }) {
    if (!(Number.isInteger(monthly) && monthly > 0)) throw new Error("hide_debt: monthly must be a positive whole number of dollars");
    addTradeline(c, monthly, { claimed: false });
  },
  inflate_income(c, { pct }) {
    if (!(pct > 0)) throw new Error("inflate_income: pct must be positive");
    const s = c.presentation.current_state;
    s.salary = Math.floor(s.salary * (1 + pct));
  },
  fabricate_assets(c, { pct }) {
    if (!(pct > 0)) throw new Error("fabricate_assets: pct must be positive");
    const s = c.presentation.current_state;
    s.checking_balance = roundToInt(s.checking_balance * (1 + pct));
  },
  conflict_document(c, { field, pct, value }) {
    const spec = CONFLICT_FIELDS[field];
    if (!spec) throw new Error(`conflict_document: unsupported field ${field}`);
    const [name, key] = field.split(".");
    const doc = source(c, name);
    if (!doc) throw new Error(`conflict_document: the case has no ${name}`);
    if (spec.param === "pct") {
      if (!(pct > 0)) throw new Error("conflict_document: pct must be positive");
      doc.fields[key] = roundToInt(doc.fields[key] * (1 + pct));
    } else {
      if (!value) throw new Error("conflict_document: value is required");
      doc.fields[key] = value;
    }
  },
  remove_statement(c, { source: name }) {
    if (!source(c, name)) throw new Error(`remove_statement: the case has no ${name}`);
    c.evidence = c.evidence.filter((e) => e.source !== name);
    const docs = c.application_metadata?.documents;
    if (docs) c.application_metadata.documents = docs.filter((d) => d.source !== name);
  },
  shift_fico(c, { points }) {
    if (!Number.isInteger(points) || points === 0) throw new Error("shift_fico: points must be a non-zero whole number");
    for (const layer of [c.truth, c.presentation]) layer.current_state.credit_score += points;
    const bureau = source(c, "CREDIT_BUREAU");
    if (bureau) bureau.fields.credit_score += points;
  },
  shift_dti_to(c, { target }, { profile }) {
    if (!(target > 0 && target < 2)) throw new Error("shift_dti_to: target is a ratio, e.g. 0.36");
    const now = caseDti(c, profile, "presentation");
    if (now.dti === null) throw new Error("shift_dti_to: the case has no income");
    const add = roundToInt(target * now.monthlyIncome - (now.dti * now.monthlyIncome));
    if (add <= 0) throw new Error(`shift_dti_to: the DTI is already ${(now.dti * 100).toFixed(1)}%; this mutation only raises it`);
    addTradeline(c, add, { claimed: true });
  },
  set_checking(c, { amount }) {
    if (!(Number.isInteger(amount) && amount >= 0)) throw new Error("set_checking: amount must be a whole number of dollars");
    for (const layer of [c.truth, c.presentation]) layer.current_state.checking_balance = amount;
    const bank = source(c, "BANK_STATEMENT");
    if (bank) bank.fields.checking_balance = amount;
  },
  flip_sensitive(c, { attribute, value }) {
    if (!SENSITIVE_ATTRIBUTES.includes(attribute)) throw new Error(`flip_sensitive: ${attribute} is not a sensitive attribute`);
    if (value === undefined || value === c.audit_attributes?.[attribute]) throw new Error("flip_sensitive: value must differ from the current one");
    c.audit_attributes = { ...c.audit_attributes, [attribute]: value };
  }
};

/** The severity a fraud mutation is labelled with: HIGH when it crosses its HIGH rule's threshold. */
function fraudSeverity(type, params) {
  if (type === "hide_debt") return params.monthly >= 100 ? "HIGH" : "MEDIUM";
  if (type === "inflate_income") return params.pct > 0.15 ? "HIGH" : "MEDIUM";
  return "HIGH";
}

/**
 * Apply one mutation. Returns a new case; the input is never changed.
 * @param {object} caseObj  a generated (or already mutated) case
 * @param {{type: string, params?: object}} mutation
 * @param {{config?: object, profile?: object}} ctx  config for the reference label; profile for shift_dti_to
 */
export function applyMutation(caseObj, mutation, ctx = {}) {
  const spec = MUTATIONS[mutation?.type];
  if (!spec) throw new Error(`Unknown mutation type: ${mutation?.type}`);
  const params = { ...(mutation.params ?? {}) };
  const out = structuredClone(caseObj);
  APPLY[mutation.type](out, params, ctx);
  // Ratios are recomputed only in a layer whose salary or obligations moved, so an untouched layer
  // keeps the generator's own values exactly.
  for (const name of ["truth", "presentation"]) {
    const was = caseObj[name].current_state, now = out[name].current_state;
    if (was.salary !== now.salary || was.monthly_obligations !== now.monthly_obligations) recomputeRatios(out[name]);
  }

  const prior = caseObj.meta?.mutations ?? [];
  const seedBase = caseObj.meta?.seed ?? caseObj.id;
  out.meta = {
    ...out.meta,
    base_case_id: caseObj.meta?.base_case_id ?? caseObj.id,
    base_corruption_type: caseObj.meta?.base_corruption_type ?? caseObj.meta?.corruption_type,
    mutations: [...prior, { type: mutation.type, params }]
  };
  if (spec.kind === "fraud" && !(caseObj.meta?.typologies?.length)) {
    out.meta.corruption_type = spec.typology;
    out.meta.severity = fraudSeverity(mutation.type, params);
  }
  if (spec.kind === "fraud") out.meta.typologies = [...new Set([...(caseObj.meta?.typologies ?? []), spec.typology])];

  // A change to truth, claims or evidence refreshes what the generator derives from them, on a stream
  // keyed by the mutation (deterministic). An audit-attribute change touches none of them.
  if (!(spec.layers.length === 1 && spec.layers[0] === "audit")) {
    const rng = createRng(`${seedBase}-mutation-${prior.length}`);
    const findings = generateAlignmentFindings(out.truth, out.presentation, out.evidence, out.application_metadata);
    out.alignment_findings = findings;
    out.ground_truth_findings = generateGroundTruthFindings(out.truth, out.presentation, out.evidence, out.meta.corruption_type);
    const label = computeDecision(out.truth, out.presentation, out.evidence, findings, out.meta.corruption_type, out.meta.severity, rng, ctx.config ?? {});
    out.label = { ...label, conditions: label.conditions || [] };
    out.performance = simulateLoanPerformance(out.truth, out.meta.corruption_type, ctx.config ?? {}, createRng(`${seedBase}-performance`));
  }
  return out;
}

/** Apply a list of mutations in order. */
export function applyMutations(caseObj, mutations, ctx = {}) {
  return mutations.reduce((c, m) => applyMutation(c, m, ctx), caseObj);
}

/**
 * The outputs the expected-change table speaks about, for one case: the credit policy (the profile's
 * decision), the underwriting policy, the fraud rules, the DTIs and the layers that must stay put.
 */
export function observeCase(c, { profile, config } = {}) {
  const credit = assessCredit(c, profile);
  const uw = scoreCase(c, config ?? {}, { now: "observe" });
  const alerts = runFraudRules(extractDecisionView(c)).alerts;
  const claimed = caseDti(c, profile, "presentation").dti;
  const truthDti = caseDti(c, profile, "truth").dti;
  const p = c.presentation?.current_state ?? {};
  return {
    "credit.decision": credit.policyDecision,
    "credit.flags": credit.flags.map((f) => f.code).sort(),
    "underwriting.decision": uw.decision.outcome,
    "underwriting.reason_codes": [...uw.decision.reason_codes].sort(),
    "fraud_rules": alerts.map((a) => `${a.rule_id}:${a.severity}`).sort(),
    "claimed_dti": claimed === null ? null : Math.round(claimed * 1e6) / 1e6,
    "true_dti": truthDti === null ? null : Math.round(truthDti * 1e6) / 1e6,
    "claimed_fico": p.credit_score ?? null,
    "claims": JSON.stringify({ state: c.presentation?.current_state, events: c.presentation?.events }),
    "truth": JSON.stringify(c.truth),
    "evidence": JSON.stringify(c.evidence),
    "evidence_sources": (c.evidence ?? []).map((e) => e.source).sort(),
    "application_metadata": JSON.stringify(c.application_metadata),
    "audit_attributes": JSON.stringify(c.audit_attributes),
    "reference_label": JSON.stringify({ outcome: c.label?.expected_outcome, codes: c.label?.reason_codes })
  };
}

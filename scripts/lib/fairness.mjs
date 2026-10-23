// scripts/lib/fairness.mjs — Counterfactual flips for the fairness checks (Sprint 12).
//
// Three kinds of flip, each changing one sensitive attribute and nothing else that matters:
//   audit      flip_sensitive (src/mutations.js): the audit record only. Proves no engine reads it.
//   deep       the attribute in every layer that holds a copy of it (claims, truth, evidence, audit),
//              with nothing recomputed. Proves no engine reads the field directly. Any change here is
//              "direct use" and stops the sprint.
//   financial  region only: the deep flip plus the financial consequence of moving region, the current
//              housing payment scaled by the target region's rent multiplier (config geography params),
//              so DTI follows. Changes here are reported as the financial channel, not as direct use.
// For every flip the outputs compared are the credit-policy decision and reason codes, the
// underwriting decision and codes, every fraud-rule result, and the credit model's 14 features (the
// model is deterministic, so identical features mean an identical PD and identical stated reasons).

import { applyMutation, observeCase } from "../../src/mutations.js";
import { AGE_BANDS, INCOME_BANDS, FAMILY_STATUS_SCENARIOS, ageBand } from "../../src/core/audit_attributes.js";
import { featureRow } from "./credit-features.mjs";

export function flipValues(config) {
  return {
    audit: {
      age_band: AGE_BANDS,
      geography_group: config.geography.categories,
      income_band: INCOME_BANDS,
      family_status_scenario: FAMILY_STATUS_SCENARIOS,
      disability_income_scenario: [0, 1],
      persona: config.personas.categories
    },
    deep: {
      region: config.geography.categories,
      persona: config.personas.categories,
      regime: Object.keys(config.regimes.params),
      zip_code: null, // a deterministic different ZIP (see otherZip)
      age: null // ten years older, or younger at 65 and above
    }
  };
}

const otherZip = (zip) => { const s = String(zip); return `${(Number(s[0]) + 1) % 10}${s.slice(1)}`; };
const evidenceOf = (c, source) => c.evidence?.find((e) => e.source === source);

/** The attribute set in every layer that holds it; nothing recomputed. */
export function deepFlip(caseObj, field, value) {
  const c = structuredClone(caseObj);
  const states = [c.truth?.current_state, c.presentation?.current_state].filter(Boolean);
  const geo = evidenceOf(c, "GEOGRAPHIC_VERIFICATION")?.fields;
  if (field === "region") {
    for (const s of states) s.region = value;
    if (c.truth?.demographics) c.truth.demographics.region = value;
    if (geo) geo.region = value;
    c.audit_attributes = { ...c.audit_attributes, geography_group: value };
  } else if (field === "persona") {
    for (const s of states) s.persona = value;
    const bureau = evidenceOf(c, "CREDIT_BUREAU")?.fields;
    if (bureau && "persona" in bureau) bureau.persona = value;
    c.audit_attributes = { ...c.audit_attributes, persona: value };
  } else if (field === "regime") {
    for (const s of states) s.regime = value;
    c.audit_attributes = { ...c.audit_attributes, regime: value };
  } else if (field === "zip_code") {
    for (const s of states) if (s.zip_code !== undefined) s.zip_code = value;
    if (c.truth?.demographics?.zip_code !== undefined) c.truth.demographics.zip_code = value;
    if (geo && geo.zip_code !== undefined) geo.zip_code = value;
    c.audit_attributes = { ...c.audit_attributes, zip3: String(value).slice(0, 3) };
  } else if (field === "age") {
    if (c.applicant) c.applicant.age = value;
    if (c.truth?.demographics) c.truth.demographics.age = value;
    c.audit_attributes = { ...c.audit_attributes, age_band: ageBand(value) };
  } else {
    throw new Error(`deepFlip: unknown field ${field}`);
  }
  return c;
}

/** Region moved with its financial consequence: the current housing payment scaled by the rent multiplier. */
export function regionWithHousing(caseObj, value, config) {
  const from = caseObj.truth?.demographics?.region ?? caseObj.truth?.current_state?.region;
  const c = deepFlip(caseObj, "region", value);
  const p = config.geography.params;
  const ratio = p[value]?.rent_multiplier && p[from]?.rent_multiplier ? p[value].rent_multiplier / p[from].rent_multiplier : 1;
  for (const s of [c.truth?.current_state, c.presentation?.current_state].filter(Boolean)) {
    for (const h of s.housing_history ?? []) if (Number.isFinite(h.monthly_payment)) h.monthly_payment = Math.round(h.monthly_payment * ratio);
  }
  const rent = evidenceOf(c, "RENT_VERIFICATION")?.fields;
  if (rent && Number.isFinite(rent.monthly_rent)) rent.monthly_rent = Math.round(rent.monthly_rent * ratio);
  return c;
}

/** The outputs a flip must leave unchanged. `policy` (optional) is a test-only decision function. */
export function outputsOf(c, ctx, policy) {
  const o = observeCase(c, ctx);
  return {
    decision: policy ? policy(c, o) : o["credit.decision"],
    flags: o["credit.flags"],
    underwriting: [o["underwriting.decision"], o["underwriting.reason_codes"]],
    fraud_rules: o.fraud_rules,
    features: featureRow(c, ctx.profile),
    claimed_dti: o.claimed_dti
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * An accumulator of every flip of every case added (each case with its own context when it was built
 * under another one): rows() gives { kind, attribute, cases, flips,
 * changed } per attribute (changed: flips whose outputs differ). For the financial channel,
 * `dti_moved` counts flips whose claimed DTI moved, `decision_changed` those whose credit decision
 * changed, and `changed_without_dti_move` any change the channel cannot explain (the stop condition).
 */
export function createFlipTable(ctx, { policy } = {}) {
  const values = flipValues(ctx.config);
  const rows = new Map();
  const row = (kind, attribute) => {
    const k = `${kind}|${attribute}`;
    if (!rows.has(k)) rows.set(k, { kind, attribute, cases: 0, flips: 0, changed: 0, ...(kind === "financial" ? { dti_moved: 0, decision_changed: 0, changed_without_dti_move: 0 } : {}), examples: [] });
    return rows.get(k);
  };
  const record = (r, id, before, after) => {
    r.flips++;
    if (!same(before, after)) {
      r.changed++;
      if (r.examples.length < 3) r.examples.push(id);
    }
  };
  const add = (c, caseCtx = ctx) => {
    const before = outputsOf(c, caseCtx, policy);
    for (const [attribute, vals] of Object.entries(values.audit)) {
      const r = row("audit", attribute);
      r.cases++;
      for (const v of vals) {
        if (v === c.audit_attributes?.[attribute]) continue;
        record(r, c.id, before, outputsOf(applyMutation(c, { type: "flip_sensitive", params: { attribute, value: v } }, caseCtx), caseCtx, policy));
      }
    }
    for (const [field, vals] of Object.entries(values.deep)) {
      const r = row("deep", field);
      r.cases++;
      const current = field === "region" ? c.truth?.demographics?.region : field === "persona" ? c.truth?.current_state?.persona : field === "regime" ? c.truth?.current_state?.regime : null;
      const targets = field === "zip_code" ? [otherZip(c.truth?.current_state?.zip_code ?? c.truth?.demographics?.zip_code ?? "00000")] : field === "age" ? [c.applicant.age >= 65 ? c.applicant.age - 10 : c.applicant.age + 10] : vals.filter((v) => v !== current);
      for (const v of targets) record(r, c.id, before, outputsOf(deepFlip(c, field, v), caseCtx, policy));
    }
    const fr = row("financial", "region");
    fr.cases++;
    for (const v of values.deep.region) {
      if (v === c.truth?.demographics?.region) continue;
      const after = outputsOf(regionWithHousing(c, v, caseCtx.config), caseCtx, policy);
      fr.flips++;
      const dtiMoved = after.claimed_dti !== before.claimed_dti;
      if (dtiMoved) fr.dti_moved++;
      if (after.decision !== before.decision) fr.decision_changed++;
      if (!same(before, after)) {
        fr.changed++;
        if (!dtiMoved) { fr.changed_without_dti_move++; if (fr.examples.length < 3) fr.examples.push(c.id); }
      }
    }
  };
  return { add, rows: () => [...rows.values()] };
}

/** The flip table for an array of cases. */
export function flipTable(cases, ctx, opts) {
  const t = createFlipTable(ctx, opts);
  for (const c of cases) t.add(c);
  return t.rows();
}

/** True when no audit or deep flip changed anything and the financial channel explains every change. */
export function flipsClean(rows) {
  return rows.every((r) => (r.kind === "financial" ? r.changed_without_dti_move === 0 : r.changed === 0));
}
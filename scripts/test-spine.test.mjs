// scripts/test-spine.test.mjs — Negative controls, the leakage audit and generator invariants.
// Run: npm run test:spine (also part of npm run test:all, which CI runs).
//
// Exits non-zero on the first failed assertion. Runs under both profiles.
//   Negative controls: pinned clean cases (corruption NONE, the Python clean_negative_control
//     construction) are never sent to fraud review and get exactly the credit decision their claimed
//     values imply, so a "decline everything" policy cannot pass.
//   Leakage audit (metamorphic): change only world-truth fields; every decision output is identical.
//     Scope: decision outputs only (assessCredit, the fraud rules, scoreCase, the sandbox pool record
//     and decide, and the integrity badge's display rule). The integrity verdict itself
//     (label.expected_outcome and label.reason_codes) is computed from world truth at generation by
//     design. It is an answer key, frozen with the case, so this test holds it fixed and never claims
//     it is truth-free. The pool record's loanInputs (true values feeding the outcome simulation) are
//     excluded for the same reason.
//   Invariants: claimed DTI equals caseDti exactly, schema types and ranges, no duplicate case IDs.
// The Solar prime DTI invariant over all 18,674 pool applications is in scripts/locked-numbers.test.mjs.

import assert from "node:assert/strict";
import { generateBlendedCase, generateCase } from "../src/generator.js";
import { applyProfile, getProfile } from "../src/profiles/index.js";
import { assessCredit, caseDti, CREDIT_POLICY } from "../src/creditRisk.js";
import { extractDecisionView, runFraudRules, scoreCase } from "../src/decisioning/index.js";
import { poolRecord, decide } from "../src/policySandbox.js";
import { integrityBadge } from "../src/ui/credit/useCreditAssessments.js";
import { REQUIRED_CASE_PATHS } from "../src/evaluation/generator-quality/index.js";
import { demoConfig } from "./lib/solar-book.mjs";
import { STRATA, CORRUPTION_TYPES } from "./lib/answer-key.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const SEED = "42";
const base = demoConfig();
const PROFILES = ["MORTGAGE", "SOLAR_PRIME"].map((id) => ({ id, profile: getProfile(id), config: applyProfile(base, id) }));
const cleanControls = (config) => Array.from({ length: 750 }, (_, i) => generateCase(i, config, "NONE", "LOW", `${SEED}-clean-${i}`));
const blended = (config, n, seed = SEED) => Array.from({ length: n }, (_, i) => generateBlendedCase(i, config, seed));
const stratified = (config, perStratum, seed = SEED) => {
  const out = [];
  let sid = 0;
  for (const [type, sev] of STRATA) for (let i = 0; i < perStratum; i++) out.push(generateCase(sid++, config, type, sev, `${seed}-strat-${type}-${sev}-${i}`));
  return out;
};

/** The credit decision implied by a case's claimed values, written out independently of assessCredit. */
function impliedDecision(c, profile) {
  const claimed = c.presentation.current_state;
  const fico = claimed.credit_score;
  const dti = caseDti(c, profile, "presentation").dti;
  const checking = claimed.checking_balance;
  if (fico < 660 || dti > 0.45) return "DECLINE";
  if (dti >= 0.36 || (checking < 1000 && dti > 0.40)) return "REVIEW";
  return "APPROVE";
}

console.log("test-spine tests");

check("the implied-decision thresholds are the credit policy's (FICO 660, DTI cap 45%, watch 36%, liquidity $1,000 at DTI > 40%)", () => {
  assert.deepEqual(
    [CREDIT_POLICY.ficoDecline, CREDIT_POLICY.dtiDecline, CREDIT_POLICY.dtiWatchLow, CREDIT_POLICY.liquidityCheckingMin, CREDIT_POLICY.liquidityDtiMin],
    [660, 0.45, 0.36, 1000, 0.40]
  );
});

for (const { id, profile, config } of PROFILES) {
  const controls = cleanControls(config);

  check(`negative controls (${id}): 750 clean cases, none sent to fraud review, each gets the decision its claimed values imply`, () => {
    const tally = { APPROVE: 0, REVIEW: 0, DECLINE: 0 };
    for (const c of controls) {
      assert.equal(c.meta.corruption_type, "NONE", c.id);
      const a = assessCredit(c, profile);
      assert.equal(a.fraudFlag, "NONE", `${c.id} sent to fraud review`);
      assert.ok(!runFraudRules(extractDecisionView(c)).alerts.some((x) => x.severity === "HIGH"), `${c.id} has a HIGH fraud alert`);
      assert.equal(a.policyDecision, impliedDecision(c, profile), c.id);
      tally[a.policyDecision]++;
    }
    // Not a decline-everything control: the claimed values imply all three outcomes.
    assert.ok(tally.APPROVE > 0 && tally.REVIEW > 0 && tally.DECLINE > 0, JSON.stringify(tally));
    console.log(`        ${JSON.stringify(tally)}`);
  });

  check(`leakage audit (${id}): changing only world-truth fields leaves every decision output identical`, () => {
    const sample = [...blended(config, 300, "leakage"), ...stratified(config, 10, "leakage")];
    const frozen = (c) => JSON.stringify([c.id, c.applicant, c.application, c.application_metadata, c.presentation, c.evidence, c.label, c.meta]);
    const decisions = (c) => {
      const a = assessCredit(c, profile);
      const { loanInputs: _outcomeInputs, ...record } = poolRecord(c, profile);
      return JSON.stringify([a, runFraudRules(extractDecisionView(c)), scoreCase(c, config, { now: "leakage-audit" }), record, decide(record), integrityBadge(a, c.label)]);
    };
    for (const c of sample) {
      const k = structuredClone(c);
      const t = k.truth.current_state;
      t.credit_score = 1150 - t.credit_score;
      t.salary = t.salary * 1.7 + 1234;
      t.monthly_obligations *= 0.3;
      t.checking_balance = t.checking_balance * 4 + 999;
      t.dti *= 0.5;
      t.backend_dti = 0.99;
      t.monthly_mortgage_payment *= 2;
      t.employer = "MUTATED EMPLOYER";
      t.monthly_ledger = [];
      t.housing_history = [];
      k.truth.events = [];
      k.truth.demographics.age += 20;
      k.truth.demographics.zip_code = "00000";
      k.performance = { ...k.performance, defaulted: 1 - k.performance.defaulted };
      assert.notEqual(JSON.stringify(k.truth), JSON.stringify(c.truth), `${c.id}: truth was not changed`);
      // Guard: the mutation must not reach the claimed, evidence or label layers through a shared reference.
      assert.equal(frozen(k), frozen(c), `${c.id}: a frozen layer changed`);
      assert.equal(decisions(k), decisions(c), `${c.id}: a decision output read world truth`);
    }
  });

  check(`invariants (${id}): claimed and true back-end DTI equal caseDti exactly; schema types and ranges; unique case IDs`, () => {
    const cases = [...blended(config, 2000), ...stratified(config, 40), ...controls];
    const ids = new Set();
    const get = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
    const finite = (v) => typeof v === "number" && Number.isFinite(v);
    for (const c of cases) {
      assert.ok(!ids.has(c.id), `duplicate case id ${c.id}`);
      ids.add(c.id);
      for (const p of REQUIRED_CASE_PATHS) assert.notEqual(get(c, p), undefined, `${c.id}: missing ${p}`);
      // Mortgage basis (proposed PITI): the generator stores it; the definitions are shared, so no tolerance.
      for (const layer of ["presentation", "truth"]) assert.equal(c[layer].current_state.backend_dti, caseDti(c, getProfile("MORTGAGE"), layer).dti, `${c.id} ${layer}`);
      assert.match(c.id, /^case-gen-\d+-[0-9a-f]+$/);
      assert.ok(CORRUPTION_TYPES.includes(c.meta.corruption_type), c.meta.corruption_type);
      assert.ok(["LOW", "MEDIUM", "HIGH"].includes(c.meta.severity), c.meta.severity);
      assert.ok(["APPROVE", "MANUAL_REVIEW", "DECLINE"].includes(c.label.expected_outcome), c.label.expected_outcome);
      assert.ok(Array.isArray(c.label.reason_codes) && Array.isArray(c.evidence) && c.evidence.length > 0, c.id);
      for (const layer of ["presentation", "truth"]) {
        const s = c[layer].current_state;
        assert.ok(Number.isInteger(s.credit_score) && s.credit_score >= 300 && s.credit_score <= 850, `${c.id} ${layer} credit_score ${s.credit_score}`);
        assert.ok(finite(s.salary) && s.salary > 0, `${c.id} ${layer} salary ${s.salary}`);
        assert.ok(finite(s.monthly_obligations) && s.monthly_obligations >= 0, `${c.id} ${layer} monthly_obligations`);
        assert.ok(finite(s.checking_balance), `${c.id} ${layer} checking_balance`);
        assert.ok(finite(s.backend_dti) && s.backend_dti >= 0, `${c.id} ${layer} backend_dti`);
      }
      assert.ok(finite(c.application.loan_amount) && c.application.loan_amount > 0, `${c.id} loan_amount`);
      assert.ok(Number.isInteger(c.applicant.age) && c.applicant.age >= 18 && c.applicant.age <= 100, `${c.id} age ${c.applicant.age}`);
      assert.ok([0, 1].includes(c.performance.defaulted), `${c.id} defaulted ${c.performance.defaulted}`);
    }
    assert.equal(ids.size, cases.length);
  });
}

console.log(`\n${passed} checks passed`);

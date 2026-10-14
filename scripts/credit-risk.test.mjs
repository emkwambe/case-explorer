// scripts/credit-risk.test.mjs — Credit policy overlay checks. Run: npm run test:credit
//
// Exits non-zero on the first failed assertion. Prints the policy decision mix per profile so the
// decline share under SOLAR_PRIME can be reported.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBlendedCase } from "../src/generator.js";
import { CREDIT_POLICY, ADVERSE_ACTION, DISAGREEMENT, applyProfile, assessCredit, backEndDti, riskSummary, ficoComparison } from "../src/creditRisk.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = JSON.parse(fs.readFileSync(path.join(root, "src", "distribution_config.json"), "utf8"));
const CONFIG = { ...BASE, generation: { ...BASE.generation, as_of_date: "2026-01-15" } };
const PROFILES = { MORTGAGE: applyProfile(CONFIG, "MORTGAGE"), SOLAR_PRIME: applyProfile(CONFIG, "SOLAR_PRIME") };
const ADVERSE_WORDING = new Set(Object.values(ADVERSE_ACTION));

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

function handBuilt({ fico = 720, salary = 120000, obligations = 1000, housing = 3300, checking = 5000, studentPayment = 320, expected = "APPROVE", reasonCodes = [] } = {}) {
  return {
    id: "case-hand-built",
    applicant: { name: "Hand Built", age: 35, zip_code: "75708", region: "MEDIUM_COST" },
    application: { loan_type: "MORTGAGE", loan_amount: 300000 },
    presentation: {
      events: studentPayment ? [{ t: "2021-07-14", type: "LIABILITY_OPENED", type_detail: "STUDENT_LOAN", payment: studentPayment }] : [],
      current_state: {
        credit_score: fico, salary, monthly_obligations: obligations, checking_balance: checking,
        housing_history: housing === null ? [] : [
          { t: "2019-02-01", type: "ADDRESS_CHANGE", type_detail: "RENTED", monthly_payment: 900 },
          { t: "2023-04-14", type: "ADDRESS_CHANGE", type_detail: "RENTED", monthly_payment: housing }
        ],
        region: "MEDIUM_COST", zip_code: "75708", persona: "STABLE_PROFESSIONAL", regime: "PRIME"
      }
    },
    evidence: [],
    application_metadata: {},
    label: { expected_outcome: expected, fraud_risk_level: "NONE", reason_codes: reasonCodes },
    meta: { corruption_type: "NONE" }
  };
}

/** Copy of a case with every geography, demographic-proxy and regime field changed. */
function withProxiesChanged(c) {
  const k = structuredClone(c);
  const swap = (o) => {
    if (!o) return;
    if ("region" in o) o.region = o.region === "HIGH_COST" ? "LOW_COST" : "HIGH_COST";
    if ("zip_code" in o) o.zip_code = o.zip_code === "10001" ? "59801" : "10001";
    if ("persona" in o) o.persona = o.persona === "GIG_WORKER" ? "STABLE_PROFESSIONAL" : "GIG_WORKER";
    if ("regime" in o) o.regime = o.regime === "SUBPRIME" ? "PRIME" : "SUBPRIME";
    if ("age" in o) o.age = o.age >= 60 ? 25 : 70;
  };
  swap(k.applicant);
  swap(k.truth?.demographics);
  swap(k.truth?.current_state);
  swap(k.presentation?.current_state);
  return k;
}

console.log("credit-risk tests");

const mix = {};
for (const [profile, cfg] of Object.entries(PROFILES)) {
  check(`assessCredit never throws across 500 seeded cases (${profile})`, () => {
    for (let i = 0; i < 500; i++) {
      const c = generateBlendedCase(i, cfg, `credit-${profile}`);
      assert.doesNotThrow(() => riskSummary(assessCredit(c)), `case ${i} (${profile})`);
    }
  });
}

check("every DECLINE carries a high-severity reason with adverse-action wording", () => {
  for (const cfg of Object.values(PROFILES)) {
    for (let i = 0; i < 500; i++) {
      const a = assessCredit(generateBlendedCase(i, cfg, 42));
      if (a.policyDecision !== "DECLINE") continue;
      assert.ok(a.flags.some((f) => f.severity === "high" && ADVERSE_WORDING.has(f.adverseActionReason)), `DECLINE without adverse-action reason: ${riskSummary(a)}`);
      assert.ok(a.reasons.length > 0 && a.reasons.every((r) => ADVERSE_WORDING.has(r)));
    }
  }
});

check("backEndDti matches a hand-built example", () => {
  // (1,000 non-housing + 3,300 latest rent) / (120,000 / 12) = 4,300 / 10,000 = 0.43
  const r = backEndDti(handBuilt().presentation.current_state);
  assert.equal(r.housingPayment, 3300);
  assert.equal(r.partial, false);
  assert.ok(Math.abs(r.dti - 0.43) < 1e-12, `dti ${r.dti}`);
  const partial = backEndDti(handBuilt({ housing: null }).presentation.current_state);
  assert.equal(partial.partial, true);
  assert.ok(Math.abs(partial.dti - 0.1) < 1e-12, `partial dti ${partial.dti}`);
});

check("FICO 682 with DTI 0.43 is REVIEW; FICO 640 is DECLINE", () => {
  const review = assessCredit(handBuilt({ fico: 682 }));
  assert.equal(review.policyDecision, "REVIEW");
  assert.deepEqual(review.flags.map((f) => f.code), ["ELEVATED_DTI"]);
  const decline = assessCredit(handBuilt({ fico: 640 }));
  assert.equal(decline.policyDecision, "DECLINE");
  assert.deepEqual(decline.reasons, [ADVERSE_ACTION.LOW_FICO]);
  assert.equal(CREDIT_POLICY.ficoDecline, 660);
});

check("geography exclusion: region, zip code, persona, age and regime do not change assessCredit", () => {
  const hb = handBuilt({ fico: 682 });
  assert.deepEqual(assessCredit(withProxiesChanged(hb)), assessCredit(hb));
  for (const cfg of Object.values(PROFILES)) {
    for (let i = 0; i < 200; i++) {
      const c = generateBlendedCase(i, cfg, "geo");
      const changed = withProxiesChanged(c);
      assert.notEqual(changed.presentation.current_state.region, c.presentation.current_state.region);
      assert.deepEqual(assessCredit(changed), assessCredit(c), `case ${i}`);
    }
  }
});

check("SOLAR_PRIME over 2,000 applications at seed 42: approved-only mean FICO 748 ± 5, no score value above 2% of all applications", () => {
  for (const [profile, cfg] of Object.entries(PROFILES)) {
    const counts = { APPROVE: 0, REVIEW: 0, DECLINE: 0 };
    const conflicts = { [DISAGREEMENT.INTEGRITY_APPROVE_CREDIT_DECLINE]: 0, [DISAGREEMENT.INTEGRITY_FLAG_CREDIT_APPROVE]: 0 };
    const scores = [], cases = [];
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const c = generateBlendedCase(i, cfg, 42);
      cases.push(c);
      scores.push(c.presentation.current_state.credit_score);
      const a = assessCredit(c);
      counts[a.policyDecision]++;
      if (a.disagreement) conflicts[a.disagreement.kind]++;
    }
    const freq = new Map();
    for (const v of scores) freq.set(v, (freq.get(v) ?? 0) + 1);
    const [modeValue, modeCount] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    const sorted = [...scores].sort((a, b) => a - b);
    mix[profile] = {
      n, counts, conflicts, comparison: ficoComparison(cases),
      modeValue, modeShare: modeCount / n,
      p5: sorted[Math.floor(0.05 * n)],
      below660: scores.filter((v) => v < CREDIT_POLICY.ficoDecline).length / n
    };
  }
  const solar = mix.SOLAR_PRIME;
  // Sunlight's 748 describes financed borrowers, so the target is the mean of approved applications.
  assert.ok(Math.abs(solar.comparison.approvedMean - 748) <= 5, `SOLAR_PRIME approved-only mean FICO ${solar.comparison.approvedMean.toFixed(1)}`);
  assert.ok(solar.modeShare < 0.02, `SOLAR_PRIME score ${solar.modeValue} holds ${(100 * solar.modeShare).toFixed(2)}% of cases`);
});

check("disagreement callouts: only integrity APPROVE + credit DECLINE, and integrity DECLINE / fraud REVIEW + credit APPROVE", () => {
  const a = assessCredit(handBuilt({ fico: 640, expected: "APPROVE" }));
  assert.equal(a.disagreement.kind, DISAGREEMENT.INTEGRITY_APPROVE_CREDIT_DECLINE);
  assert.equal(a.disagreement.text, "Integrity check: APPROVE · Credit policy: DECLINE (FICO 640)");
  const b = assessCredit(handBuilt({ fico: 720, housing: 1000, expected: "DECLINE" }));
  assert.equal(b.policyDecision, "APPROVE");
  assert.equal(b.disagreement.kind, DISAGREEMENT.INTEGRITY_FLAG_CREDIT_APPROVE);
  const c = assessCredit(handBuilt({ fico: 720, housing: 1000, expected: "MANUAL_REVIEW", reasonCodes: ["UNSOURCED_LARGE_DEPOSIT"] }));
  assert.equal(c.disagreement.kind, DISAGREEMENT.INTEGRITY_FLAG_CREDIT_APPROVE);
  assert.match(c.disagreement.text, /^Integrity check: REVIEW for fraud · Credit policy: APPROVE \(UNSOURCED_LARGE_DEPOSIT\)$/);
  // A credit-only integrity review against a credit approval is a difference of lens, not a conflict.
  assert.equal(assessCredit(handBuilt({ fico: 720, housing: 1000, expected: "MANUAL_REVIEW", reasonCodes: ["ELEVATED_DTI"] })).disagreement, null);
  // Integrity DECLINE + credit DECLINE and integrity APPROVE + credit REVIEW are not callouts.
  assert.equal(assessCredit(handBuilt({ fico: 640, expected: "DECLINE" })).disagreement, null);
  assert.equal(assessCredit(handBuilt({ fico: 682, expected: "APPROVE" })).disagreement, null);
});

check("riskSummary matches the documented format", () => {
  const line = riskSummary(assessCredit(handBuilt({ fico: 682, expected: "APPROVE" })));
  assert.equal(line, "Borrower: FICO 682, DTI 43%, Student $320/mo, Fraud: None, Policy: REVIEW - Elevated DTI | Integrity: APPROVE");
  const format = /^Borrower: FICO (\d+|n\/a), DTI (\d+%( \(partial\))?|n\/a), Student \$[\d,]+\/mo, Fraud: (None|Review), Policy: (APPROVE|(REVIEW|DECLINE) - .+) \| Integrity: (APPROVE|REVIEW|DECLINE|n\/a)$/;
  for (let i = 0; i < 200; i++) {
    const s = riskSummary(assessCredit(generateBlendedCase(i, PROFILES.SOLAR_PRIME, 42)));
    assert.match(s, format);
  }
});

console.log(`\n${passed} checks passed\n`);
const fmt = (v) => (v === null ? "n/a" : v.toFixed(1));
const share = (v) => `${(100 * v).toFixed(1)}%`;
console.log("Credit policy on 2,000 blended applications at seed 42 (claimed FICO):");
for (const [profile, m] of Object.entries(mix)) {
  const k = m.comparison;
  console.log(`  ${profile}`);
  console.log(`    FICO   all applications ${fmt(k.allMean)} (n ${k.n}) · approved only ${fmt(k.approvedMean)} (n ${k.approvedN}) · p5 ${m.p5} · below 660 ${share(m.below660)} · most common score ${m.modeValue} at ${share(m.modeShare)}`);
  console.log(`    Policy APPROVE ${share(m.counts.APPROVE / m.n)} · REVIEW ${share(m.counts.REVIEW / m.n)} · DECLINE ${share(m.counts.DECLINE / m.n)}`);
  console.log(`    Callouts: integrity APPROVE + credit DECLINE ${m.conflicts[DISAGREEMENT.INTEGRITY_APPROVE_CREDIT_DECLINE]} · integrity DECLINE/fraud REVIEW + credit APPROVE ${m.conflicts[DISAGREEMENT.INTEGRITY_FLAG_CREDIT_APPROVE]}`);
}

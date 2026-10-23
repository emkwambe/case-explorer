// scripts/challenge.test.mjs — Challenge-mode scoring, the evidence map and the scenario packs.
// Run: npm run test:challenge
//
// Exits non-zero on the first failed assertion.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreAttempt, DECISION_POINTS, DECISIONS } from "../src/challenge/score.js";
import { keyEvidence, evidenceItemsFor, EVIDENCE_ITEMS } from "../src/challenge/evidence.js";
import { REASON_CODES } from "../src/challenge/reasonCodes.js";
import { PACK_RULES, buildPacks, orderPack } from "../src/challenge/packs.js";
import { teachingContext, buildTeachingCase } from "../src/challenge/teachingCases.js";
import { challengeData, teachingSet, scoringMarkdown, challengeReadme, WORKED_EXAMPLES, DATA_FILE, SCORING_DOC, CHALLENGE_README } from "./challenge-docs.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "src/distribution_config.json"), "utf8"));
const data = challengeData();
const byId = new Map(data.cases.map((e) => [e.id, e]));

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log("challenge tests");

check("the decision matrix is the one in the spec, cell by cell", () => {
  assert.deepEqual(DECISION_POINTS, {
    APPROVE: { APPROVE: 50, REVIEW: 20, DECLINE: 0 },
    REVIEW: { APPROVE: 0, REVIEW: 50, DECLINE: 20 },
    DECLINE: { APPROVE: 0, REVIEW: 25, DECLINE: 50 }
  });
  const e = byId.get("near/fico-659-b1");
  for (const d of DECISIONS) assert.equal(scoreAttempt(e, { decision: d, reasonCodes: [], evidence: "x" }).parts.decision, DECISION_POINTS[e.expected.decision][d]);
  assert.throws(() => scoreAttempt(e, { decision: "MAYBE", reasonCodes: [], evidence: "x" }));
});

check("reason-code arithmetic: coverage, extra-code penalty, acceptable codes, duplicates and the floor at 0", () => {
  const two = { id: "t", group: "near-threshold", mutations: [{ type: "shift_dti_to", params: {} }], expected: { decision: "REVIEW", reason_codes: ["ELEVATED_DTI", "LIQUIDITY_RISK"] } };
  const r = (codes, e = two) => scoreAttempt(e, { decision: "REVIEW", reasonCodes: codes, evidence: "x" }).parts.reasons;
  assert.equal(r(["ELEVATED_DTI", "LIQUIDITY_RISK"]), 30);
  assert.equal(r(["ELEVATED_DTI"]), 15);
  assert.equal(r([]), 0);
  assert.equal(r(["ELEVATED_DTI", "HIGH_DTI"]), 5);
  assert.equal(r(["ELEVATED_DTI", "HIGH_DTI", "LOW_FICO"]), 0, "15 − 20 floors at 0");
  assert.equal(r(["ELEVATED_DTI", "ELEVATED_DTI"]), 15, "a code chosen twice counts once");
  const none = { ...two, expected: { decision: "APPROVE", reason_codes: [] } };
  assert.equal(r([], none), 30, "no codes required: choosing none scores 30");
  assert.equal(r(["LOW_FICO"], none), 20, "no codes required: 30 − 10 per extra");
  const acc = byId.get("concealment-1/fraud");
  assert.deepEqual(acc.expected.acceptable_codes, ["FRAUD_REVIEW"]);
  assert.equal(r(["HIGH_DTI", "UNDISCLOSED_LIABILITIES", "FRAUD_REVIEW"], acc), 30, "an acceptable code costs nothing");
  assert.equal(r(["FRAUD_REVIEW"], acc), 0, "an acceptable code earns nothing");
});

check("the liquidity pair scores differently when LIQUIDITY_RISK is omitted", () => {
  const attempt = { decision: "REVIEW", reasonCodes: ["ELEVATED_DTI"], evidence: "application.checking" };
  const low = scoreAttempt(byId.get("near/checking-999-b1"), attempt), at = scoreAttempt(byId.get("near/checking-1000-b1"), attempt);
  assert.equal(low.parts.decision, at.parts.decision);
  assert.ok(low.total < at.total, `${low.total} vs ${at.total}`);
  assert.equal(low.parts.reasons, 15);
});

check("the worked examples in docs/SCORING.md score as documented", () => {
  const expectTotals = { "concealment-1/clean": 100, "concealment-1/fraud": 60, "near/checking-999-b1": 85, "near/checking-1000-b1": 100, "thin/bank-statement-b1": 40, "conflict/sub-threshold-b1": 0 };
  assert.deepEqual(WORKED_EXAMPLES.map((x) => x.id), Object.keys(expectTotals));
  for (const ex of WORKED_EXAMPLES) assert.equal(scoreAttempt(byId.get(ex.id), ex.attempt).total, expectTotals[ex.id], ex.id);
  assert.ok(byId.get("conflict/sub-threshold-b1").gap, "the gap example is a gap case");
});

check("determinism: the same case and attempt always score the same, and the inputs are not modified", () => {
  for (const e of data.cases) {
    const attempt = { decision: "REVIEW", reasonCodes: ["FRAUD_REVIEW", "ELEVATED_DTI"], evidence: keyEvidence(e)[0] };
    const before = JSON.stringify([e, attempt]);
    assert.deepEqual(scoreAttempt(e, attempt), scoreAttempt(e, attempt), e.id);
    assert.equal(JSON.stringify([e, attempt]), before, e.id);
  }
});

check("the expected answer scores 100 on every case, and every case's codes are in the selectable list", () => {
  for (const e of data.cases) {
    for (const c of [...e.expected.reason_codes, ...(e.expected.acceptable_codes ?? [])]) assert.ok(REASON_CODES.includes(c), `${e.id}: ${c}`);
    const s = scoreAttempt(e, { decision: e.expected.decision, reasonCodes: e.expected.reason_codes, evidence: keyEvidence(e)[0] });
    assert.equal(s.total, 100, e.id);
  }
});

const ctx = teachingContext(data, baseConfig);
const built = new Map(data.cases.map((e) => [e.id, buildTeachingCase(e, data, ctx)]));

check("the browser's recipe rebuild reproduces every committed teaching case (system.hash)", () => {
  for (const e of data.cases) assert.equal(crypto.createHash("sha256").update(JSON.stringify(built.get(e.id))).digest("hex").slice(0, 16), e.system.hash, e.id);
});

check("evidence map: every key fact maps to at least one item, each offered for that case; ids are unique", () => {
  assert.equal(new Set(EVIDENCE_ITEMS.map((i) => i.id)).size, EVIDENCE_ITEMS.length);
  const counts = {};
  for (const e of data.cases) {
    const keys = keyEvidence(e), offered = evidenceItemsFor(built.get(e.id)).map((i) => i.id);
    assert.ok(keys.length >= 1, e.id);
    for (const k of keys) assert.ok(offered.includes(k), `${e.id}: ${k} not offered`);
    counts[keys.join("|")] = (counts[keys.join("|")] ?? 0) + 1;
  }
  assert.deepEqual(counts, {
    supports: 22, "bureau.obligations": 5, "employer.salary": 5, "bank.checking": 10, "application.credit_score|bureau.credit_score": 9,
    "application.dti": 12, "application.checking|bank.checking": 6, "employer.salary|bureau.obligations": 6, missing: 4
  });
  // A missing document's items are not offered (the list shows what the case has, nothing more).
  assert.ok(!evidenceItemsFor(built.get("thin/bank-statement-b1")).some((i) => i.id === "bank.checking"));
});

check("packs: rule-derived, ids exist in teaching-v1, counts as documented, reproducible", () => {
  assert.deepEqual(data.packs.map((p) => [p.id, p.caseIds.length]), [["first-week", 18], ["on-the-line", 27], ["judgment-calls", 12], ["causal-pairs", 40], ["engine-limits", 15], ["full-set", 79]]);
  assert.equal(data.packs.length, PACK_RULES.length);
  for (const p of data.packs) for (const id of p.caseIds) assert.ok(byId.has(id), `${p.id}: ${id}`);
  assert.deepEqual(buildPacks(data.cases), data.packs);
  const fw = data.packs.find((p) => p.id === "first-week").caseIds.map((id) => byId.get(id));
  assert.ok(fw.every((e) => e.difficulty === "easy" && fw.some((x) => x.pair === e.pair && x.role !== e.role)), "first week holds whole easy pairs");
  assert.equal(data.packs.find((p) => p.id === "engine-limits").caseIds.length, data.cases.filter((e) => e.gap).length);
});

check("seeded order: a permutation, deterministic, never two same-base cases adjacent (200 seeds per pack), full set easy → hard", () => {
  for (const p of data.packs) {
    for (let s = 1; s <= 200; s++) {
      const order = orderPack(p, data.cases, s);
      assert.deepEqual([...order].sort(), [...p.caseIds].sort(), `${p.id} seed ${s}`);
      for (let i = 1; i < order.length; i++) assert.notEqual(byId.get(order[i]).base.case_id, byId.get(order[i - 1]).base.case_id, `${p.id} seed ${s} at ${i}`);
      if (p.tiered) { const rank = { easy: 0, medium: 1, hard: 2 }; for (let i = 1; i < order.length; i++) assert.ok(rank[byId.get(order[i]).difficulty] >= rank[byId.get(order[i - 1]).difficulty]); }
    }
    assert.deepEqual(orderPack(p, data.cases, 42), orderPack(p, data.cases, 42));
    assert.notDeepEqual(orderPack(p, data.cases, 1), orderPack(p, data.cases, 2), `${p.id}: the seed changes the order`);
  }
  assert.throws(() => orderPack(data.packs[0], data.cases, ""));
});

check("challenge data, docs/SCORING.md and the packs README are current, and carry the teaching set's SHA-256", () => {
  assert.equal(data.teaching_sha256, teachingSet().sha);
  assert.equal(fs.readFileSync(DATA_FILE, "utf8"), `${JSON.stringify(data, null, 1)}\n`);
  assert.equal(fs.readFileSync(SCORING_DOC, "utf8"), scoringMarkdown());
  assert.equal(fs.readFileSync(CHALLENGE_README, "utf8"), challengeReadme());
});

console.log(`\n${passed} checks passed`);

// scripts/fairness.test.mjs — Counterfactual flips and the bureau-score policy file. Run: npm run test:fairness
//
// Exits non-zero on the first failed assertion. The full flip table (opening library, teaching-v1 and
// the 18,674-application seed-42 pool) is built by scripts/export_credit_features.mjs, which CI reruns
// and diffs; here the committed table is checked, a sample of the pool is flipped afresh, and two
// deliberately broken test-only policies prove the assertion can fail.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBlendedCase } from "../src/generator.js";
import { applyProfile, getProfile } from "../src/profiles/index.js";
import { demoConfig } from "./lib/solar-book.mjs";
import { flipTable, flipsClean } from "./lib/fairness.mjs";
import { DECISION_COLUMNS, SENSITIVE_COLUMNS } from "./export_credit_features.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const rows = (text) => { const [h, ...ls] = text.trimEnd().split("\n"); const c = h.split(","); return ls.map((l) => Object.fromEntries(l.split(",").map((v, i) => [c[i], v]))); };
const SAMPLE = 300;

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log("fairness tests");

const solar = getProfile("SOLAR_PRIME"), ctx = { profile: solar, config: applyProfile(demoConfig(), solar) };
const sample = Array.from({ length: SAMPLE }, (_, i) => generateBlendedCase(i, ctx.config, 42));

check("committed flip table: every audit and deep flip changed nothing, and every financial-channel change moved DTI", () => {
  const flips = JSON.parse(read("data", "credit-model", "fairness-flips.json"));
  assert.equal(flips.clean, true);
  const sizes = { opening_library: 13, teaching_v1: 79, pool_seed_42: 18674 };
  assert.deepEqual(Object.keys(flips.sets), Object.keys(sizes));
  for (const [name, set] of Object.entries(flips.sets)) {
    assert.equal(set.length, 12, `${name}: 6 audit, 5 deep and 1 financial row`);
    for (const r of set) {
      assert.equal(r.cases, sizes[name], `${name} ${r.kind} ${r.attribute}`);
      assert.ok(r.flips >= r.cases, `${name} ${r.kind} ${r.attribute}: every case flipped`);
      if (r.kind === "financial") assert.equal(r.changed_without_dti_move, 0, `${name}: financial change without a DTI move`);
      else assert.equal(r.changed, 0, `${name} ${r.kind} ${r.attribute}`);
    }
  }
});

check(`a fresh flip of ${SAMPLE} seed-42 applications is clean`, () => {
  const t = flipTable(sample, ctx);
  assert.ok(flipsClean(t), JSON.stringify(t.filter((r) => r.changed && r.kind !== "financial")));
  const fin = t.find((r) => r.kind === "financial");
  assert.ok(fin.dti_moved > 0, "the financial channel moves DTI");
});

check("a test-only policy that reads the age band fails the assertion (audit and deep flips both catch it)", () => {
  const broken = (c, o) => (c.audit_attributes?.age_band === "60+" ? "DECLINE" : o["credit.decision"]);
  const t = flipTable(sample.slice(0, 100), ctx, { policy: broken });
  assert.equal(flipsClean(t), false);
  assert.ok(t.find((r) => r.kind === "audit" && r.attribute === "age_band").changed > 0);
  assert.ok(t.find((r) => r.kind === "deep" && r.attribute === "age").changed > 0);
});

check("a test-only policy that reads the true region fails on the deep flip, which the audit flip alone would miss", () => {
  const broken = (c, o) => (c.truth?.demographics?.region === "HIGH_COST" ? "REVIEW" : o["credit.decision"]);
  const t = flipTable(sample.slice(0, 100), ctx, { policy: broken });
  assert.equal(t.find((r) => r.kind === "audit" && r.attribute === "geography_group").changed, 0);
  assert.ok(t.find((r) => r.kind === "deep" && r.attribute === "region").changed > 0);
  assert.equal(flipsClean(t), false);
});

check("decisions file: the claimed-FICO decision is the locked tape's; the bureau-score policy's mix is reported beside it", () => {
  const d = rows(read("data", "credit-model", "decisions-seed-42.csv"));
  assert.deepEqual(Object.keys(d[0]), DECISION_COLUMNS);
  const tape = rows(read("data", "credit-tape", "credit-tape-pool.csv"));
  assert.equal(d.length, tape.length);
  tape.forEach((t, i) => {
    assert.equal(d[i].application_id, t.application_id);
    assert.equal(d[i].decision_claimed, t.decision, t.application_id);
  });
  const mix = (k) => d.reduce((m, r) => ({ ...m, [r[k]]: (m[r[k]] ?? 0) + 1 }), {});
  assert.deepEqual(mix("decision_claimed"), { APPROVE: 10000, REVIEW: 4494, DECLINE: 4180 });
  assert.deepEqual(mix("decision_bureau"), { APPROVE: 9991, REVIEW: 4475, DECLINE: 4208 });
});

check("sensitive file: the audit attributes of every seed-42 application, and none of them is a feature", () => {
  const s = rows(read("data", "credit-model", "sensitive-seed-42.csv"));
  assert.deepEqual(Object.keys(s[0]), SENSITIVE_COLUMNS);
  assert.equal(s.length, 18674);
  const features = read("data", "credit-model", "applications-seed-42.csv").split("\n", 1)[0].split(",");
  for (const c of SENSITIVE_COLUMNS.slice(1)) assert.ok(!features.includes(c), c);
});

console.log(`fairness tests: ${passed} passed`);

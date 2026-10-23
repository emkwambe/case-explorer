// scripts/mutations.test.mjs — The mutation engine, the expected-change table and the teaching set.
// Run: npm run test:mutations
//
// Exits non-zero on the first failed assertion.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateBlendedCase } from "../src/generator.js";
import { applyProfile, getProfile } from "../src/profiles/index.js";
import { MUTATIONS, applyMutation, applyMutations, observeCase } from "../src/mutations.js";
import { MUTATION_TABLE, OUTPUTS, isEligibleBase, checkRow } from "../src/mutationTable.js";
import { buildTeachingSet, serializeTeachingSet, RUBRIC, DIFFICULTY_RULE } from "./lib/teaching-set.mjs";
import { mutationsMarkdown, teachingReadme, MUTATIONS_DOC, teachingReadmePath } from "./teaching-docs.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sets = JSON.parse(fs.readFileSync(path.join(ROOT, "benchmarks/case-sets.json"), "utf8")).sets;
const SET = sets.find((s) => s.kind === "teaching");
const SET_FILE = path.join(ROOT, "benchmarks", SET.file);
const configText = fs.readFileSync(path.join(ROOT, "src/distribution_config.json"), "utf8");
const baseConfig = JSON.parse(configText);
const profile = getProfile(SET.profile);
const config = applyProfile({ ...baseConfig, generation: { ...baseConfig.generation, as_of_date: SET.as_of } }, profile);
const ctx = { profile, config };
const sha256 = (t) => crypto.createHash("sha256").update(t).digest("hex");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log("mutation tests");

const bases = [];
for (let i = 0; bases.length < 20 && i < 500; i++) {
  const c = generateBlendedCase(i, config, SET.seed);
  if (isEligibleBase(c, observeCase(c, ctx))) bases.push(c);
}

check("the table: every row places each of the 15 outputs in exactly one column, and names a known mutation", () => {
  assert.equal(OUTPUTS.length, 15);
  for (const r of MUTATION_TABLE) {
    assert.ok(MUTATIONS[r.mutation], r.id);
    const cols = [...r.must.map((m) => m.output), ...r.may, ...r.mustNot];
    assert.deepEqual([...cols].sort(), [...OUTPUTS].sort(), `${r.id}: columns`);
    assert.equal(new Set(cols).size, cols.length, `${r.id}: an output is in two columns`);
  }
  assert.ok(new Set(MUTATION_TABLE.map((r) => r.mutation)).size === Object.keys(MUTATIONS).length, "every mutation type has a row");
  const flip = MUTATION_TABLE.find((r) => r.mutation === "flip_sensitive");
  for (const o of ["credit.decision", "credit.flags", "underwriting.decision", "underwriting.reason_codes", "fraud_rules", "claimed_dti", "reference_label"]) assert.ok(flip.mustNot.includes(o), `flip_sensitive must leave ${o} unchanged`);
});

check(`every row of the expected-change table holds on ${bases.length} eligible bases`, () => {
  assert.equal(bases.length, 20);
  for (const r of MUTATION_TABLE) {
    for (const b of bases) {
      const start = r.setup ? applyMutations(b, r.setup, ctx) : b;
      const after = applyMutation(start, { type: r.mutation, params: r.params(start) }, ctx);
      assert.deepEqual(checkRow(r, observeCase(start, ctx), observeCase(after, ctx)), [], `${r.id} on ${b.id}`);
    }
  }
});

check("applyMutation never changes its input, and the same input gives the same output", () => {
  for (const r of MUTATION_TABLE) {
    for (const b of bases.slice(0, 3)) {
      const start = r.setup ? applyMutations(b, r.setup, ctx) : b;
      const before = JSON.stringify(start);
      const m = { type: r.mutation, params: r.params(start) };
      const one = JSON.stringify(applyMutation(start, m, ctx));
      const two = JSON.stringify(applyMutation(start, m, ctx));
      assert.equal(JSON.stringify(start), before, `${r.id}: input changed`);
      assert.equal(one, two, `${r.id}: not deterministic`);
      const out = JSON.parse(one);
      assert.equal(out.id, start.id, `${r.id}: a mutated case keeps its base id`);
      assert.deepEqual(out.meta.mutations.at(-1), m);
      assert.equal(out.meta.base_case_id, b.id);
    }
  }
});

check("invalid mutations are rejected", () => {
  const b = bases[0];
  assert.throws(() => applyMutation(b, { type: "nope" }), /Unknown mutation/);
  assert.throws(() => applyMutation(b, { type: "hide_debt", params: { monthly: -5 } }), /positive whole number/);
  assert.throws(() => applyMutation(b, { type: "conflict_document", params: { field: "W2_DOCUMENT.w2_wages", pct: 0.2 } }), /unsupported field/);
  assert.throws(() => applyMutation(b, { type: "shift_dti_to", params: { target: 0.05 } }, ctx), /only raises it/);
  assert.throws(() => applyMutation(b, { type: "flip_sensitive", params: { attribute: "salary", value: 1 } }), /not a sensitive attribute/);
  assert.throws(() => applyMutation(b, { type: "remove_statement", params: { source: "PASSPORT" } }), /has no PASSPORT/);
});

// The teaching set
const committedText = fs.readFileSync(SET_FILE, "utf8");
const built = buildTeachingSet(SET, baseConfig, configText);
const entries = built.entries;

check("teaching-v1 rebuilds byte-identical from its seeds and recipes (no hand-edited case)", () => {
  assert.equal(serializeTeachingSet(built), committedText);
  assert.equal(entries.length, 79);
  assert.ok(fs.readFileSync(path.join(ROOT, "benchmarks/CHANGELOG.md"), "utf8").includes(sha256(committedText)), "the set's SHA-256 is named in the CHANGELOG");
});

check("teaching-v1 is the same when built in another time zone (Asia/Tokyo)", () => {
  const child = `const m = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, "scripts/lib/teaching-set.mjs")).href)}); const fs = await import("node:fs");
    const sets = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, "benchmarks/case-sets.json"))}, "utf8")).sets; const t = fs.readFileSync(${JSON.stringify(path.join(ROOT, "src/distribution_config.json"))}, "utf8");
    process.stdout.write(String(new Date(2026, 6, 1).getTimezoneOffset()) + " " + (await import("node:crypto")).createHash("sha256").update(m.serializeTeachingSet(m.buildTeachingSet(sets.find((s) => s.kind === "teaching"), JSON.parse(t), t))).digest("hex"));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", child], { encoding: "utf8", env: { ...process.env, TZ: "Asia/Tokyo" } });
  assert.equal(r.status, 0, r.stderr);
  const [offset, digest] = r.stdout.trim().split(" ");
  assert.equal(offset, "-540");
  assert.equal(digest, sha256(committedText));
});

check("composition: 40 pair, 27 near-threshold, 6 conflicting, 6 thin-evidence; every case records its base, mutations, key fact, difficulty, typology and both answers", () => {
  const n = (g) => entries.filter((e) => e.group === g).length;
  assert.deepEqual([n("causal-pair"), n("near-threshold"), n("conflicting"), n("thin-evidence")], [40, 27, 6, 6]);
  for (const e of entries) {
    assert.ok(e.base.seed && Number.isInteger(e.base.index) && e.base.case_id, e.id);
    assert.ok(Array.isArray(e.mutations) && e.key_fact?.field && e.typology && e.tests, e.id);
    assert.ok(Object.keys(DIFFICULTY_RULE).includes(e.difficulty), e.id);
    // The teaching answer comes from the rubric, never from the reference label.
    assert.deepEqual(Object.keys(e.expected).sort(), ["decision", "reason_codes", "rubric"], e.id);
    assert.ok(RUBRIC[e.expected.rubric], e.id);
    assert.ok(e.system.reference_label && e.system.underwriting, e.id);
  }
});

const bySet = new Map(entries.map((e, i) => [e.id, { e, c: built.cases[i] }]));
/** Leaf paths that differ between two cases, with evidence keyed by source. */
function diffPaths(a, b, prefix = "") {
  const norm = (x) => (x && typeof x === "object" && Array.isArray(x.evidence) ? { ...x, evidence: Object.fromEntries(x.evidence.map((d) => [d.source, d])) } : x);
  a = prefix ? a : norm(a); b = prefix ? b : norm(b);
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b) || (Array.isArray(a) && a.length !== b.length)) return [prefix];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k));
}
const DERIVED = ["label", "alignment_findings", "ground_truth_findings", "performance", "meta"];
const ALLOWED = {
  hide_debt: ["truth.events", "truth.current_state.monthly_obligations", "truth.current_state.backend_dti", "truth.current_state.dti", "evidence.CREDIT_BUREAU.fields.liabilities", "evidence.CREDIT_BUREAU.fields.open_accounts", "evidence.BANK_STATEMENT.fields.recurring_debits"],
  inflate_income: ["presentation.current_state.salary", "presentation.current_state.backend_dti", "presentation.current_state.dti"],
  conflict_document: ["evidence.BANK_STATEMENT.fields.checking_balance"],
  fabricate_assets: ["presentation.current_state.checking_balance"]
};
const KEY_PATH = { hide_debt: "truth.current_state.monthly_obligations", inflate_income: "presentation.current_state.salary", conflict_document: "evidence.BANK_STATEMENT.fields.checking_balance", fabricate_assets: "presentation.current_state.checking_balance" };

check("pairs: the twins differ only in the key fact (and what the generator derives from it), and the decision changes as recorded", () => {
  const pairs = [...new Set(entries.filter((e) => e.pair).map((e) => e.pair))];
  assert.equal(pairs.length, 20);
  for (const p of pairs) {
    const clean = bySet.get(`${p}/clean`), fraud = bySet.get(`${p}/fraud`);
    assert.equal(fraud.c.id, clean.c.id, `${p}: twins share the base id`);
    assert.deepEqual(clean.e.mutations, []);
    assert.equal(fraud.e.mutations.length, 1);
    const type = fraud.e.mutations[0].type;
    const diff = diffPaths(clean.c, fraud.c).filter((d) => !DERIVED.some((x) => d === x || d.startsWith(`${x}.`)));
    for (const d of diff) assert.ok(ALLOWED[type].some((x) => d === x || d.startsWith(`${x}.`)), `${p}: ${d} changed`);
    assert.ok(diff.includes(KEY_PATH[type]), `${p}: the key fact ${KEY_PATH[type]} did not change`);
    assert.equal(clean.e.system.decision, "APPROVE", p);
    assert.equal(fraud.e.system.decision, "REVIEW", p);
    assert.deepEqual(fraud.e.system.reason_codes, ["FRAUD_REVIEW"], p);
    assert.equal(fraud.e.system.claimed_fico, clean.e.system.claimed_fico, p);
  }
});

check("near-threshold cases land on the expected side of their threshold", () => {
  for (const e of entries.filter((x) => x.group === "near-threshold")) {
    const v = e.key_fact.value, s = e.system;
    if (e.id.startsWith("near/fico-")) assert.equal(s.claimed_fico, v, e.id);
    else if (e.id.startsWith("near/dti-")) {
      const thr = Number(e.key_fact.threshold);
      assert.ok(Math.abs(s.claimed_dti - v) < 0.0005, `${e.id}: DTI ${s.claimed_dti} vs target ${v}`);
      assert.ok(v < thr ? s.claimed_dti < thr : s.claimed_dti > thr, `${e.id}: DTI ${s.claimed_dti} on the wrong side of ${thr}`);
    } else {
      assert.equal(bySet.get(e.id).c.presentation.current_state.checking_balance, v, e.id);
      assert.ok(s.claimed_dti > 0.40 && s.claimed_dti < 0.45, e.id);
    }
    assert.equal(s.decision, e.expected.decision, e.id);
    assert.deepEqual([...s.reason_codes].sort(), [...e.expected.reason_codes].sort(), e.id);
  }
});

check("every case where the teaching answer and the engine differ is a named gap with a reason", () => {
  const gaps = entries.filter((e) => e.gap);
  for (const e of entries) {
    const agrees = e.expected.decision === e.system.decision && JSON.stringify([...e.expected.reason_codes].sort()) === JSON.stringify([...e.system.reason_codes].sort());
    assert.equal(Boolean(e.gap), !agrees, e.id);
    if (e.gap) assert.ok(typeof e.gap.reason === "string" && e.gap.reason.length > 20, `${e.id}: gap without a reason`);
  }
  assert.equal(gaps.length, 9);
  assert.deepEqual([...new Set(gaps.map((g) => g.group))].sort(), ["conflicting", "thin-evidence"]);
});

check("docs/MUTATIONS.md and the teaching-set README are current", () => {
  assert.equal(fs.readFileSync(MUTATIONS_DOC, "utf8"), mutationsMarkdown());
  assert.equal(fs.readFileSync(teachingReadmePath(), "utf8"), teachingReadme(SET_FILE));
});

console.log(`\n${passed} checks passed`);

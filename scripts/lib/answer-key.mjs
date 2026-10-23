// scripts/lib/answer-key.mjs — Seed-pinned case sets, their committed answer keys, and the scorecard
// `npm run benchmark` prints after its release gates.
//
// Each set in benchmarks/case-sets.json is regenerated and compared, case by case, with
// benchmarks/answer-key-<set>.json. Any difference fails the benchmark unless the key is
// regenerated (`npm run benchmark -- --update-key`) and benchmarks/CHANGELOG.md gains a line naming
// the new key's SHA-256 with a one-line reason. The current outputs are the baseline: a key records
// what the engine does, not what it should do.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBlendedCase, generateCase } from "../../src/generator.js";
import { applyProfile, getProfile } from "../../src/profiles/index.js";
import { assessCredit } from "../../src/creditRisk.js";
import { extractDecisionView, runFraudRules, scoreCase, FRAUD_RULESET_VERSION, UNDERWRITING_POLICY_VERSION, REASON_CODE_CATALOG_VERSION } from "../../src/decisioning/index.js";
import { FRAUD_CORRUPTION_TYPES } from "../../src/ml/decision_features.js";
import { GENERATOR_VERSION, CASE_SCHEMA_VERSION } from "../../src/core/case.js";
import { buildTeachingSet, serializeTeachingSet, teachingFile, teachingSummary } from "./teaching-set.mjs";

export const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "benchmarks");

/** The benchmark's stratified detection set: every corruption type at each severity it is generated with. */
export const STRATA = [
  ["NONE", "LOW"], ["INFLATION", "LOW"], ["INFLATION", "MEDIUM"], ["INFLATION", "HIGH"],
  ["CONCEALMENT", "MEDIUM"], ["CONCEALMENT", "HIGH"], ["FABRICATION", "HIGH"], ["BUST_OUT", "HIGH"],
  ["EVIDENCE_TAMPERING", "MEDIUM"], ["EVIDENCE_TAMPERING", "HIGH"], ["INCOHERENT", "HIGH"],
  ["OCCUPANCY_MISREPRESENTATION", "MEDIUM"], ["GIFT_FUND_MISREPRESENTATION", "MEDIUM"], ["ASSET_SEASONING", "MEDIUM"], ["STRAW_BUYER", "HIGH"]
];

/** All 11 corruption types the generator can produce, clean (NONE) first; the scorecard reports each. */
export const CORRUPTION_TYPES = ["NONE", ...FRAUD_CORRUPTION_TYPES, "INCOHERENT"];
const SEVERITIES = ["LOW", "MEDIUM", "HIGH"];

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** Generate a set's cases: the blended population, then the stratified set, as scripts/benchmark.js does. */
export function generateSet(set, baseConfig) {
  const config = { ...baseConfig, generation: { ...(baseConfig.generation || {}), as_of_date: set.as_of } };
  // raw_config: the benchmark's own population, generated from distribution_config.json with no profile applied.
  const cfg = set.raw_config ? config : applyProfile(config, set.profile);
  const cases = [];
  for (let i = 0; i < set.count; i++) cases.push(generateBlendedCase(i, cfg, set.seed));
  let sid = 0;
  for (const [type, sev] of STRATA) for (let i = 0; i < set.stratified; i++) cases.push(generateCase(sid++, cfg, type, sev, `${set.seed}-strat-${type}-${sev}-${i}`));
  return { cases, config: cfg };
}

/** One answer-key record: what the engine decides on a case today. */
export function caseRecord(c, set, config) {
  const alerts = runFraudRules(extractDecisionView(c)).alerts;
  const base = {
    id: c.id,
    hash: sha256(JSON.stringify(c)).slice(0, 16),
    type: c.meta.corruption_type,
    severity: c.meta.severity,
    integrity: c.label.expected_outcome,
    integrity_codes: [...(c.label.reason_codes || [])],
    fraud_rules: alerts.map((a) => `${a.rule_id}:${a.severity}`).sort()
  };
  if (set.decision === "credit_policy") {
    const a = assessCredit(c, getProfile(set.profile));
    return { ...base, decision: a.policyDecision, reason_codes: a.flags.map((f) => f.code), flagged: a.fraudFlag === "REVIEW" };
  }
  const scored = scoreCase(c, config, { now: "benchmark" });
  return { ...base, decision: scored.decision.outcome, reason_codes: [...(scored.decision.reason_codes || [])], flagged: alerts.length > 0 };
}

export function keyHeader(set, configText) {
  return {
    ...set,
    generator_version: GENERATOR_VERSION,
    case_schema_version: CASE_SCHEMA_VERSION,
    ruleset_version: FRAUD_RULESET_VERSION,
    policy_version: UNDERWRITING_POLICY_VERSION,
    reason_code_catalog_version: REASON_CODE_CATALOG_VERSION,
    configuration_hash: `sha256:${sha256(configText)}`
  };
}

/** Key file text: the header pretty-printed, then one case per line so a diff reads case by case. */
export function serializeKey(header, records) {
  return `{\n"set": ${JSON.stringify(header, null, 2)},\n"cases": [\n${records.map((r) => JSON.stringify(r)).join(",\n")}\n]\n}\n`;
}

const keyPath = (set) => path.join(BENCH_DIR, `answer-key-${set.id}.json`);
const FIELDS = ["hash", "type", "severity", "integrity", "integrity_codes", "decision", "reason_codes", "fraud_rules", "flagged"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Differences between a key and the current records: header fields, and per case the fields that moved. */
export function compareKey(key, header, records) {
  const headerChanges = Object.keys({ ...key.set, ...header }).filter((k) => !same(key.set[k], header[k])).map((k) => ({ field: k, before: key.set[k], after: header[k] }));
  const before = new Map(key.cases.map((r) => [r.id, r]));
  const now = new Set(records.map((r) => r.id));
  const changed = [];
  for (const r of records) {
    const b = before.get(r.id);
    if (!b) { changed.push({ id: r.id, type: r.type, severity: r.severity, fields: ["(new case)"], before: null, after: r }); continue; }
    const fields = FIELDS.filter((f) => !same(b[f], r[f]));
    if (fields.length) changed.push({ id: r.id, type: r.type, severity: r.severity, fields, before: b, after: r });
  }
  for (const b of key.cases) if (!now.has(b.id)) changed.push({ id: b.id, type: b.type, severity: b.severity, fields: ["(case removed)"], before: b, after: null });
  return { headerChanges, changed };
}

/** Scorecard over the current records, measured against the committed key. */
export function scorecard(set, records, changed) {
  const changedIds = new Set(changed.map((c) => c.id));
  const group = (keyFn, keys) => keys.map((k) => {
    const rs = records.filter((r) => keyFn(r) === k);
    return { key: k, n: rs.length, pass: rs.filter((r) => !changedIds.has(r.id)).length };
  });
  const fraud = records.filter((r) => FRAUD_CORRUPTION_TYPES.includes(r.type));
  const clean = records.filter((r) => r.type === "NONE");
  const review = records.filter((r) => r.decision === "REVIEW" || r.decision === "MANUAL_REVIEW");
  const mix = {};
  for (const r of records) mix[r.decision] = (mix[r.decision] ?? 0) + 1;
  return {
    set: set.id,
    n: records.length,
    pass: records.length - records.filter((r) => changedIds.has(r.id)).length,
    byType: group((r) => r.type, CORRUPTION_TYPES),
    bySeverity: group((r) => r.severity, SEVERITIES),
    fraud: { n: fraud.length, caught: fraud.filter((r) => r.flagged).length },
    clean: { n: clean.length, falseAlarms: clean.filter((r) => r.flagged).length },
    reviewRate: review.length / records.length,
    mix,
    flag: set.decision === "credit_policy" ? "sent to fraud review (a HIGH-severity rule fired)" : "any fraud rule fired"
  };
}

function printScorecard(s, changed) {
  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
  console.log(`\n=== Answer key: ${s.set} — ${s.pass === s.n ? "PASS" : "CHANGED"} (${s.pass.toLocaleString("en-US")} of ${s.n.toLocaleString("en-US")} cases match, ${pct(s.pass, s.n)}) ===`);
  console.table(Object.fromEntries([...s.byType, ...s.bySeverity].map((g) => [g.key, { n: g.n, match: g.pass, rate: pct(g.pass, g.n) }])));
  console.log(`Fraud caught ${s.fraud.caught.toLocaleString("en-US")} of ${s.fraud.n.toLocaleString("en-US")} (${pct(s.fraud.caught, s.fraud.n)}), missed ${(s.fraud.n - s.fraud.caught).toLocaleString("en-US")} · false alarms on clean ${s.clean.falseAlarms.toLocaleString("en-US")} of ${s.clean.n.toLocaleString("en-US")} (${pct(s.clean.falseAlarms, s.clean.n)}) · flagged = ${s.flag}`);
  console.log(`Review rate ${pct(s.reviewRate, 1)} · decisions ${Object.entries(s.mix).map(([k, v]) => `${k} ${v.toLocaleString("en-US")}`).join(" · ")}`);
  if (changed.length) {
    console.log(`Changed cases (${changed.length}):`);
    for (const c of changed.slice(0, 50)) {
      const show = (r) => (r ? c.fields.filter((f) => !f.startsWith("(")).map((f) => `${f}=${JSON.stringify(r[f])}`).join(" ") : "—");
      console.log(`  ${c.id} [${c.type}/${c.severity}] ${c.fields.join(",")}: before ${show(c.before)} → after ${show(c.after)}`);
    }
    if (changed.length > 50) console.log(`  … and ${changed.length - 50} more`);
  }
}

/**
 * Run every pinned set that applies to this benchmark run. Returns false when the gate fails: a case
 * or header differs from its key, a key is missing, or a key's SHA-256 is not named in the CHANGELOG.
 */
export function runAnswerKeys(args, { configText, baseConfig }) {
  const sets = JSON.parse(fs.readFileSync(path.join(BENCH_DIR, "case-sets.json"), "utf8")).sets;
  const changelog = fs.existsSync(path.join(BENCH_DIR, "CHANGELOG.md")) ? fs.readFileSync(path.join(BENCH_DIR, "CHANGELOG.md"), "utf8") : "";
  // The first set is the benchmark's own population; the keys apply only to a run with its parameters.
  const pinned = args.count === sets[0].count && args.seed === sets[0].seed && args.stratified === sets[0].stratified && args.asOf === sets[0].as_of;
  if (!pinned) {
    console.log(`\nAnswer keys skipped: this run (count ${args.count}, seed ${args.seed}, stratified ${args.stratified}, as-of ${args.asOf}) is not the pinned set (count ${sets[0].count}, seed ${sets[0].seed}, stratified ${sets[0].stratified}, as-of ${sets[0].as_of}).`);
    return true;
  }
  let ok = true;
  for (const set of sets) {
    if (set.kind === "teaching") { ok = runTeachingKey(set, args, { configText, baseConfig, changelog }) && ok; continue; }
    const { cases, config } = generateSet(set, baseConfig);
    const records = cases.map((c) => caseRecord(c, set, config));
    const header = keyHeader(set, configText);
    const text = serializeKey(header, records);
    const file = keyPath(set);
    if (args.updateKey) {
      fs.mkdirSync(BENCH_DIR, { recursive: true });
      fs.writeFileSync(file, text);
      const digest = sha256(text);
      console.log(`\nAnswer key written: ${path.relative(path.dirname(BENCH_DIR), file)} (${records.length} cases, sha256 ${digest})`);
      if (!changelog.includes(digest)) console.log(`  Add a line to benchmarks/CHANGELOG.md naming sha256 ${digest} and the reason, or CI fails.`);
      continue;
    }
    if (!fs.existsSync(file)) { console.log(`\nANSWER KEY MISSING: ${set.id}. Run npm run benchmark -- --update-key.`); ok = false; continue; }
    const committed = fs.readFileSync(file, "utf8");
    const { headerChanges, changed } = compareKey(JSON.parse(committed), header, records);
    printScorecard(scorecard(set, records, changed), changed);
    for (const h of headerChanges) console.log(`  set header changed: ${h.field} ${JSON.stringify(h.before)} → ${JSON.stringify(h.after)}`);
    const digest = sha256(committed);
    const logged = changelog.includes(digest);
    if (!logged) console.log(`ANSWER KEY NOT IN CHANGELOG: ${set.id} sha256 ${digest} is not named in benchmarks/CHANGELOG.md.`);
    if (changed.length || headerChanges.length) console.log(`ANSWER KEY CHANGED: ${set.id}. If the change is intended, run npm run benchmark -- --update-key and add a CHANGELOG line with the reason.`);
    ok = ok && logged && !changed.length && !headerChanges.length && committed === text;
  }
  return ok;
}

/**
 * A teaching set (kind "teaching", e.g. teaching-v1) is its own key: the file holds each case's
 * teaching answer (`expected`) and the engine's answer (`system`). The gate rebuilds it and requires
 * an identical file whose SHA-256 is named in the CHANGELOG, so a change to either answer is logged.
 * The scorecard lists every case where expected and system differ, with its reason.
 */
function runTeachingKey(set, args, { configText, baseConfig, changelog }) {
  const built = buildTeachingSet(set, baseConfig, configText);
  const text = serializeTeachingSet(built);
  const file = teachingFile(BENCH_DIR, set);
  if (args.updateKey) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    const digest = sha256(text);
    console.log(`\nTeaching set written: ${path.relative(path.dirname(BENCH_DIR), file)} (${built.entries.length} cases, sha256 ${digest})`);
    if (!changelog.includes(digest)) console.log(`  Add a line to benchmarks/CHANGELOG.md naming sha256 ${digest} and the reason, or CI fails.`);
    return true;
  }
  if (!fs.existsSync(file)) { console.log(`\nTEACHING SET MISSING: ${set.id}. Run npm run benchmark -- --update-key.`); return false; }
  const committed = fs.readFileSync(file, "utf8");
  const before = new Map(JSON.parse(committed).cases.map((e) => [e.id, e]));
  const changed = built.entries.filter((e) => !before.has(e.id) || !same(before.get(e.id).system, e.system) || !same(before.get(e.id).expected, e.expected)).map((e) => e.id);
  for (const id of before.keys()) if (!built.entries.some((e) => e.id === id)) changed.push(`${id} (removed)`);
  const s = teachingSummary(built.entries);
  console.log(`\n=== Teaching set: ${set.id} — ${changed.length || committed !== text ? "CHANGED" : "PASS"} (${(s.n - changed.length).toLocaleString("en-US")} of ${s.n} cases match the committed answers) ===`);
  console.log(`Groups ${Object.entries(s.byGroup).map(([k, v]) => `${k} ${v}`).join(" · ")} · difficulty ${Object.entries(s.byDifficulty).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`Teaching answer vs credit policy: agree on ${s.agree} of ${s.n}; named gaps ${s.gaps.length}:`);
  for (const g of s.gaps) console.log(`  ${g.id}: expected ${g.expected.decision} [${g.expected.reason_codes.join(", ")}], system ${g.system.decision} [${g.system.reason_codes.join(", ")}] — ${g.reason ?? "NO REASON RECORDED"}`);
  for (const id of changed.slice(0, 30)) console.log(`  changed: ${id}`);
  const digest = sha256(committed);
  const logged = changelog.includes(digest);
  if (!logged) console.log(`TEACHING SET NOT IN CHANGELOG: ${set.id} sha256 ${digest} is not named in benchmarks/CHANGELOG.md.`);
  const unexplained = s.gaps.filter((g) => !g.reason);
  if (unexplained.length) console.log(`TEACHING SET HAS UNEXPLAINED GAPS: ${unexplained.map((g) => g.id).join(", ")}.`);
  if (committed !== text) console.log(`TEACHING SET CHANGED: ${set.id}. If intended, run npm run benchmark -- --update-key and add a CHANGELOG line with the reason.`);
  return logged && committed === text && !unexplained.length;
}

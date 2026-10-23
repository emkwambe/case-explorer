#!/usr/bin/env node
// scripts/export_credit_features.mjs — Training, calibration and test data for the credit PD model
// (analytics/src/case_analytics/credit/), written to data/credit-model/.
//
//   node scripts/export_credit_features.mjs           write every file and the manifest
//   node scripts/export_credit_features.mjs --check   rebuild in memory; exit 1 if any file or hash differs
//
// Books: the locked seed-42 book is the test set; independent books from seeds 1001, 1002, … are the
// training books (added until their funded loans hold at least 2,000 defaults), and the next two
// seeds are calibration books. Each book is a full rerun of the seed-42 pipeline (buildSolarBook)
// with another seed. For every application the file records the decision-time features, whether the
// credit policy funded it, and its simulated 30+ DPD outcome (every application is simulated, which
// only synthetic data allows; the headline model uses funded rows only). The answer-key columns go in
// separate oracle files that are never model inputs.
//
// Fairness (Sprint 12): the counterfactual flip table over the opening library, the teaching set and
// the seed-42 pool (scripts/lib/fairness.mjs), the seed-42 audit attributes for the group tables and
// proxy check (never a model input), and per book the credit policy's decision on the claimed FICO
// (the app's policy) and on the bureau FICO (the bureau-score policy, an evaluation variant only).
//
// Committed: the seed-42 files, the teaching and opening-library features, the flip table, the feature
// spec and the manifest. The training and calibration books (about 2.5 MB each) are regenerated deterministically
// and gitignored; the manifest holds their SHA-256, so a regeneration is checked against it.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSolarBook, ROOT, CONFIG_PATH, AS_OF, demoConfig } from "./lib/solar-book.mjs";
import { featureRow, oracleRow, featureSpec, FEATURE_NAMES } from "./lib/credit-features.mjs";
import { simulatePool, decide } from "../src/policySandbox.js";
import { CREDIT_POLICY } from "../src/creditRisk.js";
import { createFlipTable, flipsClean } from "./lib/fairness.mjs";
import { generateBlendedCase } from "../src/generator.js";
import { applyProfile, getProfile } from "../src/profiles/index.js";
import { teachingContext, buildTeachingCase } from "../src/challenge/teachingCases.js";
import { GENERATOR_VERSION, CASE_SCHEMA_VERSION } from "../src/core/case.js";

export const OUT = path.join(ROOT, "data", "credit-model");
export const BOOKS_DIR = "books";
export const TEST_SEED = 42;
export const FIRST_TRAINING_SEED = 1001;
export const MIN_TRAINING_DEFAULTS = 2000;
export const CALIBRATION_BOOKS = 2;
export const APP_COLUMNS = ["application_id", "seed", "index", "funded", "ead", "dpd30", ...FEATURE_NAMES];
export const ORACLE_COLUMNS = ["application_id", "p_dpd30_true", "p_dpd30_dealer_averaged", "pd_chargeoff", "fraud_true", "corruption_type"];
export const SENSITIVE_COLUMNS = ["application_id", "age_band", "geography_group", "zip3", "income_band", "persona", "regime", "family_status_scenario", "disability_income_scenario"];
export const DECISION_COLUMNS = ["application_id", "fraud_review", "decision_claimed", "decision_bureau"];

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const cell = (v) => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "1" : "0") : String(v));
const csv = (columns, rows) => [columns.join(","), ...rows.map((r) => columns.map((k) => cell(r[k])).join(","))].join("\n") + "\n";

/**
 * One book's application, oracle, decision and audit-attribute rows. `flips` (optional) is a flip
 * accumulator (createFlipTable) that sees every application as it is generated.
 */
export function bookRows(seed, { flips } = {}) {
  const feats = new Map(), corruption = new Map(), index = new Map(), sensitive = new Map();
  const book = buildSolarBook({
    seed,
    onCase: (c, _record, i) => {
      feats.set(c.id, featureRow(c, getProfile("SOLAR_PRIME")));
      corruption.set(c.id, c.meta.corruption_type);
      index.set(c.id, i);
      sensitive.set(c.id, c.audit_attributes);
      flips?.add(c);
    }
  });
  const sims = simulatePool(book.pool, book.dealers, book.settings);
  const dealerById = new Map(book.dealers.map((d) => [d.id, d]));
  const fundedIds = new Set(book.loans.map((l) => l.id));
  // The funded subset of the pool simulation is the book itself, outcome for outcome.
  const byLoan = new Map(book.loans.map((l) => [l.id, l]));
  for (const s of sims) if (fundedIds.has(s.id) && byLoan.get(s.id).dpd30 !== s.dpd30) throw new Error(`book ${seed}: pool simulation differs from the book for ${s.id}`);
  const apps = sims.map((s) => ({ application_id: s.id, seed, index: index.get(s.id), funded: fundedIds.has(s.id), ead: s.ead, dpd30: s.dpd30, ...feats.get(s.id) }));
  const oracle = sims.map((s) => ({ application_id: s.id, ...oracleRow(s, dealerById.get(s.dealerId), book.settings, corruption.get(s.id), book.dealers) }));
  // The bureau-score policy: the same decide() and thresholds, reading the bureau FICO the models see.
  const decisions = book.pool.map((r) => ({ application_id: r.id, fraud_review: r.fraudReview, decision_claimed: decide(r, CREDIT_POLICY), decision_bureau: decide({ ...r, fico: feats.get(r.id).fico_bureau }, CREDIT_POLICY) }));
  const audit = book.pool.map((r) => ({ application_id: r.id, ...sensitive.get(r.id) }));
  const fundedDefaults = apps.filter((a) => a.funded && a.dpd30).length;
  return { seed, apps, oracle, decisions, audit, counts: { applications: apps.length, funded: fundedIds.size, funded_defaults: fundedDefaults, all_defaults: apps.filter((a) => a.dpd30).length } };
}

function teachingCases() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "challenge", "challenge-data.json"), "utf8"));
  const ctx = teachingContext(data, JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
  return { ctx, entries: data.cases.map((e) => ({ e, c: buildTeachingCase(e, data, ctx) })) };
}

const teachingRows = ({ ctx, entries }) => entries.map(({ e, c }) => ({ teaching_id: e.id, case_id: e.base.case_id, group: e.group, role: e.role ?? "", typology: e.typology, ...featureRow(c, ctx.profile) }));

/** The Solar prime opening library as the app builds it, each case with the context it was built in. */
function openingCases() {
  // 12 blended cases at the demo seed, plus the opening pair's clean twin (src/ui/hooks/useCaseLibrary.js).
  const solar = getProfile("SOLAR_PRIME"), ctx = { profile: solar, config: applyProfile(demoConfig(), solar) };
  const opening = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "challenge", "opening-pair.json"), "utf8"));
  const twinCtx = teachingContext(opening, JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
  const cases = Array.from({ length: solar.openingLibrary.count }, (_, i) => ({ c: generateBlendedCase(i, ctx.config, "demo-2026"), ctx }));
  cases.push({ c: buildTeachingCase(opening.clean, opening, twinCtx), ctx: twinCtx });
  return cases;
}

const openingRows = (cases) => cases.map(({ c }) => ({ case_id: c.id, ...featureRow(c, getProfile("SOLAR_PRIME")) }));

/** Every output file as { relativePath: text }, the manifest included. */
export function creditModelFiles({ log = () => {} } = {}) {
  const files = {}, meta = {}, seeds = { test: TEST_SEED, training: [], calibration: [] }, perSeed = {};
  const addBook = (b, role) => {
    const dir = role === "test" ? "" : `${BOOKS_DIR}/`;
    files[`${dir}applications-seed-${b.seed}.csv`] = csv(APP_COLUMNS, b.apps);
    files[`${dir}oracle-seed-${b.seed}.csv`] = csv(ORACLE_COLUMNS, b.oracle);
    files[`${dir}decisions-seed-${b.seed}.csv`] = csv(DECISION_COLUMNS, b.decisions);
    meta[`${dir}decisions-seed-${b.seed}.csv`] = { role: `${role} book: credit-policy decision on the claimed FICO (the app's policy) and on the bureau FICO (the bureau-score policy, evaluation only)`, rows: b.decisions.length, committed: role === "test" };
    meta[`${dir}applications-seed-${b.seed}.csv`] = { role: `${role} book: decision-time features, funded flag and simulated outcome for every application`, rows: b.apps.length, committed: role === "test" };
    meta[`${dir}oracle-seed-${b.seed}.csv`] = { role: `${role} book: answer key — never a model input`, rows: b.oracle.length, committed: role === "test" };
    perSeed[b.seed] = { role, ...b.counts };
    log(`  seed ${b.seed} (${role}): ${b.counts.funded} funded, ${b.counts.funded_defaults} funded defaults, ${b.counts.all_defaults} defaults over ${b.counts.applications} applications`);
  };
  const solar = getProfile("SOLAR_PRIME");
  const poolFlips = createFlipTable({ profile: solar, config: applyProfile(demoConfig(), solar) });
  const test = bookRows(TEST_SEED, { flips: poolFlips });
  addBook(test, "test");
  files[`sensitive-seed-${TEST_SEED}.csv`] = csv(SENSITIVE_COLUMNS, test.audit);
  meta[`sensitive-seed-${TEST_SEED}.csv`] = { role: "test book: audit attributes (sensitive), for the fairness group tables and proxy check only — never a model input", rows: test.audit.length, committed: true };
  let trainingDefaults = 0, seed = FIRST_TRAINING_SEED;
  while (trainingDefaults < MIN_TRAINING_DEFAULTS) {
    const b = bookRows(seed++);
    seeds.training.push(b.seed);
    trainingDefaults += b.counts.funded_defaults;
    addBook(b, "training");
  }
  for (let k = 0; k < CALIBRATION_BOOKS; k++) {
    const b = bookRows(seed++);
    seeds.calibration.push(b.seed);
    addBook(b, "calibration");
  }
  const teachingSet = teachingCases(), library = openingCases();
  const teaching = teachingRows(teachingSet), opening = openingRows(library);
  const teachingFlips = createFlipTable(teachingSet.ctx), libraryFlips = createFlipTable(library[0].ctx);
  for (const { c } of teachingSet.entries) teachingFlips.add(c);
  for (const { c, ctx } of library) libraryFlips.add(c, ctx);
  const flipSets = { opening_library: libraryFlips.rows(), teaching_v1: teachingFlips.rows(), [`pool_seed_${TEST_SEED}`]: poolFlips.rows() };
  for (const [name, rows] of Object.entries(flipSets)) log(`  flips ${name}: ${rows.reduce((n, r) => n + r.flips, 0)} flips over ${rows[0].cases} cases; ${flipsClean(rows) ? "no direct use; every financial-channel change moved DTI" : "CHANGES NOT EXPLAINED BY THE FINANCIAL CHANNEL"}`);
  files["fairness-flips.json"] = JSON.stringify({ produced_by: "node scripts/export_credit_features.mjs (scripts/lib/fairness.mjs)", clean: Object.values(flipSets).every(flipsClean), sets: flipSets }, null, 2) + "\n";
  meta["fairness-flips.json"] = { role: "counterfactual flips of every sensitive attribute (audit, deep and financial-channel) over the opening library, teaching-v1 and the seed-42 pool", committed: true };
  files["teaching-v1.csv"] = csv(["teaching_id", "case_id", "group", "role", "typology", ...FEATURE_NAMES], teaching);
  meta["teaching-v1.csv"] = { role: "teaching-v1 cases (rebuilt from their recipes): decision-time features, for reasons and reason accuracy", rows: teaching.length, committed: true };
  files["opening-library.csv"] = csv(["case_id", ...FEATURE_NAMES], opening);
  meta["opening-library.csv"] = { role: "Solar prime opening library: decision-time features, for the case view", rows: opening.length, committed: true };
  files["feature-spec.json"] = JSON.stringify(featureSpec(), null, 2) + "\n";
  meta["feature-spec.json"] = { role: "features, monotonic directions, groups and reason statements (read by the Python model)", committed: true };
  const manifest = {
    manifest_version: "1.0.0",
    profile: "SOLAR_PRIME",
    as_of_date: AS_OF,
    generator_version: GENERATOR_VERSION,
    case_schema_version: CASE_SCHEMA_VERSION,
    configuration_hash: `sha256:${sha256(fs.readFileSync(CONFIG_PATH, "utf8"))}`,
    produced_by: "node scripts/export_credit_features.mjs",
    book_rule: `test: seed ${TEST_SEED} (the locked book); training: seeds from ${FIRST_TRAINING_SEED} upward until the training books' funded loans hold at least ${MIN_TRAINING_DEFAULTS} defaults; calibration: the next ${CALIBRATION_BOOKS} seeds`,
    seeds,
    books: perSeed,
    training_funded_defaults: trainingDefaults,
    files: Object.fromEntries(Object.keys(files).sort().map((name) => [name, { ...meta[name], sha256: sha256(files[name]) }]))
  };
  files["manifest.json"] = JSON.stringify(manifest, null, 2) + "\n";
  return { files, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const started = performance.now();
  const { files } = creditModelFiles({ log: console.log });
  if (check) {
    const differ = Object.entries(files).filter(([name, text]) => !fs.existsSync(path.join(OUT, name)) || fs.readFileSync(path.join(OUT, name), "utf8") !== text).map(([name]) => name);
    console.log(differ.length ? `Credit-model data differs from a fresh build: ${differ.join(", ")}` : `Credit-model data matches a fresh build (${Object.keys(files).length} files).`);
    process.exit(differ.length ? 1 : 0);
  }
  fs.mkdirSync(path.join(OUT, BOOKS_DIR), { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), text);
  console.log(`Credit-model data written to ${path.relative(ROOT, OUT)}/ (${Object.keys(files).length} files) in ${((performance.now() - started) / 1000).toFixed(1)}s`);
}

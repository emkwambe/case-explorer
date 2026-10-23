// scripts/credit-features.test.mjs — The credit-model data files. Run: npm run test:credit-features
//
// Exits non-zero on the first failed assertion. buildSolarBook without a seed is still the locked
// seed-42 book (its tape hashes equal the committed tape manifest, and an explicit seed 42 gives the
// same files); the committed credit-model files match their manifest; no answer-key column, dealer ID
// or sensitive field is a feature. The training books are regenerated and hash-checked in CI by
// running scripts/export_credit_features.mjs and diffing data/credit-model/.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSolarBook } from "./lib/solar-book.mjs";
import { tapeFiles } from "./lib/credit-tape.mjs";
import { FEATURES, FEATURE_NAMES, featureSpec } from "./lib/credit-features.mjs";
import { APP_COLUMNS, ORACLE_COLUMNS, TEST_SEED } from "./export_credit_features.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "data", "credit-model");
const read = (name) => fs.readFileSync(path.join(DIR, name), "utf8");
const sha256 = (t) => crypto.createHash("sha256").update(t).digest("hex");
const manifest = JSON.parse(read("manifest.json"));
const header = (name) => read(name).split("\n", 1)[0].split(",");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log("credit-model data tests");

check("buildSolarBook() with no seed is today's locked book, and an explicit seed 42 is the same book", () => {
  const tapeManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "credit-tape", "manifest.json"), "utf8"));
  const plain = tapeFiles(buildSolarBook()), explicit = tapeFiles(buildSolarBook({ seed: 42 }));
  for (const [name, f] of Object.entries(tapeManifest.files)) {
    assert.equal(sha256(plain.files[name]), f.sha256, `no-seed book: ${name}`);
    assert.equal(explicit.files[name], plain.files[name], `seed 42: ${name}`);
  }
});

check("committed credit-model files match the manifest; training and calibration books are listed with their hashes", () => {
  for (const [name, f] of Object.entries(manifest.files)) {
    if (!f.committed) continue;
    assert.equal(sha256(read(name)), f.sha256, name);
  }
  assert.equal(manifest.seeds.test, TEST_SEED);
  for (const s of [...manifest.seeds.training, ...manifest.seeds.calibration]) {
    assert.notEqual(s, TEST_SEED);
    for (const kind of ["applications", "oracle"]) assert.match(manifest.files[`books/${kind}-seed-${s}.csv`].sha256, /^[0-9a-f]{64}$/);
  }
  assert.ok(manifest.training_funded_defaults >= 2000, `${manifest.training_funded_defaults} training defaults`);
});

check("answer-key columns live only in the oracle files; features exclude dealer, geography and sensitive fields", () => {
  assert.deepEqual(header("applications-seed-42.csv"), APP_COLUMNS);
  assert.deepEqual(header("oracle-seed-42.csv"), ORACLE_COLUMNS);
  const hidden = ORACLE_COLUMNS.filter((c) => c !== "application_id");
  assert.deepEqual(APP_COLUMNS.filter((c) => hidden.includes(c) || /true|oracle|quality|dealer/.test(c)), []);
  for (const f of FEATURE_NAMES) assert.doesNotMatch(f, /age|region|zip|persona|regime|cost_of_living|dealer|true|corruption|metadata|ip_|vpn|w2/, f);
  assert.match(manifest.files["oracle-seed-42.csv"].role, /answer key — never a model input/);
});

check("the feature spec is the committed one; every feature has a group, a monotonic direction and a reason statement", () => {
  assert.equal(read("feature-spec.json"), JSON.stringify(featureSpec(), null, 2) + "\n");
  const spec = featureSpec();
  for (const f of FEATURES) {
    assert.ok([1, -1].includes(f.monotone), f.name);
    assert.ok(spec.groups[f.group]?.statement, f.name);
  }
});

check("seed-42 file: 18,674 applications, 10,000 funded, 225 funded defaults; teaching 79 rows; opening library 13", () => {
  const rows = read("applications-seed-42.csv").trimEnd().split("\n").slice(1).map((l) => l.split(","));
  const col = (k) => APP_COLUMNS.indexOf(k);
  assert.equal(rows.length, 18_674);
  assert.equal(rows.filter((r) => r[col("funded")] === "1").length, 10_000);
  assert.equal(rows.filter((r) => r[col("funded")] === "1" && r[col("dpd30")] === "1").length, 225);
  assert.equal(read("teaching-v1.csv").trimEnd().split("\n").length - 1, 79);
  assert.equal(read("opening-library.csv").trimEnd().split("\n").length - 1, 13);
});

console.log(`\n${passed} checks passed`);

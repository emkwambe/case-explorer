// scripts/timezone.test.mjs — The generator and the rules give identical cases in every process time
// zone. Run: npm run test:timezone
//
// Generates the same cases in child processes under TZ=UTC, America/New_York and Asia/Tokyo and
// compares their answer-key records (case hash, fraud rules, decision and reason codes). The child
// processes do not load scripts/lib/utc.mjs: the generator itself must be time-zone independent.
// Case case-gen-1042-6c72619a is the regression case: before the fix, FR-009 fired on it in US
// Eastern time only (a daylight-saving shift moved an auto-loan date by a day).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ZONES = [["UTC", 0], ["America/New_York", 240], ["Asia/Tokyo", -540]];
const REGRESSION_ID = "case-gen-1042-6c72619a";

// Child: build the sample and print its records. Runs only when spawned with --child.
if (process.argv.includes("--child")) {
  const { generateBlendedCase, generateCase } = await import(pathToFileURL(path.join(ROOT, "src/generator.js")).href);
  const { applyProfile } = await import(pathToFileURL(path.join(ROOT, "src/profiles/index.js")).href);
  const { caseRecord } = await import(pathToFileURL(path.join(ROOT, "scripts/lib/answer-key.mjs")).href);
  const sets = JSON.parse(fs.readFileSync(path.join(ROOT, "benchmarks/case-sets.json"), "utf8")).sets;
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, "src/distribution_config.json"), "utf8"));
  const records = {};
  for (const set of sets) {
    const config = { ...base, generation: { ...base.generation, as_of_date: set.as_of } };
    const cfg = set.raw_config ? config : applyProfile(config, set.profile);
    // 250 blended cases per set: a 500-case sample across both profiles.
    records[set.id] = Array.from({ length: 250 }, (_, i) => caseRecord(generateBlendedCase(i, cfg, set.seed), set, cfg));
    if (set.id === "mortgage-baseline") {
      // Stratified case 1042 of the benchmark set: FABRICATION / HIGH, the 143rd of its stratum.
      records.regression = caseRecord(generateCase(1042, cfg, "FABRICATION", "HIGH", `${set.seed}-strat-FABRICATION-HIGH-142`), set, cfg);
    }
  }
  process.stdout.write(JSON.stringify({ julyOffset: new Date(2026, 6, 1).getTimezoneOffset(), records }));
  process.exit(0);
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log("time-zone tests");

const runs = Object.fromEntries(ZONES.map(([tz]) => {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child"], { encoding: "utf8", env: { ...process.env, TZ: tz }, maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, `${tz}: ${r.stderr}`);
  return [tz, JSON.parse(r.stdout)];
}));

check("each child process really runs in its time zone", () => {
  for (const [tz, offset] of ZONES) assert.equal(runs[tz].julyOffset, offset, tz);
});

check(`${REGRESSION_ID}: identical in all three zones and equal to the committed key (FR-009 does not fire)`, () => {
  const key = JSON.parse(fs.readFileSync(path.join(ROOT, "benchmarks/answer-key-mortgage-baseline.json"), "utf8"));
  const committed = (key.cases ?? key.records ?? Object.values(key).find(Array.isArray)).find((c) => c.id === REGRESSION_ID);
  assert.ok(committed, "regression case missing from the committed key");
  for (const [tz] of ZONES) {
    assert.deepEqual(runs[tz].records.regression, committed, tz);
    assert.ok(!runs[tz].records.regression.fraud_rules.some((r) => r.startsWith("FR-009:")), `${tz}: FR-009 fired`);
  }
});

check("a 500-case sample is identical in all three zones: case hash, fraud rules, decision and reason codes", () => {
  const utc = runs.UTC.records;
  let n = 0;
  for (const [tz] of ZONES.slice(1)) {
    for (const set of ["mortgage-baseline", "solar-prime"]) {
      assert.equal(runs[tz].records[set].length, 250);
      runs[tz].records[set].forEach((rec, i) => {
        assert.deepEqual(rec, utc[set][i], `${tz} ${set} ${rec.id}`);
        n++;
      });
    }
  }
  assert.equal(n, 1000);
});

console.log(`\n${passed} checks passed`);

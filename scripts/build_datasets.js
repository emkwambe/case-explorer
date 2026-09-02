#!/usr/bin/env node
// scripts/build_datasets.js — Build governed, manifested datasets for model development.
//
//   node scripts/build_datasets.js [--out analytics/data] [--train 6000] [--seed 42] [--as-of 2026-01-15]
//
// Splits (each with its own manifest):
//   train / validation / test      deterministic hash split of the baseline population
//   out_of_time                    later as-of date + rate shock, fresh seed stream
//   geography_stress               population skewed to high-cost markets
//   economic_regime_stress         subprime-heavy population under a rate shock
//   adversarial_fraud              adversarial corruption placement (config.adversarial)
//   clean_negative_control         corruption NONE only
//
// Rows are the PERMITTED decision features (claims + evidence + metadata). Sensitive attributes
// are exported in separate `sensitive__*` columns for fairness testing only, and labels in
// `label__*` columns. The feature policy is exported alongside so the Python layer enforces
// the same rules.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { generateBlendedCase, generateCase } from "../src/generator.js";
import { GENERATOR_VERSION, CASE_SCHEMA_VERSION } from "../src/core/case.js";
import { extractDecisionFeatures, decisionRowsToCsv, DECISION_FEATURE_SCHEMA_VERSION } from "../src/ml/decision_features.js";
import { exportPolicy } from "../src/decisioning/policies/feature_policy.js";
import { describeRules, FRAUD_RULESET_VERSION } from "../src/decisioning/fraud-rules/rules.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATASET_VERSION = "2.1.0";

function parseArgs(argv) {
  const a = { out: "analytics/data", train: 6000, seed: "42", asOf: "2026-01-15" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--train") a.train = parseInt(argv[++i], 10);
    else if (argv[i] === "--seed") a.seed = String(argv[++i]);
    else if (argv[i] === "--as-of") a.asOf = argv[++i];
  }
  return a;
}

function hashSplit(id) {
  const h = crypto.createHash("sha1").update(id).digest();
  const u = h.readUInt32BE(0) / 0xffffffff;
  return u < 0.6 ? "train" : u < 0.8 ? "validation" : "test";
}
function sha256(obj) { return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex"); }
function gitCommit() { try { return execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; } }

function withOverrides(base, fn) { const c = JSON.parse(JSON.stringify(base)); fn(c); return c; }

export function buildDatasets(args) {
  const baseConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "distribution_config.json"), "utf8"));
  baseConfig.generation = { ...(baseConfig.generation || {}), as_of_date: args.asOf };
  const outDir = path.resolve(ROOT, args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const commit = gitCommit();
  const generatedAt = new Date().toISOString();
  const index = { dataset_version: DATASET_VERSION, generated_at: generatedAt, generator_version: GENERATOR_VERSION, generator_commit: commit, seed: args.seed, splits: {} };

  const regimes = [];
  // Baseline population → train / validation / test
  {
    const config = baseConfig;
    const buckets = { train: [], validation: [], test: [] };
    for (let i = 0; i < args.train; i++) {
      const c = generateBlendedCase(i, config, args.seed);
      buckets[hashSplit(c.id)].push(c);
    }
    for (const [split, cases] of Object.entries(buckets)) regimes.push({ split, population_regime: "baseline", config, cases, as_of: args.asOf, seed: args.seed, note: "Deterministic SHA-1 hash split (60/20/20) of the baseline blended population." });
  }
  const n4 = Math.max(200, Math.floor(args.train / 4));
  // Out-of-time: later origination date, +150bp rate shock, fresh seed stream.
  {
    const asOf = "2026-07-15";
    const config = withOverrides(baseConfig, c => { c.generation.as_of_date = asOf; c.loan.interest_rate = +(c.loan.interest_rate + 0.015).toFixed(4); });
    const seed = `${args.seed}-oot`;
    regimes.push({ split: "out_of_time", population_regime: "out_of_time_rate_shock", config, cases: Array.from({ length: n4 }, (_, i) => generateBlendedCase(i, config, seed)), as_of: asOf, seed, note: "Originations six months later with a +150bp mortgage-rate shock (higher PITI, higher back-end DTI)." });
  }
  // Geography stress
  {
    const config = withOverrides(baseConfig, c => { const i = c.geography.categories.indexOf("HIGH_COST"); c.geography.probabilities = c.geography.categories.map((_, k) => k === i ? 0.7 : 0.3 / (c.geography.categories.length - 1)); });
    const seed = `${args.seed}-geo`;
    regimes.push({ split: "geography_stress", population_regime: "high_cost_markets", config, cases: Array.from({ length: n4 }, (_, i) => generateBlendedCase(i, config, seed)), as_of: args.asOf, seed, note: "70% of applicants from high-cost markets." });
  }
  // Economic regime stress
  {
    const config = withOverrides(baseConfig, c => { c.regimes.probabilities = c.regimes.categories.map(r => r === "SUBPRIME" ? 0.6 : r === "PRIME" ? 0.25 : 0.15); c.loan.interest_rate = +(c.loan.interest_rate + 0.02).toFixed(4); });
    const seed = `${args.seed}-regime`;
    regimes.push({ split: "economic_regime_stress", population_regime: "subprime_heavy_rate_shock", config, cases: Array.from({ length: n4 }, (_, i) => generateBlendedCase(i, config, seed)), as_of: args.asOf, seed, note: "Subprime-heavy population (60%) under a +200bp rate shock." });
  }
  // Adversarial fraud placement
  {
    const config = withOverrides(baseConfig, c => { c.adversarial.enabled = true; });
    const seed = `${args.seed}-adv`;
    regimes.push({ split: "adversarial_fraud", population_regime: "adversarial_placement", config, cases: Array.from({ length: n4 }, (_, i) => generateBlendedCase(i, config, seed, true)), as_of: args.asOf, seed, note: "Fraud injected where it is hardest to distinguish from legitimate marginal applicants (config.adversarial)." });
  }
  // Clean negative control
  {
    const seed = `${args.seed}-clean`;
    regimes.push({ split: "clean_negative_control", population_regime: "clean_only", config: baseConfig, cases: Array.from({ length: Math.max(100, Math.floor(n4 / 2)) }, (_, i) => generateCase(i, baseConfig, "NONE", "LOW", `${seed}-${i}`)), as_of: args.asOf, seed, note: "No corruption. Any alert here is a false positive." });
  }

  for (const r of regimes) {
    const rows = r.cases.map(extractDecisionFeatures);
    const csv = decisionRowsToCsv(rows);
    fs.writeFileSync(path.join(outDir, `${r.split}.csv`), csv);
    const fraudTypes = {};
    const outcomes = {};
    for (const row of rows) { fraudTypes[row.labels.fraud_type] = (fraudTypes[row.labels.fraud_type] || 0) + 1; outcomes[row.labels.expected_outcome] = (outcomes[row.labels.expected_outcome] || 0) + 1; }
    const manifest = {
      dataset_version: DATASET_VERSION,
      split: r.split,
      generator_version: GENERATOR_VERSION,
      case_schema_version: CASE_SCHEMA_VERSION,
      feature_schema_version: DECISION_FEATURE_SCHEMA_VERSION,
      ruleset_version: FRAUD_RULESET_VERSION,
      generator_commit: commit,
      configuration_hash: sha256(r.config),
      seed: r.seed,
      generated_at: generatedAt,
      as_of_date: r.as_of,
      population_regime: r.population_regime,
      record_count: rows.length,
      fraud_count: rows.filter(x => x.labels.is_fraud === 1).length,
      fraud_rate: rows.length ? +(rows.filter(x => x.labels.is_fraud === 1).length / rows.length).toFixed(4) : 0,
      fraud_types: fraudTypes,
      outcomes,
      note: r.note,
      file: `${r.split}.csv`,
      file_sha256: "sha256:" + crypto.createHash("sha256").update(csv).digest("hex")
    };
    fs.writeFileSync(path.join(outDir, `${r.split}.manifest.json`), JSON.stringify(manifest, null, 2));
    index.splits[r.split] = { file: manifest.file, record_count: manifest.record_count, fraud_rate: manifest.fraud_rate, population_regime: manifest.population_regime, configuration_hash: manifest.configuration_hash, seed: manifest.seed };
    console.log(`${r.split.padEnd(26)} ${String(rows.length).padStart(6)} rows  fraud ${(manifest.fraud_rate * 100).toFixed(1)}%`);
  }
  fs.writeFileSync(path.join(outDir, "feature_policy.json"), JSON.stringify(exportPolicy(), null, 2));
  fs.writeFileSync(path.join(outDir, "fraud_rules.json"), JSON.stringify({ ruleset_version: FRAUD_RULESET_VERSION, rules: describeRules() }, null, 2));
  fs.writeFileSync(path.join(outDir, "datasets.manifest.json"), JSON.stringify(index, null, 2));
  console.log(`Datasets written to ${path.relative(ROOT, outDir)}/`);
  return index;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) buildDatasets(parseArgs(process.argv.slice(2)));

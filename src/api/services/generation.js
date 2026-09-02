// src/api/services/generation.js — Dataset/case generation service used by the API and seed script.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { generateBlendedCase, generateCase } from "../../generator.js";
import { GENERATOR_VERSION, CASE_SCHEMA_VERSION } from "../../core/case.js";
import { DECISION_FEATURE_SCHEMA_VERSION } from "../../ml/decision_features.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONFIG_PATH = path.join(ROOT, "src", "distribution_config.json");

export function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); }
export function configHash(config) { return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex"); }

export const POPULATION_REGIMES = {
  baseline: c => c,
  out_of_time_rate_shock: c => { c.loan.interest_rate = +(c.loan.interest_rate + 0.015).toFixed(4); return c; },
  high_cost_markets: c => { const i = c.geography.categories.indexOf("HIGH_COST"); c.geography.probabilities = c.geography.categories.map((_, k) => k === i ? 0.7 : 0.3 / (c.geography.categories.length - 1)); return c; },
  subprime_heavy_rate_shock: c => { c.regimes.probabilities = c.regimes.categories.map(r => r === "SUBPRIME" ? 0.6 : r === "PRIME" ? 0.25 : 0.15); c.loan.interest_rate = +(c.loan.interest_rate + 0.02).toFixed(4); return c; }
};

export function buildConfig({ as_of_date, population_regime = "baseline" } = {}) {
  const config = loadConfig();
  config.generation = { ...(config.generation || {}), as_of_date: as_of_date ?? config.generation?.as_of_date ?? new Date().toISOString().split("T")[0] };
  return (POPULATION_REGIMES[population_regime] || POPULATION_REGIMES.baseline)(config);
}

export function generateDataset(req, { requestedBy = "api", commit = null } = {}) {
  const config = buildConfig(req);
  const seed = req.seed !== undefined ? String(req.seed) : crypto.randomUUID().slice(0, 8);
  const cases = Array.from({ length: req.count }, (_, i) => generateBlendedCase(i, config, seed, req.adversarial));
  const id = `ds-${crypto.createHash("sha1").update(`${seed}|${req.count}|${req.population_regime}|${req.adversarial}|${config.generation.as_of_date}`).digest("hex").slice(0, 12)}`;
  const outcomes = {}; const types = {};
  for (const c of cases) { outcomes[c.label.expected_outcome] = (outcomes[c.label.expected_outcome] || 0) + 1; types[c.meta.corruption_type] = (types[c.meta.corruption_type] || 0) + 1; }
  const manifest = {
    dataset_version: "2.1.0",
    generator_version: GENERATOR_VERSION,
    case_schema_version: CASE_SCHEMA_VERSION,
    feature_schema_version: DECISION_FEATURE_SCHEMA_VERSION,
    generator_commit: commit,
    configuration_hash: configHash(config),
    seed,
    generated_at: new Date().toISOString(),
    as_of_date: config.generation.as_of_date,
    population_regime: req.population_regime,
    adversarial: req.adversarial,
    record_count: cases.length,
    outcomes,
    corruption_types: types,
    requested_by: requestedBy,
    request: req
  };
  return { id, name: req.name ?? id, manifest, cases };
}

export function generateSingle(req) {
  const config = buildConfig(req);
  return generateCase(0, config, req.corruptionType, req.severity, req.seed !== undefined ? String(req.seed) : undefined);
}

#!/usr/bin/env node
// scripts/seed.js — Seed the store with a baseline dataset, score every case, and open
// investigations for declined/review cases so the demo and API have data.
//   node scripts/seed.js [--count 200] [--seed 42]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateBlendedCase } from "../src/generator.js";
import { GENERATOR_VERSION, CASE_SCHEMA_VERSION } from "../src/core/case.js";
import { scoreCase } from "../src/decisioning/index.js";
import { openInvestigation } from "../src/decisioning/investigation/workflow.js";
import { createStore } from "../src/db/index.js";
import { configHash } from "../src/api/services/generation.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function seed({ count = 200, seed = "42", asOf = "2026-01-15", store } = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "distribution_config.json"), "utf8"));
  config.generation = { ...(config.generation || {}), as_of_date: asOf };
  const s = store ?? await createStore();
  const cases = Array.from({ length: count }, (_, i) => generateBlendedCase(i, config, seed));
  const id = `seed-${seed}-${count}`;
  await s.saveDataset({ id, name: "Seed baseline", manifest: { dataset_version: "2.1.0", generator_version: GENERATOR_VERSION, case_schema_version: CASE_SCHEMA_VERSION, configuration_hash: configHash(config), seed, population_regime: "baseline", as_of_date: asOf, record_count: count, generated_at: new Date().toISOString(), requested_by: "seed" }, cases });
  let scored = 0, opened = 0;
  for (const c of cases) {
    const record = scoreCase(c, config);
    await s.saveDecision(record);
    await s.appendAudit({ event_type: "DECISION_ISSUED", actor: "policy-engine", case_version: c.id, policy_version: record.versions.policy, new_state: record.decision.outcome, payload: { reason_codes: record.decision.reason_codes } });
    scored++;
    if (record.decision.outcome !== "APPROVE") {
      const inv = openInvestigation(c, record, { actor: "system", previousHash: await s.lastAuditHash() });
      await s.saveInvestigation(inv);
      await s.appendAuditEvents(inv.audit_events);
      opened++;
    }
  }
  console.log(`Seeded dataset ${id}: ${count} cases, ${scored} decisions, ${opened} investigations (${s.kind} store)`);
  return { id, count, scored, opened };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  seed({ count: parseInt(get("--count", "200"), 10), seed: get("--seed", "42") }).then(async () => { const s = await createStore(); await s.close(); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}

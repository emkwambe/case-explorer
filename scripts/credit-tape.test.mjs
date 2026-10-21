// scripts/credit-tape.test.mjs — Committed loan-tape checks. Run: npm run test:tape
//
// Exits non-zero on the first failed assertion. Reads data/credit-tape/ only (no generation): each
// file matches its manifest hash, the reconciliation equals the locked numbers, and no hidden field
// leaks into the loans or pool files. scripts/locked-numbers.test.mjs re-derives the same hashes from
// a fresh build, so together they lock the tape to the engine.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "credit-tape");
const read = (name) => fs.readFileSync(path.join(DIR, name), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const recon = JSON.parse(read("credit-tape-reconciliation.json"));
const table = (name) => {
  const [header, ...lines] = read(name).trimEnd().split("\n");
  return { columns: header.split(","), rows: lines.map((l) => l.split(",")) };
};

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log("credit tape tests");

check("every data file matches its SHA-256 in the manifest; seed 42, Solar prime", () => {
  assert.equal(manifest.seed, 42);
  assert.equal(manifest.profile, "SOLAR_PRIME");
  assert.deepEqual(Object.keys(manifest.files).sort(), ["credit-tape-loans.csv", "credit-tape-oracle.csv", "credit-tape-pool.csv", "credit-tape-reconciliation.json"]);
  for (const [name, f] of Object.entries(manifest.files)) assert.equal(crypto.createHash("sha256").update(read(name)).digest("hex"), f.sha256, name);
});

check("reconciliation equals the locked numbers: 10,000 loans, $448,332,100 EAD, $4,413,431 expected loss, 2.25% 30+ DPD, NC-19 1,885 loans", () => {
  assert.equal(recon.loans.count, 10_000);
  assert.equal(recon.loans.sum_ead, 448_332_100);
  assert.equal(recon.loans.expected_loss, 4_413_431);
  assert.equal(recon.loans.dpd30_count, 225);
  assert.equal((100 * recon.loans.dpd30_rate).toFixed(2), "2.25");
  assert.equal(recon.dealers.find((d) => d.dealer_id === "NC-19").loans, 1_885);
  assert.deepEqual(recon.dealers.filter((d) => d.rating === "RED").map((d) => d.dealer_id).sort(), ["NC-20", "NC-30"]);
  assert.equal(recon.pool.applications, 18_674);
  assert.equal(recon.pool.funded, 10_000);
  assert.equal(recon.pool.policy_mix.APPROVE + recon.pool.policy_mix.REVIEW + recon.pool.policy_mix.DECLINE, 18_674);
  assert.match(recon.pool.note, /not the 54\.6 \/ 24\.7 \/ 20\.7 mix/);
});

check("the files reconcile to each other: row counts, Σ EAD, 30+ DPD, per-dealer counts, funded flags", () => {
  const loans = table("credit-tape-loans.csv"), pool = table("credit-tape-pool.csv"), oracle = table("credit-tape-oracle.csv");
  const col = (t, k) => t.rows.map((r) => r[t.columns.indexOf(k)]);
  assert.equal(loans.rows.length, recon.loans.count);
  assert.equal(oracle.rows.length, recon.loans.count);
  assert.equal(pool.rows.length, recon.pool.applications);
  for (const [t, name] of [[loans, "credit-tape-loans.csv"], [pool, "credit-tape-pool.csv"], [oracle, "credit-tape-oracle.csv"]]) {
    assert.deepEqual(t.columns, manifest.files[name].columns, name);
    assert.equal(t.rows.length, manifest.files[name].rows, name);
  }
  assert.equal(col(loans, "ead").reduce((s, v) => s + Number(v), 0), recon.loans.sum_ead);
  assert.equal(col(loans, "dpd30").filter((v) => v === "1").length, recon.loans.dpd30_count);
  const perDealer = {};
  for (const d of col(loans, "dealer_id")) perDealer[d] = (perDealer[d] ?? 0) + 1;
  assert.deepEqual(perDealer, Object.fromEntries(recon.dealers.map((d) => [d.dealer_id, d.loans])));
  assert.deepEqual(col(oracle, "loan_id"), col(loans, "loan_id"));
  const funded = new Set(pool.rows.filter((r) => r[pool.columns.indexOf("funded")] === "1").map((r) => r[0]));
  assert.equal(funded.size, recon.pool.funded);
  assert.ok(col(loans, "loan_id").every((id) => funded.has(id)), "every loan is a funded pool application");
  assert.equal(new Set(col(pool, "application_id")).size, pool.rows.length, "application IDs are unique");
});

check("hidden fields appear only in the oracle file, which is labelled as an answer key", () => {
  const hidden = ["fico_true", "dti_true", "fraud_true", "corruption_type", "dealer_quality", "pd"];
  for (const name of ["credit-tape-loans.csv", "credit-tape-pool.csv"]) {
    assert.deepEqual(table(name).columns.filter((c) => hidden.includes(c) || /true|oracle|quality/.test(c)), [], name);
  }
  assert.match(manifest.files["credit-tape-oracle.csv"].role, /^answer key — never a model input/);
  assert.match(read("README.md"), /Answer key — never a model input/);
});

console.log(`\n${passed} checks passed`);

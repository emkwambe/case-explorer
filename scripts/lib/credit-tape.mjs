// scripts/lib/credit-tape.mjs — The loan tape's file contents, derived from a built Solar book.
//
// Deterministic: the same book gives byte-identical files (no timestamps), so the manifest's
// SHA-256 values double as a lock. Presented (claimed) values go in the loans and pool files; world
// truth, the corruption label, dealer quality and PD (computed from true values) go only in the
// oracle file, which is an answer key and never a model input.

import crypto from "node:crypto";
import fs from "node:fs";
import { CREDIT_POLICY } from "../../src/creditRisk.js";
import { decide } from "../../src/policySandbox.js";
import { GENERATOR_VERSION, CASE_SCHEMA_VERSION } from "../../src/core/case.js";
import { reconciliation, CONFIG_PATH, AS_OF } from "./solar-book.mjs";

export const TAPE_FILES = Object.freeze({
  loans: "credit-tape-loans.csv",
  pool: "credit-tape-pool.csv",
  oracle: "credit-tape-oracle.csv",
  reconciliation: "credit-tape-reconciliation.json"
});

export const COLUMNS = Object.freeze({
  loans: ["loan_id", "dealer_id", "ead", "fico_presented", "dti_presented", "checking_presented", "fraud_review", "dpd30", "charged_off"],
  pool: ["application_id", "fico_presented", "dti_presented", "checking_presented", "fraud_review", "decision", "funded"],
  oracle: ["loan_id", "fico_true", "dti_true", "fraud_true", "corruption_type", "dealer_quality", "pd"]
});

export const ROLES = Object.freeze({
  loans: "one row per funded loan: presented values and simulated outcomes",
  pool: "one row per application generated to fund the book: presented values and the credit-policy decision",
  oracle: "answer key — never a model input: world truth, the corruption label, dealer quality and PD for each funded loan",
  reconciliation: "totals the tape must reconcile to"
});

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const cell = (v) => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "1" : "0") : String(v));
const csv = (columns, rows) => [columns.join(","), ...rows.map((r) => columns.map((k) => cell(r[k])).join(","))].join("\n") + "\n";

/** Row objects for the three CSV files. */
export function tapeRows(book) {
  const byId = new Map(book.pool.map((a) => [a.id, a]));
  const quality = new Map(book.dealers.map((d) => [d.id, d.quality]));
  const loans = book.loans.map((l) => {
    const a = byId.get(l.id);
    return { loan_id: l.id, dealer_id: l.dealerId, ead: l.ead, fico_presented: a.fico, dti_presented: a.dti, checking_presented: a.checking, fraud_review: a.fraudReview, dpd30: l.dpd30, charged_off: l.chargedOff };
  });
  const pool = book.pool.map((a) => {
    const decision = decide(a, CREDIT_POLICY);
    return { application_id: a.id, fico_presented: a.fico, dti_presented: a.dti, checking_presented: a.checking, fraud_review: a.fraudReview, decision, funded: decision === "APPROVE" };
  });
  const oracle = book.loans.map((l) => ({ loan_id: l.id, fico_true: l.fico, dti_true: l.dti, fraud_true: l.fraud, corruption_type: book.corruption.get(l.id), dealer_quality: quality.get(l.dealerId), pd: l.pd }));
  return { loans, pool, oracle };
}

/** The tape's data files as { fileName: text }, plus the manifest that hashes them. */
export function tapeFiles(book) {
  const rows = tapeRows(book);
  const files = {
    [TAPE_FILES.loans]: csv(COLUMNS.loans, rows.loans),
    [TAPE_FILES.pool]: csv(COLUMNS.pool, rows.pool),
    [TAPE_FILES.oracle]: csv(COLUMNS.oracle, rows.oracle),
    [TAPE_FILES.reconciliation]: JSON.stringify(reconciliation(book), null, 2) + "\n"
  };
  const counts = { loans: rows.loans.length, pool: rows.pool.length, oracle: rows.oracle.length };
  const manifest = {
    tape_version: "1.0.0",
    profile: "SOLAR_PRIME",
    seed: book.seed,
    as_of_date: AS_OF,
    generator_version: GENERATOR_VERSION,
    case_schema_version: CASE_SCHEMA_VERSION,
    configuration_hash: `sha256:${sha256(fs.readFileSync(CONFIG_PATH, "utf8"))}`,
    produced_by: "node scripts/export_credit_book.mjs",
    files: Object.fromEntries(Object.entries(TAPE_FILES).map(([key, name]) => [name, {
      role: ROLES[key],
      ...(counts[key] !== undefined ? { rows: counts[key], columns: COLUMNS[key] } : {}),
      sha256: sha256(files[name])
    }]))
  };
  return { files, manifest, rows };
}

/** Distribution summary for the README: numeric quantiles, category counts, missing values. */
export function tapeProfile(rows) {
  const numeric = (xs) => {
    const v = xs.filter((x) => x !== null && x !== undefined).map(Number).sort((a, b) => a - b);
    const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    return { n: v.length, missing: xs.length - v.length, min: v[0], p25: q(0.25), median: q(0.5), p75: q(0.75), max: v.at(-1), mean: v.reduce((s, x) => s + x, 0) / v.length };
  };
  const counts = (xs) => {
    const m = {};
    for (const x of xs) m[cell(x)] = (m[cell(x)] ?? 0) + 1;
    return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
  };
  const col = (rs, k) => rs.map((r) => r[k]);
  return {
    loans: { ead: numeric(col(rows.loans, "ead")), fico_presented: numeric(col(rows.loans, "fico_presented")), dti_presented: numeric(col(rows.loans, "dti_presented")), checking_presented: numeric(col(rows.loans, "checking_presented")), fraud_review: counts(col(rows.loans, "fraud_review")), dpd30: counts(col(rows.loans, "dpd30")), charged_off: counts(col(rows.loans, "charged_off")) },
    pool: { fico_presented: numeric(col(rows.pool, "fico_presented")), dti_presented: numeric(col(rows.pool, "dti_presented")), checking_presented: numeric(col(rows.pool, "checking_presented")), decision: counts(col(rows.pool, "decision")), fraud_review: counts(col(rows.pool, "fraud_review")) },
    oracle: { fico_true: numeric(col(rows.oracle, "fico_true")), dti_true: numeric(col(rows.oracle, "dti_true")), pd: numeric(col(rows.oracle, "pd")), dealer_quality: numeric(col(rows.oracle, "dealer_quality")), fraud_true: counts(col(rows.oracle, "fraud_true")), corruption_type: counts(col(rows.oracle, "corruption_type")) }
  };
}

// scripts/public-record.test.mjs — Public-record snapshot checks. Run: npm run test:public-record
//
// Exits non-zero on the first failed assertion. Builds the app into a temporary directory to
// confirm the bundle never requests SEC or FRED.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalise, readManualExtractions, isPreMergerRegistrantFact, quarterInfo, regime } from "./public-record/normalise.mjs";
import { liquidityRunway, trailingFour, leverageLiquidity, leverageGaps, unitEconomics, pearson, INSUFFICIENT } from "../src/profiles/sunlight/publicRecord.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "data", "public-record");
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
const manifest = readJson("manifest.json");
const quarterly = readJson("sunlight-quarterly.json");
const events = readJson("events.json").events;
const manualCsv = fs.readFileSync(path.join(DIR, "manual-extractions.csv"), "utf8");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b}`);

console.log("public-record tests");

check("every hash in the manifest matches the bytes of its raw file", () => {
  assert.ok(manifest.sources.length >= 3);
  let verified = 0, absent = 0;
  for (const s of manifest.sources) {
    const file = path.join(DIR, s.file);
    if (!fs.existsSync(file)) {
      assert.equal(s.committed, false, `${s.file} is committed but missing`);
      absent++;
      continue;
    }
    const buf = fs.readFileSync(file);
    assert.equal(buf.length, s.bytes, s.file);
    assert.equal(crypto.createHash("sha256").update(buf).digest("hex"), s.sha256, s.file);
    verified++;
  }
  for (const id of ["sec-companyfacts", "fred-DFF", "fred-DGS10"]) assert.equal(manifest.sources.find((s) => s.id === id).committed, true);
  console.log(`        ${verified} verified, ${absent} not present locally (filing documents are not committed)`);
});

check("no email address is stored in the manifest or the snapshot", () => {
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  assert.match(manifest.userAgent, /\[contact email redacted\]/);
  for (const f of ["manifest.json", "sunlight-quarterly.json", "events.json", "manual-extractions.csv"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(DIR, f), "utf8"), email, f);
  }
});

check("the normalised snapshot is reproducible from the raw files and the manual extractions", () => {
  const rebuilt = normalise({
    companyfacts: readJson("raw/sec-companyfacts-1821850.json"),
    fred: { DFF: fs.readFileSync(path.join(DIR, "raw/fred-DFF.csv"), "utf8"), DGS10: fs.readFileSync(path.join(DIR, "raw/fred-DGS10.csv"), "utf8") },
    manualCsv
  });
  assert.deepEqual(rebuilt.quarters, quarterly.quarters);
  assert.deepEqual(rebuilt.gaps, quarterly.gaps);
  assert.deepEqual(rebuilt.reconciliation, quarterly.reconciliation);
});

function assertSourced(m, where) {
  if (m === null) return;
  if (m.stubs) { for (const s of Object.values(m.stubs)) assertSourced(s, `${where} stub`); return; }
  if (m.derived) {
    assert.ok(m.method && m.inputs?.length === 2, `${where}: derived without method and two inputs`);
    for (const i of m.inputs) assertSourced(i, `${where} input`);
    return;
  }
  assert.ok(["xbrl", "manual", "fred"].includes(m.source), `${where}: no source`);
  if (m.source === "xbrl") assert.ok(m.concept && m.accn && m.form && m.filed && m.basis, `${where}: XBRL lineage incomplete`);
  if (m.source === "manual") assert.ok(m.document && m.accession_or_url && m.page_or_section && m.quoted_label, `${where}: manual lineage incomplete`);
  if (m.source === "fred") assert.ok(m.series && m.method && m.observations > 0, `${where}: FRED lineage incomplete`);
}

check("every metric in the quarterly snapshot has a source", () => {
  for (const row of quarterly.quarters) for (const [metric, m] of Object.entries(row.metrics)) assertSourced(m, `${row.quarter} ${metric}`);
});

check("every manual extraction row has a document, a page or section and a quoted label; rows without one fail", () => {
  const { rows, errors } = readManualExtractions(manualCsv);
  assert.deepEqual(errors, []);
  assert.ok(rows.length >= 20);
  for (const r of rows) {
    assert.match(r.page_or_section, /^p\. \d+, /, `line ${r.line}`);
    assert.ok(r.quoted_label.length > 0 && r.accession_or_url.startsWith("https://www.sec.gov/Archives/"), `line ${r.line}`);
  }
  const header = manualCsv.split("\n")[0];
  const missingPage = `${header}\n2022Q1,funded_volume,1,USD thousands,Some 10-Q,https://www.sec.gov/Archives/x/,,Funded Loans,me,2026-10-14\n`;
  assert.match(readManualExtractions(missingPage).errors.join("\n"), /missing page_or_section/);
  assert.throws(() => normalise({ companyfacts: { facts: {} }, fred: { DFF: "observation_date,DFF\n", DGS10: "observation_date,DGS10\n" }, manualCsv: missingPage }), /missing page_or_section/);
});

check("funded volume and platform fees cover every quarter Q1 2021–Q2 2023 (Q3 2021 as two stubs)", () => {
  for (const row of quarterly.quarters) {
    for (const metric of ["funded_volume", "platform_fees"]) {
      const m = row.metrics[metric];
      if (row.quarter === "2021Q3") {
        assert.ok(m.stubs.predecessor && m.stubs.successor, `${metric} 2021Q3 stubs`);
        assert.equal(m.value, undefined, "Q3 2021 must not be combined");
      } else assert.ok(Number.isFinite(m?.value), `${metric} ${row.quarter}`);
    }
  }
  // Q4s derived from the full year less nine months, citing both filings.
  for (const [q, inputs] of [["2021Q4", ["2021SUCC-FY", "2021Q3-SUCC"]], ["2022Q4", ["2022FY", "2022YTDQ3"]]]) {
    const m = quarterly.quarters.find((r) => r.quarter === q).metrics.funded_volume;
    assert.equal(m.derived, true);
    assert.deepEqual(m.inputs.map((i) => i.period), inputs);
    assert.equal(m.value, m.inputs[0].value - m.inputs[1].value);
  }
});

check("each quarter uses its own filing; later restatements are listed beside it", () => {
  const q1 = quarterly.quarters.find((r) => r.quarter === "2022Q1").metrics.funded_volume;
  assert.match(q1.document, /quarter ended March 31, 2022/);
  assert.ok(q1.restatements.length >= 1 && q1.restatements.every((r) => /March 31, 2023/.test(r.document)));
  for (const row of quarterly.quarters) {
    for (const metric of ["funded_volume", "platform_fees"]) {
      const m = row.metrics[metric];
      for (const r of m?.restatements ?? []) assert.ok(r.accession > m.accession, `${row.quarter} ${metric}: primary is not the earliest filing`);
    }
  }
});

check("the SPAC's pre-merger filings are excluded and every XBRL value carries its Predecessor/Successor basis", () => {
  assert.equal(isPreMergerRegistrantFact({ fy: 2021, fp: "Q2" }), true);
  assert.equal(isPreMergerRegistrantFact({ fy: 2021, fp: "Q3" }), false);
  assert.equal(isPreMergerRegistrantFact({ fy: 2020, fp: "FY" }), true);
  assert.equal(quarterly.eda.xbrl.excludedFilings.length, 3);
  for (const row of quarterly.quarters) {
    for (const m of Object.values(row.metrics)) {
      if (m?.source === "xbrl" && !m.derived) {
        assert.ok(!quarterly.eda.xbrl.excludedFilings.includes(m.accn));
        assert.equal(m.basis, m.end <= "2021-07-09" ? "Predecessor" : "Successor");
      }
    }
  }
  assert.equal(regime("2021-01-01", "2021-07-09"), "predecessor");
  assert.equal(regime("2021-07-10", "2021-09-30"), "successor");
  assert.equal(regime("2021-01-01", "2021-12-31"), "crosses");
  assert.equal(quarterInfo("2022Q4").end, "2022-12-31");
});

check("reconciliation: quarters sum to the filed year-to-date figure within $0.1M, or the mismatch is listed", () => {
  const recs = quarterly.reconciliation;
  assert.ok(recs.length > 0);
  const mismatches = recs.filter((r) => r.status === "mismatch");
  for (const r of mismatches) console.log(`        MISMATCH ${r.source} ${r.metric} ${r.window}: sum ${r.sum} vs filed ${r.filed.value} (${r.difference} ${r.unit})`);
  for (const r of recs.filter((x) => x.status !== "incomplete")) {
    assert.equal(r.sum, r.parts.reduce((t, p) => t + p.value, 0));
    assert.equal(r.difference, r.sum - r.filed.value);
    if (r.status === "match") assert.ok(Math.abs(r.difference) <= r.tolerance);
  }
  assert.equal(mismatches.length, 0, "unexplained reconciliation mismatches");
  assert.ok(recs.some((r) => r.independent), "at least one independent check");
  const fv = recs.find((r) => r.source === "manual" && r.metric === "funded_volume" && r.window === "2022 nine months");
  assert.equal(fv.sum, 592831 + 716351 + 834735);
  assert.equal(fv.filed.value, 2143918);
});

check("leverageLiquidity matches a hand-calculated example", () => {
  // TL 60, TA 200, cash 30, operating cash flow −12:
  // 60 ÷ 200 = 0.3; 30 ÷ 60 = 0.5; 30 ÷ 12 = 2.5 quarters of outflow.
  const v = (value) => ({ value, unit: "USD", source: "xbrl" });
  const [r] = leverageLiquidity([{ quarter: "2022Q1", metrics: { totalLiabilities: v(60), totalAssets: v(200), cash: v(30), operatingCashFlow: v(-12) } }]);
  close(r.liabilitiesToAssets.value, 0.3, 1e-12);
  close(r.cashToLiabilities.value, 0.5, 1e-12);
  close(r.cashToOutflow.value, 2.5, 1e-12);
  assert.deepEqual(r.cashToOutflow.inputs.map((m) => m.value), [30, -12]);
  assert.deepEqual(leverageGaps([r]), []);
});

check("leverageLiquidity gives insufficient data for a missing input, and not burning for a non-negative outflow", () => {
  const v = (value) => ({ value, unit: "USD", source: "xbrl" });
  const [noAssets, noCash, zeroOutflow, stubs] = leverageLiquidity([
    { quarter: "2022Q1", metrics: { totalLiabilities: v(60), totalAssets: null, cash: v(30), operatingCashFlow: v(5) } },
    { quarter: "2022Q2", metrics: { totalLiabilities: v(60), totalAssets: v(200), operatingCashFlow: v(-12) } },
    { quarter: "2022Q3", metrics: { totalLiabilities: v(60), totalAssets: v(200), cash: v(30), operatingCashFlow: v(0) } },
    { quarter: "2021Q3", metrics: { totalLiabilities: v(60), totalAssets: v(200), cash: v(30), operatingCashFlow: { stubs: { predecessor: v(-1), successor: v(-2) } } } }
  ]);
  assert.equal(noAssets.liabilitiesToAssets.value, null);
  assert.equal(noAssets.liabilitiesToAssets.status, INSUFFICIENT);
  assert.match(noAssets.liabilitiesToAssets.reason, /total assets not filed/);
  assert.equal(noAssets.cashToOutflow.status, "not burning");
  for (const k of ["cashToLiabilities", "cashToOutflow"]) assert.equal(noCash[k].status, INSUFFICIENT);
  assert.equal(zeroOutflow.cashToOutflow.status, "not burning");
  assert.equal(stubs.cashToOutflow.status, INSUFFICIENT);
  assert.match(stubs.cashToOutflow.reason, /stubs, which are not combined/);
  // Gaps: noAssets 2 (leverage, not burning), noCash 2, zeroOutflow 1, stubs 1.
  assert.deepEqual(leverageGaps([noAssets, noCash, zeroOutflow, stubs]).map((g) => g.quarter), ["2022Q1", "2022Q1", "2022Q2", "2022Q2", "2022Q3", "2021Q3"]);
});

check("leverage and liquidity on the snapshot: computed only where the filings support it, every gap listed", () => {
  const results = leverageLiquidity(quarterly.quarters);
  const ok = (k) => results.filter((r) => r[k].status === "ok").map((r) => r.quarter);
  const balanceQuarters = ["2021Q3", "2021Q4", "2022Q1", "2022Q2", "2022Q3", "2022Q4", "2023Q1", "2023Q2"];
  assert.deepEqual(ok("liabilitiesToAssets"), balanceQuarters);
  assert.deepEqual(ok("cashToLiabilities"), balanceQuarters);
  assert.deepEqual(ok("cashToOutflow"), ["2022Q1", "2022Q4"]);
  const by = (q) => results.find((r) => r.quarter === q);
  assert.match(by("2021Q3").cashToOutflow.reason, /stubs, which are not combined/);
  for (const q of ["2021Q4", "2022Q2", "2022Q3", "2023Q1", "2023Q2"]) assert.equal(by(q).cashToOutflow.status, "not burning", q);
  for (const q of ["2021Q1", "2021Q2"]) for (const k of ["liabilitiesToAssets", "cashToLiabilities", "cashToOutflow"]) assert.equal(by(q)[k].status, INSUFFICIENT, `${q} ${k}`);
  // Each computed value is exactly its filed inputs' quotient.
  const q4 = by("2022Q4"), m = quarterly.quarters.find((r) => r.quarter === "2022Q4").metrics;
  assert.equal(q4.cashToOutflow.value, m.cash.value / -m.operatingCashFlow.value);
  assert.equal(q4.liabilitiesToAssets.value, m.totalLiabilities.value / m.totalAssets.value);
  assert.equal(leverageGaps(results).length, results.length * 3 - 8 - 8 - 2);
});

check("liquidityRunway returns insufficient data, never a number, when burn is unavailable", () => {
  const actual = liquidityRunway(quarterly.quarters);
  for (const r of actual) {
    if (r.status !== "ok") { assert.equal(r.runwayMonths, null); assert.equal(r.burnPerMonth, null); }
    else assert.ok(r.runwayMonths > 0 && r.burnPerMonth > 0);
  }
  assert.equal(actual.find((r) => r.quarter === "2022Q1").status, INSUFFICIENT);
  assert.match(actual.find((r) => r.quarter === "2021Q4").reason, /Q3 2021 Predecessor\/Successor stubs/);
  const mk = (q, ocf, cash = 120) => ({ quarter: q, metrics: { cash: { value: cash }, operatingCashFlow: ocf === null ? null : { value: ocf } } });
  const r = liquidityRunway([mk("2022Q1", -6), mk("2022Q2", -6), mk("2022Q3", null), mk("2022Q4", -6)]);
  assert.equal(r[3].status, INSUFFICIENT);
  assert.equal(r[3].runwayMonths, null);
  const ok = liquidityRunway([mk("2022Q1", -6), mk("2022Q2", -6), mk("2022Q3", -6), mk("2022Q4", -6)]);
  assert.equal(ok[3].burnPerMonth, 2);
  assert.equal(ok[3].runwayMonths, 60);
  assert.equal(liquidityRunway([mk("2022Q1", 1), mk("2022Q2", 1), mk("2022Q3", 1), mk("2022Q4", 1)])[3].status, "not burning");
  const crossing = trailingFour([mk("2021Q2", -1), mk("2021Q3", -1), mk("2021Q4", -1), mk("2022Q1", -1)].map((x, i) => (i === 0 ? { ...x, quarter: "2021Q1" } : x)), 3, "operatingCashFlow");
  assert.equal(crossing.value, null);
});

check("unit economics: take rate, correlation labelled descriptive with n", () => {
  const ue = unitEconomics(quarterly.quarters);
  const q22 = ue.quarters.find((q) => q.quarter === "2022Q2");
  close(q22.takeRate.value, 27873 / 716351, 1e-15);
  assert.equal(ue.quarters.find((q) => q.quarter === "2021Q3").takeRate, null);
  assert.equal(ue.correlation.n, 9);
  assert.match(ue.correlation.label, /not causal/);
  close(pearson([[1, 2], [2, 4], [3, 6]]), 1, 1e-12);
  assert.equal(pearson([[1, 2], [2, 4]]), null);
});

check("no string from events.json appears in src/ outside src/profiles/sunlight/", () => {
  const strings = events.flatMap((e) => [e.title, e.detail, e.source.label]);
  const src = path.join(ROOT, "src"), allowed = path.join(src, "profiles", "sunlight");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return full === allowed ? [] : walk(full);
    return [full];
  });
  const offenders = [];
  for (const file of walk(src)) {
    const text = fs.readFileSync(file, "utf8");
    for (const s of strings) if (text.includes(s)) offenders.push(`${path.relative(ROOT, file)}: ${s.slice(0, 50)}`);
  }
  assert.deepEqual(offenders, []);
  for (const e of events) assert.match(e.source.url, /^https:\/\//);
});

check("the built bundle makes no request to sec.gov or stlouisfed.org (snapshot-only)", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "public-record-bundle-"));
  try {
    const build = spawnSync("npx", ["vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], { cwd: ROOT, shell: process.platform === "win32", encoding: "utf8" });
    assert.equal(build.status, 0, build.stderr);
    const js = fs.readdirSync(path.join(out, "assets")).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(out, "assets", f), "utf8")).join("\n");
    const requestCall = /\b(fetch|sendBeacon|EventSource|WebSocket|importScripts)\s*\(\s*[`'"][^`'"]*(sec\.gov|stlouisfed\.org)|\.open\(\s*[`'"][A-Z]+[`'"]\s*,\s*[`'"][^`'"]*(sec\.gov|stlouisfed\.org)/;
    assert.doesNotMatch(js, requestCall);
    // Every fetch in the bundle targets a relative path (the published benchmark artifacts).
    const fetchArgs = [...js.matchAll(/\bfetch\(\s*([^,)]{0,80})/g)].map((m) => m[1]);
    for (const a of fetchArgs) assert.doesNotMatch(a, /https?:\/\//, `absolute fetch: ${a}`);
    assert.ok(js.includes("data.sec.gov"), "the provenance panel should name the endpoint as text");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

console.log(`\n${passed} checks passed`);

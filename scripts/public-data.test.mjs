// scripts/public-data.test.mjs — Public-data group checks (Sprint 8.5). Run: npm run test:public-data
//
// Exits non-zero on the first failed assertion. Files kept local (complaint downloads, court
// exhibits) are checked when present; CI checks the committed snapshots, their hashes and schema.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalise, fiscalYtd, quarterInfo, QUARTERS } from "./public-record/normalise.mjs";
import {
  peersFile, complaintsFile, macroFile, courtExcerptFile, courtText, courtPages, checkCompanyFacts, complaintRecords, fredRows,
  quarterOf, quarterCodes, monthCodes, previousMonth, sourceSlug, PEERS_FILE, CFPB_FILE, MACRO_FILE, COURT_EXCERPT_FILE, COURT_FACTS_FILE
} from "./public-record/public-data.mjs";
import { userAgentFor, PLAIN_USER_AGENT } from "./public-record/user-agent.mjs";
import { publicDataMarkdown, README_FILE } from "./public-record/public-data-md.mjs";
import { leverageLiquidity } from "../src/profiles/sunlight/publicRecord.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "data", "public-record");
const readText = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const readJson = (f) => JSON.parse(readText(f));
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const asFile = (obj) => JSON.stringify(obj, null, 2) + "\n";
const manifest = readJson("manifest.json");
const pd = manifest.publicData;
const config = readJson("public-data-config.json");
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b}`);

/** Bytes of a public-data source when present (hash checked), else null; committed files must be present. */
function raw(id) {
  const s = pd.sources.find((x) => x.id === id);
  const file = path.join(DIR, s.file);
  if (!fs.existsSync(file)) { assert.equal(s.committed, false, `${s.file} is committed but missing`); return null; }
  const buf = fs.readFileSync(file);
  assert.equal(buf.length, s.bytes, s.file);
  assert.equal(sha256(buf), s.sha256, s.file);
  return buf;
}
const derived = (id) => pd.derived.find((d) => d.id === id);
function assertDerivedHash(id, file) {
  const text = readText(file), d = derived(id);
  assert.ok(d, `${id} missing from manifest.publicData.derived`);
  assert.equal(d.file, file);
  assert.equal(d.bytes, Buffer.byteLength(text), `${file} bytes`);
  assert.equal(d.sha256, sha256(Buffer.from(text)), `${file} hash`);
  return text;
}
const companyFacts = () => Object.fromEntries(config.edgar.filers.map((f) => [f.cik, JSON.parse(raw(`sec-companyfacts-${f.cik}`).toString("utf8"))]));
const fredCsv = () => Object.fromEntries(config.fred.series.map((s) => [s.id, raw(`fred-${s.id}`).toString("utf8")]));
function complaintRaw() {
  const out = {};
  for (const c of config.cfpb.companies) for (const s of c.strings) {
    const buf = raw(`cfpb-${sourceSlug(s)}`);
    if (!buf) return null;
    out[s] = JSON.parse(buf.toString("utf8"));
  }
  return out;
}
function courtRaw() {
  const out = {};
  for (const d of config.court.documents) {
    const buf = raw(`court-${d.id}`);
    if (!buf) return null;
    out[d.id] = buf.toString("utf8");
  }
  return out;
}

console.log("public-data tests");

check("the case-study manifest keys are untouched; the public data has its own list with licence and terms per source", () => {
  assert.deepEqual(Object.keys(manifest), ["generatedAt", "userAgent", "sources", "derived", "publicData"]);
  assert.equal(manifest.generatedAt, "2026-10-14T22:12:15.416Z");
  assert.equal(manifest.sources.length, 11);
  assert.ok(manifest.sources.every((s) => !s.id.startsWith("cfpb-") && !s.id.startsWith("court-") && !["fred-DRCLACBS", "fred-CORCACBS", "fred-UNRATE"].includes(s.id)));
  assert.match(pd.userAgent, /\[contact email redacted\]/);
  assert.equal(pd.sources.length, 16);
  for (const s of pd.sources) {
    assert.ok(s.licence?.length > 20 && s.terms?.length > 20 && /^https:\/\//.test(s.termsUrl), `${s.id}: licence and terms`);
    assert.ok(/^https:\/\//.test(s.url) && s.retrievedAt && s.sha256 && s.bytes > 0, `${s.id}: URL, date, hash`);
    if (!s.committed) assert.ok(s.file.startsWith("raw/local/"), `${s.id}: local-only files live in raw/local/`);
  }
  assert.ok(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").split(/\r?\n/).includes("data/public-record/raw/local/"));
  for (const id of pd.sources.filter((s) => s.id.startsWith("cfpb-") || s.id.startsWith("court-")).map((s) => s.id)) assert.equal(pd.sources.find((s) => s.id === id).committed, false, id);
});

check("every public-data hash matches its raw file (local-only files when present)", () => {
  let verified = 0, absent = 0;
  for (const s of pd.sources) {
    if (raw(s.id)) verified++;
    else absent++;
  }
  console.log(`        ${verified} verified, ${absent} local-only files not present`);
});

check("the SEC User-Agent goes to SEC hosts only", () => {
  const ua = "Org [contact]";
  assert.equal(userAgentFor("https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json", ua), ua);
  assert.equal(userAgentFor("https://www.sec.gov/Archives/edgar/data/1/x.htm", ua), ua);
  for (const u of ["https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE", config.cfpb.api, "https://sec.gov.example.com/"]) assert.equal(userAgentFor(u, ua), PLAIN_USER_AGENT, u);
  assert.doesNotMatch(PLAIN_USER_AGENT, EMAIL);
});

check("content checks: SEC company facts, FRED CSV header, complaint responses, court exhibits", () => {
  for (const f of config.edgar.filers) checkCompanyFacts(JSON.parse(raw(`sec-companyfacts-${f.cik}`).toString("utf8")), f.cik);
  for (const s of config.fred.series) assert.ok(fredRows(raw(`fred-${s.id}`).toString("utf8"), s.id).length > 50);
  assert.throws(() => checkCompanyFacts({ cik: 1, entityName: "x", facts: {} }, 2), /not an SEC company-facts document/);
  assert.throws(() => fredRows("DATE,VALUE\n2020-01-01,1", "UNRATE"), /expected "observation_date,UNRATE"/);
  assert.throws(() => complaintRecords({ hits: { total: { value: 2 }, hits: [{ _source: { company: "A", date_received: "2020-01-01T00:00:00Z" } }] } }, "A"), /truncated/);
  assert.throws(() => complaintRecords({ hits: { total: { value: 1 }, hits: [{ _source: { company: "B", date_received: "2020-01-01T00:00:00Z" } }] } }, "A"), /names "B"/);
  const complaints = complaintRaw();
  if (complaints) for (const [s, r] of Object.entries(complaints)) complaintRecords(r, s);
  const court = courtRaw();
  if (court) for (const html of Object.values(court)) assert.ok(html.includes(config.court.caseNumber));
});

check("sunlight-quarterly.json is byte-identical to a rebuild from its raw files (the case-study normaliser is unchanged)", () => {
  const manualCsv = readText("manual-extractions.csv");
  const result = normalise({ companyfacts: readJson("raw/sec-companyfacts-1821850.json"), fred: { DFF: readText("raw/fred-DFF.csv"), DGS10: readText("raw/fred-DGS10.csv") }, manualCsv });
  const out = { builtFrom: { manifestGeneratedAt: manifest.generatedAt, rawHashes: Object.fromEntries(manifest.sources.map((s) => [s.id, s.sha256])), manualExtractions: sha256(Buffer.from(manualCsv)) }, ...result };
  assert.equal(asFile(out), readText("sunlight-quarterly.json"));
  assert.equal(sha256(fs.readFileSync(path.join(DIR, "sunlight-quarterly.json"))), "a278b5c0938b626554155709af51cf2393ec1e9216f1f0b3eb15c77b8cba1732");
});

check("string date helpers: quarters, months, fiscal year-to-date windows", () => {
  assert.equal(quarterOf("2026-04-01"), "2026Q2");
  assert.equal(quarterOf("2024-12-31"), "2024Q4");
  assert.deepEqual(quarterCodes("2019Q3", "2020Q2"), ["2019Q3", "2019Q4", "2020Q1", "2020Q2"]);
  assert.deepEqual(monthCodes("2019-11", "2020-02"), ["2019-11", "2019-12", "2020-01", "2020-02"]);
  assert.equal(previousMonth("2026-01"), "2025-12");
  // Calendar fiscal year: Q1 has no earlier window; Q4 = full year less nine months.
  assert.deepEqual(fiscalYtd(quarterInfo("2024Q1"), 1), { ytdStart: "2024-01-01", prevEnd: null });
  assert.deepEqual(fiscalYtd(quarterInfo("2024Q4"), 1), { ytdStart: "2024-01-01", prevEnd: "2024-09-30" });
  // Fiscal year from July: calendar Q3 starts it; calendar Q2 is its fourth quarter.
  assert.deepEqual(fiscalYtd(quarterInfo("2024Q3"), 7), { ytdStart: "2024-07-01", prevEnd: null });
  assert.deepEqual(fiscalYtd(quarterInfo("2024Q1"), 7), { ytdStart: "2023-07-01", prevEnd: "2023-12-31" });
  assert.deepEqual(fiscalYtd(quarterInfo("2024Q2"), 7), { ytdStart: "2023-07-01", prevEnd: "2024-03-31" });
});

const peers = readJson(PEERS_FILE);

check("peers-quarterly.json rebuilds byte-identical from the committed company facts and matches its manifest hash", () => {
  const text = assertDerivedHash("peers-quarterly", PEERS_FILE);
  assert.equal(asFile(peersFile(companyFacts(), config, pd.sources)), text);
  assert.deepEqual(peers.filers.map((f) => f.cik), config.edgar.filers.map((f) => f.cik));
  assert.deepEqual(peers.caseStudyWindow, { from: QUARTERS[0], to: QUARTERS.at(-1) });
});

check("peers: every value is a filed fact or a two-input derivation of filed facts; every missing cell is a listed gap", () => {
  const facts = companyFacts();
  for (const f of peers.filers) {
    const cf = facts[f.cik];
    const filed = (m) => Object.values(cf.facts).some((t) => t[m.concept]?.units?.USD?.some((x) => x.val === m.value && x.end === m.end && (x.start ?? null) === m.start && x.accn === m.accn));
    for (const row of f.quarters) {
      for (const [metric, m] of Object.entries(row.metrics)) {
        if (m === null) {
          assert.ok(f.gaps.some((g) => g.metric === metric && (g.quarter === row.quarter || g.quarter === "all")), `${f.id} ${row.quarter} ${metric}: missing but not listed`);
          continue;
        }
        if (m.derived) {
          assert.equal(m.inputs.length, 2, `${f.id} ${row.quarter} ${metric}`);
          for (const i of m.inputs) { assert.ok(filed(i), `${f.id} ${row.quarter} ${metric}: derived input not in the raw facts`); assert.equal(i.cik, f.cik); }
          assert.equal(m.value, m.inputs[0].value - m.inputs[1].value);
          assert.equal(m.inputs[0].start, m.inputs[1].start, "both year-to-date facts start the same fiscal year");
        } else {
          assert.ok(filed(m), `${f.id} ${row.quarter} ${metric}: not a filed fact`);
          assert.equal(m.end, row.periodEnd);
          assert.equal(m.cik, f.cik);
        }
      }
    }
    const missing = f.quarters.reduce((s, r) => s + Object.values(r.metrics).filter((m) => m === null).length, 0);
    const listed = f.gaps.reduce((s, g) => s + (g.quarter === "all" ? f.quarters.length : 1), 0);
    assert.equal(listed, missing, `${f.id}: listed gaps vs missing cells`);
  }
  // One concept per metric per filer: the existing rule, no overrides.
  for (const f of peers.filers) for (const row of f.quarters) for (const [metric, m] of Object.entries(row.metrics)) if (m) assert.equal(m.concept, f.eda.dedupe[metric].concept, `${f.id} ${metric}`);
});

check("peers: hand-calculated ratio example and the fiscal-year derivation", () => {
  // Filer "oportun" at December 31, 2022 (10-K and later 10-Qs agree): liabilities $3,066,096k, assets
  // $3,613,695k, cash $98,817k. 3,066,096 ÷ 3,613,695 = 0.848466; 98,817 ÷ 3,066,096 = 0.032229.
  const op = peers.filers.find((f) => f.id === "oportun");
  const row = op.quarters.find((r) => r.quarter === "2022Q4");
  assert.equal(row.metrics.totalLiabilities.value, 3066096000);
  assert.equal(row.metrics.totalAssets.value, 3613695000);
  assert.equal(row.metrics.cash.value, 98817000);
  const [r] = leverageLiquidity([row]);
  close(r.liabilitiesToAssets.value, 0.848466, 5e-7);
  close(r.cashToLiabilities.value, 0.032229, 5e-7);
  // Filer "affirm" has a fiscal year from July 1: calendar Q2 2024 is its fiscal Q4, so revenue is the fiscal year less nine months.
  const aff = peers.filers.find((f) => f.id === "affirm").quarters.find((q) => q.quarter === "2024Q2").metrics.revenue;
  assert.equal(aff.derived, true);
  assert.equal(aff.method, "2023-07-01–2024-06-30 less 2023-07-01–2024-03-31");
  // The decided gaps stay gaps: "onemain" revenue (no listed concept), "lendingclub" cash after 2020.
  assert.ok(peers.filers.find((f) => f.id === "onemain").gaps.some((g) => g.metric === "revenue" && g.quarter === "all"));
  const lcFiler = peers.filers.find((f) => f.id === "lendingclub"), lc = lcFiler.quarters;
  assert.ok(lc.filter((q) => q.quarter >= "2021Q1").every((q) => q.metrics.cash === null));
  // Owner decision (October 22, 2026): a later-filed zero contradicting an earlier non-zero value is a
  // listed gap. Here: $524,963,000 in the FY2020 10-K, 0 in later 10-Qs, for cash at 2020-12-31.
  assert.equal(lc.find((q) => q.quarter === "2020Q4").metrics.cash, null);
  assert.match(lcFiler.gaps.find((g) => g.metric === "cash" && g.quarter === "2020Q4").detail, /filings disagree for 2020-12-31: 524,963,000 in the 10-K filed 2021-03-11, 0 in the 10-Q filed 2021-11-03; left as a gap/);
  assert.deepEqual(lcFiler.eda.dedupe.cash.filingsDisagree.map((c) => [c.end, c.earlier.value, c.later.value]), [["2020-12-31", 524963000, 0]]);
});

check("peers: every figure comes from a 10-K or 10-Q (or an amendment); proxy-statement figures are excluded", () => {
  const leaves = (m) => (m.derived ? m.inputs : [m]);
  for (const f of peers.filers) for (const row of f.quarters) for (const m of Object.values(row.metrics)) if (m) for (const l of leaves(m)) assert.match(l.form, /^10-[QK](\/A)?$/, `${f.id} ${row.quarter} ${l.concept}: ${l.form}`);
  // The FY2023 net income behind "lendingclub" Q4 2023 is the 10-K's $38,939,000, not a proxy statement's rounded $38,900,000.
  const ni = peers.filers.find((f) => f.id === "lendingclub").quarters.find((q) => q.quarter === "2023Q4").metrics.netIncome;
  assert.equal(ni.inputs[0].value, 38939000);
  assert.equal(ni.inputs[0].form, "10-K");
  assert.ok(peers.filers.every((f) => Object.values(f.eda.dedupe).every((d) => d.concept === null || d.excludedNonPeriodicForms >= 0)));
});

check("public data renders after the data-provenance panel, so the captured provenance image is unchanged", () => {
  const view = fs.readFileSync(path.join(ROOT, "src", "ui", "publicRecord", "PublicRecordView.jsx"), "utf8");
  const tab = view.slice(view.indexOf("export function PublicRecordTab"));
  const at = (s) => { const i = tab.indexOf(s); assert.ok(i >= 0, s); return i; };
  for (const p of ["<CourtFilingsPanel", "<PeerPanel", "<ComplaintsPanel", "<CreditConditionsPanel", "<PublicDataProvenancePanel"]) assert.ok(at("<ProvenancePanel") < at(p), `${p} must come after <ProvenancePanel`);
  // Nothing from the public data is rendered inside the panels above it.
  assert.equal(view.slice(0, view.indexOf("function ProvenancePanel")).includes("publicData"), false);
});

const cfpb = readJson(CFPB_FILE);

check("complaints: schema holds counts only (no narrative, ZIP, tags, IDs or other free text) and the hash matches", () => {
  assertDerivedHash("cfpb-complaints", CFPB_FILE);
  const forbidden = new Set(config.cfpb.droppedFields);
  const allowed = new Set(["builtFrom", "rawHashes", "window", "from", "to", "provisionalMonth", "keptFields", "droppedFields", "method", "companies", "id", "label", "role", "strings", "switch", "date", "total", "eda", "string", "records", "first", "last", "rawRecords", "beforeWindow", "afterWindow", "missingInKeptFields", "totalOnly", "firstInWindow", "lastInWindow", "monthly", "month", "count", "provisional", "sparsity", "months", "monthsWithComplaints", "monthsWithAtMostTwo", "medianInMonthsWithComplaints", "max", "byIssue", "bySubIssue", "byProduct", "bySubProduct", "byState", "byResponse", "byTimely", "byString", "key", "monthlyByIssue", "issue", ...config.cfpb.keptFields, ...pd.sources.map((s) => s.id)]);
  const freeText = new Set(["method", "label"]);
  const walk = (v, where, key) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${where}[${i}]`, key));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        assert.ok(!forbidden.has(k), `${where}.${k}: dropped field present`);
        assert.ok(allowed.has(k), `${where}.${k}: key not in the counts-only schema`);
        walk(x, `${where}.${k}`, k);
      }
      return;
    }
    if (typeof v === "string") {
      assert.doesNotMatch(v, /^\d{5}(-\d{4})?$/, `${where}: looks like a ZIP code`);
      assert.doesNotMatch(v, EMAIL, where);
      if (!freeText.has(key)) assert.ok(v.length <= 200, `${where}: string longer than a category name`);
    }
  };
  walk(cfpb, "cfpb");
  assert.equal(cfpb.method.includes("No narrative"), true);
  for (const c of cfpb.companies) {
    assert.equal(c.label, config.cfpb.companies.find((x) => x.id === c.id).label);
    if (c.switch) assert.equal(c.switch.label, config.cfpb.companies.find((x) => x.id === c.id).switch.label);
  }
});

check("complaints: counts reconcile to the raw totals, every category sums to the total, window ends at the last complete month", () => {
  const retrieved = pd.sources.filter((s) => s.id.startsWith("cfpb-")).map((s) => s.retrievedAt.slice(0, 7)).sort()[0];
  assert.deepEqual(cfpb.window, { from: config.cfpb.windowStart, to: previousMonth(retrieved), provisionalMonth: previousMonth(retrieved) });
  for (const c of cfpb.companies) {
    assert.equal(c.eda.rawRecords, c.eda.strings.reduce((s, x) => s + x.records, 0), c.id);
    assert.equal(c.total + c.eda.beforeWindow + c.eda.afterWindow, c.eda.rawRecords, `${c.id}: in + before + after = raw`);
    if (c.totalOnly) { assert.equal(c.monthly, undefined); assert.equal(c.byIssue, undefined); continue; }
    assert.deepEqual(c.monthly.map((m) => m.month), monthCodes(cfpb.window.from, cfpb.window.to));
    assert.deepEqual(c.monthly.filter((m) => m.provisional).map((m) => m.month), [cfpb.window.to]);
    const sum = (xs) => xs.reduce((s, x) => s + x.count, 0);
    for (const k of ["monthly", "byIssue", "bySubIssue", "byProduct", "bySubProduct", "byState", "byResponse", "byTimely", "byString", "monthlyByIssue"]) assert.equal(sum(c[k]), c.total, `${c.id} ${k}`);
    for (const m of c.monthly) assert.equal(sum(c.monthlyByIssue.filter((x) => x.month === m.month)), m.count, `${c.id} ${m.month}`);
  }
  const gs = cfpb.companies.find((c) => c.switch);
  const from = gs.eda.strings.find((s) => s.string === gs.switch.from), to = gs.eda.strings.find((s) => s.string === gs.switch.to);
  assert.ok(from.last < gs.switch.date && to.first >= gs.switch.date, "the two company names do not overlap the switch date");
  assert.deepEqual(cfpb.companies.filter((c) => c.totalOnly).map((c) => c.id), config.cfpb.companies.filter((c) => c.totalOnly).map((c) => c.id));
});

check("complaints: rebuild byte-identical from the local downloads when present; dates bucketed from the string", () => {
  // A UTC timestamp just after midnight stays in its own month (it would move back in US time zones as a Date).
  const rec = (d, company = "X") => ({ _source: { company, date_received: d, product: "P", sub_product: "", issue: "I", sub_issue: null, state: "", company_response: "Closed", timely: "Yes" } });
  const mini = { ...config, cfpb: { ...config.cfpb, windowStart: "2024-08", companies: [{ id: "x", label: "X", role: "peer", strings: ["X"] }] } };
  const out = complaintsFile({ X: { hits: { total: { value: 2 }, hits: [rec("2024-09-01T01:12:54.000Z"), rec("2024-08-31T23:59:59.000Z")] } } }, mini, [{ id: "cfpb-x", sha256: "h", retrievedAt: "2024-10-05T00:00:00.000Z" }]);
  assert.deepEqual(out.companies[0].monthly, [{ month: "2024-08", count: 1 }, { month: "2024-09", count: 1, provisional: true }]);
  assert.deepEqual(out.companies[0].byState, [{ key: "(not given)", count: 2 }]);
  const complaints = complaintRaw();
  if (!complaints) { console.log("        complaint downloads not present locally; committed snapshot checked only"); return; }
  assert.equal(asFile(complaintsFile(complaints, config, pd.sources)), readText(CFPB_FILE));
  console.log("        rebuilt from the local downloads and matched");
});

const macro = readJson(MACRO_FILE);

check("macro-credit.json rebuilds byte-identical; a missing observation is listed and left empty, never filled", () => {
  const text = assertDerivedHash("macro-credit", MACRO_FILE);
  assert.equal(asFile(macroFile(fredCsv(), config, pd.sources)), text);
  const un = macro.series.find((s) => s.id === "UNRATE");
  assert.deepEqual(un.missingInWindow, [{ date: "2025-10-01", period: "2025-10" }]);
  assert.equal(un.observations.find((o) => o.date === "2025-10-01").value, null);
  const dr = macro.series.find((s) => s.id === "DRCLACBS");
  assert.equal(dr.frequency, "quarterly");
  assert.ok(dr.observations.every((o) => o.period === quarterOf(o.date) && o.date.endsWith("-01")));
  assert.equal(dr.observations[0].period, "2019Q1");
  for (const s of macro.series) {
    const rows = new Map(fredRows(fredCsv()[s.id], s.id).map((r) => [r.date, r.value]));
    for (const o of s.observations) assert.equal(o.value, rows.get(o.date), `${s.id} ${o.date}`);
  }
});

check("the new snapshots do not depend on the process time zone", () => {
  const child = `
    const fs = await import("node:fs"); const path = await import("node:path"); const crypto = await import("node:crypto");
    const pdm = await import(${JSON.stringify(new URL("./public-record/public-data.mjs", import.meta.url).href)});
    const DIR = ${JSON.stringify(DIR)};
    const m = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8")).publicData;
    const cfg = JSON.parse(fs.readFileSync(path.join(DIR, "public-data-config.json"), "utf8"));
    const read = (id) => fs.readFileSync(path.join(DIR, m.sources.find((s) => s.id === id).file), "utf8");
    const h = (o) => crypto.createHash("sha256").update(JSON.stringify(o, null, 2) + "\\n").digest("hex");
    const facts = Object.fromEntries(cfg.edgar.filers.map((f) => [f.cik, JSON.parse(read("sec-companyfacts-" + f.cik))]));
    const csv = Object.fromEntries(cfg.fred.series.map((s) => [s.id, read("fred-" + s.id)]));
    console.log(JSON.stringify({ offset: new Date(2024, 0, 15).getTimezoneOffset(), peers: h(pdm.peersFile(facts, cfg, m.sources)), macro: h(pdm.macroFile(csv, cfg, m.sources)) }));`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], { encoding: "utf8", env: { ...process.env, TZ: "America/New_York" } });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim());
  assert.equal(out.offset, 300, "the child process must really run in US Eastern time");
  assert.equal(out.peers, derived("peers-quarterly").sha256);
  assert.equal(out.macro, derived("macro-credit").sha256);
});

const excerpt = readJson(COURT_EXCERPT_FILE);
const court = readJson(COURT_FACTS_FILE);

check("court excerpt: only the cited pages, no email address, hash in the manifest; rebuilt from the local exhibits when present", () => {
  const text = assertDerivedHash("filing-excerpts-court", COURT_EXCERPT_FILE);
  assert.doesNotMatch(text, EMAIL);
  assert.deepEqual(excerpt.documents.map((d) => [d.id, d.pages.map((p) => p.page)]), [["amended-plan", ["4", "6", "22", "23"]], ["dkt-95", ["4"]]]);
  for (const d of excerpt.documents) assert.equal(d.builtFrom.sha256, pd.sources.find((s) => s.id === `court-${d.id}`).sha256);
  // The ECF stamp on the cited Dkt. 95 page carries its filing date.
  assert.match(excerpt.documents[1].pages[0].text, /Case 23-11794-MFW Doc 95 Filed 11\/02\/23 Page 4 of 11/);
  const docs = courtRaw();
  if (!docs) { console.log("        court exhibits not present locally; quotes checked against the committed excerpt only"); return; }
  assert.equal(asFile(courtExcerptFile(docs, config, pd.sources)), text);
  // The plan's date comes from its cover; other pages of both exhibits do carry email addresses.
  assert.match(courtText(docs["amended-plan"]), /Dated: December 1, 2023/);
  assert.ok(courtPages(docs["dkt-95"], "ecf-stamp").filter((p) => EMAIL.test(p.text)).map((p) => p.page).join(",") === "1,2,3,11");
  console.log("        excerpt rebuilt from the local exhibits and matched");
});

check("court facts: each quote appears word for word on its cited page; citations in the approved form; timing only from the plan", () => {
  assert.equal(court.facts.length, 5);
  for (const f of court.facts) {
    const doc = excerpt.documents.find((d) => d.id === f.document);
    assert.ok(doc, `${f.id}: unknown document`);
    assert.match(f.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(f.date, f.document === "dkt-95" ? "2023-11-02" : "2023-12-01", f.id);
    assert.equal(f.source.url, doc.url);
    for (const q of f.quotes) {
      assert.match(q.citation, f.document === "dkt-95" ? /^Dkt\. 95, ECF p\. 4$/ : /^Plan § \d+\.\d+(\([a-z]\)(\([ivx]+\))?)?, p\. \d+$/, q.citation);
      assert.equal(q.citation.match(/p\. (\d+)$/)[1], q.page);
      const page = doc.pages.find((p) => p.page === q.page);
      assert.ok(page, `${f.id}: page ${q.page} not in the excerpt`);
      assert.ok(page.text.includes(courtText(q.text)), `${f.id}: not found word for word on p. ${q.page}`);
      if (f.document === "dkt-95") assert.doesNotMatch(q.text, /Effective Date|following|January|days|\b20\d\d\b/, "timing facts come from the Amended Plan");
    }
  }
  // Approved quotes include the bank partner's allowed claim, verbatim with "not less than".
  assert.ok(court.facts.some((f) => f.quotes.some((q) => q.text.includes("not less than $114,247,926.34") && q.citation === "Plan § 4.3(b)(i), p. 22")));
  // Court facts stay out of events.json, which the Findings chart draws.
  const eventsText = readText("events.json");
  for (const f of court.facts) { assert.ok(!eventsText.includes(f.id)); for (const q of f.quotes) assert.ok(!eventsText.includes(q.text.slice(0, 40))); }
});

check("no string from court-filings.json appears in src/ outside src/profiles/sunlight/", () => {
  const strings = court.facts.flatMap((f) => [f.title, f.source.label, ...f.quotes.map((q) => q.text)]);
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
});

check("peer lender names appear only under src/profiles/ and data/ (none in other src/ files or scripts/)", () => {
  const names = [...new Set([
    ...config.nameGuard,
    ...config.edgar.filers.map((f) => f.label),
    ...peers.filers.map((f) => f.entityName),
    ...config.cfpb.companies.filter((c) => c.role !== "case-study").flatMap((c) => [c.label, ...c.strings])
  ])];
  assert.ok(names.length >= 15);
  const roots = [path.join(ROOT, "src"), path.join(ROOT, "scripts")], allowed = path.join(ROOT, "src", "profiles");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return full === allowed || e.name === "node_modules" ? [] : walk(full);
    return /\.(js|jsx|mjs|cjs|ts|tsx|json|css|html|md)$/.test(e.name) ? [full] : [];
  });
  const offenders = [];
  for (const file of roots.flatMap(walk)) {
    const text = fs.readFileSync(file, "utf8");
    for (const s of names) if (text.includes(s)) offenders.push(`${path.relative(ROOT, file)}: ${s}`);
  }
  assert.deepEqual(offenders, []);
});

check("no email address in any public-data file; the data README is current", () => {
  for (const f of ["public-data-config.json", PEERS_FILE, CFPB_FILE, MACRO_FILE, COURT_EXCERPT_FILE, COURT_FACTS_FILE, "manifest.json", "README.md"]) assert.doesNotMatch(readText(f), EMAIL, f);
  assert.equal(fs.readFileSync(README_FILE, "utf8"), publicDataMarkdown(), "run node scripts/public-record/public-data-md.mjs --write");
});

check("the deploy uploads every snapshot the app imports, and none of the raw or excerpt files", () => {
  const vi = fs.readFileSync(path.join(ROOT, ".vercelignore"), "utf8").split(/\r?\n/);
  for (const f of ["public-data-config.json", PEERS_FILE, CFPB_FILE, MACRO_FILE, COURT_FACTS_FILE]) assert.ok(vi.includes(`!/data/public-record/${f}`), `.vercelignore must include ${f}`);
  for (const f of [COURT_EXCERPT_FILE, "README.md"]) assert.ok(!vi.includes(`!/data/public-record/${f}`), `${f} is not needed by the build`);
  const imports = fs.readFileSync(path.join(ROOT, "src", "profiles", "sunlight", "publicRecordData.js"), "utf8");
  for (const f of ["public-data-config.json", PEERS_FILE, CFPB_FILE, MACRO_FILE, COURT_FACTS_FILE]) assert.ok(imports.includes(`data/public-record/${f}`), f);
});

console.log(`\n${passed} checks passed`);

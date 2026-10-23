// scripts/fetch-public-record.mjs — Build-time fetch of the public-record snapshots.
// Run manually, never in CI:
//
//   SEC_USER_AGENT="Organisation Name <contact email>" node scripts/fetch-public-record.mjs
//   node scripts/fetch-public-record.mjs --normalise-only     # rebuild from saved raw files
//   SEC_USER_AGENT=… node scripts/fetch-public-record.mjs --group public-data
//   node scripts/fetch-public-record.mjs --group public-data --normalise-only
//
// The public-data group (complaint counts, peer lenders, FRED credit conditions, court-filing
// excerpts; sources in data/public-record/public-data-config.json) has its own `publicData` list in
// the manifest. Fetching it leaves `generatedAt`, `sources` and every case-study snapshot untouched.
// The SEC User-Agent (with its contact email) is sent to sec.gov hosts only.
//
// Fetches SEC XBRL company facts, two FRED daily series and the periodic filings used for the
// manual extractions, saves the raw bytes, records each
// file's SHA-256 and retrieval time in the manifest, then normalises everything (with the manual
// extractions) into data/public-record/sunlight-quarterly.json, plus the daily DGS10 window for the
// rate paths into data/public-record/dgs10-daily.json. The browser never calls SEC or FRED.
// The User-Agent is read from the environment; any email address in it is masked in the manifest.

import "./lib/utc.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { normalise, dailySeriesFile, DAILY_FILE, filingExcerptFile, EXCERPT_FILE, EXCERPT_PAGES } from "./public-record/normalise.mjs";
import { userAgentFor } from "./public-record/user-agent.mjs";
import { peersFile, complaintsFile, macroFile, courtExcerptFile, checkCompanyFacts, complaintRecords, fredRows, sourceSlug, PEERS_FILE, CFPB_FILE, MACRO_FILE, COURT_EXCERPT_FILE } from "./public-record/public-data.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "data", "public-record");
const RAW = path.join(DIR, "raw");
const MIN_INTERVAL_MS = 250; // at most 4 requests a second, under SEC's 10/s and the sprint's 5/s limit

export const SOURCES = [
  { id: "sec-companyfacts", url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0001821850.json", file: "sec-companyfacts-1821850.json", needsSecAgent: true },
  { id: "fred-DFF", url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFF", file: "fred-DFF.csv" },
  { id: "fred-DGS10", url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10", file: "fred-DGS10.csv" },
  // Primary documents of the periodic filings the manual extractions are read from. They are
  // hashed in the manifest but not committed (several megabytes of HTML each); re-download from
  // the URL and compare the SHA-256 to verify.
  ...[
    ["10q-2021q3", "000182185021000026/sunl-20210930.htm"],
    ["10k-2021", "000182185022000004/sunl-20211231.htm"],
    ["10q-2022q1", "000182185022000019/sunl-20220331.htm"],
    ["10q-2022q2", "000182185022000050/sunl-20220630.htm"],
    ["10q-2022q3", "000182185022000073/sunl-20220930.htm"],
    ["10k-2022", "000182185023000025/sunl-20221231.htm"],
    ["10q-2023q1", "000182185023000043/sunl-20230331.htm"],
    ["10q-2023q2", "000182185023000064/sunl-20230630.htm"]
  ].map(([id, rel]) => ({ id: `filing-${id}`, url: `https://www.sec.gov/Archives/edgar/data/1821850/${rel}`, file: `filings/${id}.htm`, committed: false }))
];

export const redactEmails = (s) => s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[contact email redacted]");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAll(userAgent) {
  fs.mkdirSync(path.join(RAW, "filings"), { recursive: true });
  const entries = [];
  let last = 0;
  for (const s of SOURCES) {
    const wait = last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(s.url, { headers: { "User-Agent": userAgentFor(s.url, userAgent), "Accept-Encoding": "gzip, deflate" } });
    if (res.status !== 200) throw new Error(`${s.url} returned HTTP ${res.status}; stopping without writing anything further`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(RAW, s.file), buf);
    entries.push({ id: s.id, url: s.url, file: `raw/${s.file}`, committed: s.committed !== false, bytes: buf.length, sha256: sha256(buf), retrievedAt: new Date().toISOString(), contentType: res.headers.get("content-type") });
    console.log(`  fetched ${s.id}: ${buf.length.toLocaleString("en-US")} bytes`);
  }
  return entries;
}

function readText(file) {
  return fs.readFileSync(path.join(DIR, file), "utf8");
}

function build(manifest) {
  const companyfacts = JSON.parse(readText("raw/sec-companyfacts-1821850.json"));
  const fred = { DFF: readText("raw/fred-DFF.csv"), DGS10: readText("raw/fred-DGS10.csv") };
  const manualPath = path.join(DIR, "manual-extractions.csv");
  const manualCsv = fs.existsSync(manualPath) ? fs.readFileSync(manualPath, "utf8") : null;
  const result = normalise({ companyfacts, fred, manualCsv });
  const out = {
    builtFrom: { manifestGeneratedAt: manifest.generatedAt, rawHashes: Object.fromEntries(manifest.sources.map((s) => [s.id, s.sha256])), manualExtractions: manualCsv ? sha256(Buffer.from(manualCsv)) : null },
    ...result
  };
  fs.writeFileSync(path.join(DIR, "sunlight-quarterly.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`  wrote sunlight-quarterly.json: ${result.quarters.length} quarters, ${result.gaps.length} gaps`);
  buildDaily(manifest, fred.DGS10);
}

// The daily DGS10 file for the rate-path windows. Its hash goes into the manifest's `derived` list,
// separate from `sources`, so sunlight-quarterly.json (which records the source hashes) is unchanged.
function buildDaily(manifest, dgs10Text) {
  const source = manifest.sources.find((s) => s.id === "fred-DGS10");
  const out = dailySeriesFile(dgs10Text, source);
  const text = JSON.stringify(out, null, 2) + "\n";
  fs.writeFileSync(path.join(DIR, DAILY_FILE), text);
  const entry = { id: "dgs10-daily", file: DAILY_FILE, builtFrom: source.file, builtFromSha256: source.sha256, bytes: Buffer.byteLength(text), sha256: sha256(Buffer.from(text)) };
  manifest.derived = [...(manifest.derived ?? []).filter((d) => d.id !== entry.id), entry];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`  wrote ${DAILY_FILE}: ${out.observations.length} days, ${out.observations.filter((o) => o.carriedFrom).length} carried forward`);
  buildExcerpts(manifest);
}

// The text of the 10-K pages the Funding & Rates quotes cite. Rebuilt only when the filing is
// present locally (it is not committed); otherwise the committed excerpt and its entry stay as they are.
function buildExcerpts(manifest) {
  const source = manifest.sources.find((s) => s.id === "filing-10k-2022");
  const file = path.join(DIR, source.file);
  if (!fs.existsSync(file)) { console.log(`  ${EXCERPT_FILE}: filing not present locally, kept as committed`); return; }
  const buf = fs.readFileSync(file);
  if (sha256(buf) !== source.sha256) throw new Error(`${source.file} does not match its manifest hash; not rebuilding ${EXCERPT_FILE}`);
  const text = JSON.stringify(filingExcerptFile(buf.toString("utf8"), source), null, 2) + "\n";
  fs.writeFileSync(path.join(DIR, EXCERPT_FILE), text);
  const entry = { id: "filing-excerpts-10k-2022", file: EXCERPT_FILE, builtFrom: source.file, builtFromSha256: source.sha256, bytes: Buffer.byteLength(text), sha256: sha256(Buffer.from(text)) };
  manifest.derived = [...(manifest.derived ?? []).filter((d) => d.id !== entry.id), entry];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`  wrote ${EXCERPT_FILE}: pages ${EXCERPT_PAGES.join(", ")}`);
}

// ---------------------------------------------------------------------------------------------
// Public-data group

export const CONFIG_FILE = "public-data-config.json";
const slug = sourceSlug;

/** The public-data sources named by the config, each with its licence and terms text. */
export function publicDataSources(config) {
  const terms = (key) => ({ licence: config.terms[key].licence, terms: config.terms[key].terms, termsUrl: config.terms[key].url });
  return [
    ...config.cfpb.companies.flatMap((c) => c.strings.map((s) => ({ id: `cfpb-${slug(s)}`, url: `${config.cfpb.api}?company=${encodeURIComponent(s)}&size=10000&no_aggs=true`, file: `raw/local/cfpb-${slug(s)}.json`, committed: false, ...terms("cfpb"), check: (buf) => complaintRecords(JSON.parse(buf.toString("utf8")), s) }))),
    ...config.edgar.filers.map((f) => ({ id: `sec-companyfacts-${f.cik}`, url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(f.cik).padStart(10, "0")}.json`, file: `raw/sec-companyfacts-${f.cik}.json`, committed: true, ...terms("sec"), check: (buf) => checkCompanyFacts(JSON.parse(buf.toString("utf8")), f.cik) })),
    ...config.fred.series.map((s) => ({ id: `fred-${s.id}`, url: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${s.id}`, file: `raw/fred-${s.id}.csv`, committed: true, ...terms("fred"), check: (buf) => fredRows(buf.toString("utf8"), s.id) })),
    ...config.court.documents.map((d) => ({ id: `court-${d.id}`, url: d.url, file: d.file, committed: false, ...terms("sec"), check: (buf) => { if (!buf.toString("utf8").includes(config.court.caseNumber)) throw new Error(`${d.url}: case number ${config.court.caseNumber} not found`); } }))
  ];
}

async function fetchPublicData(userAgent, config) {
  fs.mkdirSync(path.join(RAW, "local"), { recursive: true });
  const entries = [];
  let last = 0;
  for (const s of publicDataSources(config)) {
    const wait = last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(s.url, { headers: { "User-Agent": userAgentFor(s.url, userAgent), "Accept-Encoding": "gzip, deflate" } });
    if (res.status !== 200) throw new Error(`${s.url} returned HTTP ${res.status}; stopping without writing anything further`);
    const buf = Buffer.from(await res.arrayBuffer());
    s.check(buf); // content check before the bytes are saved
    fs.writeFileSync(path.join(DIR, s.file), buf);
    const { check: _check, ...entry } = s;
    entries.push({ ...entry, bytes: buf.length, sha256: sha256(buf), retrievedAt: new Date().toISOString(), contentType: res.headers.get("content-type") });
    console.log(`  fetched ${s.id}: ${buf.length.toLocaleString("en-US")} bytes`);
  }
  return entries;
}

/** Bytes of a public-data raw file, checked against its manifest hash; null when a local-only file is absent. */
function publicRaw(sources, id) {
  const s = sources.find((x) => x.id === id);
  const file = path.join(DIR, s.file);
  if (!fs.existsSync(file)) {
    if (s.committed) throw new Error(`${s.file} is committed but missing`);
    return null;
  }
  const buf = fs.readFileSync(file);
  if (sha256(buf) !== s.sha256) throw new Error(`${s.file} does not match its manifest hash`);
  return buf;
}

function buildPublicData(manifest) {
  const config = JSON.parse(readText(CONFIG_FILE));
  const { sources } = manifest.publicData;
  const derived = new Map((manifest.publicData.derived ?? []).map((d) => [d.id, d]));
  const write = (id, file, obj, builtFrom) => {
    const text = JSON.stringify(obj, null, 2) + "\n";
    fs.writeFileSync(path.join(DIR, file), text);
    derived.set(id, { id, file, builtFrom, bytes: Buffer.byteLength(text), sha256: sha256(Buffer.from(text)) });
    console.log(`  wrote ${file}`);
  };
  const ids = (prefix) => sources.filter((s) => s.id.startsWith(prefix)).map((s) => s.id);
  const text = (id) => publicRaw(sources, id)?.toString("utf8") ?? null;

  const facts = Object.fromEntries(config.edgar.filers.map((f) => [f.cik, JSON.parse(text(`sec-companyfacts-${f.cik}`))]));
  write("peers-quarterly", PEERS_FILE, peersFile(facts, config, sources), ids("sec-companyfacts-"));
  write("macro-credit", MACRO_FILE, macroFile(Object.fromEntries(config.fred.series.map((s) => [s.id, text(`fred-${s.id}`)])), config, sources), ids("fred-"));

  const complaints = Object.fromEntries(sources.filter((s) => s.id.startsWith("cfpb-")).map((s) => [s.id, text(s.id)]));
  if (Object.values(complaints).every((t) => t !== null)) {
    const byString = {};
    for (const c of config.cfpb.companies) for (const s of c.strings) byString[s] = JSON.parse(complaints[`cfpb-${slug(s)}`]);
    write("cfpb-complaints", CFPB_FILE, complaintsFile(byString, config, sources), ids("cfpb-"));
  } else console.log(`  ${CFPB_FILE}: raw complaint files not present locally, kept as committed`);

  const court = Object.fromEntries(config.court.documents.map((d) => [d.id, text(`court-${d.id}`)]));
  if (Object.values(court).every((t) => t !== null)) write("filing-excerpts-court", COURT_EXCERPT_FILE, courtExcerptFile(court, config, sources), ids("court-"));
  else console.log(`  ${COURT_EXCERPT_FILE}: court documents not present locally, kept as committed`);

  manifest.publicData.derived = [...derived.values()];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("  wrote manifest.json (publicData only)");
}

function requireSecUserAgent() {
  const userAgent = process.env.SEC_USER_AGENT?.trim();
  if (!userAgent) {
    console.error([
      "SEC_USER_AGENT is not set.",
      "SEC asks every automated client to declare who it is, with a contact email, in the User-Agent header.",
      'Set it for this one command, for example: SEC_USER_AGENT="Organisation Name <contact email>" node scripts/fetch-public-record.mjs',
      "The email is never written to the repository; the manifest records it masked."
    ].join("\n"));
    process.exit(2);
  }
  if (!/@/.test(userAgent)) {
    console.error("SEC_USER_AGENT must include a contact email address (SEC fair-access policy).");
    process.exit(2);
  }
  return userAgent;
}

const normaliseOnly = process.argv.includes("--normalise-only");
const manifestPath = path.join(DIR, "manifest.json");
const groupAt = process.argv.indexOf("--group");
const group = groupAt >= 0 ? process.argv[groupAt + 1] : null;

if (group !== null && group !== "public-data") {
  console.error(`Unknown group "${group}". The only group is public-data.`);
  process.exit(2);
} else if (group === "public-data") {
  if (!fs.existsSync(manifestPath)) {
    console.error("No manifest.json yet. Run the case-study fetch first.");
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (normaliseOnly) {
    if (!manifest.publicData) {
      console.error("The manifest has no publicData list yet. Run the public-data fetch once with SEC_USER_AGENT set.");
      process.exit(2);
    }
    buildPublicData(manifest);
  } else {
    const userAgent = requireSecUserAgent();
    console.log("fetching public-data snapshots");
    const sources = await fetchPublicData(userAgent, JSON.parse(readText(CONFIG_FILE)));
    manifest.publicData = { generatedAt: new Date().toISOString(), userAgent: redactEmails(userAgent), sources, derived: manifest.publicData?.derived ?? [] };
    buildPublicData(manifest);
  }
} else if (normaliseOnly) {
  if (!fs.existsSync(manifestPath)) {
    console.error("No manifest.json yet. Run the fetch once with SEC_USER_AGENT set.");
    process.exit(2);
  }
  build(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
} else {
  const userAgent = requireSecUserAgent();
  console.log("fetching public-record snapshots");
  const sources = await fetchAll(userAgent);
  // The public-data group's list is kept; a case-study fetch never touches it.
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
  const manifest = { generatedAt: new Date().toISOString(), userAgent: redactEmails(userAgent), sources, ...(previous.derived ? { derived: previous.derived } : {}), ...(previous.publicData ? { publicData: previous.publicData } : {}) };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("  wrote manifest.json");
  build(manifest);
}

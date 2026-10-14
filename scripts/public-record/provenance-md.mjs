// scripts/public-record/provenance-md.mjs — Writes the "Public record: data provenance" section of
// README.md from the same snapshot and notes the app's provenance panel reads, so the two agree.
//
//   node scripts/public-record/provenance-md.mjs           # print the section
//   node scripts/public-record/provenance-md.mjs --write   # replace it in README.md
//   node scripts/public-record/provenance-md.mjs --check   # exit 1 if README.md is out of date

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_RECORD_NOTES as notes } from "../../src/profiles/sunlight/publicRecordNotes.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = path.join(ROOT, "data", "public-record");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
const START = "<!-- public-record:start -->", END = "<!-- public-record:end -->";

export function provenanceMarkdown() {
  const manifest = read("manifest.json");
  const { quarters, gaps, eda, reconciliation } = read("sunlight-quarterly.json");
  const q = (c) => `${c.slice(4)} ${c.slice(0, 4)}`;
  const n = (v) => v.toLocaleString("en-US");
  const lines = [];
  lines.push(START, "_Generated from `data/public-record/` by `node scripts/public-record/provenance-md.mjs --write`. Do not edit by hand._", "");
  lines.push(`**Company:** ${notes.company}. ${notes.basisNote}`, "");
  lines.push("**How the data was obtained.** `scripts/fetch-public-record.mjs` was run once by hand, never in CI. It made at most four requests a second and stopped on any non-200 response.",
    `- Run on ${manifest.generatedAt.slice(0, 10)} with the User-Agent \`${manifest.userAgent}\`. The contact email is masked in every committed file.`,
    "- The browser never calls SEC or FRED; the app reads only the committed snapshot.", "");
  lines.push("| Source | Endpoint | Retrieved (UTC) | SHA-256 | Bytes | In repository |", "|---|---|---|---|---|---|");
  for (const s of manifest.sources) lines.push(`| ${s.id} | ${s.url} | ${s.retrievedAt.replace("T", " ").slice(0, 19)} | \`${s.sha256}\` | ${n(s.bytes)} | ${s.committed ? "yes" : "no (hash recorded)"} |`);
  lines.push("", `- **XBRL:** ${notes.origins.xbrl}`, `- **Manual extraction:** ${notes.origins.manual}`, `- **FRED:** ${notes.origins.fred}`, "");

  lines.push("**Before EDA.**",
    `- **XBRL company facts:** ${eda.xbrl.conceptCount} concepts and ${n(eda.xbrl.factCount)} facts from ${eda.xbrl.filings.length} filings.`,
    `- **Excluded:** ${eda.xbrl.excludedFilings.length} of those filings are the SPAC's own pre-merger reports (${eda.xbrl.excludedFilings.join(", ")}).`,
    "- **Duplicates:** most periods are reported more than once, because the same period appears again as a comparative in later 10-Qs and in the 10-K.",
    `- **FRED:** DFF has ${n(eda.fred.DFF.observations)} daily observations (${eda.fred.DFF.firstDate} to ${eda.fred.DFF.lastDate}, ${eda.fred.DFF.missingMarkedDot} missing). DGS10 has ${n(eda.fred.DGS10.observations)} (${eda.fred.DGS10.firstDate} to ${eda.fred.DGS10.lastDate}, ${eda.fred.DGS10.missingMarkedDot} days marked missing).`, "");
  lines.push("| Metric | Concept | Raw facts | Pre-merger excluded | Duplicates in one filing | Duplicates across filings | Kept |", "|---|---|---|---|---|---|---|");
  for (const [metric, d] of Object.entries(eda.dedupe)) lines.push(`| ${metric} | ${d.concept} | ${d.rawFacts} | ${d.excludedPreMergerRegistrant} | ${d.removedSameFiling} | ${d.removedAcrossFilings} | ${d.keptFacts} |`);
  const allGaps = [...gaps, ...notes.declaredGaps];
  lines.push("", `**Gaps (${allGaps.length}).** None was filled with an estimate.`, "");
  const byMetric = new Map();
  for (const g of allGaps) byMetric.set(g.metric, [...(byMetric.get(g.metric) ?? []), g]);
  for (const [metric, list] of byMetric) lines.push(`- ${metric}: ${list.map((g) => (g.quarter === "all" ? `all quarters (${g.detail})` : q(g.quarter))).join(", ")}`);
  lines.push("");

  lines.push("**After EDA.**",
    `- **Table:** ${quarters.length} quarterly rows (${q(quarters[0].quarter)} to ${q(quarters.at(-1).quarter)}).`,
    "- **Deduplication:** facts are deduplicated by (concept, period start, period end, form, fiscal period), keeping the latest filed. Then they are deduplicated by (concept, period start, period end) across filings, again keeping the latest filed.",
    "- **Derived quarters:** a quarter not filed on its own is derived as year-to-date minus the previous year-to-date (Q4 = full year minus nine months). It is marked derived and cites both filings. No derivation crosses the July 2021 Predecessor/Successor break.",
    "- **FRED:** each series is the simple mean of the daily observations dated in the quarter.",
    "- **Restatements:** manual figures use each quarter's own 10-Q or 10-K, and later restatements are listed with the value.", "");
  for (const b of notes.breaks) lines.push(`- **Presentation break, ${b.metric}, ${q(b.quarter)}:** ${b.note}`);
  lines.push("", "| Quarter | Reported | Derived | Stubs | Missing |", "|---|---|---|---|---|");
  for (const c of eda.coverage) lines.push(`| ${q(c.quarter)} | ${c.reported} | ${c.derived} | ${c.stubs} | ${c.missing} |`);
  lines.push("", "**Reconciliation.** The sum of each window's quarters is compared with the filed year-to-date figure, within $0.1M. A window that includes a derived quarter matches by construction and is marked as not independent.", "");
  lines.push("| Metric | Source | Window | Result | Difference | Check |", "|---|---|---|---|---|---|");
  for (const r of reconciliation) lines.push(`| ${r.metric} | ${r.source} | ${r.window} | ${r.status} | ${r.difference === undefined ? "—" : `${n(r.difference)} ${r.unit}`} | ${r.independent === undefined ? "—" : r.independent ? "independent" : "not independent"} |`);
  lines.push("", "**What the data cannot support:** " + notes.cannotSupport.join("; ") + ".", END);
  return lines.join("\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const md = provenanceMarkdown();
  const readmePath = path.join(ROOT, "README.md");
  const readme = fs.readFileSync(readmePath, "utf8");
  const has = readme.includes(START) && readme.includes(END);
  const current = has ? readme.slice(readme.indexOf(START), readme.indexOf(END) + END.length) : null;
  if (process.argv.includes("--check")) {
    if (current !== md) { console.error("README public-record provenance section is out of date. Run with --write."); process.exit(1); }
    console.log("README public-record provenance section is up to date.");
  } else if (process.argv.includes("--write")) {
    if (!has) { console.error(`README.md has no ${START} … ${END} markers.`); process.exit(2); }
    fs.writeFileSync(readmePath, readme.replace(current, md));
    console.log("README public-record provenance section written.");
  } else console.log(md);
}

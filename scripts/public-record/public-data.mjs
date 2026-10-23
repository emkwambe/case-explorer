// scripts/public-record/public-data.mjs — Builders for the public-data group (Sprint 8.5): peer
// lender XBRL quarters, complaint counts, FRED credit-conditions series and the court-filing page
// excerpt. Pure functions over the saved raw files; names, CIKs and company strings come from
// data/public-record/public-data-config.json.
//
// Rules carried over from normalise.mjs: only figures that appear in a source are used; a missing
// figure is listed as a gap, never estimated or interpolated. Dates are compared and bucketed as
// `YYYY-MM-DD` strings; nothing is computed in local time.

import { XBRL_METRICS, dedupeFacts, usdFacts, durationSeries, instantSeries, quarterInfo } from "./normalise.mjs";

export const PEERS_FILE = "peers-quarterly.json";
export const CFPB_FILE = "cfpb-complaints.json";
export const MACRO_FILE = "macro-credit.json";
export const COURT_EXCERPT_FILE = "filing-excerpts-court.json";
export const COURT_FACTS_FILE = "court-filings.json";

const pad = (n) => String(n).padStart(2, "0");

/** File-name and source-id form of a company string ("Example Lending, LLC" → "example-lending-llc"). */
export const sourceSlug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Quarter code ("2022Q3") of a `YYYY-MM-DD` date string. */
export const quarterOf = (date) => `${date.slice(0, 4)}Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;

/** Quarter codes from `from` to `to` inclusive. */
export function quarterCodes(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4)), q = Number(from.slice(5));
  while (`${y}Q${q}` <= to && out.length < 400) {
    out.push(`${y}Q${q}`);
    if (++q === 5) { q = 1; y++; }
  }
  return out;
}

/** Month codes ("2022-03") from `from` to `to` inclusive. */
export function monthCodes(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  while (`${y}-${pad(m)}` <= to && out.length < 1200) {
    out.push(`${y}-${pad(m)}`);
    if (++m === 13) { m = 1; y++; }
  }
  return out;
}

/** The month before a month code. */
export function previousMonth(month) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

const byCountThenKey = (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const tally = (values) => {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort(byCountThenKey).map(([key, count]) => ({ key, count }));
};
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// ---------------------------------------------------------------------------------------------
// Peer lenders (SEC XBRL company facts)

/** Fact reference for a filer: the case-study fields without the Predecessor/Successor basis, plus the CIK. */
const peerRef = (cik) => (concept, f, extra = {}) => ({ value: f.val, unit: f.unit, concept, accn: f.accn, form: f.form, filed: f.filed, fy: f.fy, fp: f.fp, start: f.start ?? null, end: f.end, source: "xbrl", cik, ...extra });

/** Content check for a saved company-facts file. */
export function checkCompanyFacts(cf, cik) {
  if (!cf || typeof cf.facts !== "object" || Number(cf.cik) !== Number(cik) || !cf.entityName) throw new Error(`company facts for CIK ${cik}: not an SEC company-facts document for that CIK`);
}

/**
 * The latest calendar quarter for which the filer reports total assets at the quarter end, from a
 * 10-Q or 10-K. Quarters after it are outside the filer's window, not gaps.
 */
export function latestFiledQuarter(cf) {
  const ends = (usdFacts(cf, "Assets") ?? []).filter((f) => /^10-[QK]/.test(f.form)).map((f) => f.end).filter((e) => quarterInfo(quarterOf(e)).end === e);
  return ends.length ? quarterOf(ends.sort().at(-1)) : null;
}

/** Periodic reports: the only forms a filer's figures are taken from (proxy statements and other forms are excluded). */
export const PERIODIC_FORM = /^10-[QK](\/A)?$/;

/**
 * Periods where the latest-filed value is zero but an earlier periodic report filed a non-zero value
 * for the same period. Such a zero is treated as a disagreement between filings, not a restatement:
 * the period is left as a gap and both values are recorded.
 */
export function zeroConflicts(facts, kept) {
  const out = [];
  for (const k of kept) {
    if (k.val !== 0) continue;
    const earlier = facts.filter((f) => f.end === k.end && (f.start ?? null) === (k.start ?? null) && f.val !== 0 && f.filed < k.filed).sort((a, b) => (a.filed < b.filed ? -1 : 1))[0];
    if (earlier) out.push({ start: k.start ?? null, end: k.end, earlier: { value: earlier.val, form: earlier.form, filed: earlier.filed, accn: earlier.accn }, later: { value: k.val, form: k.form, filed: k.filed, accn: k.accn } });
  }
  return out;
}

/** One filer's quarterly table, gaps and EDA, over `windowStart` to its latest filed quarter. */
export function peerFiler(cf, filer, { windowStart, metrics }) {
  checkCompanyFacts(cf, filer.cik);
  const latest = latestFiledQuarter(cf);
  const quarters = latest ? quarterCodes(windowStart, latest) : [];
  const rows = Object.fromEntries(quarters.map((q) => [q, { quarter: q, periodEnd: quarterInfo(q).end, metrics: {} }]));
  const gaps = [], dedupe = {};
  const ref = peerRef(filer.cik);
  for (const metric of metrics) {
    const spec = XBRL_METRICS[metric];
    const concept = spec.concepts.find((c) => usdFacts(cf, c));
    if (!concept) {
      gaps.push({ metric, quarter: "all", detail: `None of ${spec.concepts.join(", ")} is reported` });
      for (const q of quarters) rows[q].metrics[metric] = null;
      dedupe[metric] = { concept: null, rawFacts: 0, keptFacts: 0 };
      continue;
    }
    const all = usdFacts(cf, concept);
    const periodic = all.filter((f) => PERIODIC_FORM.test(f.form));
    const deduped = dedupeFacts(periodic);
    const conflicts = zeroConflicts(periodic, deduped.kept);
    const conflicted = new Set(conflicts.map((c) => `${c.start ?? ""}|${c.end}`));
    const kept = deduped.kept.filter((f) => !conflicted.has(`${f.start ?? ""}|${f.end}`));
    dedupe[metric] = {
      concept, rawFacts: all.length, excludedNonPeriodicForms: all.length - periodic.length,
      removedSameFiling: deduped.removedStage1, removedAcrossFilings: deduped.removedStage2, periodsReportedMoreThanOnce: deduped.periodsReportedMoreThanOnce,
      filingsDisagree: conflicts, keptFacts: kept.length, otherConceptsReported: spec.concepts.filter((c) => c !== concept && usdFacts(cf, c))
    };
    const { out, gaps: g } = spec.kind === "instant" ? instantSeries(concept, kept, { quarters, ref }) : durationSeries(concept, kept, { quarters, fyStartMonth: filer.fiscalYearStartMonth, ref });
    for (const q of quarters) rows[q].metrics[metric] = out[q];
    // A gap caused by a disagreement says so, with both filed values.
    const why = (quarter) => conflicts.filter((c) => quarterOf(c.end) === quarter).map((c) => `filings disagree for ${c.start ? `${c.start} to ` : ""}${c.end}: ${c.earlier.value.toLocaleString("en-US")} in the ${c.earlier.form} filed ${c.earlier.filed}, 0 in the ${c.later.form} filed ${c.later.filed}; left as a gap`);
    gaps.push(...g.map((x) => { const d = why(x.quarter); return { metric, concept, ...x, ...(d.length ? { detail: `${x.detail}; ${d.join("; ")}` } : {}) }; }));
  }
  let conceptCount = 0, factCount = 0;
  for (const taxonomy of Object.values(cf.facts)) for (const c of Object.values(taxonomy)) { conceptCount++; for (const u of Object.values(c.units ?? {})) factCount += u.length; }
  const table = quarters.map((q) => rows[q]);
  const coverage = Object.fromEntries(metrics.map((m) => [m, {
    reported: table.filter((r) => r.metrics[m] && !r.metrics[m].derived).length,
    derived: table.filter((r) => r.metrics[m]?.derived).length,
    missing: table.filter((r) => r.metrics[m] === null).length
  }]));
  return {
    id: filer.id, label: filer.label, cik: filer.cik, entityName: cf.entityName, model: filer.model, fiscalYearStartMonth: filer.fiscalYearStartMonth,
    firstQuarter: quarters[0] ?? null, latestQuarter: latest, quarters: table, gaps,
    eda: { conceptCount, factCount, dedupe, coverage }
  };
}

/** The peers snapshot: every configured filer, with the raw hashes it was built from. */
export function peersFile(companyFactsByCik, config, sources) {
  const { edgar } = config;
  const filers = edgar.filers.map((f) => peerFiler(companyFactsByCik[f.cik], f, { windowStart: edgar.windowStart, metrics: edgar.metrics }));
  const latest = filers.map((f) => f.latestQuarter).filter(Boolean).sort().at(-1);
  return {
    builtFrom: { rawHashes: Object.fromEntries(sources.filter((s) => s.id.startsWith("sec-companyfacts-")).map((s) => [s.id, s.sha256])) },
    window: { from: edgar.windowStart, to: latest },
    caseStudyWindow: edgar.caseStudyWindow,
    method: "Same concept lists and two-stage deduplication as the case-study snapshot; one concept per metric per filer, so a series never mixes definitions. Only facts from periodic reports (10-K, 10-Q and their amendments) are used; facts from other forms, such as the rounded figures in proxy statements, are excluded. The latest-filed value is kept, so restatements are used, except that a later-filed zero contradicting an earlier non-zero value for the same period is a disagreement between filings: that period is a listed gap, with both values recorded. A discrete quarter not filed as such is year-to-date minus the previous year-to-date within the filer's fiscal year (marked derived, citing both facts). Calendar quarters are matched on period end dates. Quarters after a filer's latest filed quarter are outside its window; every gap inside it is listed and none is filled.",
    filers
  };
}

// ---------------------------------------------------------------------------------------------
// Complaint counts (CFPB Consumer Complaint Database)

/** Content check for one saved API response; returns its records. Fails when the response is truncated. */
export function complaintRecords(raw, companyString) {
  const hits = raw?.hits?.hits;
  if (!Array.isArray(hits)) throw new Error(`complaints for "${companyString}": not a complaint search response`);
  const total = raw.hits.total?.value;
  if (total !== hits.length) throw new Error(`complaints for "${companyString}": ${hits.length} records returned of ${total}; the response is truncated`);
  const records = hits.map((h) => h._source);
  for (const r of records) {
    if (r.company !== companyString) throw new Error(`complaints for "${companyString}": a record names "${r.company}"`);
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(r.date_received))) throw new Error(`complaints for "${companyString}": unreadable date_received ${r.date_received}`);
  }
  return records;
}

const NONE = "(not given)";
const field = (r, f) => (r[f] === null || r[f] === undefined || r[f] === "" ? NONE : String(r[f]));

/**
 * Complaint counts per configured company, by month and by category, over the window from
 * `windowStart` to the last complete month before retrieval (that month is marked provisional,
 * since complaints are published up to 15 days after receipt). Only the kept fields are read; a
 * date is bucketed by the first seven characters of date_received, never through a Date object.
 */
export function complaintsFile(rawByString, config, sources) {
  const { cfpb } = config;
  const cfpbSources = sources.filter((s) => s.id.startsWith("cfpb-"));
  const retrievedMonth = cfpbSources.map((s) => s.retrievedAt.slice(0, 7)).sort()[0];
  const to = previousMonth(retrievedMonth);
  const months = monthCodes(cfpb.windowStart, to);
  const companies = cfpb.companies.map((c) => {
    const byString = c.strings.map((s) => {
      const recs = complaintRecords(rawByString[s], s);
      const dates = recs.map((r) => String(r.date_received).slice(0, 10)).sort();
      return { string: s, records: recs, raw: { records: recs.length, first: dates[0] ?? null, last: dates.at(-1) ?? null } };
    });
    const all = byString.flatMap((b) => b.records.map((r) => ({ ...r, month: String(r.date_received).slice(0, 7) })));
    const inWindow = all.filter((r) => r.month >= cfpb.windowStart && r.month <= to);
    const missing = Object.fromEntries(cfpb.keptFields.map((f) => [f, all.filter((r) => field(r, f) === NONE).length]));
    const eda = {
      strings: byString.map((b) => ({ string: b.string, ...b.raw })),
      rawRecords: all.length,
      beforeWindow: all.filter((r) => r.month < cfpb.windowStart).length,
      afterWindow: all.filter((r) => r.month > to).length,
      missingInKeptFields: missing
    };
    const base = { id: c.id, label: c.label, role: c.role, strings: c.strings, ...(c.switch ? { switch: c.switch } : {}), total: inWindow.length, eda };
    if (c.totalOnly) {
      const d = inWindow.map((r) => String(r.date_received).slice(0, 10)).sort();
      return { ...base, totalOnly: true, firstInWindow: d[0] ?? null, lastInWindow: d.at(-1) ?? null };
    }
    const perMonth = new Map(months.map((m) => [m, 0]));
    for (const r of inWindow) perMonth.set(r.month, perMonth.get(r.month) + 1);
    const monthly = months.map((m) => ({ month: m, count: perMonth.get(m), ...(m === to ? { provisional: true } : {}) }));
    const active = monthly.filter((m) => m.count > 0).map((m) => m.count);
    const cells = new Map();
    for (const r of inWindow) { const k = `${r.month}\u0000${field(r, "issue")}`; cells.set(k, (cells.get(k) ?? 0) + 1); }
    const monthlyByIssue = [...cells.entries()].map(([k, count]) => { const [month, issue] = k.split("\u0000"); return { month, issue, count }; })
      .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : 0));
    return {
      ...base,
      monthly,
      sparsity: { months: months.length, monthsWithComplaints: active.length, monthsWithAtMostTwo: monthly.filter((m) => m.count <= 2).length, medianInMonthsWithComplaints: median(active), max: active.length ? Math.max(...active) : 0 },
      byIssue: tally(inWindow.map((r) => field(r, "issue"))),
      bySubIssue: tally(inWindow.map((r) => field(r, "sub_issue"))),
      byProduct: tally(inWindow.map((r) => field(r, "product"))),
      bySubProduct: tally(inWindow.map((r) => field(r, "sub_product"))),
      byState: tally(inWindow.map((r) => field(r, "state"))),
      byResponse: tally(inWindow.map((r) => field(r, "company_response"))),
      byTimely: tally(inWindow.map((r) => field(r, "timely"))),
      byString: tally(inWindow.map((r) => r.company)),
      monthlyByIssue
    };
  });
  return {
    builtFrom: { rawHashes: Object.fromEntries(cfpbSources.map((s) => [s.id, s.sha256])) },
    window: { from: cfpb.windowStart, to, provisionalMonth: to },
    keptFields: cfpb.keptFields,
    droppedFields: cfpb.droppedFields,
    method: `Counts only. Each company string is downloaded whole; the response must contain every record it reports. Records are counted by the first seven characters of date_received (the date the CFPB received the complaint, as in the database's CSV export). Months with no complaints count as zero. A missing category value is counted as "${NONE}". Category names are the database's own; the product names changed during the window and are not merged. monthlyByIssue lists only non-zero cells. No narrative, ZIP code, tag, complaint ID or other free text is stored.`,
    companies
  };
}

// ---------------------------------------------------------------------------------------------
// Credit conditions (FRED)

/** Content check and parse of a FRED graph CSV: header `observation_date,<ID>`, empty or "." for a missing value. */
export function fredRows(text, id) {
  const lines = text.trim().split(/\r?\n/);
  if (lines[0] !== `observation_date,${id}`) throw new Error(`fred-${id}: header is "${lines[0]}", expected "observation_date,${id}"`);
  return lines.slice(1).map((line) => {
    const [date, raw] = line.split(",");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`fred-${id}: bad date "${date}"`);
    return { date, value: raw === "" || raw === "." || raw === undefined ? null : Number(raw) };
  });
}

/** The credit-conditions snapshot: each series from `windowStart`, missing observations listed, not filled. */
export function macroFile(csvById, config, sources) {
  const { fred } = config;
  return {
    builtFrom: { rawHashes: Object.fromEntries(sources.filter((s) => s.id.startsWith("fred-")).map((s) => [s.id, s.sha256])) },
    window: { from: fred.windowStart },
    method: "Observations as FRED lists them, from the window start to the latest value. FRED dates a quarterly observation at the first day of the quarter, so the period is the quarter code; a monthly observation's period is its month. A missing observation is listed and left empty; nothing is interpolated.",
    series: fred.series.map((s) => {
      const source = sources.find((x) => x.id === `fred-${s.id}`);
      const rows = fredRows(csvById[s.id], s.id);
      const present = rows.filter((r) => r.value !== null);
      const inWindow = rows.filter((r) => r.date >= fred.windowStart);
      const period = (d) => (s.frequency === "quarterly" ? quarterOf(d) : d.slice(0, 7));
      return {
        id: s.id, title: s.title, units: s.units, frequency: s.frequency, owner: s.owner, url: `https://fred.stlouisfed.org/series/${s.id}`,
        builtFrom: { file: source.file, sha256: source.sha256, retrievedAt: source.retrievedAt },
        raw: { rows: rows.length, first: rows[0]?.date ?? null, last: rows.at(-1)?.date ?? null, missing: rows.filter((r) => r.value === null).map((r) => r.date), latestValue: present.at(-1) ?? null },
        missingInWindow: inWindow.filter((r) => r.value === null).map((r) => ({ date: r.date, period: period(r.date) })),
        observations: inWindow.map((r) => ({ date: r.date, period: period(r.date), value: r.value }))
      };
    })
  };
}

// ---------------------------------------------------------------------------------------------
// Court filings (EDGAR-hosted exhibits): page text for the cited pages

const NAMED = { nbsp: " ", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", sect: "§", amp: "&", ndash: "–", mdash: "—", lrm: "", rlm: "", quot: '"', apos: "'", lt: "<", gt: ">" };

/**
 * Plain text of court-exhibit HTML, separate from filingText (which the 10-K excerpt depends on):
 * comments and tags dropped; named, decimal and hex entities decoded; non-breaking and narrow
 * spaces made plain; whitespace collapsed; the space that tag boundaries leave inside curly
 * quotation marks and before closing punctuation removed. Curly quotes and apostrophes are kept.
 */
export function courtText(html) {
  return html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/[    ]/g, " ").replace(/[‎‏]/g, "")
    .replace(/\s+/g, " ").replace(/“ /g, "“").replace(/ ”/g, "”").replace(/ ([,.;:)])/g, "$1").trim();
}

/**
 * Pages of a court exhibit with their printed numbers. "footer-field": pages end at the filer's
 * page-number field (`<!-- Field: Page … Name: PageNo -->N…<!-- Field: /Page -->`). "ecf-stamp":
 * pages are separated by page breaks and numbered by the court's stamp "Page N of M".
 */
export function courtPages(html, marker) {
  if (marker === "footer-field") {
    const pages = [];
    let last = 0;
    for (const m of html.matchAll(/<!-- Field: Page;[\s\S]*?Name: PageNo -->([^<]*)<!-- Field: \/Sequence -->[\s\S]*?<!-- Field: \/Page -->/g)) {
      pages.push({ page: m[1].trim(), text: courtText(html.slice(last, m.index)) });
      last = m.index + m[0].length;
    }
    return pages;
  }
  if (marker === "ecf-stamp") {
    return html.split(/<div[^>]*page-break-after:\s*always;?[^>]*>/i).map((p) => {
      const text = courtText(p);
      return { page: text.match(/ Page (\d+) of \d+/)?.[1] ?? null, text };
    });
  }
  throw new Error(`unknown page marker "${marker}"`);
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** The committed excerpt: only the configured pages of each document, with the hash of the file they come from. */
export function courtExcerptFile(htmlById, config, sources) {
  const { court } = config;
  return {
    case: court.case,
    method: "Each cited page's text: comments and tags removed, entities decoded, spacing collapsed, curly quotation marks kept. Plan pages are numbered by the filer's printed page footer; Dkt. 95 pages by the court's ECF stamp. Only the cited pages are kept, and none of them contains an email address.",
    documents: court.documents.map((d) => {
      const html = htmlById[d.id];
      if (!html.includes(court.caseNumber)) throw new Error(`${d.id}: case number ${court.caseNumber} not found`);
      const source = sources.find((s) => s.id === `court-${d.id}`);
      const all = courtPages(html, d.pageMarker);
      return {
        id: d.id, short: d.short, title: d.title, exhibit: d.exhibit, url: d.url,
        builtFrom: { file: source.file, sha256: source.sha256 },
        pages: d.pages.map((n) => {
          const found = all.filter((p) => p.page === n);
          if (found.length !== 1) throw new Error(`${d.id}: page ${n} found ${found.length} times`);
          if (EMAIL.test(found[0].text)) throw new Error(`${d.id}: page ${n} contains an email address`);
          return found[0];
        })
      };
    })
  };
}

// scripts/public-record/normalise.mjs — Turns the pinned raw snapshots (SEC XBRL company facts,
// FRED daily series) and the hand-typed manual extractions into one quarterly table.
//
// Rules:
//   * Only figures that appear in a source are used. A figure that is not there is listed as a
//     gap; nothing is estimated.
//   * The only arithmetic on filed figures is the quarter derivation the project owner approved:
//     a discrete quarter = year-to-date to quarter end − year-to-date to the previous quarter end
//     (Q4 = full year − nine months). Every derived value is marked `derived` and cites each input.
//   * Periods never combine across the July 9 / July 10, 2021 Predecessor/Successor break. The
//     third quarter of 2021 is kept as two labelled stubs.

export const QUARTERS = ["2021Q1", "2021Q2", "2021Q3", "2021Q4", "2022Q1", "2022Q2", "2022Q3", "2022Q4", "2023Q1", "2023Q2"];
export const BREAK = { predecessorEnd: "2021-07-09", successorStart: "2021-07-10" };

// Concepts per metric, in order of preference. A metric uses the first concept that has any facts,
// and only that concept, so a series never mixes definitions.
export const XBRL_METRICS = {
  cash: { kind: "instant", concepts: ["CashAndCashEquivalentsAtCarryingValue", "Cash"] },
  totalAssets: { kind: "instant", concepts: ["Assets"] },
  totalLiabilities: { kind: "instant", concepts: ["Liabilities"] },
  // Total book equity, including non-controlling interest where the filer reports it.
  equity: { kind: "instant", concepts: ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "StockholdersEquity", "MembersEquity"] },
  retainedEarnings: { kind: "instant", concepts: ["RetainedEarningsAccumulatedDeficit"] },
  currentAssets: { kind: "instant", concepts: ["AssetsCurrent"] },
  currentLiabilities: { kind: "instant", concepts: ["LiabilitiesCurrent"] },
  debt: { kind: "instant", concepts: ["LongTermDebt", "LineOfCredit", "DebtInstrumentCarryingAmount", "NotesPayable"] },
  revenue: { kind: "duration", concepts: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"] },
  netIncome: { kind: "duration", concepts: ["NetIncomeLoss", "ProfitLoss"] },
  operatingIncome: { kind: "duration", concepts: ["OperatingIncomeLoss"] },
  operatingCashFlow: { kind: "duration", concepts: ["NetCashProvidedByUsedInOperatingActivities"] }
};

export const FRED_SERIES = ["DFF", "DGS10"];

/**
 * Until the business combination closed on July 9, 2021, CIK 1821850 was the SPAC (Spartan
 * Acquisition Corp. II). Its own filings for periods before the merger (the FY2020 10-K and the
 * Q1 and Q2 2021 10-Qs) describe the shell company, not Sunlight's business, so their facts are
 * excluded. Sunlight's pre-merger (Predecessor) figures enter only as comparatives in the filings
 * made after the merger.
 */
export function isPreMergerRegistrantFact(f) {
  return f.fy < 2021 || (f.fy === 2021 && (f.fp === "Q1" || f.fp === "Q2"));
}

const pad = (n) => String(n).padStart(2, "0");

/** Calendar facts for a quarter code like "2022Q3". */
export function quarterInfo(code) {
  const year = Number(code.slice(0, 4)), q = Number(code.slice(5));
  const startMonth = (q - 1) * 3 + 1, endMonth = q * 3;
  const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return {
    code, year, q,
    start: `${year}-${pad(startMonth)}-01`,
    end: `${year}-${pad(endMonth)}-${pad(endDay)}`,
    yearStart: `${year}-01-01`,
    previousEnd: q === 1 ? null : quarterInfo(`${year}Q${q - 1}`).end
  };
}

/** Which side of the 2021 break a period falls on; "crosses" if it spans it. */
export function regime(start, end) {
  if (end <= BREAK.predecessorEnd) return "predecessor";
  if ((start ?? end) >= BREAK.successorStart) return "successor";
  return "crosses";
}

function factRef(concept, f, extra = {}) {
  const basis = f.end <= BREAK.predecessorEnd ? "Predecessor" : "Successor";
  return { value: f.val, unit: f.unit, concept, accn: f.accn, form: f.form, filed: f.filed, fy: f.fy, fp: f.fp, start: f.start ?? null, end: f.end, basis, source: "xbrl", ...extra };
}

/**
 * Two-stage deduplication of the raw facts of one concept:
 *   1. by (period start, period end, form, fiscal period), keeping the latest-filed value — the
 *      sprint rule, with the period start added so a 10-Q's three-month and year-to-date facts
 *      (same end, form and fiscal period) are not collapsed into one;
 *   2. by (period start, period end) across forms, keeping the latest-filed value, because the
 *      same period is reported again in later 10-Qs and the 10-K.
 * Returns the kept facts and how many duplicates each stage removed.
 */
export function dedupeFacts(facts) {
  const latest = (a, b) => (b.filed > a.filed || (b.filed === a.filed && b.accn > a.accn) ? b : a);
  const stage1 = new Map();
  for (const f of facts) {
    const k = `${f.start ?? ""}|${f.end}|${f.form}|${f.fp}`;
    stage1.set(k, stage1.has(k) ? latest(stage1.get(k), f) : f);
  }
  const stage2 = new Map();
  const reportedIn = new Map();
  for (const f of stage1.values()) {
    const k = `${f.start ?? ""}|${f.end}`;
    stage2.set(k, stage2.has(k) ? latest(stage2.get(k), f) : f);
    reportedIn.set(k, (reportedIn.get(k) ?? 0) + 1);
  }
  return {
    kept: [...stage2.values()],
    removedStage1: facts.length - stage1.size,
    removedStage2: stage1.size - stage2.size,
    periodsReportedMoreThanOnce: [...reportedIn.values()].filter((n) => n > 1).length
  };
}

/** USD facts of a concept, tagged with the unit. */
function usdFacts(companyfacts, concept) {
  for (const taxonomy of Object.keys(companyfacts.facts ?? {})) {
    const units = companyfacts.facts[taxonomy]?.[concept]?.units;
    if (units?.USD) return units.USD.map((f) => ({ ...f, unit: "USD" }));
  }
  return null;
}

/** Quarterly values for one duration metric, with YTD derivation and the 2021 stubs. */
function durationSeries(concept, facts) {
  const byPeriod = new Map(facts.map((f) => [`${f.start}|${f.end}`, f]));
  const get = (start, end) => byPeriod.get(`${start}|${end}`);
  const out = {}, gaps = [];
  for (const code of QUARTERS) {
    const qi = quarterInfo(code);
    if (code === "2021Q3") {
      const pred = get("2021-07-01", BREAK.predecessorEnd);
      const succ = get(BREAK.successorStart, qi.end);
      out[code] = {
        stubs: {
          predecessor: pred ? factRef(concept, pred, { label: "Predecessor, July 1–9, 2021" }) : null,
          successor: succ ? factRef(concept, succ, { label: "Successor, July 10–September 30, 2021" }) : null
        }
      };
      if (!pred) gaps.push({ quarter: code, detail: "Predecessor stub (July 1–9, 2021) not reported" });
      if (!succ) gaps.push({ quarter: code, detail: "Successor stub (July 10–September 30, 2021) not reported" });
      continue;
    }
    const direct = get(qi.start, qi.end);
    if (direct) { out[code] = factRef(concept, direct); continue; }
    // Year-to-date start: January 1, or the Successor start for the rest of 2021.
    const ytdStart = qi.year === 2021 && qi.q === 4 ? BREAK.successorStart : qi.yearStart;
    const prevEnd = qi.year === 2021 && qi.q === 4 ? "2021-09-30" : qi.previousEnd;
    const ytd = get(ytdStart, qi.end);
    const prevYtd = prevEnd ? get(ytdStart, prevEnd) : null;
    if (ytd && prevYtd && regime(ytdStart, qi.end) !== "crosses") {
      out[code] = {
        value: ytd.val - prevYtd.val, unit: "USD", concept, source: "xbrl", derived: true,
        method: `${ytdStart}–${qi.end} less ${ytdStart}–${prevEnd}`,
        start: qi.start, end: qi.end,
        inputs: [factRef(concept, ytd), factRef(concept, prevYtd)]
      };
    } else {
      out[code] = null;
      gaps.push({ quarter: code, detail: `No three-month fact, and no pair of year-to-date facts to derive it from (${ytdStart}–${qi.end} and ${ytdStart}–${prevEnd ?? "n/a"})` });
    }
  }
  return { out, gaps };
}

/** Quarterly values for one instant (balance-sheet) metric. */
function instantSeries(concept, facts) {
  const byEnd = new Map(facts.map((f) => [f.end, f]));
  const out = {}, gaps = [];
  for (const code of QUARTERS) {
    const f = byEnd.get(quarterInfo(code).end);
    out[code] = f ? factRef(concept, f) : null;
    if (!f) gaps.push({ quarter: code, detail: `No balance at ${quarterInfo(code).end}` });
  }
  return { out, gaps };
}

/** Parses a FRED graph CSV into daily observations; "." marks a missing day. */
export function parseFredCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = [];
  let missing = 0;
  for (const line of lines.slice(1)) {
    const [date, raw] = line.split(",");
    if (raw === "." || raw === "" || raw === undefined) { missing++; continue; }
    rows.push({ date, value: Number(raw) });
  }
  return { header, rows, missing };
}

/** Simple average of the daily observations dated inside each quarter. */
export function quarterAverages(rows) {
  const out = {};
  for (const code of QUARTERS) {
    const { start, end } = quarterInfo(code);
    const inside = rows.filter((r) => r.date >= start && r.date <= end);
    out[code] = inside.length ? { value: inside.reduce((s, r) => s + r.value, 0) / inside.length, observations: inside.length, unit: "percent" } : null;
  }
  return out;
}

const CSV_COLUMNS = ["quarter", "metric", "value", "unit", "document", "accession_or_url", "page_or_section", "quoted_label", "extracted_by", "extracted_on"];

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, commas inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((v) => v !== "")) rows.push(row); }
  return rows;
}

/**
 * Manual extractions. Period codes in the `quarter` column:
 *   2022Q1 … three months; 2022YTDQ2 / 2022YTDQ3 … year to date; 2022FY … full year;
 *   2021Q3-PRED / 2021Q3-SUCC … the 2021 stubs; 2021SUCC-YTDQ3 / 2021SUCC-FY … Successor periods
 *   from July 10, 2021. Rows missing a document, location or quoted label are errors.
 */
export function readManualExtractions(text) {
  const [header, ...body] = parseCsv(text);
  const errors = [];
  if (!header || header.join(",") !== CSV_COLUMNS.join(",")) errors.push(`Header must be: ${CSV_COLUMNS.join(",")}`);
  const rows = body.map((cells, i) => {
    const r = Object.fromEntries(CSV_COLUMNS.map((c, k) => [c, (cells[k] ?? "").trim()]));
    for (const c of ["quarter", "metric", "value", "unit", "document", "accession_or_url", "page_or_section", "quoted_label"]) {
      if (!r[c]) errors.push(`Row ${i + 2}: missing ${c}`);
    }
    if (r.value && !Number.isFinite(Number(r.value))) errors.push(`Row ${i + 2}: value is not a number`);
    return { ...r, value: Number(r.value), line: i + 2 };
  });
  return { rows, errors };
}

/** Accession number from a SEC archive URL (sortable: earlier filings sort first for one filer). */
export function accessionOf(row) {
  const m = row.accession_or_url.match(/\/(\d{10})(\d{2})(\d{6})\//);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : row.accession_or_url;
}

/**
 * Groups manual rows by period. The primary row is the earliest-filed one (the period's own 10-Q or
 * 10-K, or for 2021 the first filing that reports it); rows from later filings are kept as
 * restatement checks and flagged when the value differs.
 */
function groupByPeriod(rows) {
  const groups = new Map();
  for (const r of rows) groups.set(r.quarter, [...(groups.get(r.quarter) ?? []), r]);
  const primary = new Map();
  for (const [period, list] of groups) {
    const sorted = [...list].sort((a, b) => accessionOf(a).localeCompare(accessionOf(b)));
    primary.set(period, { ...sorted[0], restatements: sorted.slice(1).map((r) => ({ ...manualRef(r), differs: r.value !== sorted[0].value })) });
  }
  return primary;
}

function manualRef(r, extra = {}) {
  return {
    value: r.value, unit: r.unit, source: "manual", document: r.document, accession_or_url: r.accession_or_url,
    page_or_section: r.page_or_section, quoted_label: r.quoted_label, period: r.quarter, line: r.line, accession: accessionOf(r),
    ...(r.restatements?.length ? { restatements: r.restatements } : {}), ...extra
  };
}

/** Quarterly manual metrics: filed three-month rows first, then the approved Q4 / Q2 / Q3 derivations. */
function manualSeries(metric, rows) {
  const byPeriod = groupByPeriod(rows.filter((r) => r.metric === metric));
  const out = {}, gaps = [];
  for (const code of QUARTERS) {
    if (code === "2021Q3") {
      const pred = byPeriod.get("2021Q3-PRED"), succ = byPeriod.get("2021Q3-SUCC"), full = byPeriod.get("2021Q3");
      if (full) { out[code] = manualRef(full); continue; }
      out[code] = { stubs: { predecessor: pred ? manualRef(pred, { label: "Predecessor, July 1–9, 2021" }) : null, successor: succ ? manualRef(succ, { label: "Successor, July 10–September 30, 2021" }) : null } };
      if (!pred && !succ) gaps.push({ quarter: code, detail: "Not reported for the full quarter or for either stub" });
      continue;
    }
    const direct = byPeriod.get(code);
    if (direct) { out[code] = manualRef(direct); continue; }
    const { year, q } = quarterInfo(code);
    const succ2021 = year === 2021 && q === 4;
    const ytdCode = succ2021 ? "2021SUCC-FY" : q === 4 ? `${year}FY` : `${year}YTDQ${q}`;
    // For the Successor, year to date at September 30, 2021 is the July 10–September 30 stub itself.
    const prevCode = succ2021 ? "2021Q3-SUCC" : q === 2 ? `${year}Q1` : `${year}YTDQ${q - 1}`;
    const ytd = byPeriod.get(ytdCode), prev = byPeriod.get(prevCode) ?? (q === 2 ? byPeriod.get(`${year}YTDQ1`) : null);
    if (ytd && prev && ytd.unit === prev.unit) {
      out[code] = { value: ytd.value - prev.value, unit: ytd.unit, source: "manual", derived: true, method: `${ytdCode} less ${prev.quarter}`, inputs: [manualRef(ytd), manualRef(prev)] };
    } else {
      out[code] = null;
      gaps.push({ quarter: code, detail: `No three-month figure, and no ${ytdCode} and ${prevCode} pair to derive it from` });
    }
  }
  return { out, gaps };
}

/**
 * Reconciliation windows: the quarters inside a filed year-to-date period. The sum of the quarters
 * is compared with the filed year-to-date figure. A window counts as an independent check only if
 * every quarter in it is a filed figure; a sum that includes a derived quarter is listed as not
 * independent (it equals the year-to-date figure by construction).
 */
export const RECONCILIATION_WINDOWS = [
  { label: "2021 first half (Predecessor)", quarters: ["2021Q1", "2021Q2"], xbrl: ["2021-01-01", "2021-06-30"], manual: "2021YTDQ2" },
  { label: "2022 nine months", quarters: ["2022Q1", "2022Q2", "2022Q3"], xbrl: ["2022-01-01", "2022-09-30"], manual: "2022YTDQ3" },
  { label: "2022 full year", quarters: ["2022Q1", "2022Q2", "2022Q3", "2022Q4"], xbrl: ["2022-01-01", "2022-12-31"], manual: "2022FY" },
  { label: "2023 first half", quarters: ["2023Q1", "2023Q2"], xbrl: ["2023-01-01", "2023-06-30"], manual: "2023YTDQ2" }
];

function reconcileWindow(metric, source, window, quarters, filed) {
  if (!filed) return null;
  const parts = window.quarters.map((q) => ({ quarter: q, value: quarters[q]?.metrics[metric]?.value ?? null, derived: Boolean(quarters[q]?.metrics[metric]?.derived) }));
  if (parts.some((p) => p.value === null)) return { metric, source, window: window.label, status: "incomplete", parts, filed };
  const sum = parts.reduce((t, p) => t + p.value, 0);
  const tolerance = source === "manual" ? 100 : 100_000; // $0.1M in the metric's unit
  const difference = sum - filed.value;
  const independent = !parts.some((p) => p.derived);
  return { metric, source, window: window.label, parts, sum, filed, difference, tolerance, unit: filed.unit, independent, status: Math.abs(difference) <= tolerance ? "match" : "mismatch" };
}

/** Builds the normalised quarterly table, the gap list and the EDA statistics. */
export function normalise({ companyfacts, fred, manualCsv }) {
  const quarters = Object.fromEntries(QUARTERS.map((q) => [q, { quarter: q, periodEnd: quarterInfo(q).end, metrics: {} }]));
  const gaps = [];
  const eda = { xbrl: {}, fred: {}, manual: {}, dedupe: {} };

  // XBRL
  let conceptCount = 0, factCount = 0;
  for (const taxonomy of Object.keys(companyfacts.facts ?? {})) {
    for (const concept of Object.values(companyfacts.facts[taxonomy])) {
      conceptCount++;
      for (const unit of Object.values(concept.units ?? {})) factCount += unit.length;
    }
  }
  const filings = new Map();
  for (const taxonomy of Object.keys(companyfacts.facts ?? {})) {
    for (const concept of Object.values(companyfacts.facts[taxonomy])) {
      for (const unit of Object.values(concept.units ?? {})) for (const f of unit) filings.set(f.accn, { accn: f.accn, form: f.form, fy: f.fy, fp: f.fp, filed: f.filed, preMergerRegistrant: isPreMergerRegistrantFact(f) });
    }
  }
  eda.xbrl = {
    entityName: companyfacts.entityName, cik: companyfacts.cik, taxonomies: Object.keys(companyfacts.facts ?? {}), conceptCount, factCount,
    filings: [...filings.values()].sort((a, b) => a.filed.localeCompare(b.filed)),
    excludedFilings: [...filings.values()].filter((f) => f.preMergerRegistrant).map((f) => f.accn)
  };

  for (const [metric, spec] of Object.entries(XBRL_METRICS)) {
    const concept = spec.concepts.find((c) => usdFacts(companyfacts, c));
    if (!concept) {
      gaps.push({ metric, source: "xbrl", quarter: "all", detail: `None of ${spec.concepts.join(", ")} is reported` });
      for (const q of QUARTERS) quarters[q].metrics[metric] = null;
      continue;
    }
    const all = usdFacts(companyfacts, concept);
    const raw = all.filter((f) => !isPreMergerRegistrantFact(f));
    const { kept, removedStage1, removedStage2, periodsReportedMoreThanOnce } = dedupeFacts(raw);
    eda.dedupe[metric] = { concept, rawFacts: all.length, excludedPreMergerRegistrant: all.length - raw.length, removedSameFiling: removedStage1, removedAcrossFilings: removedStage2, periodsReportedMoreThanOnce, keptFacts: kept.length };
    const { out, gaps: g } = spec.kind === "instant" ? instantSeries(concept, kept) : durationSeries(concept, kept);
    for (const q of QUARTERS) quarters[q].metrics[metric] = out[q];
    gaps.push(...g.map((x) => ({ metric, source: "xbrl", concept, ...x })));
  }

  // FRED
  for (const id of FRED_SERIES) {
    const parsed = parseFredCsv(fred[id]);
    const avg = quarterAverages(parsed.rows);
    eda.fred[id] = { header: parsed.header, observations: parsed.rows.length, missingMarkedDot: parsed.missing, firstDate: parsed.rows[0]?.date, lastDate: parsed.rows.at(-1)?.date };
    for (const q of QUARTERS) {
      quarters[q].metrics[id] = avg[q] ? { ...avg[q], source: "fred", series: id, method: "simple average of daily observations in the quarter" } : null;
      if (!avg[q]) gaps.push({ metric: id, source: "fred", quarter: q, detail: "No observations in the quarter" });
    }
  }

  // Manual extractions
  if (manualCsv !== undefined && manualCsv !== null) {
    const { rows, errors } = readManualExtractions(manualCsv);
    if (errors.length) throw new Error(`manual-extractions.csv:\n${errors.join("\n")}`);
    const metrics = [...new Set(rows.map((r) => r.metric))];
    eda.manual = { rows: rows.length, metrics, documents: [...new Set(rows.map((r) => r.document))].length };
    for (const metric of metrics) {
      const { out, gaps: g } = manualSeries(metric, rows);
      for (const q of QUARTERS) quarters[q].metrics[metric] = out[q];
      gaps.push(...g.map((x) => ({ metric, source: "manual", ...x })));
    }
  }

  // Reconciliation of quarters against filed year-to-date figures.
  const reconciliation = [];
  for (const [metric, spec] of Object.entries(XBRL_METRICS)) {
    if (spec.kind !== "duration") continue;
    const concept = spec.concepts.find((c) => usdFacts(companyfacts, c));
    if (!concept) continue;
    const kept = dedupeFacts(usdFacts(companyfacts, concept).filter((f) => !isPreMergerRegistrantFact(f))).kept;
    for (const w of RECONCILIATION_WINDOWS) {
      const f = kept.find((k) => k.start === w.xbrl[0] && k.end === w.xbrl[1]);
      const r = reconcileWindow(metric, "xbrl", w, quarters, f ? factRef(concept, f) : null);
      if (r) reconciliation.push(r);
    }
  }
  if (manualCsv !== undefined && manualCsv !== null) {
    const { rows } = readManualExtractions(manualCsv);
    for (const metric of [...new Set(rows.map((r) => r.metric))]) {
      const byPeriod = groupByPeriod(rows.filter((r) => r.metric === metric));
      for (const w of RECONCILIATION_WINDOWS) {
        const row = byPeriod.get(w.manual);
        const r = reconcileWindow(metric, "manual", w, quarters, row ? manualRef(row) : null);
        if (r) reconciliation.push(r);
      }
    }
  }

  const table = QUARTERS.map((q) => quarters[q]);
  eda.coverage = table.map((row) => ({
    quarter: row.quarter,
    reported: Object.values(row.metrics).filter((m) => m && !m.derived && !m.stubs).length,
    derived: Object.values(row.metrics).filter((m) => m?.derived).length,
    stubs: Object.values(row.metrics).filter((m) => m?.stubs).length,
    missing: Object.values(row.metrics).filter((m) => m === null).length
  }));
  return { quarters: table, gaps, eda, reconciliation };
}

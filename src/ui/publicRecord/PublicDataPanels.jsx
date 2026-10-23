// src/ui/publicRecord/PublicDataPanels.jsx — Public record panels over the public-data snapshots:
// peer lenders (SEC XBRL), complaint counts (CFPB), credit conditions (FRED), their provenance, and
// the court-filing facts on the timeline. Every name, label and figure comes from the profile's
// data; this file names no company. Gaps are shown as gaps, never filled.

import React, { useMemo } from "react";
import { styles } from "../theme.js";
import { LineChart } from "../funding/LineChart.jsx";
import { Val } from "./PublicRecordView.jsx";
import { qLabel, fmtPct, fmtRate, quarterAxisX, monthAxisX } from "./format.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const muted = { color: "#94a3b8" };

function quarterCodes(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4)), q = Number(from.slice(5));
  while (`${y}Q${q}` <= to) {
    out.push(`${y}Q${q}`);
    if (++q === 5) { q = 1; y++; }
  }
  return out;
}

const n = (v) => v.toLocaleString("en-US");

// ---------------------------------------------------------------------------------------------

const PEER_RATIOS = [
  { key: "liabilitiesToAssets", label: "Total liabilities ÷ total assets", computed: "total liabilities ÷ total assets at quarter end", note: "Every quarter in each filer's window where both balances are filed." },
  { key: "cashToLiabilities", label: "Cash ÷ total liabilities, where reported", computed: "cash and cash equivalents ÷ total liabilities at quarter end", note: "Shown only where the filer reports cash under the same concept for that quarter; a blank cell is a gap, listed below." }
];

export function PeerPanel({ record, select }) {
  const { peers, config } = record.publicData;
  const { leverageLiquidity } = record.analyses;
  const cw = peers.caseStudyWindow;
  const quarters = quarterCodes(peers.window.from, peers.window.to);
  const columns = useMemo(() => {
    const cs = record.quarterly.quarters;
    return [
      { id: "case-study", label: config.edgar.caseStudy.label, model: config.edgar.caseStudy.model, rows: cs, first: cs[0].quarter, last: cs.at(-1).quarter },
      ...peers.filers.map((f) => ({ id: f.id, label: f.label, model: f.model, rows: f.quarters, first: f.firstQuarter, last: f.latestQuarter }))
    ].map((c) => ({ ...c, results: new Map(leverageLiquidity(c.rows).map((r) => [r.quarter, r])) }));
  }, [record, peers, config, leverageLiquidity]);
  const totalGaps = peers.filers.reduce((s, f) => s + f.gaps.length, 0);

  const cell = (c, q, d) => {
    if (q < c.first || q > c.last) return <span style={{ color: "#cbd5e1" }} title="outside this filer's filing window">·</span>;
    const x = c.results.get(q)?.[d.key];
    if (!x || x.value === null) return <span style={muted} title={x?.reason}>—</span>;
    return <Val refData={{ computed: d.computed, inputs: x.inputs }} text={fmtPct(x.value, 1)} onSelect={(ref) => select(`${d.label.toLowerCase()}, ${c.label}, ${qLabel(q)}`, ref)} testId={`peer-${d.key}-${c.id}-${q}`} />;
  };

  return (
    <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-peers">
      <h3 style={styles.panelTitle}>6. Peer lenders</h3>
      <p style={styles.note} data-testid="peers-label"><strong>Different business models (balance-sheet lenders vs. platforms); compare direction, not level.</strong> Ratios from each filer's own SEC XBRL balance sheet, by calendar quarter end, {qLabel(peers.window.from)} to {qLabel(peers.window.to)}. Shaded rows are the case-study window ({qLabel(cw.from)}–{qLabel(cw.to)}). “·” is outside a filer's filing window; “—” is a gap. No take-rate comparison is made: the business models make it misleading.</p>
      <div style={styles.tableContainer}>
        <table style={{ ...styles.table, fontSize: 12 }} data-testid="peer-filers">
          <thead><tr>{["Filer", "Business model", "CIK", "Quarters filed in window", "Gaps"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {peers.filers.map((f) => (
              <tr key={f.id}>
                <td style={styles.td}>{f.label}<div style={{ fontSize: 11, color: "#64748b" }}>{f.entityName}</div></td>
                <td style={styles.td}>{f.model}</td>
                <td style={styles.td}><a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${f.cik}`} target="_blank" rel="noreferrer">{f.cik}</a></td>
                <td style={styles.td}>{qLabel(f.firstQuarter)} – {qLabel(f.latestQuarter)}{f.latestQuarter < peers.window.to ? " (no later filing in the company facts)" : ""}</td>
                <td style={{ ...styles.td, ...styles.num }}>{f.gaps.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {PEER_RATIOS.map((d) => (
        <div key={d.key}>
          <h4 style={{ fontSize: 13, margin: "14px 0 4px" }}>{d.label}</h4>
          <p style={{ ...styles.note, margin: "0 0 6px" }}>{d.note}</p>
          <div style={styles.tableContainer}>
            <table style={{ ...styles.table, fontSize: 12 }} data-testid={`peer-table-${d.key}`}>
              <thead><tr><th style={styles.th}>Quarter</th>{columns.map((c) => <th key={c.id} style={{ ...styles.th, ...styles.num }}>{c.label}</th>)}</tr></thead>
              <tbody>
                {quarters.map((q) => (
                  <tr key={q} style={q >= cw.from && q <= cw.to ? { background: "#fffbeb" } : undefined}>
                    <td style={styles.td}>{qLabel(q)}</td>
                    {columns.map((c) => <td key={c.id} style={{ ...styles.td, ...styles.num }}>{cell(c, q, d)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <details style={{ marginTop: 10, fontSize: 12 }} data-testid="peer-gaps">
        <summary style={{ cursor: "pointer", fontSize: 13 }}><strong>Gaps inside the filers' windows ({totalGaps}), none filled</strong></summary>
        {peers.filers.map((f) => (
          <div key={f.id} style={{ marginTop: 6 }}>
            <strong>{f.label}</strong> ({f.gaps.length}; metrics use {Object.entries(f.eda.dedupe).map(([m, x]) => `${m} ${x.concept ?? "none"}`).join(", ")})
            <ul style={{ lineHeight: 1.5, margin: "4px 0" }}>
              {f.gaps.map((g, i) => <li key={i}>{g.metric} · {g.quarter === "all" ? "all quarters" : qLabel(g.quarter)} · {g.detail}</li>)}
            </ul>
          </div>
        ))}
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

export function ComplaintsPanel({ record, select }) {
  const { complaints } = record.publicData;
  const { window: win } = complaints;
  const cs = complaints.companies.find((c) => c.role === "case-study");
  const monthly = complaints.companies.filter((c) => !c.totalOnly);
  const years = [...new Set(cs.monthly.map((m) => m.month.slice(0, 4)))];
  const yearSum = (c, y) => c.monthly.filter((m) => m.month.startsWith(y)).reduce((s, m) => s + m.count, 0);
  const points = cs.monthly.map((m, i) => ({ x: i, y: m.count, label: `${monthLabel(m.month)}${m.provisional ? " (provisional)" : ""}`, m }));
  const xTicks = cs.monthly.map((m, i) => ({ x: i, month: m.month })).filter((t) => t.month.endsWith("-01")).map((t) => ({ x: t.x, label: t.month.slice(0, 4) }));
  const lastDay = `${win.to}-28`;
  const markers = record.events.filter((e) => e.date >= `${win.from}-01` && e.date <= lastDay).map((e) => ({ x: monthAxisX(e.date, win.from), label: e.dateLabel }));
  const ref = (c, extra = {}) => ({ cfpb: { company: c, window: win, ...extra } });
  const topIssues = cs.byIssue.slice(0, 8);
  return (
    <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-complaints">
      <h3 style={styles.panelTitle}>7. Complaint signals</h3>
      <p style={styles.note} data-testid="complaints-label"><strong>Counts, not rates: the database has no loan volumes, so a peer with more loans will have more complaints.</strong> Complaints received by the CFPB, {monthLabel(win.from)} to {monthLabel(win.to)}; {monthLabel(win.provisionalMonth)} is provisional, because complaints are published up to 15 days after the company is asked to respond. The database is not a statistical sample. Counts only: no complaint text, ZIP code or complaint ID is stored.</p>
      <LineChart testId="chart-complaints" title={`Complaints per month: ${cs.label}, with dated events`} xLabel="Month received" yLabel="Complaints" xTicks={xTicks}
        points={points} markers={markers} formatY={(v) => String(v)} onPointClick={(p) => select(`complaints, ${cs.label}, ${p.label}`, ref(cs, { month: p.m }))} />
      <p style={styles.note} data-testid="complaints-sparsity">Monthly counts are small: {cs.sparsity.monthsWithAtMostTwo} of {cs.sparsity.months} months have two or fewer complaints, and the median in months with any is {cs.sparsity.medianInMonthsWithComplaints}. Month-to-month moves are mostly noise; read the level over several months.</p>
      <div style={styles.tableContainer}>
        <table style={{ ...styles.table, fontSize: 12 }} data-testid="complaints-companies">
          <thead><tr>{["Company", "Database company name", "Complaints in window", "Months with any", "Median in those months", "Months with ≤ 2"].map((h, i) => <th key={h} style={i >= 2 ? { ...styles.th, ...styles.num } : styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {complaints.companies.map((c) => (
              <tr key={c.id}>
                <td style={styles.td}>{c.label}</td>
                <td style={styles.td}>{c.strings.map((s) => `“${s}”`).join(" + ")}{c.switch && <div style={{ fontSize: 11, color: "#64748b" }}>{c.switch.label}</div>}{c.totalOnly && <div style={{ fontSize: 11, color: "#64748b" }}>Total only ({c.firstInWindow} to {c.lastInWindow}): too few for monthly counts.</div>}</td>
                <td style={{ ...styles.td, ...styles.num }}><Val refData={ref(c)} text={n(c.total)} onSelect={(r) => select(`complaints in window, ${c.label}`, r)} testId={`complaints-total-${c.id}`} /></td>
                <td style={{ ...styles.td, ...styles.num }}>{c.totalOnly ? "—" : c.sparsity.monthsWithComplaints}</td>
                <td style={{ ...styles.td, ...styles.num }}>{c.totalOnly ? "—" : c.sparsity.medianInMonthsWithComplaints}</td>
                <td style={{ ...styles.td, ...styles.num }}>{c.totalOnly ? "—" : c.sparsity.monthsWithAtMostTwo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 style={{ fontSize: 13, margin: "14px 0 4px" }}>Complaints per year (sum of the monthly counts)</h4>
      <div style={styles.tableContainer}>
        <table style={{ ...styles.table, fontSize: 12 }} data-testid="complaints-years">
          <thead><tr><th style={styles.th}>Year</th>{monthly.map((c) => <th key={c.id} style={{ ...styles.th, ...styles.num }}>{c.label}</th>)}</tr></thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}>
                <td style={styles.td}>{y}{y === win.to.slice(0, 4) ? ` (to ${monthLabel(win.to)}, provisional)` : ""}</td>
                {monthly.map((c) => <td key={c.id} style={{ ...styles.td, ...styles.num }}>{n(yearSum(c, y))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 style={{ fontSize: 13, margin: "14px 0 4px" }}>Top issues, {cs.label}</h4>
      <ul style={{ fontSize: 13, lineHeight: 1.55 }} data-testid="complaints-top-issues">
        {topIssues.map((x) => <li key={x.key}>{x.key}: <Val refData={ref(cs, { issue: x.key, count: x.count })} text={n(x.count)} onSelect={(r) => select(`complaints about “${x.key}”`, r)} /></li>)}
        {cs.byIssue.length > topIssues.length && <li style={muted}>{cs.byIssue.length - topIssues.length} other issues: {n(cs.byIssue.slice(topIssues.length).reduce((s, x) => s + x.count, 0))}</li>}
      </ul>
      <p style={styles.note}>Company response: {cs.byResponse.map((x) => `${x.key} ${n(x.count)}`).join("; ")}. Timely response: {cs.byTimely.map((x) => `${x.key} ${n(x.count)}`).join("; ")}. Category names are the database's own; its product names changed during the window and are not merged.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

export function CreditConditionsPanel({ record, select }) {
  const { macro } = record.publicData;
  return (
    <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-credit-conditions">
      <h3 style={styles.panelTitle}>8. Credit conditions</h3>
      <p style={styles.note} data-testid="credit-conditions-label"><strong>Context only: bank consumer-loan rates are a different measure from the synthetic book's 18-month 30+ DPD.</strong> Real series from FRED, {macro.window.from.slice(0, 4)} to the latest value, with the case study's dated events marked. Missing observations are left as gaps.</p>
      {macro.series.map((s) => {
        const quarterly = s.frequency === "quarterly";
        const first = s.observations[0].period;
        const label = (o) => (quarterly ? qLabel(o.period) : monthLabel(o.period));
        const points = s.observations.map((o, i) => ({ x: i, y: o.value, label: label(o), o }));
        const xTicks = s.observations.map((o, i) => ({ x: i, o })).filter((t) => (quarterly ? t.o.period.endsWith("Q1") : t.o.period.endsWith("-01"))).map((t) => ({ x: t.x, label: t.o.period.slice(0, 4) }));
        const markers = record.events.map((e) => ({ x: quarterly ? quarterAxisX(e.date, first) : monthAxisX(e.date, first), label: e.dateLabel }));
        return (
          <div key={s.id} data-testid={`macro-${s.id}`}>
            <LineChart testId={`chart-macro-${s.id}`} title={`${s.title} (${s.units}, ${s.frequency}; FRED ${s.id})`} xLabel={quarterly ? "Quarter" : "Month"} yLabel="Percent" xTicks={xTicks}
              points={points} markers={markers} formatY={fmtRate} onPointClick={(p) => select(`${s.id}, ${p.label}`, { fredObservation: { series: s, observation: p.o } })} />
            {s.missingInWindow.length > 0 && <p style={{ ...styles.note, marginTop: 4 }}>Not published by the source, left empty: {s.missingInWindow.map((m) => (quarterly ? qLabel(m.period) : monthLabel(m.period))).join(", ")}.</p>}
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

export function PublicDataProvenancePanel({ record }) {
  const pd = record.manifest.publicData;
  const terms = [...new Map(pd.sources.map((s) => [s.termsUrl, s])).values()];
  return (
    <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-public-data-provenance">
      <h3 style={styles.panelTitle}>9. Public data provenance</h3>
      <p style={styles.note}>Fetched once by <code>scripts/fetch-public-record.mjs --group public-data</code> on {pd.generatedAt.slice(0, 10)}, at most four requests a second, with a content check on every response before it was saved. The declared User-Agent “{pd.userAgent}” went to SEC hosts only. Files marked “local only” (the complaint downloads and the court exhibits) are hashed here but not committed; only counts and the cited pages are. The data sections, with each dataset's shape before and after EDA, are in <code>data/public-record/README.md</code>.</p>
      <div style={styles.tableContainer}>
        <table style={{ ...styles.table, fontSize: 12 }} data-testid="public-data-sources">
          <thead><tr>{["Source", "Endpoint", "Retrieved (UTC)", "SHA-256", "Bytes", "In repository"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {pd.sources.map((s) => (
              <tr key={s.id}>
                <td style={styles.td}>{s.id}</td>
                <td style={{ ...styles.td, wordBreak: "break-all" }}>{s.url}</td>
                <td style={styles.td}>{s.retrievedAt.replace("T", " ").slice(0, 19)}</td>
                <td style={{ ...styles.td, fontFamily: "monospace" }} title={s.sha256}>{s.sha256.slice(0, 16)}…</td>
                <td style={{ ...styles.td, ...styles.num }}>{n(s.bytes)}</td>
                <td style={styles.td}>{s.committed ? "yes" : "local only (hash recorded)"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 style={{ fontSize: 13 }}>Built from them</h4>
      <ul style={{ fontSize: 12, lineHeight: 1.55 }} data-testid="public-data-derived">
        {pd.derived.map((d) => <li key={d.id}><code>{d.file}</code>: {n(d.bytes)} bytes, SHA-256 <span style={{ fontFamily: "monospace" }}>{d.sha256.slice(0, 16)}…</span>, from {d.builtFrom.length} source file{d.builtFrom.length === 1 ? "" : "s"}</li>)}
      </ul>
      <h4 style={{ fontSize: 13 }}>Licence and terms</h4>
      <ul style={{ fontSize: 12, lineHeight: 1.55 }} data-testid="public-data-terms">
        {terms.map((s) => <li key={s.termsUrl}>{s.licence} {s.terms} <a href={s.termsUrl} target="_blank" rel="noreferrer">{s.termsUrl}</a></li>)}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

/**
 * The court-filing facts on the case-study timeline, each quoted word for word with its citation.
 * Rendered after the data-provenance panel: anything added above that panel moves it on the page
 * and changes its captured Findings image (docs/findings/provenance.png).
 */
export function CourtFilingsPanel({ record, select }) {
  const { courtFilings, documents } = record.publicData;
  return (
    <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-court-filings">
      <h3 style={styles.panelTitle}>5. Court filings on the case-study timeline</h3>
      <p style={styles.note}>Dated facts from the Chapter 11 case, after the events in section 2. Each passage is quoted exactly as filed, with its section and page; the cited pages' text is committed with the snapshot. Timing facts are taken from the Amended Plan.</p>
      <h4 style={{ fontSize: 13, margin: "14px 0 6px" }}>Court filings (quoted word for word)</h4>
      <ul style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }} data-testid="court-filings-list">
        {courtFilings.map((f) => (
          <li key={f.id} style={{ marginBottom: 6 }}>
            <Val refData={{ court: f, document: documents.find((d) => d.id === f.document) }} text={f.dateLabel} onSelect={(x) => select(`court filing, ${f.dateLabel}`, x)} />: <strong>{f.title}.</strong>
            {/* Quoted text is shown as an indented block exactly as filed, with no quotation marks added. */}
            {f.quotes.map((q, i) => (
              <span key={i} style={{ display: "block", borderLeft: "3px solid #cbd5e1", paddingLeft: 8, margin: "3px 0", color: "#334155" }}>
                {q.text} <span style={{ fontSize: 12, color: "#64748b" }}>({q.citation}{q.form ? `; ${q.form}` : ""})</span>
              </span>
            ))}
            <a href={f.source.url} target="_blank" rel="noreferrer">Source: {f.source.label}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

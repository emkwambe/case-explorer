// src/ui/publicRecord/PublicRecordView.jsx — Public record tab: three analyses over the active
// profile's pinned public-record snapshot, a data-provenance panel, and lineage on every value.
// All lender-specific text and data come from the profile; this component names no company.

import React, { useEffect, useMemo, useState } from "react";
import { styles } from "../theme.js";
import { Callout } from "../components/primitives.jsx";
import { LineChart, BarChart } from "../funding/LineChart.jsx";
import { qLabel, toMillions, fmtM, fmtPct, fmtRate, eventX } from "./format.js";

const filingIndexUrl = (accn) => `https://www.sec.gov/Archives/edgar/data/1821850/${accn.replace(/-/g, "")}/`;

/** A clickable value that opens its lineage. */
export function Val({ refData, text, onSelect, testId }) {
  if (!refData) return <span style={{ color: "#94a3b8" }}>—</span>;
  return (
    <button type="button" onClick={() => onSelect(refData)} data-testid={testId} title="Show source"
      style={{ background: "none", border: "none", padding: 0, color: "#1d4ed8", textDecoration: "underline dotted", cursor: "pointer", font: "inherit" }}>
      {text}
    </button>
  );
}

function LineageDetail({ r, depth = 0 }) {
  if (!r) return null;
  const indent = { marginLeft: depth * 14 };
  if (r.computed) {
    return (
      <div style={indent}>
        <div><strong>Computed:</strong> {r.computed}</div>
        {r.inputs?.map((inp, i) => <LineageDetail key={i} r={inp} depth={depth + 1} />)}
      </div>
    );
  }
  if (r.derived) {
    return (
      <div style={indent}>
        <div><strong>Derived</strong> ({r.method}), {r.source === "xbrl" ? `XBRL concept us-gaap:${r.concept}` : "manual extraction"}; inputs:</div>
        {r.inputs?.map((inp, i) => <LineageDetail key={i} r={inp} depth={depth + 1} />)}
      </div>
    );
  }
  if (r.source === "xbrl") {
    return (
      <div style={indent}>
        SEC XBRL · us-gaap:{r.concept} · {r.form} filed {r.filed} · accession{" "}
        <a href={filingIndexUrl(r.accn)} target="_blank" rel="noreferrer">{r.accn}</a> · period {r.start ? `${r.start} to ` : ""}{r.end} · {r.basis} · value {r.value.toLocaleString("en-US")} {r.unit}
      </div>
    );
  }
  if (r.source === "manual") {
    return (
      <div style={indent}>
        Manual extraction · <a href={r.accession_or_url} target="_blank" rel="noreferrer">{r.document}</a> · {r.page_or_section} · label “{r.quoted_label}” · value {r.value.toLocaleString("en-US")} {r.unit}
        {r.restatements?.length > 0 && (
          <div style={{ marginLeft: 14 }}>
            Also reported in: {r.restatements.map((x) => `${x.document.split(" (")[0]}, ${x.page_or_section.split(",")[0]}: ${x.value.toLocaleString("en-US")}${x.differs ? " (differs)" : " (same)"}`).join("; ")}
          </div>
        )}
      </div>
    );
  }
  if (r.source === "fred") {
    return (
      <div style={indent}>
        FRED series <a href={`https://fred.stlouisfed.org/series/${r.series}`} target="_blank" rel="noreferrer">{r.series}</a> · {r.method} · {r.observations} daily observations · {r.value.toFixed(3)}%
      </div>
    );
  }
  if (r.event) {
    return <div style={indent}>{r.event.dateLabel}: {r.event.detail} <a href={r.event.source.url} target="_blank" rel="noreferrer">{r.event.source.label}</a></div>;
  }
  if (r.citation) {
    return <div style={indent}>{r.citation.text} <a href={r.citation.source.url} target="_blank" rel="noreferrer">{r.citation.source.label}</a></div>;
  }
  return <div style={indent}>{JSON.stringify(r)}</div>;
}

export function LineagePanel({ selected, onClose }) {
  return (
    <div style={{ ...styles.panel, position: "sticky", top: 0, zIndex: 2, marginBottom: 14, background: "#eff6ff", borderColor: "#bfdbfe", fontSize: 12, lineHeight: 1.6 }} data-testid="lineage" aria-live="polite">
      {!selected && <span>Select any value or data point to see where it comes from.</span>}
      {selected && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <strong>Source of {selected.title}</strong>
            <button type="button" onClick={onClose} style={styles.btnSmall}>Close</button>
          </div>
          <LineageDetail r={selected.ref} />
        </>
      )}
    </div>
  );
}

function stubText(m) {
  const p = m.stubs.predecessor, s = m.stubs.successor;
  return `${p ? `P ${fmtM(toMillions(p))}` : "P —"} / ${s ? `S ${fmtM(toMillions(s))}` : "S —"}`;
}

function UnitEconomicsPanel({ record, select }) {
  const { unitEconomics, QUARTER_ORDER } = record.analyses;
  const ue = useMemo(() => unitEconomics(record.quarterly.quarters), [record, unitEconomics]);
  const brk = record.breaks.find((b) => b.metric === "platform_fees");
  const xTicks = ue.quarters.map((q, i) => ({ x: i, label: qLabel(q.quarter) }));
  const takeRef = (q) => q.takeRate && { computed: "platform fees ÷ funded loans for the quarter", inputs: q.takeRate.inputs };
  return (
    <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-unit-economics">
      <h3 style={styles.panelTitle}>1. Rates vs unit economics</h3>
      <p style={styles.note}>Take rate = platform fees ÷ funded loans. The two series are shown as aligned charts on a shared quarter axis rather than one dual-axis chart, so neither scale can be tuned to suggest co-movement.</p>
      <LineChart testId="chart-take-rate" title="Take rate (platform fees ÷ funded loans)" xLabel="Quarter" yLabel="Take rate" xTicks={xTicks}
        points={ue.quarters.map((q, i) => ({ x: i, y: q.takeRate?.value ?? null, label: qLabel(q.quarter), q }))}
        refLines={[{ y: 0, label: "Zero" }]}
        markers={brk ? [{ x: QUARTER_ORDER.indexOf(brk.quarter), label: "Presentation break" }] : []}
        formatY={(v) => fmtPct(v, 1)} onPointClick={(p) => select(`take rate, ${p.label}`, takeRef(p.q))} />
      <LineChart testId="chart-fed-funds" title="Effective federal funds rate (quarterly average of daily DFF)" xLabel="Quarter" yLabel="Fed funds" xTicks={xTicks}
        points={ue.quarters.map((q, i) => ({ x: i, y: q.fedFunds?.value ?? null, label: qLabel(q.quarter), q }))}
        formatY={fmtRate} onPointClick={(p) => select(`fed funds average, ${p.label}`, p.q.fedFunds)} />
      <BarChart testId="chart-funded-volume" title="Funded loans per quarter" yLabel="$ millions" formatY={(v) => `$${v.toFixed(0)}M`}
        bars={ue.quarters.map((q) => ({ label: qLabel(q.quarter), y: q.fundedVolume ? toMillions(q.fundedVolume) : null, note: q.stubs ? "stubs" : "gap", q }))}
        onBarClick={(b) => select(`funded loans, ${b.label}`, b.q.fundedVolume)} />
      <p style={{ fontSize: 14, margin: "12px 0" }} data-testid="correlation">
        Correlation of take rate with the quarterly average fed funds rate: <strong>{ue.correlation.value === null ? "not computable" : ue.correlation.value.toFixed(2)}</strong> (n = {ue.correlation.n} quarters). {ue.correlation.label}
      </p>
      <div style={styles.tableContainer}>
        <table style={styles.table} data-testid="unit-economics-table">
          <thead><tr>{["Quarter", "Funded loans", "Platform fees", "Take rate", "Fed funds avg", "10-year avg"].map((h, i) => <th key={h} style={i ? { ...styles.th, ...styles.num } : styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {ue.quarters.map((q) => {
              const fv = record.quarterly.quarters.find((r) => r.quarter === q.quarter).metrics.funded_volume;
              const pf = record.quarterly.quarters.find((r) => r.quarter === q.quarter).metrics.platform_fees;
              const cell = (m, what) => (m?.stubs
                ? <span>{stubText(m)} <Val refData={m.stubs.predecessor} text="P" onSelect={(r) => select(`${what}, Predecessor stub`, r)} /> <Val refData={m.stubs.successor} text="S" onSelect={(r) => select(`${what}, Successor stub`, r)} /></span>
                : <><Val refData={m} text={m ? fmtM(toMillions(m)) : "—"} onSelect={(r) => select(`${what}, ${qLabel(q.quarter)}`, r)} />{m?.derived && <span style={{ fontSize: 10, color: "#92400e" }}> derived</span>}</>);
              return (
                <tr key={q.quarter} style={brk?.quarter === q.quarter ? { background: "#fffbeb" } : undefined}>
                  <td style={styles.td}>{qLabel(q.quarter)}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{cell(fv, "funded loans")}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{cell(pf, "platform fees")}{brk?.quarter === q.quarter && <span style={{ fontSize: 10, color: "#92400e" }} data-testid="break-badge"> presentation break</span>}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{q.takeRate ? <Val refData={takeRef(q)} text={fmtPct(q.takeRate.value)} onSelect={(r) => select(`take rate, ${qLabel(q.quarter)}`, r)} /> : q.stubs ? "— (stubs)" : "—"}</td>
                  <td style={{ ...styles.td, ...styles.num }}><Val refData={q.fedFunds} text={fmtRate(q.fedFunds?.value)} onSelect={(r) => select(`fed funds average, ${qLabel(q.quarter)}`, r)} /></td>
                  <td style={{ ...styles.td, ...styles.num }}><Val refData={q.tenYear} text={fmtRate(q.tenYear?.value)} onSelect={(r) => select(`10-year average, ${qLabel(q.quarter)}`, r)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {brk && <p style={{ ...styles.note, marginTop: 8 }} data-testid="break-note"><strong>Presentation break, {qLabel(brk.quarter)}:</strong> {brk.note}</p>}
      <p style={{ ...styles.note, marginTop: 8 }}>{record.basisNote}</p>
    </section>
  );
}

function LiquidityPanel({ record, select }) {
  const { liquidityRunway, QUARTER_ORDER } = record.analyses;
  const runway = useMemo(() => liquidityRunway(record.quarterly.quarters), [record, liquidityRunway]);
  const extra = ["2023Q3", "2023Q4"];
  const xTicks = [...QUARTER_ORDER, ...extra].map((q, i) => ({ x: i, label: qLabel(q) }));
  const points = [...runway.map((r, i) => ({ x: i, y: r.cash ? toMillions(r.cash) : null, label: qLabel(r.quarter), r })), ...extra.map((q, k) => ({ x: QUARTER_ORDER.length + k, y: null, label: `${qLabel(q)} (no filing)` }))];
  return (
    <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-liquidity">
      <h3 style={styles.panelTitle}>2. Liquidity and covenants</h3>
      <LineChart testId="chart-cash" title="Cash and cash equivalents at quarter end, with dated events" xLabel="Quarter" yLabel="$ millions" xTicks={xTicks}
        points={points} formatY={(v) => `$${v.toFixed(0)}M`}
        markers={record.events.map((e) => ({ x: eventX(e.date), label: e.dateLabel }))}
        onPointClick={(p) => p.r && select(`cash, ${p.label}`, p.r.cash)} />
      <p style={styles.note}>No periodic filings exist after June 30, 2023, so the chart has no cash points after that date; later events are still marked.</p>
      <div style={styles.tableContainer}>
        <table style={styles.table} data-testid="runway-table">
          <thead><tr>{["Quarter", "Cash", "TTM operating cash flow", "Burn per month", "Runway", "Status"].map((h, i) => <th key={h} style={i >= 1 && i <= 4 ? { ...styles.th, ...styles.num } : styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {runway.map((r) => {
              const ttmRef = r.ttmOperatingCashFlow && { computed: `sum of operating cash flow for ${r.ttmOperatingCashFlow.quarters.map(qLabel).join(", ")}`, inputs: r.ttmOperatingCashFlow.inputs };
              return (
                <tr key={r.quarter}>
                  <td style={styles.td}>{qLabel(r.quarter)}</td>
                  <td style={{ ...styles.td, ...styles.num }}><Val refData={r.cash} text={r.cash ? fmtM(toMillions(r.cash)) : "—"} onSelect={(x) => select(`cash, ${qLabel(r.quarter)}`, x)} /></td>
                  <td style={{ ...styles.td, ...styles.num }}>{ttmRef ? <Val refData={ttmRef} text={fmtM(r.ttmOperatingCashFlow.value / 1e6)} onSelect={(x) => select(`TTM operating cash flow, ${qLabel(r.quarter)}`, x)} /> : "—"}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{r.burnPerMonth === null ? "—" : <Val refData={{ computed: "−TTM operating cash flow ÷ 12", inputs: [ttmRef] }} text={fmtM(r.burnPerMonth / 1e6)} onSelect={(x) => select(`burn per month, ${qLabel(r.quarter)}`, x)} />}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{r.runwayMonths === null ? "—" : <Val refData={{ computed: "cash ÷ burn per month", inputs: [r.cash, ttmRef] }} text={`${r.runwayMonths.toFixed(1)} months`} onSelect={(x) => select(`runway, ${qLabel(r.quarter)}`, x)} />}</td>
                  <td style={{ ...styles.td, fontSize: 12 }} data-testid={`runway-status-${r.quarter}`}>{r.status}{r.reason && r.status !== "ok" ? `: ${r.reason}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h4 style={{ fontSize: 13, margin: "14px 0 6px" }}>Events</h4>
      <ul style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }} data-testid="events-list">
        {record.events.map((e) => (
          <li key={e.id}>
            <Val refData={{ event: e }} text={e.dateLabel} onSelect={(x) => select(`event, ${e.dateLabel}`, x)} />: <strong>{e.title}.</strong> {e.detail}{" "}
            <a href={e.source.url} target="_blank" rel="noreferrer">Source: {e.source.label}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LeveragePanel({ record, select }) {
  const { leverageLiquidity, leverageGaps, LEVERAGE_RATIOS } = record.analyses;
  const results = useMemo(() => leverageLiquidity(record.quarterly.quarters), [record, leverageLiquidity]);
  const gaps = leverageGaps(results);
  const show = (d, r) => {
    const x = r[d.key];
    if (x.value === null) return <span style={{ fontSize: 12, color: "#64748b" }}>{x.status}</span>;
    const text = d.key === "cashToOutflow" ? `${x.value.toFixed(1)} quarters` : fmtPct(x.value, 1);
    return <Val refData={{ computed: d.computed, inputs: x.inputs }} text={text} onSelect={(ref) => select(`${d.label.toLowerCase()}, ${qLabel(r.quarter)}`, ref)} testId={`leverage-${d.key}-${r.quarter}`} />;
  };
  return (
    <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-leverage">
      <h3 style={styles.panelTitle}>3. Leverage and liquidity</h3>
      <p style={styles.note}>Ratios from the filed balance sheet and cash-flow statement, for the quarters that support them. The balance sheet is unclassified (no current assets or current liabilities are filed), so working-capital measures cannot be formed. Cash ÷ quarterly operating outflow is the number of quarters of that quarter's operating outflow the cash would cover; a quarter with non-negative operating cash flow is “not burning”.</p>
      <div style={styles.tableContainer}>
        <table style={styles.table} data-testid="leverage-table">
          <thead><tr>{["Quarter", ...LEVERAGE_RATIOS.map((d) => d.label)].map((h, i) => <th key={h} style={i ? { ...styles.th, ...styles.num } : styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.quarter}>
                <td style={styles.td}>{qLabel(r.quarter)}</td>
                {LEVERAGE_RATIOS.map((d) => <td key={d.key} style={{ ...styles.td, ...styles.num }} data-testid={`leverage-cell-${d.key}-${r.quarter}`}>{show(d, r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 13, margin: "10px 0 4px" }}><strong>Not computed ({gaps.length}), none estimated:</strong></p>
      <ul style={{ fontSize: 12, lineHeight: 1.5 }} data-testid="leverage-gaps">
        {gaps.map((g) => <li key={`${g.quarter}-${g.ratio}`}>{qLabel(g.quarter)} · {g.ratio} · {g.status}: {g.reason}</li>)}
      </ul>
    </section>
  );
}

function ProvenancePanel({ record }) {
  const { manifest, quarterly } = record;
  const { eda, gaps, reconciliation } = quarterly;
  const allGaps = [...gaps, ...record.declaredGaps.map((g) => ({ ...g, source: "declared" }))];
  return (
    <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-provenance">
      <h3 style={styles.panelTitle}>4. Data provenance</h3>
      <h4 style={{ fontSize: 13 }}>How the data was obtained</h4>
      <p style={styles.note}>Fetched once by <code>scripts/fetch-public-record.mjs</code> on {manifest.generatedAt.slice(0, 10)} with User-Agent “{manifest.userAgent}”, at most four requests a second, stopping on any non-200 response. The browser never calls SEC or FRED; the app reads only the committed snapshot.</p>
      <div style={styles.tableContainer}>
        <table style={{ ...styles.table, fontSize: 12 }} data-testid="manifest-table">
          <thead><tr>{["Source", "Endpoint", "Retrieved (UTC)", "SHA-256", "Bytes", "In repository"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {manifest.sources.map((s) => (
              <tr key={s.id}>
                <td style={styles.td}>{s.id}</td>
                <td style={{ ...styles.td, wordBreak: "break-all" }}>{s.url}</td>
                <td style={styles.td}>{s.retrievedAt.replace("T", " ").slice(0, 19)}</td>
                <td style={{ ...styles.td, fontFamily: "monospace" }} title={s.sha256}>{s.sha256.slice(0, 16)}…</td>
                <td style={{ ...styles.td, ...styles.num }}>{s.bytes.toLocaleString("en-US")}</td>
                <td style={styles.td}>{s.committed ? "yes" : "no (hash recorded; re-download to verify)"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul style={{ fontSize: 13, lineHeight: 1.55 }}>
        <li><strong>XBRL:</strong> {record.origins.xbrl}</li>
        <li><strong>Manual extraction:</strong> {record.origins.manual}</li>
        <li><strong>FRED:</strong> {record.origins.fred}</li>
      </ul>

      <h4 style={{ fontSize: 13 }}>Before EDA</h4>
      <p style={styles.note} data-testid="eda-raw">
        XBRL company facts: {eda.xbrl.conceptCount} concepts and {eda.xbrl.factCount.toLocaleString("en-US")} facts ({eda.xbrl.taxonomies.join(", ")}) from {eda.xbrl.filings.length} filings. {eda.xbrl.excludedFilings.length} filings are the SPAC's own pre-merger reports ({eda.xbrl.excludedFilings.join(", ")}) and are excluded. The same period is reported again in later 10-Qs and the 10-K, so most periods appear more than once. FRED: DFF {eda.fred.DFF.observations.toLocaleString("en-US")} daily observations ({eda.fred.DFF.firstDate} to {eda.fred.DFF.lastDate}, {eda.fred.DFF.missingMarkedDot} missing); DGS10 {eda.fred.DGS10.observations.toLocaleString("en-US")} ({eda.fred.DGS10.firstDate} to {eda.fred.DGS10.lastDate}, {eda.fred.DGS10.missingMarkedDot} days marked missing).
      </p>
      <div style={styles.tableContainer}>
        <table style={{ ...styles.table, fontSize: 12 }} data-testid="dedupe-table">
          <thead><tr>{["Metric", "Concept", "Raw facts", "Pre-merger (excluded)", "Duplicates in one filing", "Duplicates across filings", "Periods reported more than once", "Kept"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {Object.entries(eda.dedupe).map(([metric, d]) => (
              <tr key={metric}><td style={styles.td}>{metric}</td><td style={styles.td}>{d.concept}</td><td style={{ ...styles.td, ...styles.num }}>{d.rawFacts}</td><td style={{ ...styles.td, ...styles.num }}>{d.excludedPreMergerRegistrant}</td><td style={{ ...styles.td, ...styles.num }}>{d.removedSameFiling}</td><td style={{ ...styles.td, ...styles.num }}>{d.removedAcrossFilings}</td><td style={{ ...styles.td, ...styles.num }}>{d.periodsReportedMoreThanOnce}</td><td style={{ ...styles.td, ...styles.num }}>{d.keptFacts}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 13, margin: "10px 0 4px" }}><strong>Gaps ({allGaps.length}), none filled with an estimate:</strong></p>
      <ul style={{ fontSize: 12, lineHeight: 1.5 }} data-testid="gaps-list">
        {allGaps.map((g, i) => <li key={i}>{g.metric} · {g.quarter === "all" ? "all quarters" : qLabel(g.quarter)} · {g.detail}</li>)}
      </ul>

      <h4 style={{ fontSize: 13 }}>After EDA</h4>
      <p style={styles.note}>
        {quarterly.quarters.length} quarterly rows ({qLabel(quarterly.quarters[0].quarter)} to {qLabel(quarterly.quarters.at(-1).quarter)}). Deduplication: by (concept, period start, period end, form, fiscal period), keeping the latest-filed value, then by (concept, period start, period end) across filings, keeping the latest-filed value. A discrete quarter not filed as such is derived as year-to-date minus the previous year-to-date (Q4 = full year minus nine months), marked derived and citing both filings; nothing crosses the July 2021 Predecessor/Successor break. FRED series are averaged as the simple mean of the daily observations dated in each quarter. Manual figures use each quarter's own 10-Q or 10-K; later restatements are listed with the value.
      </p>
      <div style={styles.tableContainer}>
        <table style={{ ...styles.table, fontSize: 12 }} data-testid="coverage-table">
          <thead><tr>{["Quarter", "Reported", "Derived", "Stubs", "Missing"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>{eda.coverage.map((c) => <tr key={c.quarter}><td style={styles.td}>{qLabel(c.quarter)}</td><td style={styles.td}>{c.reported}</td><td style={styles.td}>{c.derived}</td><td style={styles.td}>{c.stubs}</td><td style={styles.td}>{c.missing}</td></tr>)}</tbody>
        </table>
      </div>
      <p style={{ fontSize: 13, margin: "10px 0 4px" }}><strong>Reconciliation</strong> (sum of quarters vs the filed year-to-date figure, tolerance $0.1M):</p>
      <div style={styles.tableContainer}>
        <table style={{ ...styles.table, fontSize: 12 }} data-testid="reconciliation-table">
          <thead><tr>{["Metric", "Source", "Window", "Result", "Difference", "Check"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {reconciliation.map((r, i) => (
              <tr key={i}><td style={styles.td}>{r.metric}</td><td style={styles.td}>{r.source}</td><td style={styles.td}>{r.window}</td><td style={styles.td}>{r.status}</td><td style={styles.td}>{r.difference === undefined ? "—" : `${r.difference.toLocaleString("en-US")} ${r.unit}`}</td><td style={styles.td}>{r.independent === undefined ? "—" : r.independent ? "independent" : "not independent (includes a derived quarter)"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 style={{ fontSize: 13 }}>What the data cannot support</h4>
      <ul style={{ fontSize: 13 }} data-testid="cannot-support">{record.cannotSupport.map((c) => <li key={c}>{c}</li>)}</ul>
    </section>
  );
}

export function PublicRecordTab({ profile }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    let live = true;
    setRecord(null);
    profile.publicRecord.load().then((r) => live && setRecord(r)).catch((e) => live && setError(e));
    return () => { live = false; };
  }, [profile]);
  const select = (title, ref) => ref && setSelected({ title, ref });

  if (error) return <Callout tone="bad">The public-record snapshot could not be loaded.</Callout>;
  if (!record) return <p style={styles.note}>Loading the public-record snapshot…</p>;
  return (
    <div data-testid="public-record-view">
      <p style={styles.note}>
        Real data for {record.company}: SEC XBRL, FRED and figures typed from the filings, pinned at build time. Every value links to its source; select any value or data point. Sections 1–3 are analyses of public filings, not of the synthetic data elsewhere in the app.
      </p>
      <LineagePanel selected={selected} onClose={() => setSelected(null)} />
      <UnitEconomicsPanel record={record} select={select} />
      <LiquidityPanel record={record} select={select} />
      <LeveragePanel record={record} select={select} />
      <ProvenancePanel record={record} />
    </div>
  );
}

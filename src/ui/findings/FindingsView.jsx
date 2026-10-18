// src/ui/findings/FindingsView.jsx — Findings tab: the active profile's research brief (question,
// data, method, three findings, limits) over its public-record snapshot and the shared dealer
// portfolio. The copy comes from profile.findings and every figure from findingsModel.js, which
// calls the module that owns it. This component names no company. Prints as a one-page brief.

import React, { useEffect, useMemo, useState } from "react";
import { styles, money, pct } from "../theme.js";
import { Callout } from "../components/primitives.jsx";
import { LineChart } from "../funding/LineChart.jsx";
import { Val, LineagePanel } from "../publicRecord/PublicRecordView.jsx";
import { qLabel, toMillions, fmtPct, fmtRate, eventX } from "../publicRecord/format.js";
import { TAB_GROUPS } from "../navigation.js";
import { dealerSettings } from "../../dealers.js";
import { pricingLagFigures, concentrationFigures, runwayFigures, dataFigures } from "./findingsModel.js";

const RATING_COLORS = { RED: "#b91c1c", YELLOW: "#b45309", GREEN: "#047857", INSUFFICIENT_DATA: "#475569" };
const RATING_LABELS = { RED: "Red", YELLOW: "Yellow", GREEN: "Green", INSUFFICIENT_DATA: "Insufficient data" };
const tabLabel = (id) => TAB_GROUPS.flatMap((g) => g.tabs).find((t) => t.id === id)?.label ?? id;
const fmtP = (p) => (p === null ? "—" : p < 0.0001 ? p.toExponential(2) : p.toFixed(4));
const nextQuarter = (code) => {
  const y = Number(code.slice(0, 4)), q = Number(code.slice(5));
  return q === 4 ? `${y + 1}Q1` : `${y}Q${q + 1}`;
};
const sectionTitle = { ...styles.panelTitle, marginBottom: 8 };

function EvidenceLinks({ tabs, onOpenTab, label = "Evidence" }) {
  return (
    <p style={{ fontSize: 12, color: "#475569", margin: "8px 0 0" }} className="ce-findings-evidence">
      {label}:{" "}
      {tabs.map((id, i) => (
        <React.Fragment key={id}>
          {i > 0 && " · "}
          <button type="button" onClick={() => onOpenTab(id)} data-testid={`findings-open-${id}`}
            style={{ background: "none", border: "none", padding: 0, color: "#1d4ed8", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>
            {tabLabel(id)} tab
          </button>
        </React.Fragment>
      ))}
    </p>
  );
}

function FindingText({ n, copy }) {
  return (
    <>
      <h4 style={{ fontSize: 15, margin: "0 0 6px", color: "#0f172a" }}>{n}. {copy.title}</h4>
      <p style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 6px" }}><strong>Fact:</strong> {copy.claim}</p>
      <p style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 6px" }}><strong>Analysis, not fact:</strong> {copy.analysis}</p>
    </>
  );
}

function Figures({ children }) {
  return <ul style={{ fontSize: 13, lineHeight: 1.6, paddingLeft: 18, margin: "4px 0" }}>{children}</ul>;
}

function PricingLag({ copy, record, fundingDefaults, select, onOpenTab }) {
  const f = useMemo(() => pricingLagFigures(record, fundingDefaults), [record, fundingDefaults]);
  const xTicks = f.quarters.map((q, i) => ({ x: i, label: qLabel(q.quarter) }));
  const takeRef = (q) => q.takeRate && { computed: "platform fees ÷ funded loans for the quarter", inputs: q.takeRate.inputs };
  const fp = f.feeParams;
  const beRef = fp && { computed: `breakEvenShockBps at the profile's Funding & Rates defaults (assumptions unless tagged disclosed): coupon ${fmtPct(fp.coupon)}, term ${fp.termYears} years, investor yield at approval ${fmtPct(fp.yieldAtApproval)}, dealer fee $${fp.dealerFeePct} per $100, CPR ${fmtPct(fp.cpr, 1)}; the shock at which the fee at sale reaches zero` };
  const corr = f.correlation;
  return (
    <article style={{ ...styles.panel, marginBottom: 12, background: "white" }} className="ce-finding" data-testid="findings-f1">
      <div className="ce-finding-text">
        <FindingText n={1} copy={copy} />
        <Figures>
          {f.firstTakeRate && <li>Take rate, {qLabel(f.firstTakeRate.quarter)}: <Val testId="findings-take-rate-first" refData={takeRef(f.firstTakeRate)} text={fmtPct(f.firstTakeRate.takeRate.value)} onSelect={(r) => select(`take rate, ${qLabel(f.firstTakeRate.quarter)}`, r)} /></li>}
          {f.lastTakeRate && <li>Take rate, {qLabel(f.lastTakeRate.quarter)}: <Val testId="findings-take-rate-last" refData={takeRef(f.lastTakeRate)} text={fmtPct(f.lastTakeRate.takeRate.value)} onSelect={(r) => select(`take rate, ${qLabel(f.lastTakeRate.quarter)}`, r)} /></li>}
          <li data-testid="findings-correlation">
            Correlation with the fed funds rate: <strong data-testid="findings-correlation-value">{corr.value === null ? "not computable" : corr.value.toFixed(2)}</strong> (n = <span data-testid="findings-correlation-n">{corr.n}</span> quarters). {corr.label}
          </li>
          {fp && <li>Break-even rate shock at default inputs: <Val testId="findings-break-even" refData={beRef} text={f.breakEvenBps === null ? ">1,000 bps" : `${f.breakEvenBps.toFixed(1)} bps`} onSelect={(r) => select("break-even shock", r)} /></li>}
        </Figures>
        <EvidenceLinks tabs={copy.evidenceTabs} onOpenTab={onOpenTab} />
      </div>
      <div className="ce-finding-evidence" data-testid="findings-f1-chart">
        {/* Two stacked panels on the same quarter axis (same points, ticks and chart geometry), so the quarters line up. */}
        <LineChart testId="findings-chart-take-rate" title="Take rate (platform fees ÷ funded loans)" xLabel="Quarter" yLabel="Take rate" xTicks={xTicks}
          points={f.quarters.map((q, i) => ({ x: i, y: q.takeRate?.value ?? null, label: qLabel(q.quarter), q }))}
          refLines={[{ y: 0, label: "Zero" }]}
          formatY={(v) => fmtPct(v, 1)} onPointClick={(p) => select(`take rate, ${p.label}`, takeRef(p.q))} />
        <LineChart testId="findings-chart-fed-funds" title="Effective federal funds rate (quarterly average of daily DFF)" xLabel="Quarter" yLabel="Fed funds" xTicks={xTicks}
          points={f.quarters.map((q, i) => ({ x: i, y: q.fedFunds?.value ?? null, label: qLabel(q.quarter), q }))}
          formatY={fmtRate} onPointClick={(p) => select(`fed funds average, ${p.label}`, p.q.fedFunds)} />
      </div>
    </article>
  );
}

function Concentration({ copy, profile, portfolio, select, onOpenTab }) {
  const ready = portfolio.status === "done" && portfolio.profile?.id === profile.id;
  const stale = portfolio.status === "done" && !ready;
  const { seed, count } = dealerSettings(profile.defaults?.dealerView).portfolio;
  const { inputs, dealers, settings } = portfolio;
  const f = useMemo(() => (ready ? concentrationFigures({ inputs, dealers, settings }) : null), [ready, inputs, dealers, settings]);
  const topAdvances = settings?.network.topAdvances;
  const rows = f ? [f.largest, ...f.red.filter((r) => r.dealerId !== f.largest.dealerId)] : [];
  const synthetic = f && `${f.loans.toLocaleString("en-US")} synthetic funded loans, seed ${settings.portfolio.seed}, dealer effect strength ${f.strength} (assumption)`;
  return (
    <article style={{ ...styles.panel, marginBottom: 12, background: "white" }} className="ce-finding" data-testid="findings-f2" data-largest-advance-dealer={f?.largest.dealerId}>
      <div className="ce-finding-text">
        <FindingText n={2} copy={copy} />
        {f && (
          <Figures>
            <li>Largest advance: <strong data-testid="findings-largest-dealer">{f.largest.dealer}</strong>, <Val testId="findings-largest-advance" refData={topAdvances ? { citation: { text: `${topAdvances.note} (${topAdvances.status}); which synthetic dealer holds it is simulated.`, source: topAdvances.source } } : { computed: "simulated advance balance" }} text={money(f.largest.advanceBalance)} onSelect={(r) => select("largest advance", r)} /> (<Val testId="findings-largest-advance-share" refData={{ computed: `advance balance ÷ all ${f.rows.length} dealers' advances (${money(f.totalAdvances)})` }} text={pct(f.largestAdvanceShare)} onSelect={(r) => select("share of all advances", r)} /> of all advances)</li>
            <li>Its rating: <strong data-testid="findings-largest-rating" style={{ color: RATING_COLORS[f.largest.rating] }}>{RATING_LABELS[f.largest.rating]}</strong>, 30+ DPD <span data-testid="findings-largest-dpd">{pct(f.largest.dpd30Rate, 2)}</span> against a portfolio rate of <span data-testid="findings-portfolio-rate">{pct(f.portfolioRate, 2)}</span>, p = <span data-testid="findings-largest-p">{fmtP(f.largest.pValue)}</span></li>
            <li>Failing it changes expected loss by <Val testId="findings-failure-delta" refData={{ computed: `simulateDealerFailure: stressed minus baseline expected loss over ${synthetic}; ${pct(f.failure.assumptions.nonWorkingShare.value, 0)} of its borrowers with non-working systems (${f.failure.assumptions.nonWorkingShare.status}), PD ×${f.failure.assumptions.pdMultiplier.value} (${f.failure.assumptions.pdMultiplier.status}), recovery ${pct(f.failure.assumptions.baseRecovery.value, 0)} → 0% (${f.failure.assumptions.baseRecovery.status})` }} text={money(f.failure.deltaExpectedLoss)} onSelect={(r) => select("change in expected loss", r)} />, plus a <span data-testid="findings-failure-writeoff">{money(f.failure.advanceWriteOff)}</span> advance write-off (baseline expected loss <span data-testid="findings-baseline-el">{money(f.failure.baselineExpectedLoss)}</span>)</li>
            <li>RED dealers: <span data-testid="findings-red-count">{f.red.length}</span> of {f.ratedCount} rated</li>
          </Figures>
        )}
        <EvidenceLinks tabs={copy.evidenceTabs} onOpenTab={onOpenTab} />
      </div>
      <div className="ce-finding-evidence">
        {!ready && (
          <div className="ce-no-print">
            {stale && <p style={styles.note} data-testid="findings-portfolio-stale">The portfolio was generated under {portfolio.profile.label}. Generate it again under {profile.label}.</p>}
            <p style={styles.note}>The dealer figures come from the synthetic funded portfolio shared with the Dealer View{count ? ` (${count.toLocaleString("en-US")} loans)` : ""}.</p>
            <button style={{ ...styles.btnPrimary, width: "auto", padding: "8px 14px" }} onClick={() => portfolio.generate(profile)} disabled={portfolio.status === "running"} data-testid="findings-generate">
              Generate portfolio (seed {seed})
            </button>
            {portfolio.status === "running" && <span style={{ fontSize: 13, color: "#475569", marginLeft: 10 }} data-testid="findings-portfolio-progress" aria-live="polite">Generating… {Math.round(portfolio.progress * 100)}%</span>}
          </div>
        )}
        {f && (
          <div data-testid="findings-f2-table">
            <div style={styles.tableContainer}>
              <table style={{ ...styles.table, fontSize: 12 }} data-testid="findings-dealer-table">
                <caption style={{ captionSide: "top", textAlign: "left", padding: "4px 8px", fontSize: 12, color: "#92400e" }}>Dealer rows from the Dealer View: simulated, {synthetic}</caption>
                <thead><tr>{["Dealer", "Loans", "30+ DPD", "p-value", "Rating", "Advance balance", "Share of advances"].map((h, i) => <th key={h} style={i && i !== 4 ? { ...styles.th, ...styles.num } : styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.dealerId} data-testid={`findings-row-${r.dealerId}`}>
                      <td style={{ ...styles.td, whiteSpace: "nowrap" }}>{r.dealer}</td>
                      <td style={{ ...styles.td, ...styles.num }}>{r.loans.toLocaleString("en-US")}</td>
                      <td style={{ ...styles.td, ...styles.num }}>{pct(r.dpd30Rate, 2)}</td>
                      <td style={{ ...styles.td, ...styles.num }}>{fmtP(r.pValue)}</td>
                      <td style={{ ...styles.td, color: RATING_COLORS[r.rating], fontWeight: 700 }}>{RATING_LABELS[r.rating]}</td>
                      <td style={{ ...styles.td, ...styles.num }}>{money(r.advanceBalance)}</td>
                      <td style={{ ...styles.td, ...styles.num }}>{pct(f.totalAdvances > 0 ? r.advanceBalance / f.totalAdvances : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function Runway({ copy, record, select, onOpenTab }) {
  const f = useMemo(() => runwayFigures(record, copy.chapter11EventId), [record, copy.chapter11EventId]);
  const { QUARTER_ORDER } = record.analyses;
  // Extend the quarter axis past the last filing through the quarter of the latest event.
  const lastEvent = record.events.map((e) => e.date).sort().at(-1);
  const extra = [];
  if (lastEvent) {
    const until = `${lastEvent.slice(0, 4)}Q${Math.ceil(Number(lastEvent.slice(5, 7)) / 3)}`;
    for (let q = nextQuarter(QUARTER_ORDER.at(-1)); q <= until; q = nextQuarter(q)) extra.push(q);
  }
  const xTicks = [...QUARTER_ORDER, ...extra].map((q, i) => ({ x: i, label: qLabel(q) }));
  const points = [...f.runway.map((r, i) => ({ x: i, y: r.cash ? toMillions(r.cash) : null, label: qLabel(r.quarter), r })), ...extra.map((q, k) => ({ x: QUARTER_ORDER.length + k, y: null, label: `${qLabel(q)} (no filing)` }))];
  const last = f.last;
  const ttmRef = last?.ttmOperatingCashFlow && { computed: `sum of operating cash flow for ${last.ttmOperatingCashFlow.quarters.map(qLabel).join(", ")}`, inputs: last.ttmOperatingCashFlow.inputs };
  return (
    <article style={{ ...styles.panel, marginBottom: 12, background: "white" }} className="ce-finding" data-testid="findings-f3">
      <div className="ce-finding-text">
        <FindingText n={3} copy={copy} />
        <Figures>
          {last && <li>Runway at <span data-testid="findings-runway-quarter">{qLabel(last.quarter)}</span>, the last quarter where it can be computed: <Val testId="findings-runway-months" refData={{ computed: "cash ÷ burn per month (−TTM operating cash flow ÷ 12)", inputs: [last.cash, ttmRef] }} text={`${last.runwayMonths.toFixed(1)} months`} onSelect={(r) => select(`runway, ${qLabel(last.quarter)}`, r)} /></li>}
          {f.event && <li>{f.event.title}: <Val testId="findings-event-date" refData={{ event: f.event }} text={f.event.dateLabel} onSelect={(r) => select(`event, ${f.event.dateLabel}`, r)} />{f.monthsToEvent !== null && <>, <span data-testid="findings-months-to-event">{f.monthsToEvent.toFixed(1)}</span> months after that quarter end</>}</li>}
          {f.later.length > 0 && <li data-testid="findings-runway-later">Later quarters: {f.later.map((r) => `${qLabel(r.quarter)} ${r.status}`).join("; ")}</li>}
        </Figures>
        <EvidenceLinks tabs={copy.evidenceTabs} onOpenTab={onOpenTab} />
      </div>
      <div className="ce-finding-evidence" data-testid="findings-f3-chart">
        <LineChart testId="findings-chart-cash" title="Cash at quarter end, with dated events" xLabel="Quarter" yLabel="$ millions" xTicks={xTicks}
          points={points} formatY={(v) => `$${v.toFixed(0)}M`}
          markers={record.events.map((e) => ({ x: eventX(e.date), label: e.dateLabel }))}
          onPointClick={(p) => p.r && select(`cash, ${p.label}`, p.r.cash)} />
        <ol style={{ fontSize: 12, lineHeight: 1.45, paddingLeft: 18, margin: "6px 0 0" }} className="ce-findings-events" data-testid="findings-events">
          {record.events.map((e) => (
            <li key={e.id}><Val refData={{ event: e }} text={e.dateLabel} onSelect={(x) => select(`event, ${e.dateLabel}`, x)} />: {e.title}</li>
          ))}
        </ol>
      </div>
    </article>
  );
}

export function FindingsTab({ profile, portfolio, onOpenTab }) {
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
  const copy = profile.findings;
  const data = useMemo(() => (record ? dataFigures(record) : null), [record]);

  if (!copy) return <Callout tone="info">No findings are configured for {profile.label}.</Callout>;
  if (error) return <Callout tone="bad">The public-record snapshot could not be loaded.</Callout>;
  if (!record) return <p style={styles.note}>Loading the public-record snapshot…</p>;
  const benchmark = profile.benchmarks.find((b) => b.id === copy.benchmarkId);
  const [f1, f2, f3] = copy.findings;
  const rating = dealerSettings(profile.defaults?.dealerView).rating;
  const dataText = { ...data, firstQuarter: qLabel(data.firstQuarter), lastQuarter: qLabel(data.lastQuarter) };
  return (
    <div data-testid="findings-view" className="ce-findings">
      <section style={{ marginBottom: 14 }} data-testid="findings-question">
        <p style={{ ...sectionTitle, marginBottom: 4 }}>{copy.title}</p>
        <h2 style={{ fontSize: 20, margin: "0 0 6px", color: "#0f172a" }} data-testid="findings-question-text">
          {benchmark ? copy.question(benchmark.value) : copy.question("—")}
        </h2>
        {benchmark && (
          <p style={{ ...styles.note, marginBottom: 0 }}>
            {copy.questionNote}{" "}
            <Val testId="findings-benchmark" refData={{ citation: { text: benchmark.population, source: benchmark.source } }} text="Source" onSelect={(r) => select("FICO benchmark", r)} />
          </p>
        )}
      </section>
      <div className="ce-no-print"><LineagePanel selected={selected} onClose={() => setSelected(null)} /></div>

      <div className="ce-findings-intro" style={styles.grid2}>
        <section style={styles.panel} data-testid="findings-data">
          <h3 style={sectionTitle}>Data</h3>
          <ul style={{ fontSize: 13, lineHeight: 1.5, paddingLeft: 18 }}>{copy.data(dataText).map((t) => <li key={t}>{t}</li>)}</ul>
          <EvidenceLinks tabs={["public_record"]} onOpenTab={onOpenTab} label="Data provenance" />
        </section>
        <section style={styles.panel} data-testid="findings-method">
          <h3 style={sectionTitle}>Method</h3>
          <ul style={{ fontSize: 13, lineHeight: 1.5, paddingLeft: 18 }}>{copy.method({ ...data, rating }).map((t) => <li key={t}>{t}</li>)}</ul>
          <EvidenceLinks tabs={["public_record", "funding", "dealers"]} onOpenTab={onOpenTab} label="Methods in use" />
        </section>
      </div>

      <section style={{ marginBottom: 12 }} data-testid="findings-findings">
        <h3 style={sectionTitle}>Findings</h3>
        <PricingLag copy={f1} record={record} fundingDefaults={profile.defaults?.fundingRates} select={select} onOpenTab={onOpenTab} />
        <Concentration copy={f2} profile={profile} portfolio={portfolio} select={select} onOpenTab={onOpenTab} />
        <Runway copy={f3} record={record} select={select} onOpenTab={onOpenTab} />
      </section>

      <section style={styles.panel} data-testid="findings-limits">
        <h3 style={sectionTitle}>Limits</h3>
        <ul style={{ fontSize: 13, lineHeight: 1.5, paddingLeft: 18 }}>{copy.limits.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
      <p className="ce-no-print" style={{ marginTop: 12 }}>
        <button type="button" style={styles.btnSmall} onClick={() => window.print()} data-testid="findings-print">Print the brief</button>
        <span style={{ fontSize: 12, color: "#64748b", marginLeft: 8 }}>Use “Save as PDF” in the print dialog for a one-page PDF.</span>
      </p>
    </div>
  );
}

// src/ui/sandbox/PolicySandboxView.jsx — Policy Sandbox tab: the shared portfolio's application
// pool scored under the baseline credit policy and an editable candidate policy. Shows the swap set,
// the change in volume, presented credit quality and expected loss under two views of swap-in risk,
// the dealer mix, and a printable one-page impact summary. Every figure comes from
// src/policySandbox.js; this component names no lender.

import React, { useEffect, useMemo, useState } from "react";
import { styles, money, pct } from "../theme.js";
import { Callout } from "../components/primitives.jsx";
import { Val, LineagePanel } from "../publicRecord/PublicRecordView.jsx";
import { CREDIT_POLICY } from "../../creditRisk.js";
import { dealerSettings } from "../../dealers.js";
import { SANDBOX_DEFAULTS, CANDIDATE_RANGES, POLICY_PRESETS, CELL_LABELS, applyPreset, simulatePool, swapSet, maxFundedDti } from "../../policySandbox.js";

const DEBOUNCE_MS = 150;
const REVIEW_NOTE = "Review treated as not funded, matching the baseline book.";

const FIELDS = [
  { key: "ficoDecline", label: "FICO floor (decline below)", format: (v) => String(v) },
  { key: "dtiDecline", label: "DTI decline cap (decline above)", format: (v) => pct(v, 0) },
  { key: "dtiWatchLow", label: "DTI watch threshold (review at or above)", format: (v) => pct(v, 0) },
  { key: "liquidityCheckingMin", label: "Liquidity rule: checking balance below", format: (v) => money(v) },
  { key: "liquidityDtiMin", label: "Liquidity rule: applies above DTI", format: (v) => pct(v, 0) }
];
const isPercent = (key) => key !== "ficoDecline" && key !== "liquidityCheckingMin";

function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function AssumptionTag({ status = "assumption" }) {
  return <span style={{ ...styles.chip, background: "white", color: "#92400e", border: "1px solid #d97706", marginLeft: 6, fontSize: 11 }}>{status}</span>;
}

function PolicySlider({ field, value, onChange, max }) {
  const range = CANDIDATE_RANGES[field.key];
  const scale = isPercent(field.key) ? 100 : 1;
  const hi = max ?? range.max;
  return (
    <label style={{ display: "block", fontSize: 13, color: "#334155", marginBottom: 10 }}>
      <span>{field.label}: <strong data-testid={`candidate-${field.key}-value`}>{field.format(value)}</strong></span>
      <input type="range" min={Math.round(range.min * scale)} max={Math.round(hi * scale)} step={Math.round(range.step * scale)}
        value={Math.round(value * scale)} onChange={(e) => onChange(Number(e.target.value) / scale)}
        style={{ width: "100%" }} aria-label={field.label} data-testid={`candidate-${field.key}`} />
    </label>
  );
}

/** The candidate's changes from the baseline, as "label: before → after". */
function changeList(baseline, candidate) {
  return FIELDS.filter((f) => candidate[f.key] !== baseline[f.key]).map((f) => `${f.label}: ${f.format(baseline[f.key])} → ${f.format(candidate[f.key])}`);
}

const signed = (v, fmt) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v))}`);
const pp = (v) => `${(v * 100).toFixed(1)} pp`;
const count = (n) => n.toLocaleString("en-US");

function kpiRows(result, inferred) {
  const A = result.totals.A, B = result.totals.B;
  const elB = inferred ? B.expectedLossInferred : B.expectedLoss;
  const rateB = inferred ? B.expectedLossRateInferred : B.expectedLossRate;
  const view = inferred ? `conservative inferred (swap-in PD × ${result.inferredMultiplier}, assumption)` : "synthetic truth (model PD)";
  const lgd = pct(result.lgd, 0);
  return [
    { id: "approval", label: `Approval rate (of the ${count(result.poolSize)}-application pool)`, a: A.approvalRate, b: B.approvalRate, fmt: (v) => pct(v), delta: (x, y) => signed(y - x, pp), ref: `funded applications ÷ the ${count(result.poolSize)}-application pool` },
    { id: "funded", label: "Funded loans", a: A.funded, b: B.funded, fmt: count, delta: (x, y) => signed(y - x, count), ref: "pool applications the policy approves (review is not funded)" },
    { id: "volume", label: "Funded volume", a: A.volume, b: B.volume, fmt: money, delta: (x, y) => signed(y - x, money), ref: "Σ loan amount (EAD) of funded applications" },
    { id: "fico", label: "Average presented FICO", a: A.avgFico, b: B.avgFico, fmt: (v) => (v === null ? "—" : v.toFixed(1)), delta: (x, y) => (x === null || y === null ? "—" : signed(y - x, (v) => v.toFixed(1))), ref: "mean presented credit score of funded applications" },
    { id: "el", label: "Expected loss", a: A.expectedLoss, b: elB, fmt: money, delta: (x, y) => signed(y - x, money), ref: `Σ PD × LGD ${lgd} × EAD over funded applications; PD from the dealer simulation; candidate view: ${view}` },
    { id: "elRate", label: "Expected loss rate", a: A.expectedLossRate, b: rateB, fmt: (v) => pct(v, 2), delta: (x, y) => (x === null || y === null ? "—" : signed(y - x, (v) => `${(v * 100).toFixed(2)} pp`)), ref: `expected loss ÷ funded volume; candidate view: ${view}` }
  ];
}

function SwapCell({ id, cell, select, inferred, multiplier }) {
  const el = id === "swapIn" && inferred ? cell.expectedLossInferred : cell.expectedLoss;
  const review = id === "swapIn" ? `${count(cell.reviewA)} came from review` : id === "swapOut" ? `${count(cell.reviewB)} go to review` : id === "neither" ? `${count(cell.reviewA)} in review under the baseline, ${count(cell.reviewB)} under the candidate` : null;
  return (
    <td style={{ ...styles.td, verticalAlign: "top", background: id === "swapIn" ? "#ecfdf5" : id === "swapOut" ? "#fef2f2" : "white" }} data-testid={`swap-cell-${id}`}>
      <div style={{ fontWeight: 700, fontSize: 12, color: "#334155" }}>{CELL_LABELS[id]}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>
        <Val testId={`swap-count-${id}`} refData={{ computed: `pool applications in this cell under decide() for both policies (${REVIEW_NOTE.toLowerCase()})` }} text={count(cell.count)} onSelect={(r) => select(`${CELL_LABELS[id]}: count`, r)} />
        <span style={{ fontSize: 12, fontWeight: 400, color: "#475569" }}> ({pct(cell.share)} of pool)</span>
      </div>
      {review && <div style={{ fontSize: 12, color: "#475569" }} data-testid={`swap-review-${id}`}>{review}</div>}
      {cell.count > 0 && (
        <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.6, marginTop: 4 }}>
          Avg presented FICO {cell.avgFico === null ? "—" : cell.avgFico.toFixed(0)} · avg DTI {pct(cell.avgDti)}<br />
          EAD {money(cell.ead)} · avg PD {pct(cell.avgPd, 2)}<br />
          Expected loss <Val testId={`swap-el-${id}`} refData={{ computed: `Σ PD × LGD × EAD over this cell${id === "swapIn" && inferred ? `, swap-in PD × ${multiplier} (assumption)` : ", PD from the dealer simulation (synthetic truth)"}` }} text={money(el)} onSelect={(r) => select(`${CELL_LABELS[id]}: expected loss`, r)} />
          {id === "swapIn" && <> ({inferred ? "conservative inferred" : "synthetic truth"})</>}
        </div>
      )}
    </td>
  );
}

function ImpactSummary({ baseline, candidate, result, inferred, rows, mixShifts, onPrint }) {
  const [why, setWhy] = useState("");
  const [bound, setBound] = useState("");
  const changes = changeList(baseline, candidate);
  const c = result.cells;
  const assumption = inferred
    ? `Swap-in risk shown as conservative inferred: swap-in PD × ${result.inferredMultiplier} (assumption).`
    : `Swap-in risk shown as synthetic truth (model PD). A lender never observes how swap-ins would have performed; the conservative view multiplies their PD by ${result.inferredMultiplier} (assumption).`;
  return (
    <section style={{ ...styles.panel, background: "white" }} className="ce-sandbox-summary" data-testid="sandbox-summary">
      <h3 style={styles.panelTitle}>Impact summary</h3>
      <ol style={{ fontSize: 13, lineHeight: 1.55, paddingLeft: 18, margin: 0 }}>
        <li data-testid="summary-change">
          <strong>The change:</strong> {changes.length ? changes.join("; ") : "none (candidate equals the baseline)"}.
          <div>
            <strong>Why:</strong>{" "}
            <span className="ce-print-only" data-testid="summary-why-text">{why || "(not stated)"}</span>
            <textarea className="ce-no-print" value={why} onChange={(e) => setWhy(e.target.value)} rows={2} aria-label="Reason for the change"
              placeholder="State the reason for the change before printing" style={{ ...styles.seedInput, display: "block", marginTop: 4 }} data-testid="summary-why" />
          </div>
        </li>
        <li data-testid="summary-numbers">
          <strong>Before and after:</strong>{" "}
          {rows.map((r) => `${r.label} ${r.fmt(r.a)} → ${r.fmt(r.b)} (${r.delta(r.a, r.b)})`).join("; ")}.
        </li>
        <li data-testid="summary-swaps">
          <strong>Swap set</strong> over {count(result.poolSize)} applications: {count(c.keep.count)} funded under both, {count(c.swapIn.count)} swap-ins ({count(c.swapIn.reviewA)} from review), {count(c.swapOut.count)} swap-outs ({count(c.swapOut.reviewB)} to review), {count(c.neither.count)} funded under neither. {REVIEW_NOTE} {assumption}
        </li>
        <li data-testid="summary-mix">
          <strong>Mix shifts</strong> (share of funded volume): {mixShifts.length ? mixShifts.map((m) => `${m.dealer} ${pct(m.shareA)} → ${pct(m.shareB)}`).join("; ") : "none"}. Dealer ratings are not recomputed under the candidate.
        </li>
        <li data-testid="summary-fair-lending"><strong>Fair-lending review: out of scope for synthetic data.</strong></li>
        <li data-testid="summary-pilot">
          <strong>Champion/challenger plan:</strong> Pilot on 10% of applications; stop if 30+ DPD on swap-ins exceeds{" "}
          <span className="ce-print-only">{bound ? `${bound}%` : "[bound]"}</span>
          <input className="ce-no-print" type="text" inputMode="decimal" value={bound} onChange={(e) => setBound(e.target.value)} placeholder="[bound]" aria-label="Stop bound for 30+ DPD on swap-ins (%)"
            style={{ width: 80, padding: "2px 6px", border: "1px solid #cbd5e1", borderRadius: 4 }} data-testid="summary-bound" />
          {" "}at 6 months on book. <span style={{ color: "#92400e" }}>The bound is a placeholder to set before the pilot.</span>
        </li>
        <li data-testid="summary-signoff"><strong>Sign-off:</strong> Prepared by ____________ · Reviewed by ____________ · Date ____________</li>
      </ol>
      <p style={{ fontSize: 11, color: "#64748b", margin: "8px 0 0" }}>Synthetic applications and simulated loan outcomes; not a consumer report and not any lender's actual policy.</p>
      <p className="ce-no-print" style={{ marginTop: 10, marginBottom: 0 }}>
        <button type="button" style={styles.btnSmall} onClick={onPrint} data-testid="sandbox-print">Print the impact summary</button>
        <span style={{ fontSize: 12, color: "#64748b", marginLeft: 8 }}>Use “Save as PDF” in the print dialog for a one-page PDF.</span>
      </p>
    </section>
  );
}

function Sandbox({ pool, dealers, settings, applications }) {
  const [candidate, setCandidate] = useState({ ...CREDIT_POLICY });
  const [inferred, setInferred] = useState(false);
  const [multiplier, setMultiplier] = useState(SANDBOX_DEFAULTS.inferredMultiplier.value);
  const [selected, setSelected] = useState(null);
  const select = (title, ref) => ref && setSelected({ title, ref });
  const policy = useDebounced(candidate, DEBOUNCE_MS);
  const mult = useDebounced(multiplier, DEBOUNCE_MS);

  // Dealer, PD and outcome per application depend only on the dealer settings: simulated once here,
  // then every policy change only re-filters.
  const loans = useMemo(() => simulatePool(pool, dealers, settings), [pool, dealers, settings]);
  const lgd = 1 - settings.dealerFailure.baseRecovery.value;
  const result = useMemo(() => swapSet(pool, CREDIT_POLICY, policy, { loans, lgd, inferredMultiplier: mult, dealers }), [pool, policy, loans, lgd, mult, dealers]);
  const baselineMaxDti = useMemo(() => maxFundedDti(pool, CREDIT_POLICY), [pool]);
  const rows = kpiRows(result, inferred);

  const setField = (key) => (value) => setCandidate((c) => {
    const next = { ...c, [key]: value };
    if (key === "dtiDecline" && next.dtiWatchLow > value) next.dtiWatchLow = value;
    return next;
  });
  const { cells } = result;
  const swaps = cells.swapIn.count + cells.swapOut.count;
  const capChanged = policy.dtiDecline !== CREDIT_POLICY.dtiDecline;
  const watchBinds = capChanged && baselineMaxDti !== null && baselineMaxDti < Math.min(policy.dtiDecline, CREDIT_POLICY.dtiDecline) && policy.dtiWatchLow <= Math.min(policy.dtiDecline, CREDIT_POLICY.dtiDecline);
  const volA = result.totals.A.volume, volB = result.totals.B.volume;
  const elKey = inferred ? "expectedLossInferred" : "expectedLoss";
  const mixRows = [...result.dealerMix.top, result.dealerMix.rest];
  const mixShifts = mixRows
    .map((r) => ({ dealer: r.dealer, shareA: volA ? r.A.volume / volA : 0, shareB: volB ? r.B.volume / volB : 0 }))
    .filter((m) => Math.abs(m.shareB - m.shareA) >= 0.0005)
    .sort((a, b) => Math.abs(b.shareB - b.shareA) - Math.abs(a.shareB - a.shareA))
    .slice(0, 3);

  return (
    <>
      <p style={styles.note} className="ce-no-print" data-testid="sandbox-pool">
        Pool: the {count(pool.length)} synthetic applications the baseline needed to fund {count(result.totals.A.funded)} loans ({count(applications)} generated, seed {settings.portfolio.seed}). Funded means credit-policy APPROVE. <strong data-testid="sandbox-review-note">{REVIEW_NOTE}</strong> <span data-testid="sandbox-strength">Loan outcomes are simulated at the profile's default dealer-effect strength, {settings.dealerEffect.strength}<AssumptionTag status={settings.dealerEffect.status} />; a strength chosen in the Dealer View does not apply here.</span>
      </p>
      <div className="ce-no-print"><LineagePanel selected={selected} onClose={() => setSelected(null)} /></div>

      <div style={styles.grid2} className="ce-no-print">
        <section style={styles.panel} data-testid="sandbox-baseline">
          <h3 style={styles.panelTitle}>Baseline policy (read-only)</h3>
          <ul style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
            {FIELDS.map((f) => <li key={f.key}>{f.label}: <strong>{f.format(CREDIT_POLICY[f.key])}</strong></li>)}
          </ul>
        </section>
        <section style={styles.panel} data-testid="sandbox-candidate">
          <h3 style={styles.panelTitle}>Candidate policy</h3>
          {FIELDS.map((f) => (
            <PolicySlider key={f.key} field={f} value={candidate[f.key]} onChange={setField(f.key)} max={f.key === "dtiWatchLow" ? candidate.dtiDecline : undefined} />
          ))}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} role="group" aria-label="Presets">
            {POLICY_PRESETS.map((p) => (
              <button key={p.id} type="button" style={styles.btnSmall} onClick={() => setCandidate(applyPreset(p))} data-testid={`preset-${p.id}`}>{p.label}</button>
            ))}
          </div>
        </section>
      </div>

      <section style={{ ...styles.panel, marginBottom: 16 }} className="ce-no-print" data-testid="panel-swap-set">
        <h3 style={styles.panelTitle}>1. Swap set</h3>
        <div style={styles.tableContainer}>
          <table style={styles.table} data-testid="swap-table">
            <caption style={{ captionSide: "top", textAlign: "left", padding: "6px 10px", fontSize: 12, color: "#475569" }}>Rows: baseline policy. Columns: candidate policy. {REVIEW_NOTE}</caption>
            <thead><tr><th style={styles.th} /><th style={styles.th}>Candidate: funded</th><th style={styles.th}>Candidate: not funded</th></tr></thead>
            <tbody>
              <tr><th style={styles.th} scope="row">Baseline: funded</th><SwapCell id="keep" cell={cells.keep} select={select} inferred={inferred} multiplier={mult} /><SwapCell id="swapOut" cell={cells.swapOut} select={select} inferred={inferred} multiplier={mult} /></tr>
              <tr><th style={styles.th} scope="row">Baseline: not funded</th><SwapCell id="swapIn" cell={cells.swapIn} select={select} inferred={inferred} multiplier={mult} /><SwapCell id="neither" cell={cells.neither} select={select} inferred={inferred} multiplier={mult} /></tr>
            </tbody>
          </table>
        </div>
        {swaps === 0 && result.unchangedFundingMoves > 0 && (
          <Callout tone="info">
            <span data-testid="sandbox-no-swaps">No swaps: {count(result.unchangedFundingMoves)} applications move between review and decline, which changes no funding because review is not funded.</span>
          </Callout>
        )}
        {watchBinds && (
          <Callout tone="info">
            <span data-testid="sandbox-watch-note">Every application the baseline funds has a presented back-end DTI below {pct(policy.dtiWatchLow, 0)} (highest {(Math.floor(baselineMaxDti * 10000) / 100).toFixed(2)}%, truncated), so the {pct(policy.dtiWatchLow, 0)} watch threshold, not the decline cap, is what limits volume. Moving the cap alone only moves applications between review and decline.</span>
          </Callout>
        )}
      </section>

      <section style={{ ...styles.panel, marginBottom: 16 }} className="ce-no-print" data-testid="panel-kpis">
        <h3 style={styles.panelTitle}>2. Change in volume, credit quality and expected loss</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", fontSize: 13, marginBottom: 10 }} role="radiogroup" aria-label="Swap-in risk view">
          <label><input type="radio" name="risk-view" checked={!inferred} onChange={() => setInferred(false)} data-testid="view-truth" /> Synthetic truth (model PD)</label>
          <label><input type="radio" name="risk-view" checked={inferred} onChange={() => setInferred(true)} data-testid="view-inferred" /> Conservative inferred</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Swap-in PD multiplier
            <input type="number" min={1} max={5} step={0.1} value={multiplier} onChange={(e) => setMultiplier(Math.max(0, Number(e.target.value)))} style={{ width: 70, padding: "3px 6px" }} aria-label="Swap-in PD multiplier" data-testid="inferred-multiplier" />
            <AssumptionTag status={SANDBOX_DEFAULTS.inferredMultiplier.status} />
          </label>
        </div>
        <p style={{ ...styles.note, fontSize: 12 }}>A real lender never observes how swap-ins would have performed. Here the synthetic truth is known, so it is shown next to the conservative estimate a lender would have to use: {SANDBOX_DEFAULTS.inferredMultiplier.note}</p>
        <div style={styles.tableContainer}>
          <table style={styles.table} data-testid="kpi-table">
            <thead><tr>{["Measure", "Baseline", "Candidate", "Change"].map((h, i) => <th key={h} style={i ? { ...styles.th, ...styles.num } : styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`kpi-${r.id}`}>
                  <td style={styles.td}>{r.label}</td>
                  <td style={{ ...styles.td, ...styles.num }}><Val testId={`kpi-${r.id}-a`} refData={{ computed: `${r.ref}; baseline policy` }} text={r.fmt(r.a)} onSelect={(x) => select(`${r.label}, baseline`, x)} /></td>
                  <td style={{ ...styles.td, ...styles.num }}><Val testId={`kpi-${r.id}-b`} refData={{ computed: `${r.ref}; candidate policy` }} text={r.fmt(r.b)} onSelect={(x) => select(`${r.label}, candidate`, x)} /></td>
                  <td style={{ ...styles.td, ...styles.num }} data-testid={`kpi-${r.id}-delta`}>{r.delta(r.a, r.b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ ...styles.panel, marginBottom: 16 }} className="ce-no-print" data-testid="panel-dealer-mix">
        <h3 style={styles.panelTitle}>3. Dealer mix</h3>
        <p style={{ ...styles.note, fontSize: 12 }}>The {result.dealerMix.top.length} dealers with the largest baseline funded volume, then all other dealers together. Dealer ratings depend on who is in the book and are not recomputed under the candidate; that is a later item.</p>
        <div style={styles.tableContainer}>
          <table style={{ ...styles.table, fontSize: 12 }} data-testid="dealer-mix-table">
            <thead><tr>{["Dealer", "Funded (baseline)", "Funded (candidate)", "Change", "Share of volume", "Expected loss (baseline)", "Expected loss (candidate)"].map((h, i) => <th key={h} style={i ? { ...styles.th, ...styles.num } : styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {mixRows.map((r) => (
                <tr key={r.dealerId} data-testid={`mix-${r.dealerId}`}>
                  <td style={{ ...styles.td, whiteSpace: "nowrap" }}>{r.dealer}{r.dealerId === "OTHER" ? ` (${r.dealers})` : ""}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{count(r.A.funded)}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{count(r.B.funded)}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{signed(r.B.funded - r.A.funded, count)}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{pct(volA ? r.A.volume / volA : 0)} → {pct(volB ? r.B.volume / volB : 0)}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{money(r.A.expectedLoss)}</td>
                  <td style={{ ...styles.td, ...styles.num }}>
                    <Val testId={`mix-el-${r.dealerId}`} refData={{ computed: `Σ PD × LGD × EAD over this dealer's applications funded under the candidate (${inferred ? `swap-in PD × ${mult}, assumption` : "synthetic truth"})` }} text={money(r.B[elKey])} onSelect={(x) => select(`${r.dealer}: candidate expected loss`, x)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ImpactSummary baseline={CREDIT_POLICY} candidate={policy} result={result} inferred={inferred} rows={rows} mixShifts={mixShifts} onPrint={() => window.print()} />
    </>
  );
}

export function PolicySandboxTab({ profile, portfolio }) {
  const ready = portfolio.status === "done" && portfolio.profile?.id === profile.id && Array.isArray(portfolio.pool);
  const stale = portfolio.status === "done" && portfolio.profile?.id !== profile.id;
  const { seed, count: target } = dealerSettings(profile.defaults?.dealerView).portfolio;
  return (
    <div data-testid="policy-sandbox" className="ce-sandbox">
      <div className="ce-no-print">
        <p style={styles.note}>
          What happens if the credit policy changes? The same pool of synthetic applications is scored under the baseline policy and a candidate policy, so every difference comes from the rule change.
        </p>
        {!ready && (
          <>
            {stale && <p style={styles.note} data-testid="sandbox-stale">The portfolio was generated under {portfolio.profile.label}. Generate it again under {profile.label}.</p>}
            <p style={styles.note}>The pool is built in the same pass as the funded portfolio shared with the Dealer View{target ? ` (${target.toLocaleString("en-US")} loans)` : ""}.</p>
            <button style={{ ...styles.btnPrimary, width: "auto", padding: "8px 14px" }} onClick={() => portfolio.generate(profile)} disabled={portfolio.status === "running"} data-testid="sandbox-generate">
              Generate portfolio (seed {seed})
            </button>
            {portfolio.status === "running" && <span style={{ fontSize: 13, color: "#475569", marginLeft: 10 }} data-testid="sandbox-progress" aria-live="polite">Generating… {Math.round(portfolio.progress * 100)}%</span>}
          </>
        )}
      </div>
      {ready && <Sandbox key={portfolio.pool.length} pool={portfolio.pool} dealers={portfolio.dealers} settings={portfolio.settings} applications={portfolio.applications} />}
    </div>
  );
}

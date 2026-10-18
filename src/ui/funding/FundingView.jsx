// src/ui/funding/FundingView.jsx — Funding & Rates tab: pricing lag, backbook and liquidity,
// rate paths over the holding period, credit loss, and the active profile's sourced history. Every number is computed by
// src/fundingStress.js; every default, source and historical fact comes from the active lender
// profile, so this component names no lender.

import React, { useEffect, useMemo, useState } from "react";
import { styles, money, pct } from "../theme.js";
import { MetricCard, Callout } from "../components/primitives.jsx";
import { useActiveProfile } from "../../profiles/activeProfile.js";
import { platformFee, breakEvenShockBps, backbookImpact, liquidityPath, loanCapStatus, expectedLoss } from "../../fundingStress.js";
import { simulateLoans, withDealerEffect } from "../../dealers.js";
import { LineChart } from "./LineChart.jsx";
import { RATE_PATH_DEFAULTS, triangularHolding, flatPath, linearPath, pathFee, feeAtSaleFn, historicalWindows } from "../../ratePaths.js";

const ANALYSIS = "The model shows why a long, low-coupon, fixed-rate loan priced at approval but sold later is highly sensitive to rate moves during the hold period.";
const SHOCK_GRID = Array.from({ length: 41 }, (_, i) => i * 10);

function StatusTag({ entry }) {
  const disclosed = entry.status?.startsWith("disclosed");
  return (
    <span
      title={entry.note ?? entry.citation ?? undefined}
      style={{ ...styles.chip, background: "white", fontSize: 11, marginLeft: 6, color: disclosed ? "#065f46" : "#92400e", border: `1px solid ${disclosed ? "#059669" : "#d97706"}` }}
    >
      {entry.status}
    </span>
  );
}

function SourceLink({ source }) {
  if (!source) return null;
  return <a href={source.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, marginLeft: 6 }}>source</a>;
}

function Slider({ label, entry, value, onChange, min, max, step, format, testId }) {
  return (
    <label style={{ display: "block", fontSize: 13, color: "#334155", marginBottom: 10 }}>
      <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
        {label}: <strong style={{ marginLeft: 6 }}>{format(value)}</strong>
        <StatusTag entry={entry} /><SourceLink source={entry.source} />
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%" }} aria-label={label} data-testid={testId} />
    </label>
  );
}

function NumberInput({ label, entry, value, onChange, step = 1, format, testId }) {
  return (
    <label style={{ display: "block", fontSize: 13, color: "#334155", marginBottom: 10 }}>
      <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
        {label}<StatusTag entry={entry} /><SourceLink source={entry.source} />
      </span>
      <input type="number" value={value} step={step} onChange={(e) => onChange(Number(e.target.value))} style={{ ...styles.seedInput, marginBottom: 2 }} aria-label={label} data-testid={testId} />
      {format && <span style={{ fontSize: 11, color: "#64748b" }}>{format(value)}</span>}
      {entry.note && <span style={{ display: "block", fontSize: 11, color: "#64748b" }}>{entry.note}</span>}
    </label>
  );
}

const pctFmt = (v, d = 2) => `${(v * 100).toFixed(d)}%`;
const per100 = (v) => `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
const signedMoney = (v) => (v < 0 ? `−${money(-v)}` : money(v));
const bpsFmt = (v) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)} bps`);
const CREDIT_SPREAD_NOTE = "Treasury-only paths understate losses; credit spreads also widened in 2022.";

function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const SCENARIO_PATHS = [
  { id: "flat", label: "Flat", detail: "no move", path: flatPath() },
  ...[100, 200, 300].map((bps) => ({ id: `up${bps}`, label: `+${bps} bps`, detail: `straight line over ${RATE_PATH_DEFAULTS.rampDays} days, then held`, path: linearPath(bps) })),
  { id: "down100", label: "−100 bps", detail: `straight line over ${RATE_PATH_DEFAULTS.rampDays} days, then held`, path: linearPath(-100) }
];

/** Rate paths over an uncertain holding time, with historical windows when the profile has them. */
function RatePathsPanel({ feeParams, breakEven, profile }) {
  const [holdingInput, setHoldingInput] = useState({ min: RATE_PATH_DEFAULTS.holding.min, mode: RATE_PATH_DEFAULTS.holding.mode, max: RATE_PATH_DEFAULTS.holding.max });
  const [history, setHistory] = useState(null);
  const source = profile.ratePathHistory ?? null;
  useEffect(() => {
    let live = true;
    setHistory(null);
    source?.load().then((h) => live && setHistory(h)).catch(() => live && setHistory({ error: true }));
    return () => { live = false; };
  }, [source]);
  const params = useDebounced(feeParams, 150);
  const h = useDebounced(holdingInput, 150);
  const holdingValid = h.min >= 1 && h.min <= h.mode && h.mode <= h.max && h.max <= 365;
  const holding = useMemo(() => (holdingValid ? triangularHolding(h) : null), [holdingValid, h]);
  const scenarios = useMemo(() => {
    if (!holding) return [];
    const fee = feeAtSaleFn(params);
    return SCENARIO_PATHS.map((s) => ({ ...s, ...pathFee(params, s.path, holding, fee) }));
  }, [params, holding]);
  const windows = useMemo(
    () => (history?.observations && holding ? historicalWindows(history.observations, source.year, params, { holding }) : null),
    [history, holding, params, source]
  );
  const setH = (key) => (e) => setHoldingInput((x) => ({ ...x, [key]: Number(e.target.value) }));
  const cell = { ...styles.td, ...styles.num };

  return (
    <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-rate-paths">
      <h3 style={styles.panelTitle}>Rate paths during the hold</h3>
      <p style={{ ...styles.note, fontSize: 12 }}>
        The single shock above moves the investor yield once. Here the yield follows a path while the loan waits to be sold, and the sale date itself is uncertain: the expected fee at sale is Σ p(t) × fee at sale(path(t)) over holding days t, with the pricing inputs above. Single-shock break-even for comparison: <strong data-testid="rate-paths-break-even">{breakEven === null ? ">1,000 bps" : `${breakEven.toFixed(1)} bps`}</strong>.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", fontSize: 13, marginBottom: 10 }} data-testid="holding-inputs">
        <span>Holding time (days), triangular<StatusTag entry={RATE_PATH_DEFAULTS.holding} />:</span>
        {["min", "mode", "max"].map((k) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {k === "mode" ? "most likely" : k}
            <input type="number" min={1} max={365} value={holdingInput[k]} onChange={setH(k)} style={{ width: 64, padding: "3px 6px" }} aria-label={`Holding days ${k === "mode" ? "most likely" : k}`} data-testid={`holding-${k}`} />
          </label>
        ))}
      </div>
      {!holdingValid && <Callout tone="warn"><span data-testid="holding-invalid">Holding days need 1 ≤ min ≤ most likely ≤ max ≤ 365.</span></Callout>}
      {holdingValid && (
        <div style={styles.tableContainer}>
          <table style={styles.table} data-testid="rate-paths-table">
            <thead><tr>{["Path", "Expected move over the hold", "Expected fee at sale", "Change from approval"].map((x, i) => <th key={x} style={i ? { ...styles.th, ...styles.num } : styles.th}>{x}</th>)}</tr></thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.id} data-testid={`rate-path-${s.id}`}>
                  <td style={styles.td}><strong>{s.label}</strong> <span style={{ color: "#64748b", fontSize: 12 }}>{s.detail}</span></td>
                  <td style={cell}>{bpsFmt(s.expectedShockBps)}</td>
                  <td style={{ ...cell, color: s.expectedFeeAtSale < 0 ? "#b91c1c" : "#047857", fontWeight: 600 }} data-testid={`rate-path-${s.id}-fee`}>{per100(s.expectedFeeAtSale)}</td>
                  <td style={cell}>{per100(s.expectedChange)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {source && holdingValid && (
        <div style={{ marginTop: 14 }} data-testid="rate-paths-historical">
          <h4 style={{ fontSize: 14, margin: "0 0 6px" }}>Historical {source.year}: {source.label}</h4>
          {!history && <p style={styles.note}>Loading the daily yield snapshot…</p>}
          {history?.error && <Callout tone="bad">The daily yield snapshot could not be loaded.</Callout>}
          {windows && (
            <>
              <p style={{ ...styles.note, fontSize: 12 }} data-testid="rate-paths-method">
                Forward-looking windows: each of the {windows.starts} business days from {windows.firstStart} to {windows.lastStart} is a start date, and the window is the yield change over the next 30, 60 or 90 calendar days, so the last windows run into {source.year + 1}. Missing days (market holidays) use the last prior observation, never interpolation, and the {windows.holidaysSkipped} holidays in {source.year} are not start dates. P50 and P95 are nearest-rank percentiles across start dates; the fee at P95 is the fee at the 95th-percentile rise.
              </p>
              <div style={styles.tableContainer}>
                <table style={styles.table} data-testid="historical-table">
                  <thead><tr>{["Window", "Start dates", "P50 move", "P95 move", "Fee at P50", "Fee at P95", "Windows with a negative fee"].map((x, i) => <th key={x} style={i ? { ...styles.th, ...styles.num } : styles.th}>{x}</th>)}</tr></thead>
                  <tbody>
                    {windows.fixed.map((w) => (
                      <tr key={w.days} data-testid={`historical-${w.days}`}>
                        <td style={styles.td}>{w.days} days</td>
                        <td style={cell}>{w.windows}</td>
                        <td style={cell}>{bpsFmt(w.p50Bps)}</td>
                        <td style={cell} data-testid={`historical-${w.days}-p95`}>{bpsFmt(w.p95Bps)}</td>
                        <td style={cell}>{per100(w.feeAtP50)}</td>
                        <td style={{ ...cell, color: w.feeAtP95 < 0 ? "#b91c1c" : undefined }} data-testid={`historical-${w.days}-fee-p95`}>{per100(w.feeAtP95)}</td>
                        <td style={cell}>{pct(w.negativeShare, 1)}</td>
                      </tr>
                    ))}
                    <tr data-testid="historical-weighted">
                      <td style={styles.td}>Holding-weighted ({h.min}–{h.max} days, most likely {h.mode})</td>
                      <td style={cell}>{windows.weighted.windows}</td>
                      <td style={cell}>—</td>
                      <td style={cell}>—</td>
                      <td style={cell}>{per100(windows.weighted.feeP50)}</td>
                      <td style={{ ...cell, color: windows.weighted.feeP95 < 0 ? "#b91c1c" : undefined }} data-testid="historical-weighted-fee-p95">{per100(windows.weighted.feeP95)}</td>
                      <td style={cell}>{pct(windows.weighted.negativeShare, 1)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 12, color: "#475569", margin: "8px 0 0" }} data-testid="rate-paths-source">
                Source: <a href={history.url} target="_blank" rel="noreferrer">FRED {history.series}</a>, {history.description}; built at build time from the committed raw file {history.builtFrom.file} (SHA-256 {history.builtFrom.sha256.slice(0, 12)}…, retrieved {history.builtFrom.retrievedAt.slice(0, 10)}){history.manifestEntry ? `; the derived file is hashed in the manifest (SHA-256 ${history.manifestEntry.sha256.slice(0, 12)}…)` : ""}. The browser never calls FRED.
              </p>
            </>
          )}
        </div>
      )}
      <p style={{ ...styles.note, fontWeight: 600, color: "#92400e", margin: "10px 0 0" }} data-testid="credit-spread-note">{CREDIT_SPREAD_NOTE}</p>
      {profile.ratePathQuotes && (
        <details style={{ marginTop: 12 }} data-testid="rate-path-quotes">
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>{profile.ratePathQuotes.title}</summary>
          {profile.ratePathQuotes.quotes.map((q) => (
            <figure key={q.id} style={{ margin: "10px 0 0" }} data-testid={`rate-path-quote-${q.id}`}>
              <figcaption style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{q.topic}</figcaption>
              <blockquote style={{ margin: "4px 0", padding: "6px 10px", borderLeft: "3px solid #cbd5e1", fontSize: 13, lineHeight: 1.5, color: "#0f172a" }}>“{q.text}”</blockquote>
              <p style={{ fontSize: 12, color: "#475569", margin: 0 }}>
                {q.citation}. <a href={q.source.url} target="_blank" rel="noreferrer">Source: {q.source.label}</a>
              </p>
            </figure>
          ))}
        </details>
      )}
    </section>
  );
}

function FundingModel({ defaults, portfolio, profile, history }) {
  const initial = useMemo(() => Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, v.value])), [defaults]);
  const [inputs, setInputs] = useState(initial);
  const [applyFailure, setApplyFailure] = useState(false);
  const set = (key) => (value) => setInputs((s) => ({ ...s, [key]: value }));

  const feeParams = useMemo(
    () => ({ dealerFeePct: inputs.dealerFeePct, coupon: inputs.coupon, termYears: inputs.termYears, yieldAtApproval: inputs.investorYieldAtApproval, cpr: inputs.cpr }),
    [inputs.dealerFeePct, inputs.coupon, inputs.termYears, inputs.investorYieldAtApproval, inputs.cpr]
  );
  const fee = platformFee({ ...feeParams, rateShockBps: inputs.rateShockBps });
  const breakEven = useMemo(() => breakEvenShockBps(feeParams), [feeParams]);
  const curve = useMemo(() => SHOCK_GRID.map((bps) => ({ x: bps, y: platformFee({ ...feeParams, rateShockBps: bps }).feeAtSale })), [feeParams]);

  const backbook = backbookImpact({ unsoldBalance: inputs.unsoldBalance, ...feeParams, rateShockBps: inputs.rateShockBps });
  const liquidity = liquidityPath({
    cash: inputs.cash, monthlyOpex: inputs.monthlyOpex, monthlyNewFees: inputs.monthlyNewFees,
    backbookLoss: Math.max(0, -backbook), lossRecognitionMonths: inputs.lossRecognitionMonths, minLiquidity: inputs.minLiquidity, months: 18
  });
  const cap = loanCapStatus({ unsoldBalance: inputs.unsoldBalance, loanCap: inputs.loanCap });
  const feePerLoan = (fee.feeAtSale / 100) * inputs.loanSize;

  const sentence = fee.feeAtSale < 0
    ? `A +${inputs.rateShockBps} bps move between approval and sale turns a ${per100(fee.feeAtApproval)} fee into ${per100(fee.feeAtSale)} per $100; on a ${money(inputs.unsoldBalance)} unsold backbook that is ${signedMoney(backbook)}${liquidity.breachMonth ? `, which breaches the ${money(inputs.minLiquidity)} liquidity minimum in month ${liquidity.breachMonth}` : `, and cash stays above the ${money(inputs.minLiquidity)} liquidity minimum for 18 months`}.`
    : `At +${inputs.rateShockBps} bps the fee at sale is still ${per100(fee.feeAtSale)} per $100 (${per100(fee.feeAtApproval)} at approval); it turns negative at about +${breakEven === null ? ">1,000" : breakEven.toFixed(0)} bps.`;

  // Credit loss from the Dealer View portfolio, when one has been generated under this profile.
  const portfolioReady = portfolio.status === "done" && portfolio.profile?.id === profile.id;
  const failure = portfolio.lastFailure && portfolio.lastFailure.profileId === profile.id ? portfolio.lastFailure : null;
  const strength = failure?.strength ?? portfolio.settings?.dealerEffect.strength ?? 1;
  const loans = useMemo(
    () => (portfolioReady ? simulateLoans(portfolio.inputs, portfolio.dealers, withDealerEffect(portfolio.settings, strength)) : null),
    [portfolioReady, portfolio.inputs, portfolio.dealers, portfolio.settings, strength]
  );
  const lgd = 1 - inputs.baseRecovery;
  const baseLoss = loans ? expectedLoss(loans, { lgd }) : null;
  const scenarioLoss = loans && failure && applyFailure ? expectedLoss(loans, { lgd, scenario: failure }) : null;

  return (
    <>
      <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-pricing-lag">
        <h3 style={styles.panelTitle}>A. Pricing lag</h3>
        <div style={styles.grid2}>
          <div>
            <Slider label="Coupon" entry={defaults.coupon} value={inputs.coupon} onChange={set("coupon")} min={defaults.coupon.range?.[0] ?? 0.01} max={defaults.coupon.range?.[1] ?? 0.12} step={0.0001} format={(v) => pctFmt(v)} testId="input-coupon" />
            <Slider label="Term (years)" entry={defaults.termYears} value={inputs.termYears} onChange={set("termYears")} min={defaults.termYears.range?.[0] ?? 1} max={defaults.termYears.range?.[1] ?? 30} step={1} format={String} testId="input-term" />
            <Slider label="Investor yield at approval" entry={defaults.investorYieldAtApproval} value={inputs.investorYieldAtApproval} onChange={set("investorYieldAtApproval")} min={0.01} max={0.12} step={0.0005} format={(v) => pctFmt(v)} testId="input-yield" />
          </div>
          <div>
            <Slider label="Dealer fee (per $100)" entry={defaults.dealerFeePct} value={inputs.dealerFeePct} onChange={set("dealerFeePct")} min={0} max={40} step={0.5} format={(v) => `$${v.toFixed(1)}`} testId="input-dealer-fee" />
            <Slider label="CPR" entry={defaults.cpr} value={inputs.cpr} onChange={set("cpr")} min={0} max={0.3} step={0.005} format={(v) => pctFmt(v, 1)} testId="input-cpr" />
            <Slider label="Rate shock between approval and sale (bps)" entry={defaults.rateShockBps} value={inputs.rateShockBps} onChange={set("rateShockBps")} min={defaults.rateShockBps.range?.[0] ?? 0} max={defaults.rateShockBps.range?.[1] ?? 400} step={5} format={(v) => `+${v}`} testId="input-shock" />
          </div>
        </div>
        <div style={styles.grid4}>
          <MetricCard title="Price at approval" value={`$${fee.priceAtApproval.toFixed(2)}`} color="#334155" subtitle="per $100 principal" />
          <MetricCard title="Price at sale" value={`$${fee.priceAtSale.toFixed(2)}`} color="#334155" subtitle="per $100 principal" />
          <MetricCard title="Fee at approval" value={per100(fee.feeAtApproval)} color={fee.feeAtApproval < 0 ? "#b91c1c" : "#047857"} subtitle="per $100 principal" />
          <MetricCard title="Fee at sale" value={per100(fee.feeAtSale)} color={fee.feeAtSale < 0 ? "#b91c1c" : "#047857"} subtitle="per $100 principal" />
          <MetricCard title="Modified duration" value={`${fee.modDuration.toFixed(2)} yrs`} color="#334155" subtitle={`WAL ${fee.wal.toFixed(1)} yrs`} />
          <div data-testid="tile-break-even">
            <MetricCard title="Break-even shock" value={breakEven === null ? ">1,000 bps" : `${breakEven.toFixed(1)} bps`} color="#b45309" subtitle="fee at sale reaches zero" />
          </div>
        </div>
        <NumberInput label="Loan size" entry={defaults.loanSize} value={inputs.loanSize} onChange={set("loanSize")} step={1000} format={(v) => `${money(v)} · fee at sale ${signedMoney(feePerLoan)} per loan`} testId="input-loan-size" />
        {defaults.loanSize.citation && <p style={{ ...styles.note, fontSize: 11, marginTop: -6 }} data-testid="loan-size-citation">Loan size default: {defaults.loanSize.citation}</p>}
        <LineChart
          testId="chart-fee-vs-shock"
          title="Fee at sale against the rate shock"
          xLabel="Rate shock (bps)" yLabel="Fee at sale per $100"
          points={curve}
          refLines={[{ y: 0, label: "Zero fee" }]}
          markers={breakEven !== null && breakEven <= 400 ? [{ x: breakEven, y: 0, label: `Break-even ${breakEven.toFixed(1)} bps` }] : []}
          formatX={(v) => `${Math.round(v)}`} formatY={(v) => per100(v)}
        />
      </section>

      <RatePathsPanel feeParams={feeParams} breakEven={breakEven} profile={profile} />

      <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-liquidity">
        <h3 style={styles.panelTitle}>B. Backbook and liquidity</h3>
        <div style={styles.grid2}>
          <div>
            <NumberInput label="Unsold backbook" entry={defaults.unsoldBalance} value={inputs.unsoldBalance} onChange={set("unsoldBalance")} step={10_000_000} format={money} testId="input-unsold" />
            <NumberInput label="Cash" entry={defaults.cash} value={inputs.cash} onChange={set("cash")} step={1_000_000} format={money} testId="input-cash" />
            <NumberInput label="Monthly opex" entry={defaults.monthlyOpex} value={inputs.monthlyOpex} onChange={set("monthlyOpex")} step={500_000} format={money} testId="input-opex" />
            <NumberInput label="Monthly new fees" entry={defaults.monthlyNewFees} value={inputs.monthlyNewFees} onChange={set("monthlyNewFees")} step={500_000} format={money} testId="input-new-fees" />
          </div>
          <div>
            <NumberInput label="Minimum liquidity" entry={defaults.minLiquidity} value={inputs.minLiquidity} onChange={set("minLiquidity")} step={1_000_000} format={money} testId="input-min-liquidity" />
            <NumberInput label="Loan cap" entry={defaults.loanCap} value={inputs.loanCap} onChange={set("loanCap")} step={10_000_000} format={money} testId="input-loan-cap" />
            <NumberInput label="Loss recognition months" entry={defaults.lossRecognitionMonths} value={inputs.lossRecognitionMonths} onChange={set("lossRecognitionMonths")} step={1} testId="input-recognition" />
          </div>
        </div>
        <div style={styles.grid4}>
          <MetricCard title="Backbook fee at sale" value={signedMoney(backbook)} color={backbook < 0 ? "#b91c1c" : "#047857"} subtitle={`at +${inputs.rateShockBps} bps`} />
          <MetricCard title="Months to liquidity breach" value={liquidity.breachMonth ?? "None in 18"} color="#b45309" subtitle={`minimum ${money(inputs.minLiquidity)}`} />
          <MetricCard title="Runway" value={liquidity.runwayMonths ? `${liquidity.runwayMonths} months` : "Beyond 18 months"} color="#334155" subtitle="until cash falls below zero" />
          <MetricCard title="Loan-cap utilisation" value={pct(cap.utilisation, 0)} color={cap.breached ? "#b91c1c" : "#334155"} subtitle={cap.breached ? "Cap breached" : "Within cap"} />
        </div>
        <p style={{ fontSize: 14, color: "#0f172a", lineHeight: 1.5 }} data-testid="liquidity-sentence">{sentence}</p>
        <LineChart
          testId="chart-cash"
          title="Cash at the end of each month"
          xLabel="Month" yLabel="Cash"
          points={liquidity.path.map((p) => ({ x: p.month, y: p.cash }))}
          refLines={[{ y: inputs.minLiquidity, label: "Minimum liquidity" }]}
          markers={liquidity.breachMonth ? [{ x: liquidity.breachMonth, y: liquidity.path[liquidity.breachMonth - 1].cash, label: `Breach, month ${liquidity.breachMonth}` }] : []}
          formatX={(v) => `${Math.round(v)}`} formatY={(v) => signedMoney(v)}
        />
      </section>

      <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-credit-loss">
        <h3 style={styles.panelTitle}>C. Credit loss</h3>
        <Slider label="Recovery" entry={defaults.baseRecovery} value={inputs.baseRecovery} onChange={set("baseRecovery")} min={0} max={0.6} step={0.01} format={(v) => pctFmt(v, 0)} testId="input-recovery" />
        {!portfolioReady && <Callout tone="info">Generate the 10k portfolio in the Dealer View under this profile to see portfolio expected loss.</Callout>}
        {portfolioReady && (
          <>
            <div style={styles.grid4}>
              <MetricCard title="Portfolio expected loss" value={money(baseLoss)} color="#334155" subtitle={`Σ PD × (1 − ${pctFmt(inputs.baseRecovery, 0)}) × loan amount, ${loans.length.toLocaleString("en-US")} loans`} />
              {scenarioLoss !== null && <MetricCard title="With last dealer failure" value={money(scenarioLoss)} color="#b91c1c" subtitle={`+${money(scenarioLoss - baseLoss)} plus ${money(failure.advanceWriteOff)} advance write-off`} />}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={applyFailure} disabled={!failure} onChange={(e) => setApplyFailure(e.target.checked)} data-testid="apply-failure" />
              {failure ? `Apply the last "Fail this dealer" scenario (${failure.dealerId}, dealer effect strength ${failure.strength})` : "Run \"Fail this dealer\" in the Dealer View to apply a dealer-failure scenario"}
            </label>
            <p style={{ ...styles.note, fontSize: 12, marginTop: 8 }}>Dealer-view loan outcomes are simulated — dealer effect is a set assumption.</p>
          </>
        )}
      </section>

      {history && (
        <section style={{ ...styles.panel, marginBottom: 16 }} data-testid="panel-history">
          <h3 style={styles.panelTitle}>D. {history.title}</h3>
          <ul style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
            {history.facts.map((f) => (
              <li key={f.date + f.text.slice(0, 24)} style={{ marginBottom: 6 }}>
                <strong>{f.date}:</strong> {f.text}{" "}
                <a href={f.source.url} target="_blank" rel="noreferrer">Source: {f.source.label}</a>
              </li>
            ))}
          </ul>
          {history.sources?.length > 0 && (
            <p style={{ fontSize: 12, color: "#475569" }} data-testid="history-sources">
              Sources:{" "}
              {history.sources.map((s, i) => (
                <React.Fragment key={s.url}>{i > 0 && " · "}<a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></React.Fragment>
              ))}
            </p>
          )}
          <p style={{ ...styles.note, marginBottom: 0 }} data-testid="analysis-line"><strong>Analysis, not fact:</strong> {ANALYSIS}</p>
        </section>
      )}
    </>
  );
}

export function FundingViewTab({ portfolio }) {
  const { registry, profile } = useActiveProfile();
  const defaults = profile.defaults?.fundingRates;
  const history = profile.caseStudies.find((cs) => cs.panel === "fundingRates") ?? null;
  const configured = registry.filter((p) => p.defaults?.fundingRates && p.id !== profile.id);
  const hints = registry
    .filter((p) => p.id !== profile.id)
    .flatMap((p) => p.caseStudies.filter((cs) => cs.panel === "fundingRates" && cs.hint).map((cs) => cs.hint));

  return (
    <div data-testid="funding-view">
      <p style={styles.note}>
        Every value below is computed from the inputs. Inputs are the active lender profile's illustrative defaults, each tagged as disclosed or as an assumption; none is any lender's actual current terms.
      </p>
      {!defaults && (
        <Callout tone="info">
          <span data-testid="funding-not-configured">
            Funding & Rates inputs are not configured for {profile.label}.
            {configured.length > 0 && ` Profiles with defaults: ${configured.map((p) => p.label).join(", ")}.`}
          </span>
        </Callout>
      )}
      {!defaults && hints.map((h) => <p key={h} style={styles.note} data-testid="funding-hint">{h}</p>)}
      {defaults && <FundingModel key={profile.id} defaults={defaults} portfolio={portfolio} profile={profile} history={history} />}
    </div>
  );
}

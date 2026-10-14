// src/ui/dealers/DealerView.jsx — Dealer View tab: installer-channel risk, advance exposure and
// a dealer-failure loss scenario over a synthetic portfolio. Lender-specific content (failure
// assumptions, disclosed advance amounts, case studies) comes from the lender profiles; this
// component names no lender. Every dealer metric is simulated under a set dealer-effect strength.

import React, { useMemo, useState } from "react";
import { styles, money, pct } from "../theme.js";
import { MetricCard, Th, Callout } from "../components/primitives.jsx";
import { useActiveProfile } from "../../profiles/activeProfile.js";
import { aggregateDealers, portfolioAlerts, simulateDealerFailure, simulateLoans, withDealerEffect, signalVsNoise } from "../../dealers.js";

const RATING_COLORS = { RED: "#b91c1c", YELLOW: "#b45309", GREEN: "#047857", INSUFFICIENT_DATA: "#475569" };
const RATING_LABELS = { RED: "Red", YELLOW: "Yellow", GREEN: "Green", INSUFFICIENT_DATA: "Insufficient data" };
const STRENGTHS = [0, 0.5, 1, 1.5, 2];
const SIMULATED_LABEL = "simulated — dealer effect is a set assumption";
const COLUMNS = [
  ["dealer", "Dealer"], ["city", "City"], ["state", "State"], ["loans", "Loans"], ["avgFico", "Avg FICO"],
  ["avgDti", "Avg back-end DTI"], ["dpd30Rate", "30+ DPD"], ["chargeOffRate", "Charge-off"], ["exposure", "Loan exposure"],
  ["exposureShare", "Share"], ["advanceBalance", "Advance balance"], ["signal", "Signal"], ["pValue", "p-value"], ["rating", "Rating"]
];

function AssumptionTag({ status }) {
  return <span style={{ ...styles.chip, background: "white", color: "#92400e", border: "1px solid #d97706", marginLeft: 6, fontSize: 11 }}>{status}</span>;
}

const flagged = (r) => `${r.RED} RED, ${r.YELLOW} YELLOW of ${r.rated} rated`;

function SignalVsNoisePanel({ inputs, dealers, settings }) {
  const [open, setOpen] = useState(false);
  const result = useMemo(() => (open ? signalVsNoise(inputs, dealers, settings) : null), [open, inputs, dealers, settings]);
  const minLoans = settings.rating.minLoans;
  return (
    <details style={{ ...styles.panel, marginBottom: 14 }} data-testid="signal-vs-noise" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Signal vs noise</summary>
      {result && (
        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr><th style={styles.th}>Dealer effect</th><th style={styles.th}>Flagged with the {minLoans}-loan minimum</th><th style={styles.th}>Flagged with no minimum</th></tr>
            </thead>
            <tbody>
              <tr>
                <td style={styles.td}>Set strength ({settings.dealerEffect.strength})</td>
                <td style={styles.td} data-testid="red-at-strength">{flagged(result.atStrength)}</td>
                <td style={styles.td} data-testid="red-at-strength-no-min">{flagged(result.atStrengthNoMinimum)}</td>
              </tr>
              <tr>
                <td style={styles.td}><strong>None (strength 0): false flags</strong></td>
                <td style={styles.td} data-testid="false-flags">{flagged(result.noEffect)}</td>
                <td style={styles.td} data-testid="false-flags-no-min">{flagged(result.noEffectNoMinimum)}</td>
              </tr>
            </tbody>
          </table>
          <p style={{ ...styles.note, marginTop: 10, marginBottom: 0 }}>
            At strength 0 dealer quality has no effect on loan outcomes or on where fraud lands, so every RED or YELLOW dealer is a false flag from chance and borrower mix. Without the minimum every dealer is tested, so the Bonferroni divisor grows and very small dealers can be flagged on one or two late loans.
          </p>
        </div>
      )}
    </details>
  );
}

function CaseStudyPanels({ caseStudies }) {
  if (!caseStudies.length) return null;
  return caseStudies.map((cs) => (
    <details key={cs.id} style={{ ...styles.panel, marginTop: 16 }} data-testid="dealer-case-study">
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>{cs.title}</summary>
      <ul style={{ paddingLeft: 18, marginTop: 10, fontSize: 13, lineHeight: 1.55 }}>
        {cs.facts.map((f) => (
          <li key={f.date + f.text.slice(0, 20)} style={{ marginBottom: 8 }}>
            <strong>{f.date}:</strong> {f.text}{" "}
            <a href={f.source.url} target="_blank" rel="noreferrer">Source: {f.source.label}</a>
          </li>
        ))}
      </ul>
    </details>
  ));
}

export function DealerViewTab({ portfolio }) {
  const { registry, profile: activeProfile } = useActiveProfile();
  const defaultProfileId = registry.some((p) => p.id === "SOLAR_PRIME") ? "SOLAR_PRIME" : activeProfile.id;
  const [portfolioProfileId, setPortfolioProfileId] = useState(defaultProfileId);
  const [stateFilter, setStateFilter] = useState("ALL");
  const [sortConfig, setSortConfig] = useState({ key: "exposure", direction: "desc" });
  const [failure, setFailure] = useState(null);
  const [strengthChoice, setStrengthChoice] = useState(null);

  const { status, progress, inputs, dealers, settings: profileSettings, profile: portfolioProfile, generate } = portfolio;
  const defaultStrength = profileSettings?.dealerEffect.strength ?? 1;
  const strength = strengthChoice ?? defaultStrength;
  const settings = useMemo(() => (profileSettings ? withDealerEffect(profileSettings, strength) : null), [profileSettings, strength]);
  const loans = useMemo(() => (inputs ? simulateLoans(inputs, dealers, settings) : null), [inputs, dealers, settings]);
  const rows = useMemo(() => (loans ? aggregateDealers(loans, dealers, settings) : []), [loans, dealers, settings]);
  const alerts = useMemo(() => portfolioAlerts(rows, settings?.alerts), [rows, settings]);
  const states = useMemo(() => [...new Set(rows.map((r) => r.state))].sort(), [rows]);
  const visible = useMemo(() => {
    const items = rows.filter((r) => stateFilter === "ALL" || r.state === stateFilter);
    const { key, direction } = sortConfig;
    return [...items].sort((a, b) => {
      const av = a[key] ?? -Infinity, bv = b[key] ?? -Infinity;
      if (av < bv) return direction === "asc" ? -1 : 1;
      if (av > bv) return direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, stateFilter, sortConfig]);
  const onSort = (key) => setSortConfig((s) => ({ key, direction: s.key === key && s.direction === "desc" ? "asc" : "desc" }));
  const caseStudies = activeProfile.caseStudies.filter((cs) => cs.panel === "dealerView");

  const startGeneration = () => {
    setFailure(null);
    setStrengthChoice(null);
    generate(registry.find((p) => p.id === portfolioProfileId));
  };
  const changeStrength = (value) => { setStrengthChoice(value); setFailure(null); };
  const failDealer = (dealerId) => setFailure(simulateDealerFailure({ loans, dealers }, dealerId, settings.dealerFailure));
  const count = settings?.portfolio.count;
  const topAdvances = settings?.network.topAdvances;
  const sizing = settings?.loanAmount;
  const ratedCount = rows.filter((r) => r.rating !== "INSUFFICIENT_DATA").length;
  const portfolioRate = rows[0]?.portfolioDpd30Rate ?? 0;

  return (
    <div data-testid="dealer-view">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ ...styles.chip, background: "#111827", color: "#f8fafc", border: "1px solid #111827" }} data-testid="synthetic-label">Synthetic data</span>
        <label style={{ fontSize: 13, color: "#475569", display: "flex", alignItems: "center", gap: 6 }}>
          Portfolio profile:
          <select value={portfolioProfileId} onChange={(e) => setPortfolioProfileId(e.target.value)} style={{ ...styles.select, width: "auto", marginBottom: 0 }} aria-label="Dealer portfolio profile">
            {registry.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <button style={{ ...styles.btnPrimary, width: "auto", marginBottom: 0, padding: "8px 14px" }} onClick={startGeneration} disabled={status === "running"} data-testid="generate-10k">
          Generate 10k portfolio
        </button>
        {status === "running" && (
          <span style={{ fontSize: 13, color: "#475569" }} data-testid="portfolio-progress" aria-live="polite">
            Generating… {Math.round(progress * 100)}%
          </span>
        )}
        {status === "done" && (
          <span style={{ fontSize: 13, color: "#475569" }}>{loans.length.toLocaleString("en-US")} loans · {portfolioProfile.label} · seed {settings.portfolio.seed}</span>
        )}
        {status === "done" && (
          <label style={{ fontSize: 13, color: "#475569", display: "flex", alignItems: "center", gap: 6 }}>
            Dealer effect strength:
            <select value={strength} onChange={(e) => changeStrength(Number(e.target.value))} style={{ ...styles.select, width: "auto", marginBottom: 0 }} aria-label="Dealer effect strength">
              {STRENGTHS.map((v) => <option key={v} value={v}>{v === 0 ? "0 (no dealer effect)" : v === defaultStrength ? `${v} (default)` : v}</option>)}
            </select>
            <AssumptionTag status={settings.dealerEffect.status} />
          </label>
        )}
      </div>

      <p style={styles.note} data-testid="dealer-model-note">
        Model: each synthetic loan is assigned to a fictional dealer, and its 30+ DPD path is a logistic monthly hazard over {settings?.performance.monthsOnBook ?? 18} months on true FICO, true back-end DTI, fraud and a hidden dealer quality whose effect strength is set by assumption; expected loss is PD × (1 − recovery) × loan amount, and loan amounts come from the mortgage-sized generator. The lien signal is a simulated public-record signal; a real build would read the NC Secretary of State's UCC records.
      </p>

      {status !== "done" && (
        <Callout tone="info">
          Generate the portfolio to see dealer ratings, concentration alerts and the dealer-failure scenario{count ? ` (${count.toLocaleString("en-US")} applications)` : ""}.
        </Callout>
      )}

      {status === "done" && (
        <>
          <p style={{ ...styles.note, fontWeight: 600, color: "#92400e" }} data-testid="dealer-simulated-label">
            Dealer metrics are {SIMULATED_LABEL} (strength {strength}). Ratings, delinquency, charge-offs and expected losses describe the model, not real dealers.
          </p>
          {topAdvances && (
            <p style={styles.note} data-testid="advance-source">
              The four largest advances ({topAdvances.values.map((v) => money(v)).join(", ")}) follow {topAdvances.status} amounts. {topAdvances.note}{" "}
              <a href={topAdvances.source.url} target="_blank" rel="noreferrer">Source: {topAdvances.source.label}</a>. Which synthetic dealers hold them, and every other advance, are simulated.
            </p>
          )}
          {sizing && (
            <p style={styles.note} data-testid="loan-amount-source">
              Loan amounts: {money(sizing.min.value)} to {money(sizing.max.value)} ({sizing.min.status}, <a href={sizing.min.source.url} target="_blank" rel="noreferrer">{sizing.min.source.label}</a>); {sizing.distribution} with median {money(sizing.median.value)}<AssumptionTag status={sizing.median.status} /> and σ {sizing.sigma.value}<AssumptionTag status={sizing.sigma.status} />. {sizing.median.note}
              {sizing.calibrationTarget && <> Calibration target: {sizing.calibrationTarget.metric} {money(sizing.calibrationTarget.value)} ({sizing.calibrationTarget.status}; {sizing.calibrationTarget.citation})</>}
            </p>
          )}
          {settings.exposureNote && (
            <Callout tone="warn"><span data-testid="exposure-note">{settings.exposureNote}</span></Callout>
          )}
          <p style={styles.note} data-testid="rating-method">
            Rating: one-sided binomial test of each dealer's 30+ DPD count against the portfolio rate ({pct(portfolioRate)}). RED if p &lt; {settings.rating.redAlpha} after Bonferroni across the {ratedCount} rated dealers (p &lt; {(settings.rating.redAlpha / Math.max(1, ratedCount)).toPrecision(2)}); YELLOW if p &lt; {settings.rating.yellowAlpha} unadjusted; dealers with fewer than {settings.rating.minLoans} loans are not rated.
          </p>
          <SignalVsNoisePanel inputs={inputs} dealers={dealers} settings={settings} />

          <div style={{ marginBottom: 14 }} data-testid="dealer-alerts">
            {alerts.length === 0 && <Callout tone="good">No concentration alert at the configured thresholds.</Callout>}
            {alerts.map((a) => <Callout key={a.kind + a.subject} tone="warn">{a.text}</Callout>)}
          </div>

          {failure && (
            <div style={{ ...styles.panel, marginBottom: 14 }} data-testid="dealer-failure-result">
              <h3 style={styles.panelTitle}>Dealer failure: {rows.find((r) => r.dealerId === failure.dealerId)?.dealer}</h3>
              <div style={styles.grid4}>
                <MetricCard title="Advance write-off" value={money(failure.advanceWriteOff)} color="#b91c1c" subtitle="The dealer's full advance balance" />
                <MetricCard title="Change in expected loss" value={money(failure.deltaExpectedLoss)} color="#b45309" subtitle={`${failure.affectedLoans} of ${failure.dealerLoans} borrowers with non-working systems · ${SIMULATED_LABEL}`} />
                <MetricCard title="New portfolio expected loss" value={money(failure.stressedExpectedLoss)} color="#334155" subtitle={`Was ${money(failure.baselineExpectedLoss)} · ${SIMULATED_LABEL}`} />
              </div>
              <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.8 }}>
                Inputs: non-working systems {pct(failure.assumptions.nonWorkingShare.value, 0)}<AssumptionTag status={failure.assumptions.nonWorkingShare.status} />
                {" · "}PD multiplier on those borrowers ×{failure.assumptions.pdMultiplier.value}<AssumptionTag status={failure.assumptions.pdMultiplier.status} />
                {" · "}recovery {pct(failure.assumptions.baseRecovery.value, 0)} → 0%<AssumptionTag status={failure.assumptions.baseRecovery.status} />
              </div>
            </div>
          )}

          <div style={styles.tableToolbar}>
            <label style={{ fontSize: 13, color: "#475569", display: "flex", alignItems: "center", gap: 6 }}>
              State:
              <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={{ ...styles.select, width: "auto", marginBottom: 0 }} aria-label="Filter by state">
                <option value="ALL">All states</option>
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <div style={styles.tableContainer}>
            <table style={styles.table} data-testid="dealer-table">
              <caption style={{ captionSide: "top", textAlign: "left", padding: "8px 12px", fontSize: 12, color: "#92400e" }}>Dealer metrics: {SIMULATED_LABEL}</caption>
              <thead>
                <tr>
                  {COLUMNS.map(([key, label]) => <Th key={key} label={label} sortKey={key} sortConfig={sortConfig} onSort={onSort} />)}
                  <th style={styles.th}>Scenario</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.dealerId} style={styles.tableRow}>
                    <td style={styles.td}>{r.dealer}</td>
                    <td style={styles.td}>{r.city}</td>
                    <td style={styles.td}>{r.state}</td>
                    <td style={styles.td}>{r.loans.toLocaleString("en-US")}</td>
                    <td style={styles.td}>{r.avgFico === null ? "—" : r.avgFico.toFixed(0)}</td>
                    <td style={styles.td}>{pct(r.avgDti)}</td>
                    <td style={styles.td}>{pct(r.dpd30Rate)}</td>
                    <td style={styles.td}>{pct(r.chargeOffRate)}</td>
                    <td style={styles.td}>{money(r.exposure)}</td>
                    <td style={styles.td}>{pct(r.exposureShare)}</td>
                    <td style={styles.td}>{money(r.advanceBalance)}</td>
                    <td style={styles.td}>{r.signal ? "Simulated public-record signal" : "—"}</td>
                    <td style={styles.td}>{r.pValue === null ? "—" : r.pValue < 0.0001 ? "<0.0001" : r.pValue.toFixed(4)}</td>
                    <td style={{ ...styles.td, color: RATING_COLORS[r.rating], fontWeight: 700 }}>{RATING_LABELS[r.rating]}</td>
                    <td style={styles.td}>
                      <button style={styles.btnSmall} onClick={() => failDealer(r.dealerId)} data-testid={`fail-${r.dealerId}`}>Fail this dealer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <CaseStudyPanels caseStudies={caseStudies} />
    </div>
  );
}

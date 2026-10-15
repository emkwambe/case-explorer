// src/ui/credit/CreditRisk.jsx — Credit Risk Mode: underwriting sidebar, portfolio strip,
// public-benchmark validation panel and the compliance footer.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { styles, money } from "../theme.js";
import { caseDti, dtiDefinition, riskSummary, ficoComparison, DISAGREEMENT, DTI_BASIS } from "../../creditRisk.js";
import { useActiveProfile } from "../../profiles/activeProfile.js";
import { CREDIT_DECISION_COLORS, COMPLIANCE_TEXT, REFERENCE_SIZE, REFERENCE_SEED, profileReference } from "./useCreditAssessments.js";

const FLAG_COLORS = { high: "#b91c1c", watch: "#b45309" };


export function ComplianceFooter() {
  return (
    <footer role="contentinfo" data-testid="compliance-footer" className="ce-footer">
      {COMPLIANCE_TEXT}
    </footer>
  );
}

function sumStudent(events = []) {
  return events.filter((e) => e?.type === "LIABILITY_OPENED" && e.type_detail === "STUDENT_LOAN").reduce((s, e) => s + (Number(e.payment) || 0), 0);
}

// DTI shows one decimal everywhere, matching the World truth table on the Overview tab.
const fmtPct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);

function GroundTruthComparison({ caseData }) {
  const { profile } = useActiveProfile();
  const claimed = caseData.presentation?.current_state ?? {};
  const truth = caseData.truth?.current_state ?? {};
  const cDti = caseDti(caseData, profile, "presentation");
  const tDti = caseDti(caseData, profile, "truth");
  const housingRows = cDti.basis === DTI_BASIS.CURRENT_HOUSING_PLUS_SOLAR_LOAN
    ? [["Current housing /mo", money(cDti.currentHousing), money(tDti.currentHousing)], ["Proposed solar payment /mo", money(cDti.proposedPayment), money(tDti.proposedPayment)]]
    : [["Proposed PITI /mo", money(cDti.proposedPayment), money(tDti.proposedPayment)]];
  const rows = [
    ["FICO", claimed.credit_score ?? "—", truth.credit_score ?? "—"],
    ["Salary", money(claimed.salary), money(truth.salary)],
    ["Non-housing debt /mo", money(claimed.monthly_obligations), money(truth.monthly_obligations)],
    ...housingRows,
    ["Student loans /mo", money(sumStudent(caseData.presentation?.events)), money(sumStudent(caseData.truth?.events))],
    ["Checking", money(claimed.checking_balance), money(truth.checking_balance)],
    [cDti.label, fmtPct(cDti.dti), fmtPct(tDti.dti)]
  ];
  return (
    <table style={{ ...styles.table, marginTop: 8 }} data-testid="ground-truth-comparison">
      <thead>
        <tr><th style={styles.th}>Field</th><th style={styles.th}>Claimed</th><th style={styles.th}>Truth</th></tr>
      </thead>
      <tbody>
        {rows.map(([label, c, t]) => {
          const differs = String(c) !== String(t);
          return (
            <tr key={label} style={differs ? { background: "#fef2f2" } : undefined}>
              <td style={styles.td}>{label}</td>
              <td style={styles.td}>{c}</td>
              <td style={{ ...styles.td, fontWeight: differs ? 700 : 400, color: differs ? "#991b1b" : undefined }}>{t}{differs ? " ≠" : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through to the legacy path */ }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  document.body.removeChild(area);
  return ok;
}

function CopySummaryButton({ text }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onCopy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <button style={{ ...styles.btnPrimary, marginBottom: 0 }} onClick={onCopy} data-testid="copy-risk-summary" aria-live="polite">
      {copied ? "Copied" : "Copy risk summary"}
    </button>
  );
}

export function UnderwritingSidebar({ caseData, assessment }) {
  const { profile } = useActiveProfile();
  const [showTruth, setShowTruth] = useState(false);
  if (!assessment) return null;
  const color = CREDIT_DECISION_COLORS[assessment.policyDecision];
  const summary = riskSummary(assessment);
  return (
    <aside className="ce-credit-sidebar" aria-label="Underwriting Decision" data-testid="underwriting-sidebar">
      <h2 style={{ ...styles.panelTitle, fontSize: 14 }}>Underwriting Decision</h2>
      <div style={{ padding: "12px 14px", borderRadius: 6, background: color, color: "white", marginBottom: 12 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.9 }}>Credit policy</div>
        <div style={{ fontSize: 22, fontWeight: 700 }} data-testid="policy-decision">{assessment.policyDecision}</div>
      </div>

      {assessment.fraudFlag === "REVIEW" && (
        <div data-testid="fraud-review-badge" style={{ display: "inline-block", padding: "6px 12px", marginBottom: 12, background: "#111827", color: "#fde047", border: "2px solid #fde047", borderRadius: 4, fontWeight: 800, letterSpacing: 1, fontSize: 13 }}>
          FRAUD REVIEW
        </div>
      )}

      {assessment.reasons.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#475569", fontWeight: 600, marginBottom: 4 }}>
            {assessment.policyDecision === "DECLINE" ? "Principal reasons for adverse action" : "Review triggers"}
          </div>
          <ul style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
            {assessment.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {assessment.flags.length === 0 && <span style={{ fontSize: 12, color: "#475569" }}>No policy flags</span>}
        {assessment.flags.map((f) => (
          <span key={f.code} title={f.label} style={{ ...styles.chip, background: "white", color: FLAG_COLORS[f.severity], border: `1px solid ${FLAG_COLORS[f.severity]}` }}>{f.code}</span>
        ))}
      </div>

      <div style={styles.kvRow}><span>Integrity check</span><strong>{assessment.generatorDecision ?? "—"}</strong></div>
      <div style={styles.kvRow}><span>FICO (claimed)</span><strong>{assessment.fico ?? "—"}</strong></div>
      <div style={styles.kvRow}><span>{dtiDefinition(profile).label} (claimed)</span><strong data-testid="sidebar-dti">{fmtPct(assessment.dti)}{assessment.dtiPartial ? " (partial)" : ""}</strong></div>
      <div style={styles.kvRow}><span>Student loans</span><strong>{money(assessment.studentPayment)}/mo</strong></div>
      <div style={{ ...styles.kvRow, marginBottom: 12 }}><span>Checking (claimed)</span><strong>{money(assessment.checking)}</strong></div>

      {assessment.disagreement && (
        <div data-testid="disagreement-callout" style={{ ...styles.callout, background: "#fffbeb", borderColor: "#f59e0b", color: "#78350f", fontWeight: 600 }}>
          {assessment.disagreement.text}
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} data-testid="show-ground-truth" />
        Show ground truth
      </label>
      {showTruth && <GroundTruthComparison caseData={caseData} />}

      <div style={{ fontFamily: "monospace", fontSize: 11, background: "#f1f5f9", padding: 8, borderRadius: 4, margin: "12px 0 8px", wordBreak: "break-word" }} data-testid="risk-summary">{summary}</div>
      <CopySummaryButton text={summary} />

      <p style={{ ...styles.note, fontSize: 11, marginTop: 12, marginBottom: 0 }}>
        The policy reads claimed values only and excludes geography, region, zip code, persona, age and regime. Disparate-impact testing is out of scope for synthetic data.
      </p>
    </aside>
  );
}

export function PortfolioStrip({ assessments }) {
  const counts = { APPROVE: 0, REVIEW: 0, DECLINE: 0 };
  const conflicts = { [DISAGREEMENT.INTEGRITY_APPROVE_CREDIT_DECLINE]: 0, [DISAGREEMENT.INTEGRITY_FLAG_CREDIT_APPROVE]: 0 };
  for (const a of assessments.values()) {
    counts[a.policyDecision]++;
    if (a.disagreement) conflicts[a.disagreement.kind]++;
  }
  const n = assessments.size || 1;
  const neutral = { ...styles.chip, background: "white", color: "#334155", border: "1px solid #94a3b8" };
  return (
    <div className="ce-portfolio-strip" data-testid="portfolio-strip">
      <span style={{ fontSize: 12, color: "#475569", alignSelf: "center" }}>Credit policy:</span>
      {Object.entries(counts).map(([k, v]) => (
        <span key={k} style={{ ...styles.chip, background: "white", color: CREDIT_DECISION_COLORS[k], border: `1px solid ${CREDIT_DECISION_COLORS[k]}` }}>
          {k} {Math.round((100 * v) / n)}% ({v})
        </span>
      ))}
      <span style={neutral} data-testid="conflict-approve-decline">Integrity APPROVE · Credit DECLINE: {conflicts[DISAGREEMENT.INTEGRITY_APPROVE_CREDIT_DECLINE]}</span>
      <span style={neutral} data-testid="conflict-flag-approve">Integrity DECLINE or fraud REVIEW · Credit APPROVE: {conflicts[DISAGREEMENT.INTEGRITY_FLAG_CREDIT_APPROVE]}</span>
    </div>
  );
}

const delta = (v) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`);
const fmtMean = (v) => (v === null ? "—" : v.toFixed(1));

function ComparisonRows({ id, label, comparison, target }) {
  const rows = [
    ["all", "all applications", comparison.n, comparison.allMean],
    ["approved", "approved under credit policy", comparison.approvedN, comparison.approvedMean]
  ];
  return rows.map(([key, what, n, mean]) => {
    const likeForLike = key === target.compareTo;
    return (
      <tr key={key}>
        <td style={styles.td}>{likeForLike ? <strong>{label}: {what}</strong> : `${label}: ${what}`}</td>
        <td style={styles.td}>{n.toLocaleString("en-US")}</td>
        <td style={styles.td}>{fmtMean(mean)}</td>
        <td style={styles.td} data-testid={`delta-${key}-${id}`}>{delta(mean === null ? null : mean - target.value)}</td>
      </tr>
    );
  });
}

/**
 * Compares synthetic FICO with every average-FICO benchmark in the profile registry: the loaded
 * portfolio plus a cached 2,000-case reference stream per registered profile. All text about the
 * benchmark (population, source, caveats) comes from the profile that owns it.
 */
export function BenchmarkPanel({ cases, baseConfig }) {
  const { registry, profile } = useActiveProfile();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState(null);
  const loaded = useMemo(() => ficoComparison(cases, profile), [cases, profile]);
  const benchmarks = useMemo(
    () => registry.flatMap((p) => p.benchmarks.filter((b) => b.metric === "avg_fico").map((b) => ({ ...b, owner: p }))),
    [registry]
  );

  // Reference streams are generated once per profile (2,000 cases each) and cached; the work is
  // deferred a tick so the panel opens and says it is computing before the main thread is busy.
  useEffect(() => {
    if (!open || reference || benchmarks.length === 0) return undefined;
    const t = setTimeout(() => setReference(registry.map((p) => ({ id: p.id, label: p.label, comparison: profileReference(baseConfig, p) }))), 0);
    return () => clearTimeout(t);
  }, [open, reference, benchmarks.length, registry, baseConfig]);

  return (
    <details className="ce-benchmark" data-testid="benchmark-panel" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Synthetic vs public benchmark</summary>
      <div style={{ marginTop: 10, overflowX: "auto" }}>
        {benchmarks.length === 0 && (
          <p style={{ ...styles.note, marginBottom: 0 }} data-testid="no-benchmarks">No public benchmark is configured for the registered lender profiles.</p>
        )}
        {benchmarks.map((b) => (
          <div key={`${b.owner.id}-${b.id}`} style={{ marginBottom: 12 }}>
            <table style={styles.table}>
              <thead>
                <tr><th style={styles.th}>Population</th><th style={styles.th}>n</th><th style={styles.th}>Avg FICO</th><th style={styles.th}>vs {b.value}</th></tr>
              </thead>
              <tbody>
                <ComparisonRows id="loaded" label={`Loaded portfolio (${profile.label})`} comparison={loaded} target={b} />
                {reference
                  ? reference.map((r) => <ComparisonRows key={r.id} id={r.id} label={`${r.label} reference, seed ${REFERENCE_SEED}`} comparison={r.comparison} target={b} />)
                  : <tr><td style={styles.td} colSpan={4}>{open ? `Computing reference streams (${REFERENCE_SIZE.toLocaleString("en-US")} applications per profile)…` : null}</td></tr>}
              </tbody>
            </table>
            <p style={{ ...styles.note, marginTop: 10, marginBottom: 0 }}>
              Benchmark: {b.population} ({b.value}), from the{" "}
              <a href={b.source.url} target="_blank" rel="noreferrer">{b.source.label}</a>.
              {b.compareTo === "approved"
                ? " The figure describes financed borrowers, so the approved-only rows (bold) are the like-for-like comparison; all-application rows include applicants the credit policy declines."
                : " The all-application rows (bold) are the like-for-like comparison."}
              {b.note ? ` ${b.note}` : ""}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}

// src/ui/tabs/CreditModelTab.jsx — The credit PD model, read-only, from the committed snapshot
// (artifacts/credit-model-snapshot/, copied to public/artifacts by the prebuild). Two parts: this
// case's PD and reasons (precomputed for the opening library and the teaching cases), and "About the
// model" with the portfolio results. The model is a second opinion; the credit policy decides.
// Hidden whenever a challenge case is blind.

import React from "react";
import { styles } from "../theme.js";
import { useArtifact } from "../hooks/useArtifacts.js";
import { useChallengeGate } from "../challenge/challengeGate.js";

export const CREDIT_MODEL_LABEL = "Second opinion only: the credit policy makes the decision.";
export const MODEL_CARD_URL = "https://github.com/emkwambe/case-explorer/blob/main/docs/MODEL-CARD-credit-pd.md";

const INK = "#0f172a", MUTED = "#475569", BAR = "#1d4ed8", TRACK = "#e2e8f0";
const pct = (v, d = 2) => (v === null || v === undefined ? "—" : `${(100 * v).toFixed(d)}%`);
const f3 = (v) => (v === null || v === undefined ? "—" : v.toFixed(3));
const ci = (t, k, d = 3) => `${t.metrics[k].toFixed(d)} (${t.ci95[k].low.toFixed(d)}–${t.ci95[k].high.toFixed(d)})`;

function Note({ children }) {
  return <p style={{ ...styles.note, color: MUTED }}>{children}</p>;
}

/** PD and the top reasons for one case, from the precomputed case snapshot. */
export function CaseCreditModel({ caseKey, cases }) {
  const { blind } = useChallengeGate();
  if (blind) return null;
  if (cases.status === "loading") return <Note>Loading the credit model…</Note>;
  if (cases.status !== "ready") return <Note>The credit-model snapshot is not published here.</Note>;
  const entry = cases.data.teaching?.[caseKey] ?? cases.data.opening_library?.[caseKey];
  return (
    <section style={styles.panel} data-testid="credit-model-case" aria-labelledby="cm-case">
      <h3 id="cm-case" style={styles.panelTitle}>Credit model: this case</h3>
      <p style={{ fontSize: 13, color: INK, margin: "0 0 8px", fontWeight: 600 }}>{CREDIT_MODEL_LABEL}</p>
      {!entry ? (
        <Note>No precomputed score for this case. The model runs offline in Python; only the opening library and the teaching cases are scored in the snapshot.</Note>
      ) : (
        <>
          <p style={{ fontSize: 14, color: INK, margin: "0 0 8px" }} data-testid="credit-model-pd">
            Probability of 30+ days past due within 18 months: <strong>{pct(entry.pd)}</strong>
          </p>
          {entry.reasons.length === 0 ? (
            <Note>No reason group raises this case's risk by more than the materiality threshold.</Note>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: INK }} data-testid="credit-model-reasons">
              {entry.reasons.map((r) => (
                <li key={r.group} style={{ marginBottom: 4 }}>{r.statement} <span style={{ color: MUTED }}>({r.group}, +{r.contribution.toFixed(3)} log-odds)</span></li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

/** Mean |SHAP| by reason group: one series, sorted, values labelled, each bar titled for hover. */
function GlobalShapBars({ groups, statements }) {
  const rows = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] || 1;
  return (
    <figure style={{ margin: "8px 0 0" }} data-testid="credit-model-shap">
      <figcaption style={{ fontSize: 13, color: INK, fontWeight: 600, marginBottom: 6 }}>Mean |SHAP| by reason group (log-odds, test book)</figcaption>
      <div role="list" aria-label="Mean absolute SHAP contribution by reason group">
        {rows.map(([g, v]) => (
          <div key={g} role="listitem" title={`${statements[g]}: mean |SHAP| ${v.toFixed(4)}`} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 190px) 1fr 56px", alignItems: "center", gap: 8, margin: "3px 0", fontSize: 12, color: INK }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g}</span>
            <span style={{ background: TRACK, borderRadius: 4, height: 10 }}>
              <span style={{ display: "block", width: `${Math.max(2, (100 * v) / max)}%`, height: 10, background: BAR, borderRadius: 4 }} />
            </span>
            <span style={{ textAlign: "right", color: MUTED }}>{v.toFixed(4)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function Table({ head, rows, testId }) {
  return (
    <div style={styles.tableContainer}>
      <table style={{ ...styles.table, fontSize: 12 }} data-testid={testId}>
        <thead><tr>{head.map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={styles.td}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const TYPOLOGIES = ["INFLATION", "CONCEALMENT", "EVIDENCE_TAMPERING", "FABRICATION", "ASSET_SEASONING", "INFLATION+CONCEALMENT", "NONE"];
function accuracyRows(acc) {
  return TYPOLOGIES.filter((t) => acc[t]).map((t) => {
    const a = acc[t];
    return a.control
      ? ["NONE (control)", a.n.toLocaleString("en-US"), "a discrepancy blamed (false alarm)", `${a.top1_blames_discrepancy} (${pct(a.top1_blames_discrepancy / a.n, 1)})`, `${a.top4_blames_discrepancy} (${pct(a.top4_blames_discrepancy / a.n, 1)})`]
      : [t, a.n.toLocaleString("en-US"), a.expected_groups.join(", "), `${a.top1_hits} (${pct(a.top1_hits / a.n, 0)})`, `${a.top4_hits} (${pct(a.top4_hits / a.n, 0)})`];
  });
}

/** "About the model": headline metrics, calibration, learned vs true PD, reasons and reason accuracy. */
export function AboutCreditModel({ summary }) {
  if (summary.status === "loading") return <Note>Loading the credit model…</Note>;
  if (summary.status !== "ready") return <Note>The credit-model snapshot is not published here.</Note>;
  const s = summary.data, x = s.models.credit_pd_xgb, lg = s.models.credit_pd_logistic, ce = s.ceilings;
  const d = s.comparison.xgb_minus_logistic.auc_difference;
  const statements = Object.fromEntries(Object.entries(s.reasons.groups).map(([g, v]) => [g, v.statement]));
  const mat = s.reasons.materiality, acc = mat.accuracy_after;
  return (
    <section style={styles.panel} data-testid="credit-model-about" aria-labelledby="cm-about">
      <h3 id="cm-about" style={styles.panelTitle}>About the model</h3>
      <Note>
        A probability-of-default model for the Solar book (XGBoost with monotonic constraints, beside a logistic-regression baseline), trained on {s.data.after.training.rows.toLocaleString("en-US")} funded loans from independent synthetic books and tested once on the locked seed-42 book ({s.data.after.test.defaults} defaults). Developer testing, not independent validation. It recovers a simple, known simulated process, so its performance does not transfer to real data. <a href={MODEL_CARD_URL} target="_blank" rel="noreferrer">Model card</a>.
      </Note>
      <Table testId="credit-model-metrics" head={["Model", "AUC (95% CI)", "KS (95% CI)", "Brier (95% CI)", "Mean predicted"]} rows={[
        ["credit_pd_xgb", ci(x.test, "auc"), ci(x.test, "ks"), ci(x.test, "brier", 4), pct(x.test.metrics.mean_predicted)],
        ["credit_pd_logistic (baseline)", ci(lg.test, "auc"), ci(lg.test, "ks"), ci(lg.test, "brier", 4), pct(lg.test.metrics.mean_predicted)],
        ["Ceiling: true PD", ci(ce.true_pd, "auc"), ci(ce.true_pd, "ks"), ci(ce.true_pd, "brier", 4), pct(ce.true_pd.metrics.mean_predicted)],
        ["Fair ceiling: true PD without the dealer term", ci(ce.true_pd_without_dealer_term, "auc"), ci(ce.true_pd_without_dealer_term, "ks"), ci(ce.true_pd_without_dealer_term, "brier", 4), pct(ce.true_pd_without_dealer_term.metrics.mean_predicted)]
      ]} />
      <Note>
        Observed default rate {pct(x.test.metrics.observed_rate)}. XGBoost minus baseline AUC: {f3(d.point)} (paired 95% interval {f3(d.low)} to {f3(d.high)}){d.low <= 0 && d.high >= 0 ? ", which contains 0: the test book cannot tell the two models apart." : "."}
      </Note>
      <GlobalShapBars groups={s.reasons.global.groups} statements={statements} />
      <h4 style={{ fontSize: 13, margin: "14px 0 4px", color: INK }}>Calibration and learned against true PD (credit_pd_xgb, test book by decile)</h4>
      <Table testId="credit-model-deciles" head={["Decile", "Loans", "Mean predicted", "Observed", "Mean true PD"]} rows={x.test.deciles.map((r) => [r.decile, r.n.toLocaleString("en-US"), pct(r.mean_predicted), pct(r.observed_rate), pct(r.mean_true)])} />
      <Note>
        Rank correlation with true PD {f3(x.test.learned_vs_true.spearman)}; with the dealer-blind true PD {f3(x.test.learned_vs_true_without_dealer_term.spearman)}. Only synthetic data allows this comparison. Recalibration: {x.calibration_books.recalibrated ? "applied (isotonic)" : "not needed by the pre-registered rule"}.
      </Note>
      <h4 style={{ fontSize: 13, margin: "14px 0 4px", color: INK }}>Reason accuracy against the hidden truth (stated reasons)</h4>
      <Note>A reason is stated only if its contribution exceeds {mat.threshold_log_odds.toFixed(6)} log-odds, chosen on the calibration books so that at most {pct(mat.target_false_reason_rate, 0)} of clean loans get a false discrepancy reason (clean test loans: {pct(mat.false_reason_rate.test_clean_before, 1)} before, {pct(mat.false_reason_rate.test_clean_after, 1)} after). Inflation's score is perfect by construction: only fraud loans have an income gap in this simulation.</Note>
      <Table testId="credit-model-accuracy-teaching" head={["Teaching twins", "Cases", "Expected group", "Top reason correct", "Any of top 4"]} rows={accuracyRows(acc.teaching_twins_and_conflicting)} />
      <Table testId="credit-model-accuracy-book" head={["Funded test book", "Loans", "Expected group", "Top reason correct", "Any of top 4"]} rows={accuracyRows(acc.funded_test_book)} />
    </section>
  );
}

export function CreditModelTab({ caseData }) {
  const summary = useArtifact("credit-model-summary.json");
  const cases = useArtifact("credit-model-cases.json");
  const { blind } = useChallengeGate();
  if (blind) return null;
  return (
    <div data-testid="credit-model-tab">
      <p style={{ fontSize: 14, color: INK, fontWeight: 700, margin: "0 0 10px" }}>{CREDIT_MODEL_LABEL}</p>
      <CaseCreditModel caseKey={caseData.id} cases={cases} />
      <AboutCreditModel summary={summary} />
    </div>
  );
}

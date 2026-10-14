// src/ui/tabs/analyticsTabs.jsx — Portfolio-level tabs: data table, network, economics, validation.

import React, { useMemo, useState } from "react";
import { styles, ALIGNMENT_COLORS, ALIGNMENT_DESCRIPTIONS, FRAUD_COLORS, OUTCOME_COLORS, money, pct, titleCase } from "../theme.js";
import { MetricCard, Panel, Badge, Chip, Th, Callout } from "../components/primitives.jsx";
import { download } from "../components/download.js";
import { scoreCase } from "../../decisioning/index.js";
import { alertsToScore, thresholdSweep, DEFAULT_ASSUMPTIONS } from "../../evaluation/economics/index.js";
import { analyzeNetwork } from "../../analytics/network.js";
import { injectFraudRings } from "../../simulation/rings.js";
import { isFraudCase, extractDecisionFeatures, decisionRowsToCsv } from "../../ml/decision_features.js";
import { casesToCsv } from "../../ml/features.js";
import { useArtifact, artifactUrl } from "../hooks/useArtifacts.js";

export function DataTableTab({ cases, onSelect }) {
  const [sortConfig, setSortConfig] = useState({ key: "applicant.name", direction: "asc" });
  const [filterText, setFilterText] = useState("");

  const rows = useMemo(() => {
    let items = [...cases];
    if (filterText) {
      const q = filterText.toLowerCase();
      items = items.filter((c) =>
        c.applicant.name.toLowerCase().includes(q) ||
        c.application.purpose.toLowerCase().includes(q) ||
        String(c.meta?.corruption_type ?? "").toLowerCase().includes(q) ||
        String(c.label.expected_outcome).toLowerCase().includes(q));
    }
    const read = (c, key) => {
      if (key === "dti") return c.truth.current_state?.backend_dti ?? 0;
      if (key === "salary") return c.truth.current_state?.salary ?? 0;
      if (key === "credit_score") return c.truth.current_state?.credit_score ?? 0;
      if (key === "scenario") return c.meta?.corruption_type ?? "";
      return key.split(".").reduce((o, k) => (o == null ? o : o[k]), c);
    };
    items.sort((a, b) => {
      const av = read(a, sortConfig.key), bv = read(b, sortConfig.key);
      if (av < bv) return sortConfig.direction === "asc" ? -1 : 1;
      if (av > bv) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return items;
  }, [cases, sortConfig, filterText]);

  const requestSort = (key) => setSortConfig((s) => ({ key, direction: s.key === key && s.direction === "asc" ? "desc" : "asc" }));

  return (
    <div>
      <div style={styles.tableToolbar}>
        <input type="text" placeholder="Filter by name, purpose, scenario or outcome" value={filterText} onChange={(e) => setFilterText(e.target.value)} style={styles.filterInput} aria-label="Filter cases" />
        <button style={styles.btnCSV} onClick={() => download(`decision_features_${cases.length}.csv`, decisionRowsToCsv(cases.map(extractDecisionFeatures)), "text/csv")}>
          Export model features (permitted only)
        </button>
        <button style={{ ...styles.btnCSV, background: "#475569" }} onClick={() => download(`full_cases_${cases.length}.csv`, casesToCsv(cases), "text/csv")}>
          Export diagnostic CSV (includes truth)
        </button>
      </div>
      <Callout tone="info">
        The model-feature export enforces the feature policy: truth columns, labels and identity are excluded, sensitive attributes are separated into their own columns for fairness testing only.
      </Callout>
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead><tr>
            <Th label="Name" sortKey="applicant.name" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Scenario" sortKey="scenario" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Loan" sortKey="application.loan_amount" sortConfig={sortConfig} onSort={requestSort} numeric />
            <Th label="Salary" sortKey="salary" sortConfig={sortConfig} onSort={requestSort} numeric />
            <Th label="Back-end DTI" sortKey="dti" sortConfig={sortConfig} onSort={requestSort} numeric />
            <Th label="Credit" sortKey="credit_score" sortConfig={sortConfig} onSort={requestSort} numeric />
            <Th label="Align" sortKey="label.alignment_level" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Outcome" sortKey="label.expected_outcome" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Fraud risk" sortKey="label.fraud_risk_level" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Observed outcome" sortKey="performance.status" sortConfig={sortConfig} onSort={requestSort} />
          </tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={{ ...styles.tableRow, cursor: "pointer" }} onClick={() => onSelect?.(c.id)}>
                <td style={styles.td}><strong>{c.applicant.name}</strong></td>
                <td style={styles.td}>{titleCase(c.meta?.corruption_type)}</td>
                <td style={{ ...styles.td, ...styles.num }}>{money(c.application.loan_amount)}</td>
                <td style={{ ...styles.td, ...styles.num }}>{money(c.truth.current_state?.salary)}</td>
                <td style={{ ...styles.td, ...styles.num }}>{pct(c.truth.current_state?.backend_dti)}</td>
                <td style={{ ...styles.td, ...styles.num }}>{c.truth.current_state?.credit_score}</td>
                <td style={styles.td}><Badge color={ALIGNMENT_COLORS[c.label.alignment_level]} title={ALIGNMENT_DESCRIPTIONS[c.label.alignment_level]}>{c.label.alignment_level}</Badge></td>
                <td style={styles.td}><span style={{ color: OUTCOME_COLORS[c.label.expected_outcome], fontWeight: 600 }}>{c.label.expected_outcome}</span></td>
                <td style={styles.td}><span style={{ color: FRAUD_COLORS[c.label.fraud_risk_level] }}>{c.label.fraud_risk_level}</span></td>
                <td style={styles.td}>
                  <span style={{ color: c.performance?.status === "DEFAULT" ? "#ef4444" : c.performance?.status === "DELINQUENT" ? "#f59e0b" : "#10b981", fontWeight: 600 }}>{titleCase(c.performance?.status)}</span>
                  {c.performance?.realized_loss ? <span style={{ color: "#64748b" }}> · {money(c.performance.realized_loss)}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={styles.tableFooter}>Showing {rows.length} of {cases.length} cases</div>
    </div>
  );
}

export function NetworkTab({ cases }) {
  const [withRings, setWithRings] = useState(true);
  const analysis = useMemo(() => {
    const pool = JSON.parse(JSON.stringify(cases));
    if (withRings) injectFraudRings(pool, { seed: "ui-rings", ringCount: Math.max(2, Math.floor(pool.length / 40)) });
    const a = analyzeNetwork(pool);
    return { ...a, pool };
  }, [cases, withRings]);

  return (
    <div>
      <div style={styles.note}>
        Applications are linked through shared devices, IP addresses, addresses and document fingerprints. Employers are tracked but excluded from linkage,
        since colleagues legitimately share one. Toggle ring injection to see the analytics recover a coordinated group.
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, fontSize: 13 }}>
        <input type="checkbox" checked={withRings} onChange={(e) => setWithRings(e.target.checked)} /> Inject coordinated rings into a copy of the portfolio
      </label>
      <div style={styles.grid4}>
        <MetricCard title="Entities" value={analysis.entities} color="#2563eb" />
        <MetricCard title="Shared entities" value={analysis.shared_entities.length} color="#f59e0b" />
        <MetricCard title="Clusters" value={analysis.summary.clusters} color="#7c3aed" subtitle={`${analysis.summary.high_risk_clusters} high risk`} />
        <MetricCard title="Cases in clusters" value={analysis.summary.cases_in_clusters} color="#ef4444" />
      </div>
      {analysis.clusters.length === 0 ? (
        <Callout tone="good">No application clusters in this portfolio.</Callout>
      ) : (
        <Panel title="Clusters">
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead><tr>{["Cluster", "Size", "Risk", "Linked by", "Density"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
              <tbody>
                {analysis.clusters.slice(0, 25).map((c) => (
                  <tr key={c.cluster_id}>
                    <td style={styles.td}>{c.cluster_id}</td>
                    <td style={styles.td}>{c.size}</td>
                    <td style={styles.td}><Chip color={c.risk === "HIGH" ? "#ef4444" : c.risk === "MEDIUM" ? "#f59e0b" : "#3b82f6"}>{c.risk}</Chip></td>
                    <td style={styles.td}>{c.linking_entity_types.map(titleCase).join(", ")}</td>
                    <td style={styles.td}>{c.density}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

export function EconomicsTab({ cases, config }) {
  const [assumptions, setAssumptions] = useState({ ...DEFAULT_ASSUMPTIONS, fraud_prevalence: 0.05, investigation_capacity: null });

  const scored = useMemo(() => cases.map((c) => {
    const s = scoreCase(c, config, { now: "eco" });
    return { score: alertsToScore(s.alerts), is_fraud: isFraudCase(c) ? 1 : 0, loan_amount: c.application.loan_amount };
  }), [cases, config]);

  const sweep = useMemo(() => thresholdSweep(scored, assumptions), [scored, assumptions]);
  const maxBenefit = Math.max(...sweep.rows.map((r) => Math.abs(r.net_expected_benefit)), 1);

  const field = (label, key, step = 1, suffix = "") => (
    <label key={key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#475569" }}>
      {label}
      <input
        type="number" step={step} value={assumptions[key] ?? ""}
        onChange={(e) => setAssumptions((a) => ({ ...a, [key]: e.target.value === "" ? null : Number(e.target.value) }))}
        style={{ ...styles.seedInput, marginBottom: 0 }} aria-label={label}
      />
      {suffix && <span style={{ fontSize: 11, color: "#94a3b8" }}>{suffix}</span>}
    </label>
  );

  return (
    <div>
      <div style={styles.note}>
        Expected value equals fraud loss avoided minus false-positive review cost, customer friction cost and model operating cost.
        Adjust the assumptions and the optimal alert threshold moves with them.
      </div>
      <Panel title="Assumptions">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {field("Fraud prevalence", "fraud_prevalence", 0.005, "share of applications")}
          {field("Loss given fraud", "average_loss_given_fraud", 0.01, "share of loan amount")}
          {field("Manual review cost", "manual_review_cost", 5, "per alert reviewed")}
          {field("Review minutes per alert", "review_minutes_per_alert", 5)}
          {field("False decline cost", "false_decline_cost", 50, "per wrongly declined customer")}
          {field("Customer friction cost", "customer_friction_cost", 5, "per good customer alerted")}
          {field("Model operating cost", "model_operating_cost_per_case", 0.05, "per case scored")}
          {field("Investigation capacity", "investigation_capacity", 1, "alerts reviewable; blank = unlimited")}
        </div>
      </Panel>

      <div style={styles.grid4}>
        <MetricCard title="Optimal threshold" value={sweep.optimal_threshold?.toFixed(2) ?? "—"} color="#2563eb" subtitle="maximises net benefit" />
        <MetricCard title="Net expected benefit" value={money(sweep.optimal?.net_expected_benefit)} color={sweep.optimal?.net_expected_benefit >= 0 ? "#10b981" : "#ef4444"} />
        <MetricCard title="Fraud captured / missed" value={`${sweep.optimal?.fraud_captured ?? 0} / ${sweep.optimal?.fraud_missed ?? 0}`} color="#f97316" />
        <MetricCard title="Review hours" value={sweep.optimal?.review_hours ?? 0} color="#7c3aed" subtitle={sweep.optimal?.capacity_exceeded ? "capacity exceeded" : "within capacity"} />
      </div>

      <Panel title="Threshold sweep">
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead><tr>{["Threshold", "Alerts", "Fraud captured", "Fraud missed", "False positives", "Review hours", "Loss avoided", "Net benefit", ""].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {sweep.rows.map((r) => (
                <tr key={r.threshold} style={{ background: r.threshold === sweep.optimal_threshold ? "#ecfdf5" : "transparent" }}>
                  <td style={styles.td}><strong>{r.threshold.toFixed(2)}</strong></td>
                  <td style={styles.td}>{r.alerts}</td>
                  <td style={styles.td}>{r.fraud_captured}</td>
                  <td style={styles.td}>{r.fraud_missed}</td>
                  <td style={styles.td}>{r.false_positives}</td>
                  <td style={styles.td}>{r.review_hours}</td>
                  <td style={styles.td}>{money(r.fraud_loss_avoided)}</td>
                  <td style={{ ...styles.td, fontWeight: 600, color: r.net_expected_benefit >= 0 ? "#059669" : "#dc2626" }}>{money(r.net_expected_benefit)}</td>
                  <td style={{ ...styles.td, width: 120 }}>
                    <div style={{ height: 8, borderRadius: 4, background: r.net_expected_benefit >= 0 ? "#10b981" : "#ef4444", width: `${Math.max(2, (Math.abs(r.net_expected_benefit) / maxBenefit) * 100)}%` }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export function ValidationTab() {
  const benchmark = useArtifact("validation-summary.json");
  const models = useArtifact("model-summary.json");
  const s = benchmark.data;
  const champion = models.data?.champion;

  return (
    <div>
      <div style={styles.note}>
        Every number here is generated by <code>npm run benchmark</code> and the Python analytics pipeline, then published as an artifact.
        Nothing on this page is typed by hand.
      </div>

      {benchmark.status === "unavailable" && (
        <Callout tone="warn">
          Benchmark artifacts are not published at this URL. Run <code>npm run benchmark</code> to generate
          <code> artifacts/validation-summary.json</code> and <code>artifacts/validation-report.md</code>.
        </Callout>
      )}

      {s && (
        <>
          <div style={styles.grid4}>
            <MetricCard title="Release gates" value={s.gates.passed ? "PASS" : "FAIL"} color={s.gates.passed ? "#10b981" : "#ef4444"} subtitle={s.gates.passed ? "all mandatory gates" : s.gates.failed.join(", ")} />
            <MetricCard title="Cases evaluated" value={s.headline.generated_cases.toLocaleString()} color="#2563eb" subtitle={`seed ${s.manifest.seed}`} />
            <MetricCard title="Decision agreement" value={pct(s.headline.decision_rule_agreement)} color="#0891b2" />
            <MetricCard title="Fairness" value={s.headline.fairness_status} color={s.headline.fairness_status === "PASS" ? "#10b981" : "#f59e0b"} subtitle={`counterfactual ${pct(s.headline.counterfactual_invariance)}`} />
          </div>

          <Panel title="Release gates">
            <div style={styles.tableContainer}>
              <table style={styles.table}>
                <thead><tr>{["Gate", "Layer", "Required", "Value", "Status"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {s.gates.rows.map((g) => (
                    <tr key={g.id}>
                      <td style={styles.td}>{g.label}</td>
                      <td style={styles.td}>{titleCase(g.layer)}</td>
                      <td style={styles.td}>{g.op} {g.threshold}</td>
                      <td style={styles.td}><strong>{typeof g.value === "number" ? g.value.toFixed(4) : String(g.value)}</strong></td>
                      <td style={styles.td}><Chip color={g.status === "PASS" ? "#10b981" : g.status === "WARN" ? "#f59e0b" : "#ef4444"}>{g.status}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Lineage" style={{ marginTop: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, fontSize: 13 }}>
              {Object.entries({
                Generator: s.manifest.generator_version, "Case schema": s.manifest.case_schema_version, Ruleset: s.manifest.ruleset_version,
                Policy: s.manifest.policy_version, "Reason codes": s.manifest.reason_code_catalog_version, "Feature policy": s.manifest.feature_policy_version,
                Commit: String(s.manifest.generator_commit ?? "").slice(0, 8) || "n/a", "Config hash": String(s.manifest.configuration_hash).slice(7, 19),
                "Generated at": new Date(s.manifest.generated_at).toLocaleString()
              }).map(([k, v]) => <div key={k}><span style={{ color: "#64748b" }}>{k}: </span><strong style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</strong></div>)}
            </div>
          </Panel>
        </>
      )}

      {champion && (
        <Panel title="Model validation" style={{ marginTop: 16 }}>
          <div style={styles.grid4}>
            <MetricCard title="Champion" value={champion.model} color="#2563eb" subtitle={`${champion.backend} · v${champion.version}`} />
            <MetricCard title="Test PR-AUC" value={champion.test?.pr_auc?.toFixed(3)} color="#059669" />
            <MetricCard title="Out-of-time PR-AUC" value={champion.out_of_time?.pr_auc?.toFixed(3)} color="#0891b2" />
            <MetricCard title="Clean-control FPR" value={champion.clean_control_fpr?.toFixed(3)} color="#7c3aed" />
          </div>
        </Panel>
      )}

      <Panel title="Download the validation package" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            ["Validation report (Markdown)", "validation-report.md"],
            ["Validation summary (JSON)", "validation-summary.json"],
            ["Decision results (CSV)", "decision-results.csv"],
            ["Rule analytics (CSV)", "rule-analytics.csv"],
            ["Fairness results (CSV)", "fairness-results.csv"],
            ["Model validation package", "validation-package.md"],
            ["Model comparison", "model-comparison.md"]
          ].map(([label, file]) => (
            <a key={file} href={artifactUrl(file)} download style={{ ...styles.btnSmall, textDecoration: "none", display: "inline-block" }}>{label}</a>
          ))}
        </div>
      </Panel>
    </div>
  );
}

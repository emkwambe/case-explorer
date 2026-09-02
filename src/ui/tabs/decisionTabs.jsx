// src/ui/tabs/decisionTabs.jsx — Decision, explanation, fairness and investigation tabs.

import React, { useState } from "react";
import { styles, OUTCOME_COLORS, OUTCOME_ICONS, SEVERITY_COLORS, CATEGORY_COLORS, STATE_COLORS, titleCase } from "../theme.js";
import { MetricCard, Panel, KV, Badge, Chip, CitationList, Callout } from "../components/primitives.jsx";
import { download } from "../components/download.js";
import { REASON_CODES } from "../../decisioning/reason-codes/catalog.js";
import { getRule } from "../../decisioning/fraud-rules/rules.js";
import { artifactUrl, useArtifact } from "../hooks/useArtifacts.js";

export function DecisionTab({ caseData, scored }) {
  if (!scored) return null;
  const { decision, alerts, versions } = scored;
  const agrees = decision.outcome === caseData.label.expected_outcome;
  return (
    <div>
      <div style={{ ...styles.decisionBanner, background: `${OUTCOME_COLORS[decision.outcome]}12`, borderLeft: `6px solid ${OUTCOME_COLORS[decision.outcome]}` }}>
        <div style={{ fontSize: 30, marginRight: 16 }}>{OUTCOME_ICONS[decision.outcome]}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 700 }}>{decision.outcome.replace(/_/g, " ")}</div>
          <div style={{ color: "#64748b", fontSize: 13 }}>Pathway: {titleCase(decision.pathway)} · policy {decision.policy_version} · ruleset {versions.ruleset}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12, color: agrees ? "#059669" : "#b45309" }}>
          <div>Generator label: <strong>{caseData.label.expected_outcome}</strong></div>
          <div>{agrees ? "Policy agrees" : "Policy differs — counted against decision agreement"}</div>
        </div>
      </div>

      <div style={styles.grid2}>
        <Panel title="Underwriting factors (permitted inputs only)">
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead><tr>{["Factor", "Value", "Approve", "Review", "Status"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
              <tbody>
                {decision.factors.map((f) => (
                  <tr key={f.factor} title={f.source}>
                    <td style={styles.td}>{titleCase(f.factor)}</td>
                    <td style={styles.td}><strong>{f.value}</strong></td>
                    <td style={styles.td}>{f.approve_max !== undefined ? `≤ ${f.approve_max}` : `≥ ${f.approve_min}`}</td>
                    <td style={styles.td}>{f.review_max !== undefined ? `≤ ${f.review_max}` : `≥ ${f.review_min}`}</td>
                    <td style={styles.td}>
                      <Chip color={f.status === "PASS" ? "#10b981" : f.status === "REVIEW" ? "#f59e0b" : "#ef4444"}>{f.status}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ ...styles.note, marginTop: 10, marginBottom: 0 }}>
            Underwritten on employer-verified income and the higher of disclosed versus bureau obligations, not on the applicant's own figures.
          </div>
        </Panel>

        <Panel title="Reason codes (governed catalog)">
          {decision.reason_codes.length === 0 ? (
            <Callout tone="good">Approved with no adverse reason codes.</Callout>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {decision.reason_codes.map((code) => {
                const def = REASON_CODES[code];
                return (
                  <div key={code} style={{ padding: 10, background: "white", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Chip color={CATEGORY_COLORS[def?.category] ?? "#64748b"}>{titleCase(def?.category ?? "unknown")}</Chip>
                      <strong style={{ fontSize: 13 }}>{code}</strong>
                      {def?.adverse_action && <span style={{ fontSize: 11, color: "#059669" }}>adverse-action eligible</span>}
                    </div>
                    <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>{def?.description}</div>
                  </div>
                );
              })}
            </div>
          )}
          {decision.outcome === "DECLINE" && (
            <Callout tone={decision.adverse_action_reasons.length ? "info" : "bad"}>
              {decision.adverse_action_reasons.length
                ? `Adverse-action notice would cite: ${decision.adverse_action_reasons.map((r) => r.code).join(", ")}. Fraud indicators drive investigation and are never stated as the decline reason.`
                : "No adverse-action-eligible reason. Governance would block this decline."}
            </Callout>
          )}
        </Panel>
      </div>

      <Panel title={`Rule alerts (${alerts.length})`}>
        {alerts.length === 0 ? (
          <Callout tone="good">No rule fired on this case.</Callout>
        ) : (
          <div style={styles.findingsList}>
            {alerts.map((a) => {
              const rule = getRule(a.rule_id);
              return (
                <div key={`${a.rule_id}-${a.reason_code}`} style={{ ...styles.finding, background: "white", border: "1px solid #e2e8f0", borderLeft: `4px solid ${SEVERITY_COLORS[a.severity]}` }}>
                  <div style={styles.findingHeader}>
                    <Badge color={SEVERITY_COLORS[a.severity]}>{a.severity}</Badge>
                    <strong>{`${a.rule_id}@${a.rule_version}`}</strong>
                    <Chip color={CATEGORY_COLORS[REASON_CODES[a.reason_code]?.category] ?? "#64748b"}>{a.reason_code}</Chip>
                    <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>owner {rule?.owner} · {rule?.approval_status}</span>
                  </div>
                  <p style={styles.findingDetails}>{a.detail}</p>
                  <div style={{ marginTop: 8 }}>
                    <div style={{ color: "#475569", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Supporting evidence</div>
                    <CitationList citations={a.evidence_citations} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {decision.conditions.length > 0 && (
        <Panel title="Conditions and next actions" style={{ marginTop: 16 }}>
          <ul style={{ margin: 0, paddingLeft: 20 }}>{decision.conditions.map((c) => <li key={c} style={{ marginBottom: 6 }}>{c}</li>)}</ul>
        </Panel>
      )}
    </div>
  );
}

export function ExplanationTab({ scored }) {
  const models = useArtifact("model-summary.json");
  if (!scored) return null;
  const e = scored.explanation;
  const champion = models.data?.champion;
  const importance = models.data?.explainability?.global_importance ?? models.data?.explainability?.permutation_importance ?? null;
  return (
    <div>
      <div style={styles.note}>
        Every decision answers six questions: what was detected, which inputs contributed, which evidence supports it,
        which versions produced it, what would change the outcome, and whether a human reviewed it.
      </div>

      <div style={styles.grid2}>
        <Panel title="What was detected">
          {e.what_was_detected.length === 0 ? <Callout tone="good">Nothing was detected on this case.</Callout> : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
              {e.what_was_detected.map((d) => (
                <li key={d.rule}><strong>{d.rule}</strong> ({d.severity}) → <span style={{ color: CATEGORY_COLORS[d.category] ?? "#334155" }}>{d.reason_code}</span><div style={{ color: "#475569" }}>{d.detail}</div></li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="What would change the outcome">
          {e.what_would_change_the_outcome.length === 0 ? <Callout tone="good">Approved; nothing to remediate.</Callout> : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
              {e.what_would_change_the_outcome.map((c, i) => <li key={`${c.change}-${i}`}><strong>{titleCase(c.change)}</strong>: {c.note}</li>)}
            </ul>
          )}
        </Panel>
      </div>

      <div style={styles.grid2}>
        <Panel title="Which evidence supports the finding"><CitationList citations={e.which_evidence_supports} /></Panel>
        <Panel title="Versions and review status">
          <KV label="Ruleset">{e.which_versions_were_used.ruleset}</KV>
          <KV label="Policy">{e.which_versions_were_used.policy}</KV>
          <KV label="Reason-code catalog">{e.which_versions_were_used.reason_code_catalog}</KV>
          <KV label="Model">{e.which_versions_were_used.model ?? "not applied to this decision"}</KV>
          <KV label="Automated or reviewed">{titleCase(e.automated_or_reviewed)}</KV>
        </Panel>
      </div>

      <Panel title="Model explainability (Python pipeline)">
        {models.status === "unavailable" && (
          <Callout tone="warn">
            Model artifacts are not published here. Run <code>npm run datasets</code> then the analytics pipeline
            (<code>python -m case_analytics.pipeline --data data --out artifacts</code>) to generate SHAP plots and importances.
          </Callout>
        )}
        {champion && (
          <>
            <div style={styles.grid4}>
              <MetricCard title="Champion" value={champion.model} color="#2563eb" subtitle={champion.backend} />
              <MetricCard title="Test PR-AUC" value={(champion.test?.pr_auc ?? 0).toFixed(3)} color="#059669" />
              <MetricCard title="Recall @ threshold" value={(champion.test?.recall ?? 0).toFixed(3)} color="#0891b2" subtitle={`threshold ${(champion.threshold ?? 0).toFixed(2)}`} />
              <MetricCard title="Calibration error" value={(champion.test?.ece ?? 0).toFixed(3)} color="#7c3aed" subtitle="expected calibration error" />
            </div>
            {importance && (
              <div style={styles.tableContainer}>
                <table style={styles.table}>
                  <thead><tr>{["Feature", "Importance", "Reason code"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {(Array.isArray(importance) ? importance : Object.entries(importance).map(([feature, value]) => ({ feature, value }))).slice(0, 12).map((row) => (
                      <tr key={row.feature}>
                        <td style={styles.td}>{titleCase(row.feature)}</td>
                        <td style={styles.td}>{Number(row.importance ?? row.value ?? 0).toFixed(4)}</td>
                        <td style={styles.td}>{row.reason_code ? <Chip color={CATEGORY_COLORS[REASON_CODES[row.reason_code]?.category] ?? "#64748b"}>{row.reason_code}</Chip> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
              {[`shap_summary_${champion.model}.png`, "pr_curves.png", "calibration.png"].map((img) => (
                <figure key={img} style={{ margin: 0, flex: "1 1 320px" }}>
                  <img src={artifactUrl(img)} alt={titleCase(img.replace(".png", ""))} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 6, background: "white" }} />
                  <figcaption style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{titleCase(img.replace(".png", ""))}</figcaption>
                </figure>
              ))}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

export function FairnessTab({ caseData, counterfactual }) {
  if (!counterfactual) return null;
  const clean = counterfactual.changed === 0;
  return (
    <div>
      <Callout tone="info">
        Technical fairness controls only. This does not establish legal compliance; it supports human legal and compliance review.
      </Callout>
      <div style={styles.grid4}>
        <MetricCard title="Counterfactual pairs" value={counterfactual.pairs} color="#2563eb" subtitle="on this case" />
        <MetricCard title="Decisions changed" value={counterfactual.changed} color={clean ? "#10b981" : "#ef4444"} subtitle={clean ? "invariant" : "critical finding"} />
        <MetricCard title="Base outcome" value={counterfactual.base_outcome} color={OUTCOME_COLORS[counterfactual.base_outcome]} />
        <MetricCard title="Sensitive attributes" value={Object.keys(caseData.audit_attributes ?? {}).filter((k) => !["policy_class", "note"].includes(k)).length} color="#7c3aed" subtitle="isolated from inputs" />
      </div>
      <Panel title="Counterfactual test: change one sensitive attribute, hold the financial profile fixed">
        <div style={styles.note}>
          Expected result: same permitted financial profile plus a changed sensitive audit attribute equals an unchanged decision and unchanged reason codes.
          Any row marked changed is a critical finding.
        </div>
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead><tr>{["Attribute", "From", "To", "Outcome", "Result"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {counterfactual.rows.map((r, i) => (
                <tr key={`${r.attribute}-${r.to}-${i}`}>
                  <td style={styles.td}>{titleCase(r.attribute)}</td>
                  <td style={styles.td}>{titleCase(r.from)}</td>
                  <td style={styles.td}>{titleCase(r.to)}</td>
                  <td style={styles.td}>{r.outcome}</td>
                  <td style={styles.td}><Chip color={r.unchanged ? "#10b981" : "#ef4444"}>{r.unchanged ? "unchanged" : "CHANGED"}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export function InvestigationTab({ caseData, scored, investigation, actions, act, open, error }) {
  const [note, setNote] = useState("");
  const [actor, setActor] = useState("a.morgan");
  const [role, setRole] = useState("INVESTIGATOR");

  if (!investigation) {
    return (
      <div>
        <div style={styles.note}>
          The automated decision is <strong>{scored?.decision.outcome}</strong>. Open an investigation to triage, cite evidence,
          request information, escalate and record a disposition. Every action produces an immutable audit event.
        </div>
        <button style={{ ...styles.btnPrimary, width: 220 }} onClick={open} data-testid="open-investigation">Open investigation</button>
      </div>
    );
  }

  const needsReason = (name) => actions.find((a) => a.action === name)?.requires_reason;
  const run = (action) => act({ action, actor, role, note: note || undefined, reason: needsReason(action) ? (note || "Recorded by investigator") : undefined, citations: action === "CITE_EVIDENCE" ? (scored?.explanation.which_evidence_supports ?? []).slice(0, 3) : undefined, disposition: action === "CONFIRM" ? "CONFIRMED_MISREPRESENTATION" : action === "CLEAR" ? "CLEARED" : undefined });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <Badge color={STATE_COLORS[investigation.state]}>{investigation.state.replace(/_/g, " ")}</Badge>
        <span style={{ fontSize: 13, color: "#64748b" }}>{investigation.investigation_id}</span>
        {investigation.disposition && (
          <Chip color={investigation.disposition.status === "APPROVED" ? "#10b981" : investigation.disposition.status === "REJECTED" ? "#ef4444" : "#f59e0b"}>
            {titleCase(investigation.disposition.proposed)} · {titleCase(investigation.disposition.status)}
          </Chip>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>Simulated case. Not a SAR determination.</span>
      </div>

      {error && <Callout tone="bad">{error}</Callout>}

      <Panel title="Act on this case">
        <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <input aria-label="Actor" value={actor} onChange={(e) => setActor(e.target.value)} style={{ ...styles.seedInput, width: 160, marginBottom: 0 }} />
          <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} style={{ ...styles.select, width: 200, marginBottom: 0 }}>
            <option value="INVESTIGATOR">Investigator</option>
            <option value="SENIOR_INVESTIGATOR">Senior investigator</option>
            <option value="REVIEWER">Reviewer (approves dispositions)</option>
          </select>
          <input aria-label="Note or reason" placeholder="Note or reason" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...styles.seedInput, flex: 1, minWidth: 200, marginBottom: 0 }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {actions.map((a) => (
            <button key={a.action} onClick={() => run(a.action)} data-testid={`action-${a.action}`}
              style={{ ...styles.btnSmall, borderColor: a.reviewer_only ? "#7c3aed" : "#cbd5e1", color: a.reviewer_only ? "#7c3aed" : "#334155" }}>
              {titleCase(a.action)}{a.reviewer_only ? " (reviewer)" : ""}
            </button>
          ))}
        </div>
        <div style={{ ...styles.note, marginTop: 10, marginBottom: 0 }}>
          Four-eyes control: the actor who proposes a disposition cannot approve it. Closing requires an approved disposition.
        </div>
      </Panel>

      <div style={styles.grid2}>
        <Panel title={`Findings carried into the investigation (${investigation.findings.length})`}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            {investigation.findings.map((f, i) => <li key={`${f.id}-${i}`}><strong>{f.id}</strong> {f.reason_code ? `· ${f.reason_code}` : ""}<div style={{ color: "#475569" }}>{f.detail}</div></li>)}
          </ul>
        </Panel>
        <Panel title="Notes, citations and information requests">
          {investigation.notes.length === 0 && investigation.citations.length === 0 && investigation.information_requests.length === 0 && <span style={{ color: "#94a3b8", fontSize: 13 }}>Nothing recorded yet.</span>}
          {investigation.notes.map((n, i) => <div key={`note-${i}`} style={{ fontSize: 13, marginBottom: 6 }}><strong>{n.actor}</strong>: {n.note}</div>)}
          {investigation.citations.length > 0 && <CitationList citations={investigation.citations} />}
          {investigation.information_requests.map((r, i) => (
            <div key={`req-${i}`} style={{ fontSize: 13, marginTop: 6 }}>Requested by {r.by}: {r.request} {r.received_at ? "· received" : "· outstanding"}</div>
          ))}
        </Panel>
      </div>

      <Panel title="Timeline">
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead><tr>{["When", "Actor", "Action", "From", "To", "Reason"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {investigation.timeline.map((t, i) => (
                <tr key={`${t.action}-${i}`}>
                  <td style={styles.td}>{new Date(t.at).toLocaleTimeString()}</td>
                  <td style={styles.td}>{t.actor}</td>
                  <td style={styles.td}><strong>{titleCase(t.action)}</strong></td>
                  <td style={styles.td}>{t.from ?? "—"}</td>
                  <td style={styles.td}>{t.to}</td>
                  <td style={styles.td}>{t.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title={`Immutable audit events (${investigation.audit_events.length})`} style={{ marginTop: 16 }}>
        <div style={styles.note}>
          Each event carries the hash of the previous one, so altering history is detectable. This is the record a model-risk or audit function would read.
        </div>
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead><tr>{["Event", "Actor", "Case", "Policy", "State change", "Hash"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {investigation.audit_events.map((ev) => (
                <tr key={ev.event_id}>
                  <td style={styles.td}><strong>{titleCase(ev.event_type)}</strong></td>
                  <td style={styles.td}>{ev.actor}</td>
                  <td style={{ ...styles.td, fontFamily: "monospace", fontSize: 11 }}>{String(ev.case_version).slice(-14)}</td>
                  <td style={styles.td}>{ev.policy_version ?? "—"}</td>
                  <td style={styles.td}>{ev.previous_state ?? "—"} → {ev.new_state ?? "—"}</td>
                  <td style={{ ...styles.td, fontFamily: "monospace", fontSize: 11 }}>{ev.hash.slice(7, 19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button style={{ ...styles.btnSmall, marginTop: 12 }} onClick={() => download(`audit-${caseData.id}.json`, JSON.stringify(investigation.audit_events, null, 2))}>
          Export audit record
        </button>
      </Panel>
    </div>
  );
}

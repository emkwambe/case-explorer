// src/ui/tabs/caseTabs.jsx — Tabs that describe the case itself: overview, timeline, alignment,
// ground-truth graph, evidence and application metadata.

import React from "react";
import { styles, ALIGNMENT_COLORS, ALIGNMENT_DESCRIPTIONS, FRAUD_COLORS, OUTCOME_COLORS, OUTCOME_ICONS, eventFamily, money, pct, titleCase, scenarioLabel } from "../theme.js";
import { MetricCard, Panel, KV, Badge, ComparisonRow, CitationList, Callout } from "../components/primitives.jsx";
import { caseDti, DTI_BASIS } from "../../creditRisk.js";
import { useActiveProfile } from "../../profiles/activeProfile.js";

export function OverviewTab({ caseData }) {
  const { profile } = useActiveProfile();
  const { applicant, application, truth, presentation, label, audit_attributes: audit } = caseData;
  const t = truth.current_state;
  const p = presentation.current_state;
  // Back-end DTI under the active profile's definition (see caseDti), the same figure the credit policy uses.
  const tDti = caseDti(caseData, profile, "truth");
  const pDti = caseDti(caseData, profile, "presentation");
  const solar = pDti.basis === DTI_BASIS.CURRENT_HOUSING_PLUS_SOLAR_LOAN;
  const meta = caseData.application_metadata;
  return (
    <div>
      <div style={styles.grid4}>
        <MetricCard title="Alignment Level" value={label.alignment_level} color={ALIGNMENT_COLORS[label.alignment_level]} subtitle={titleCase(label.case_coherence_status)} />
        <MetricCard title="Fraud Risk" value={label.fraud_risk_level} color={FRAUD_COLORS[label.fraud_risk_level]} />
        <MetricCard title="Expected Outcome" value={label.expected_outcome} color={OUTCOME_COLORS[label.expected_outcome]} icon={OUTCOME_ICONS[label.expected_outcome]} />
        <MetricCard title="Scenario" value={scenarioLabel(caseData.meta?.corruption_type)} color="#64748b" subtitle={`${caseData.meta?.severity} severity · ${label.difficulty}`} />
      </div>
      <div style={styles.grid2}>
        <Panel title="Applicant">
          <KV label="Name">{applicant.name}</KV>
          <KV label="Age">{applicant.age}</KV>
          <KV label="SSN (last 4)">***-**-{applicant.ssn_last4}</KV>
          <KV label="Persona">{titleCase(t.persona)}</KV>
          <KV label="Population regime">{titleCase(t.regime)}</KV>
          <KV label="Market">{titleCase(t.region)} (COL index {t.cost_of_living_index})</KV>
          <KV label="Loan">{money(application.loan_amount)} · {titleCase(application.purpose)}</KV>
          {solar
            ? <KV label="Proposed solar loan">{money(pDti.proposedLoan?.amount)} at {((pDti.proposedLoan?.coupon ?? 0) * 100).toFixed(2)}% for {pDti.proposedLoan?.termYears} years · {money(pDti.proposedPayment)}/mo</KV>
            : <KV label="Proposed PITI">{money(t.monthly_mortgage_payment)}/mo</KV>}
          {meta && <KV label="Submitted">{new Date(meta.submitted).toLocaleString()}</KV>}
          <KV label="Seed" mono>{caseData.meta?.seed ?? "unseeded"}</KV>
        </Panel>
        <Panel title="World truth → claimed truth">
          <ComparisonRow label="Employer" truth={t.employer} pres={p.employer} />
          <ComparisonRow label="Salary" truth={money(t.salary)} pres={money(p.salary)} />
          <ComparisonRow label="Checking" truth={money(t.checking_balance)} pres={money(p.checking_balance)} />
          <ComparisonRow label="Obligations" truth={`${money(t.monthly_obligations)}/mo`} pres={`${money(p.monthly_obligations)}/mo`} />
          <ComparisonRow label="Tenure" truth={`${t.tenure_months} mo`} pres={`${p.tenure_months} mo`} />
          <ComparisonRow label={pDti.label} truth={pct(tDti.dti)} pres={pct(pDti.dti)} />
          <div style={{ ...styles.note, marginTop: 12, marginBottom: 0 }}>
            World truth is never visible to the rules, the model or the underwriting policy. It exists only to label the case and to score detection.
          </div>
        </Panel>
      </div>
      {audit && (
        <Panel title="Sensitive evaluation attributes (never a decision input)">
          <Callout tone="warn">
            These attributes are classified SENSITIVE by the feature policy. They are available to fairness testing only. The counterfactual tab proves the decision does not move when they change.
          </Callout>
          <div style={styles.grid4}>
            <KV label="Age band">{audit.age_band}</KV>
            <KV label="Income band">{audit.income_band}</KV>
            <KV label="Geography">{titleCase(audit.geography_group)}</KV>
            <KV label="Family status scenario">{titleCase(audit.family_status_scenario)}</KV>
            <KV label="Disability income scenario">{audit.disability_income_scenario ? "Yes" : "No"}</KV>
          </div>
        </Panel>
      )}
    </div>
  );
}

export function TimelineTab({ caseData }) {
  const events = [...caseData.truth.events].sort((a, b) => String(a.t).localeCompare(String(b.t)));
  const ledger = caseData.truth.current_state.monthly_ledger ?? [];
  return (
    <div>
      <div style={styles.note}>
        The life script that produced this case. The ledger below closes the loop: every month must satisfy
        starting balance plus deposits minus outflows equals ending balance, and the bank statement is derived from it.
      </div>
      <div style={{ ...styles.timelineHeader, gap: 14, flexWrap: "wrap" }} data-testid="timeline-legend">
        <span>World-truth events:</span>
        {[...new Map(events.map((ev) => { const f = eventFamily(ev.type); return [f.id, f]; })).values()].map((f) => (
          <span key={f.id} style={{ display: "inline-flex", alignItems: "center" }}><span style={{ ...styles.legendDot, background: f.color }} />{f.label}</span>
        ))}
      </div>
      <div style={styles.timeline}>
        {events.map((ev, i) => (
          <div key={`${ev.t}-${ev.type}-${i}`} style={styles.timelineRow}>
            <div style={styles.timelineDate}>{ev.t}</div>
            <div style={styles.timelineDot}><div style={{ ...styles.dot, background: eventFamily(ev.type).color }} title={eventFamily(ev.type).label} data-family={eventFamily(ev.type).id} /></div>
            <div style={styles.timelineContent}>
              <div style={styles.eventType}>{titleCase(ev.type)}{ev.type_detail ? ` · ${titleCase(ev.type_detail)}` : ""}</div>
              <div style={styles.eventDetails}>
                {ev.entity && <span>{ev.entity} · </span>}
                {ev.address && <span>{ev.address} · </span>}
                {ev.salary && <span>{money(ev.salary)}/yr </span>}
                {ev.payment && <span>{money(ev.payment)}/mo </span>}
                {ev.monthly_payment && <span>{money(ev.monthly_payment)}/mo rent</span>}
                {ev.amount && <span>{money(ev.amount)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {ledger.length > 0 && (
        <Panel title="Monthly ledger (bank statement source)" style={{ marginTop: 16 }}>
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead><tr>
                {["Month", "Deposits", "Rent", "Utilities", "Liabilities", "Discretionary", "Outflows", "Start", "End"].map((h) => <th key={h} style={styles.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {ledger.map((m) => (
                  <tr key={m.month}>
                    <td style={styles.td}>{m.month}</td>
                    <td style={styles.td}>{money(m.salary_deposits)}</td>
                    <td style={styles.td}>{money(m.rent_paid)}</td>
                    <td style={styles.td}>{money(m.utilities_paid)}</td>
                    <td style={styles.td}>{money(m.liability_payments)}</td>
                    <td style={styles.td}>{money(m.discretionary_spent)}</td>
                    <td style={styles.td}>{money(m.total_outflows)}</td>
                    <td style={styles.td}>{money(m.starting_checking_balance)}</td>
                    <td style={styles.td}><strong>{money(m.ending_checking_balance)}</strong></td>
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

export function AlignmentTab({ caseData }) {
  const findings = caseData.alignment_findings ?? [];
  return (
    <div>
      <div style={styles.note}>
        Alignment findings compare claimed truth, world truth and evidence across twelve dimensions. Levels run A0 (aligned) to A5 (adversarial).
      </div>
      <div style={styles.alignmentSummary}>
        {findings.map((f, i) => (
          <div key={`${f.dimension}-${i}`} style={{ ...styles.alignmentChip, background: `${ALIGNMENT_COLORS[f.level]}20`, border: `1px solid ${ALIGNMENT_COLORS[f.level]}` }}>
            <span style={{ fontWeight: 700, color: ALIGNMENT_COLORS[f.level] }}>{f.level}</span>
            <span style={{ marginLeft: 8 }}>{titleCase(f.dimension)}</span>
          </div>
        ))}
      </div>
      <div style={styles.findingsList}>
        {findings.map((f, i) => (
          <div key={`${f.dimension}-detail-${i}`} style={{ ...styles.finding, borderLeft: `4px solid ${ALIGNMENT_COLORS[f.level]}` }}>
            <div style={styles.findingHeader}>
              <Badge color={ALIGNMENT_COLORS[f.level]} title={ALIGNMENT_DESCRIPTIONS[f.level]}>{f.level}</Badge>
              <strong>{titleCase(f.dimension)}</strong>
              <span style={{ marginLeft: "auto", color: "#64748b", fontStyle: "italic" }}>{titleCase(f.status)}</span>
            </div>
            <p style={styles.findingDetails}>{f.details}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TruthGraphTab({ caseData }) {
  const findings = caseData.ground_truth_findings ?? [];
  if (findings.length === 0) {
    return <Callout tone="good">No ground-truth deltas. Claimed truth, world truth and evidence agree; this is a clean case.</Callout>;
  }
  return (
    <div>
      <div style={styles.note}>
        Each card is an injected delta between claimed truth, world truth and evidence, with the citations that prove it.
        Detection evaluation measures how many of these the rules recover without ever seeing this tab.
      </div>
      <div style={styles.findingsList}>
        {findings.map((f, i) => (
          <div key={`${f.type}-${i}`} style={{ ...styles.finding, borderLeft: `4px solid ${ALIGNMENT_COLORS[f.classification]}` }}>
            <div style={styles.findingHeader}>
              <Badge color={ALIGNMENT_COLORS[f.classification]} title={ALIGNMENT_DESCRIPTIONS[f.classification]}>{f.classification}</Badge>
              <strong>{titleCase(f.type)}</strong>
              <span style={{ marginLeft: "auto", color: "#64748b", fontStyle: "italic" }}>{titleCase(f.target_layer)}</span>
            </div>
            <p style={styles.findingDetails}>{f.details}</p>
            <div style={{ marginTop: 10, fontSize: 13 }}>
              <div style={{ display: "flex", gap: 24, marginBottom: 8, flexWrap: "wrap" }}>
                {f.claimed_value !== null && f.claimed_value !== undefined && (
                  <div><span style={{ color: "#64748b" }}>Claimed:</span> <strong>{typeof f.claimed_value === "number" ? money(f.claimed_value) : String(f.claimed_value)}</strong></div>
                )}
                {f.true_value !== null && f.true_value !== undefined && (
                  <div><span style={{ color: "#64748b" }}>True:</span> <strong>{typeof f.true_value === "number" ? money(f.true_value) : String(f.true_value)}</strong></div>
                )}
              </div>
              <div style={{ color: "#475569", fontWeight: 600, marginBottom: 4 }}>Evidence citations</div>
              <CitationList citations={f.evidence_citations} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EvidenceTab({ caseData }) {
  const docMeta = caseData.application_metadata?.documents ?? [];
  const bySource = Object.fromEntries(docMeta.map((d) => [d.source, d]));
  return (
    <div>
      <div style={styles.note}>
        This is everything a lender actually receives. The rule engine and the model read only from here, from the application claims, and from submission metadata.
      </div>
      {caseData.evidence.map((ev) => {
        const doc = bySource[ev.source];
        return (
          <div key={ev.source} style={styles.evidenceCard}>
            <div style={styles.evidenceHeader}>
              <strong>{titleCase(ev.source)}</strong>
              <span style={styles.evidenceDate}>{ev.date}</span>
              <span style={styles.fidelityBadge}>Fidelity {(ev.fidelity * 100).toFixed(0)}%</span>
            </div>
            {doc && (
              <div style={{ padding: "8px 16px", background: doc.days_before_submission <= 2 ? "#fffbeb" : "#f8fafc", fontSize: 12, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                Created {doc.days_before_submission} day{doc.days_before_submission === 1 ? "" : "s"} before submission via {doc.pdf_generator}
                {doc.days_before_submission <= 2 && <strong> · unusually recent</strong>}
              </div>
            )}
            <div style={styles.evidenceFields}>
              {Object.entries(ev.fields).map(([key, val]) => (
                <div key={key} style={styles.evidenceRow}>
                  <span style={styles.evidenceKey}>{titleCase(key)}</span>
                  <span style={styles.evidenceValue}>{typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MetadataTab({ caseData }) {
  const meta = caseData.application_metadata;
  if (!meta) return <Callout tone="warn">No application metadata on this case.</Callout>;
  return (
    <div>
      <div style={styles.grid2}>
        <Panel title="Submission">
          <KV label="Timestamp">{new Date(meta.submitted).toLocaleString()}</KV>
          <KV label="Hour of day">{meta.hour_of_day}</KV>
          <KV label="Day of week">{meta.day_of_week}</KV>
          <KV label="Business hours">{meta.is_business_hours ? "Yes" : "No"}</KV>
        </Panel>
        <Panel title="Network">
          <KV label="IP address" mono>{meta.ip_address}</KV>
          <KV label="Risk score">{meta.ip_risk_score}</KV>
          <KV label="ISP">{meta.isp}</KV>
          <KV label="VPN">{meta.is_vpn ? "Yes" : "No"}</KV>
          <KV label="Tor">{meta.is_tor ? "Yes" : "No"}</KV>
        </Panel>
        <Panel title="Behavioural">
          <KV label="Typing speed">{meta.typing_speed_wpm} WPM</KV>
          <KV label="Copy-pasted fields">{meta.fields_copy_pasted}</KV>
          <KV label="Session duration">{meta.session_duration_seconds} s</KV>
          <KV label="Used autofill">{meta.used_autofill ? "Yes" : "No"}</KV>
        </Panel>
        <Panel title="Device">
          <KV label="Fingerprint" mono>{meta.device_fingerprint}</KV>
          <div style={{ ...styles.note, marginTop: 10, marginBottom: 0 }}>
            Device and IP are entity keys for network analytics: reuse across applications is what links a coordinated ring.
          </div>
        </Panel>
      </div>
      <Panel title="Document metadata">
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead><tr>{["Source", "Created", "Modified", "Days before submission", "PDF generator", "Content hash"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {meta.documents.map((d) => (
                <tr key={d.source} style={{ background: d.days_before_submission <= 2 ? "#fffbeb" : "transparent" }}>
                  <td style={styles.td}>{titleCase(d.source)}</td>
                  <td style={styles.td}>{d.created}</td>
                  <td style={styles.td}>{d.modified}</td>
                  <td style={styles.td}>{d.days_before_submission}</td>
                  <td style={styles.td}>{d.pdf_generator}</td>
                  <td style={{ ...styles.td, fontFamily: "monospace", fontSize: 11 }}>{String(d.content_hash ?? "").slice(0, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

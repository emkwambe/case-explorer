// src/ui/components/primitives.jsx — Small presentational building blocks.
import React from "react";
import { styles, ALIGNMENT_COLORS, ALIGNMENT_DESCRIPTIONS, FRAUD_COLORS, titleCase } from "../theme.js";

export function MetricCard({ title, value, color, subtitle, icon }) {
  return (
    <div style={{ ...styles.metricCard, borderTop: `4px solid ${color}` }}>
      <div style={{ color: "#64748b", fontSize: 13, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, wordBreak: "break-word" }}>
        {icon && <span style={{ marginRight: 8 }}>{icon}</span>}{value}
      </div>
      {subtitle && <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

export function Panel({ title, children, style }) {
  return (
    <div style={{ ...styles.panel, ...style }}>
      {title && <h3 style={styles.panelTitle}>{title}</h3>}
      {children}
    </div>
  );
}

export function KV({ label, children, mono }) {
  return (
    <div style={styles.kvRow}>
      <span>{label}</span>
      <strong style={mono ? { fontFamily: "monospace", fontSize: 12, textAlign: "right" } : { textAlign: "right" }}>{children}</strong>
    </div>
  );
}

export function Badge({ color, children, title }) {
  return <span title={title} style={{ ...styles.badge, background: color, cursor: title ? "help" : undefined }}>{children}</span>;
}

export function Chip({ color, children, title }) {
  return <span title={title} style={{ ...styles.chip, background: `${color}1a`, color, border: `1px solid ${color}` }}>{children}</span>;
}

export function Callout({ tone = "info", children }) {
  const tones = {
    info: { background: "#eff6ff", borderColor: "#bfdbfe", color: "#1e3a8a" },
    warn: { background: "#fffbeb", borderColor: "#fde68a", color: "#92400e" },
    good: { background: "#ecfdf5", borderColor: "#a7f3d0", color: "#065f46" },
    bad: { background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }
  };
  return <div style={{ ...styles.callout, ...tones[tone] }}>{children}</div>;
}

export function ComparisonRow({ label, truth, pres }) {
  const matches = truth === pres || truth === "—";
  return (
    <div style={styles.comparisonRow}>
      <span style={styles.comparisonLabel}>{label}</span>
      <span style={{ ...styles.comparisonValue, color: "#10b981" }}>{truth}</span>
      <span style={{ color: "#94a3b8" }}>→</span>
      <span style={{ ...styles.comparisonValue, color: matches ? "#10b981" : "#ef4444", fontWeight: matches ? 400 : 600 }}>{pres}</span>
      <span style={{ marginLeft: "auto", fontSize: 12, color: matches ? "#10b981" : "#ef4444" }}>{matches ? "✓" : "⚠"}</span>
    </div>
  );
}

export function CaseCard({ caseData, selected, onClick, accentColor }) {
  const { applicant, label } = caseData;
  return (
    <div
      onClick={onClick}
      data-testid="case-card"
      style={{ ...styles.caseCard, borderLeft: `4px solid ${accentColor ?? ALIGNMENT_COLORS[label.alignment_level]}`, background: selected ? "#f0f9ff" : "white" }}
    >
      <div style={styles.cardHeader}>
        <strong>{applicant.name}</strong>
        <Badge color={ALIGNMENT_COLORS[label.alignment_level]} title={ALIGNMENT_DESCRIPTIONS[label.alignment_level]}>{label.alignment_level}</Badge>
      </div>
      <div style={styles.cardMeta}>Age {applicant.age} · ${caseData.application.loan_amount.toLocaleString()} · {titleCase(caseData.meta?.corruption_type ?? "none")}</div>
      <div style={styles.cardOutcome}>
        <span style={{ color: FRAUD_COLORS[label.fraud_risk_level], fontWeight: 600 }}>{label.expected_outcome}</span>
        <span style={styles.cardDifficulty}>{label.difficulty}</span>
      </div>
    </div>
  );
}

export function Th({ label, sortKey, sortConfig, onSort, numeric }) {
  const isActive = sortConfig.key === sortKey;
  return (
    <th onClick={() => onSort(sortKey)} style={{ ...styles.th, ...(numeric ? styles.num : null), cursor: "pointer", background: isActive ? "#f1f5f9" : "#f8fafc" }}>
      {label}{isActive && <span style={{ marginLeft: 4 }}>{sortConfig.direction === "asc" ? "↑" : "↓"}</span>}
    </th>
  );
}

export function CitationList({ citations }) {
  if (!citations?.length) return <span style={{ color: "#94a3b8", fontSize: 13 }}>No citations</span>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18, color: "#334155", fontSize: 13 }}>
      {citations.map((c, j) => (
        <li key={`${c.source}-${c.field}-${j}`}>
          <strong>{titleCase(c.source)}</strong>{c.field ? `.${c.field}` : ""}
          {c.value !== undefined && c.value !== null && (
            <span style={{ color: "#64748b", marginLeft: 8 }}>= {typeof c.value === "object" ? JSON.stringify(c.value) : String(c.value)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

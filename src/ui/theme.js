// src/ui/theme.js — Shared colour scale and style objects for the explorer UI.

export const ALIGNMENT_COLORS = { A0: "#10b981", A1: "#3b82f6", A2: "#f59e0b", A3: "#f97316", A4: "#ef4444", A5: "#7c2d12" };
// Alignment levels (max across alignment findings), as defined in docs/methodology/DATA_DICTIONARY.md
// and src/core/findings.js. Used for the A0–A5 badge tooltips.
export const ALIGNMENT_DESCRIPTIONS = {
  A0: "A0 aligned: claims match the evidence (coherent; fraud risk none).",
  A1: "A1 explainable variance: a small difference such as income overstated by up to 15% (mostly coherent; fraud risk none).",
  A2: "A2 partial incoherence: e.g. income understated by more than $1,000 (fraud risk low).",
  A3: "A3 material mismatch: e.g. undisclosed liabilities, overstated assets or an incoherent world (fraud risk moderate).",
  A4: "A4 probable manipulation: e.g. a claimed employer that differs from verification or income overstated by more than 15% (fraud risk high).",
  A5: "A5 synthetic identity: the identity itself is fabricated (fraud risk critical)."
};

// Timeline event families. Three categorical slots validated all-pairs (light mode) with the
// dataviz palette validator; every dot is also labelled with its event type, and a legend is shown.
export const EVENT_FAMILIES = [
  { id: "employment", label: "Employment and income", color: "#2a78d6", types: ["EMPLOYMENT_START", "SALARY_INCREASE", "SALARY_DEPOSIT"] },
  { id: "housing", label: "Housing and occupancy", color: "#eb6834", types: ["ADDRESS_CHANGE", "OCCUPANCY_DECLARATION", "RENT_PAYMENT"] },
  { id: "liabilities", label: "Liabilities and credit", color: "#1baf7a", types: ["LIABILITY_OPENED"] }
];
export const OTHER_EVENT_COLOR = "#64748b";
export const eventFamily = (type) => EVENT_FAMILIES.find((f) => f.types.includes(type)) ?? { id: "other", label: "Other", color: OTHER_EVENT_COLOR };

export const FRAUD_COLORS = { NONE: "#10b981", LOW: "#3b82f6", MODERATE: "#f59e0b", HIGH: "#f97316", CRITICAL: "#ef4444" };
export const OUTCOME_COLORS = { APPROVE: "#10b981", MANUAL_REVIEW: "#f59e0b", DECLINE: "#ef4444" };
export const OUTCOME_ICONS = { APPROVE: "✓", DECLINE: "✗", MANUAL_REVIEW: "?" };
export const SEVERITY_COLORS = { HIGH: "#ef4444", MEDIUM: "#f59e0b", LOW: "#3b82f6" };
export const CATEGORY_COLORS = {
  CREDIT_RISK: "#2563eb", VERIFICATION_FAILURE: "#f97316", FRAUD_INDICATOR: "#ef4444",
  DATA_QUALITY: "#7c3aed", MANUAL_REVIEW_TRIGGER: "#f59e0b"
};
export const STATE_COLORS = {
  NEW: "#64748b", TRIAGED: "#3b82f6", IN_REVIEW: "#f59e0b", INFORMATION_REQUESTED: "#8b5cf6",
  ESCALATED: "#f97316", CLEARED: "#10b981", CONFIRMED: "#ef4444", CLOSED: "#334155"
};

export const styles = {
  app: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#f8fafc", minHeight: "100vh", color: "#0f172a" },
  header: { padding: "18px 28px", background: "white", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" },
  title: { margin: 0, fontSize: 20, color: "#0f172a" },
  subtitle: { margin: "4px 0 0", color: "#64748b", fontSize: 13 },
  layout: { display: "flex", minHeight: "calc(100vh - 76px)", alignItems: "stretch" },
  sidebar: { width: 330, padding: 16, background: "white", borderRight: "1px solid #e2e8f0", overflowY: "auto", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 76px)" },
  main: { flex: 1, padding: 22, overflowY: "auto", maxHeight: "calc(100vh - 76px)", minWidth: 0 },
  caseCard: { padding: 11, marginBottom: 8, borderRadius: 6, cursor: "pointer", transition: "all 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardMeta: { fontSize: 12, color: "#64748b", marginBottom: 4 },
  cardOutcome: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 },
  cardDifficulty: { color: "#94a3b8", fontSize: 11, textTransform: "uppercase" },
  generatorPanel: { marginTop: 16, padding: 14, background: "#f1f5f9", borderRadius: 6, border: "1px solid #e2e8f0" },
  detail: { background: "white", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" },
  // Tabs wrap onto a second line rather than scrolling sideways.
  tabs: { display: "flex", flexWrap: "wrap", borderBottom: "1px solid #e2e8f0", padding: "0 12px" },
  tab: { padding: "12px 12px", background: "none", border: "none", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" },
  segmented: { display: "inline-flex", gap: 2, margin: "12px 12px 0", padding: 3, background: "#f1f5f9", borderRadius: 8, border: "1px solid #e2e8f0", flexWrap: "wrap" },
  segment: { padding: "6px 14px", border: "none", borderRadius: 6, background: "transparent", color: "#475569", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  segmentActive: { background: "white", color: "#1d4ed8", boxShadow: "0 1px 2px rgba(15,23,42,0.12)" },
  // Numeric table cells: right-aligned with tabular figures so digits line up.
  num: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
  tabContent: { padding: 22 },
  grid2: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 16 },
  grid4: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 },
  panel: { padding: 16, background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0" },
  panelTitle: { margin: "0 0 12px", fontSize: 13, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5 },
  kvRow: { display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid #e2e8f0", fontSize: 14 },
  metricCard: { padding: 14, background: "white", borderRadius: 6, border: "1px solid #e2e8f0" },
  badge: { padding: "2px 8px", borderRadius: 10, color: "white", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" },
  chip: { padding: "3px 9px", borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", display: "inline-block" },
  timelineHeader: { display: "flex", alignItems: "center", marginBottom: 16, fontSize: 13 },
  legendDot: { width: 12, height: 12, borderRadius: "50%", background: "#10b981", marginRight: 6 },
  timeline: { position: "relative" },
  timelineRow: { display: "flex", marginBottom: 14, alignItems: "flex-start" },
  timelineDate: { width: 100, fontSize: 13, color: "#64748b", paddingTop: 4 },
  timelineDot: { width: 24, display: "flex", justifyContent: "center" },
  dot: { width: 12, height: 12, borderRadius: "50%", marginTop: 6 },
  timelineContent: { flex: 1, paddingLeft: 12 },
  eventType: { fontWeight: 600, fontSize: 14, marginBottom: 2 },
  eventDetails: { fontSize: 13, color: "#475569" },
  alignmentSummary: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  alignmentChip: { padding: "6px 12px", borderRadius: 16, fontSize: 13, display: "flex", alignItems: "center" },
  findingsList: { display: "flex", flexDirection: "column", gap: 12 },
  finding: { padding: 16, background: "#f8fafc", borderRadius: 6 },
  findingHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" },
  findingDetails: { margin: 0, fontSize: 14, color: "#334155", lineHeight: 1.5 },
  evidenceCard: { marginBottom: 16, border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" },
  evidenceHeader: { display: "flex", alignItems: "center", padding: "10px 16px", background: "#f1f5f9", gap: 12, fontSize: 14 },
  evidenceDate: { color: "#64748b", fontSize: 12 },
  fidelityBadge: { marginLeft: "auto", padding: "2px 8px", background: "#dbeafe", borderRadius: 10, fontSize: 11, color: "#1e40af" },
  evidenceFields: { padding: 16 },
  evidenceRow: { display: "flex", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 },
  evidenceKey: { width: 210, color: "#64748b", flexShrink: 0 },
  evidenceValue: { flex: 1, color: "#0f172a", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" },
  decisionBanner: { display: "flex", alignItems: "center", padding: 18, borderRadius: 6, marginBottom: 18 },
  comparisonRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #e2e8f0", fontSize: 14 },
  comparisonLabel: { width: 130, color: "#64748b", flexShrink: 0 },
  comparisonValue: { minWidth: 78 },
  select: { width: "100%", padding: "7px", marginBottom: "8px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: 13 },
  seedInput: { width: "100%", padding: "7px", marginBottom: "8px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" },
  btnPrimary: { width: "100%", padding: "9px", background: "#2563eb", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: 600, marginBottom: "8px", fontSize: 13 },
  btnSecondary: { width: "100%", padding: "7px", background: "white", color: "#475569", border: "1px solid #cbd5e1", borderRadius: "4px", cursor: "pointer", fontSize: "12px", marginBottom: "8px" },
  btnSmall: { padding: "6px 12px", background: "white", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  tableToolbar: { display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" },
  filterInput: { flex: 1, minWidth: 200, padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: 14 },
  btnCSV: { padding: "8px 16px", background: "#059669", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: 600 },
  tableContainer: { overflowX: "auto", background: "white", borderRadius: "6px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "10px 12px", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#475569", background: "#f8fafc", whiteSpace: "nowrap" },
  td: { padding: "9px 12px", borderBottom: "1px solid #f1f5f9" },
  tableRow: { transition: "background 0.15s" },
  tableFooter: { marginTop: 12, color: "#64748b", fontSize: 13, textAlign: "right" },
  note: { fontSize: 13, color: "#64748b", lineHeight: 1.55, marginBottom: 14 },
  callout: { padding: 12, borderRadius: 6, fontSize: 13, lineHeight: 1.5, marginBottom: 14, border: "1px solid" }
};

export const money = (n) => (n === null || n === undefined || Number.isNaN(n) ? "—" : `$${Math.round(n).toLocaleString()}`);
export const pct = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? "—" : `${(n * 100).toFixed(d)}%`);
export const titleCase = (s) => String(s ?? "").replace(/_/g, " ").toLowerCase().replace(/(^|\s)\w/g, (m) => m.toUpperCase());
/** Display name of a case's scenario (fraud typology); a case with no corruption is a clean application. */
export const scenarioLabel = (type) => (!type || type === "NONE" ? "Clean application" : titleCase(type));
/** The generator's verdict (label.expected_outcome) is computed from hidden world truth, so every view names it the same way. */
export const REFERENCE_LABEL = "Reference label";
export const REFERENCE_LABEL_NOTE = "uses the case's hidden truth; an answer key, not a system decision";

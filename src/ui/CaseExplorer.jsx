// src/ui/CaseExplorer.jsx — Application shell: case library, tab routing and the guided tour.

import React, { useCallback, useMemo, useState } from "react";
import { styles, ALIGNMENT_COLORS, titleCase } from "./theme.js";
import { CaseCard, Chip } from "./components/primitives.jsx";
import { useCaseLibrary, DEMO_SEED } from "./hooks/useCaseLibrary.js";
import { useScoredCase, useInvestigation, useCounterfactualCheck } from "./hooks/useCaseAnalysis.js";
import { OverviewTab, TimelineTab, AlignmentTab, TruthGraphTab, EvidenceTab, MetadataTab } from "./tabs/caseTabs.jsx";
import { DecisionTab, ExplanationTab, FairnessTab, InvestigationTab } from "./tabs/decisionTabs.jsx";
import { OutcomeTab } from "./tabs/outcomeTab.jsx";
import { DataTableTab, NetworkTab, EconomicsTab, ValidationTab } from "./tabs/analyticsTabs.jsx";
import { TOUR_STEPS } from "./demo/tour.js";
import { GENERATOR_VERSION } from "../core/case.js";
import { PORTFOLIO_PROFILES } from "../creditRisk.js";
import { demoConfig } from "./hooks/useCaseLibrary.js";
import { UnderwritingSidebar, PortfolioStrip, BenchmarkPanel, ComplianceFooter } from "./credit/CreditRisk.jsx";
import { useCreditAssessments, CREDIT_DECISION_COLORS } from "./credit/useCreditAssessments.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "World truth" },
  { id: "alignment", label: "Alignment" },
  { id: "truth_graph", label: "Ground truth" },
  { id: "evidence", label: "Evidence" },
  { id: "metadata", label: "Metadata" },
  { id: "decision", label: "Decision" },
  { id: "outcome", label: "Outcome" },
  { id: "explanation", label: "Explanation" },
  { id: "fairness", label: "Fairness" },
  { id: "investigation", label: "Investigation" },
  { id: "portfolio", label: "Portfolio" },
  { id: "network", label: "Network" },
  { id: "economics", label: "Economics" },
  { id: "validation", label: "Validation" }
];

const SCENARIOS = [
  ["MIXED", "Realistic mix (blended portfolio)"],
  ["NONE", "Clean applicant"],
  ["INFLATION", "Income overstatement"],
  ["CONCEALMENT", "Undisclosed liabilities"],
  ["FABRICATION", "Fabricated employment"],
  ["BUST_OUT", "Synthetic identity"],
  ["EVIDENCE_TAMPERING", "Altered bank statement"],
  ["OCCUPANCY_MISREPRESENTATION", "Occupancy misrepresentation"],
  ["GIFT_FUND_MISREPRESENTATION", "Gift-fund misrepresentation"],
  ["ASSET_SEASONING", "Asset seasoning"],
  ["STRAW_BUYER", "Straw buyer"],
  ["INCOHERENT", "Incoherent world (data-quality control)"]
];

export default function CaseExplorer() {
  const library = useCaseLibrary();
  const { cases, selectedCase, selectedId, select, genConfig, setGenConfig, generate, generateOne, config, profile, setProfile } = library;
  const [activeTab, setActiveTab] = useState("overview");
  const [tourStep, setTourStep] = useState(null);
  const [creditMode, setCreditMode] = useState(false);
  const assessments = useCreditAssessments(cases, creditMode);

  const scored = useScoredCase(selectedCase, config);
  const investigation = useInvestigation(selectedCase, scored);
  const counterfactual = useCounterfactualCheck(selectedCase, config);

  const startTour = useCallback(() => {
    const c = generateOne("EVIDENCE_TAMPERING", "HIGH", `${DEMO_SEED}-tour`);
    select(c.id);
    setActiveTab(TOUR_STEPS[0].tab);
    setTourStep(0);
  }, [generateOne, select]);

  const goToStep = useCallback((index) => {
    if (index < 0 || index >= TOUR_STEPS.length) { setTourStep(null); return; }
    setTourStep(index);
    setActiveTab(TOUR_STEPS[index].tab);
  }, []);

  const step = tourStep === null ? null : TOUR_STEPS[tourStep];
  const counts = useMemo(() => {
    const byOutcome = { APPROVE: 0, MANUAL_REVIEW: 0, DECLINE: 0 };
    for (const c of cases) byOutcome[c.label.expected_outcome] = (byOutcome[c.label.expected_outcome] ?? 0) + 1;
    return byOutcome;
  }, [cases]);

  return (
    <div style={styles.app} className="ce-app">
      <header style={styles.header}>
        <div style={{ flex: "1 1 320px" }}>
          <h1 style={styles.title}>Case Explorer</h1>
          <p style={styles.subtitle}>
            Mortgage risk simulation, fraud analytics and model validation · generator {GENERATOR_VERSION} · {cases.length} cases
            ({counts.APPROVE} approve, {counts.MANUAL_REVIEW} review, {counts.DECLINE} decline)
          </p>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569" }}>
          Portfolio profile:
          <select style={{ ...styles.select, width: "auto", marginBottom: 0 }} aria-label="Portfolio profile" value={profile} onChange={(e) => setProfile(e.target.value)} data-testid="portfolio-profile">
            {PORTFOLIO_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <button onClick={startTour} data-testid="start-tour" style={{ ...styles.btnPrimary, width: "auto", padding: "10px 18px", marginBottom: 0 }}>
          Start guided walkthrough
        </button>
      </header>

      {step && (
        <div style={{ background: "#0f172a", color: "white", padding: "12px 28px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }} data-testid="tour-banner">
          <div style={{ flex: "1 1 420px" }}>
            <strong style={{ fontSize: 14 }}>{step.title}</strong>
            <div style={{ fontSize: 13, color: "#cbd5e1", marginTop: 2 }}>{step.body}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{tourStep + 1} of {TOUR_STEPS.length}</span>
            <button style={{ ...styles.btnSmall, background: "transparent", color: "white", borderColor: "#475569" }} onClick={() => goToStep(tourStep - 1)} disabled={tourStep === 0}>Back</button>
            <button style={{ ...styles.btnSmall, background: "#2563eb", color: "white", borderColor: "#2563eb" }} onClick={() => goToStep(tourStep + 1)} data-testid="tour-next">
              {tourStep === TOUR_STEPS.length - 1 ? "Finish" : "Next"}
            </button>
            <button style={{ ...styles.btnSmall, background: "transparent", color: "#94a3b8", borderColor: "#475569" }} onClick={() => setTourStep(null)}>Exit</button>
          </div>
        </div>
      )}

      <div style={styles.layout} className="ce-layout">
        <aside style={styles.sidebar} className="ce-library">
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Case library</div>
          <div style={{ flex: 1, minHeight: 120, overflowY: "auto" }} className="ce-case-list">
            {cases.slice().reverse().map((c) => (
              <CaseCard key={c.id} caseData={c} selected={c.id === selectedId} accentColor={creditMode ? CREDIT_DECISION_COLORS[assessments.get(c.id)?.policyDecision] : undefined} onClick={() => { select(c.id); if (tourStep === null) setActiveTab("overview"); }} />
            ))}
          </div>
          <div style={styles.generatorPanel}>
            <h3 style={styles.panelTitle}>Generate cases</h3>
            <select style={styles.select} aria-label="Scenario" value={genConfig.corruptionType} onChange={(e) => setGenConfig({ ...genConfig, corruptionType: e.target.value })}>
              {SCENARIOS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select style={styles.select} aria-label="Severity" value={genConfig.severity} onChange={(e) => setGenConfig({ ...genConfig, severity: e.target.value })}>
              {["LOW", "MEDIUM", "HIGH"].map((s) => <option key={s} value={s}>{titleCase(s)} severity</option>)}
            </select>
            <select style={styles.select} aria-label="Count" value={genConfig.count} onChange={(e) => setGenConfig({ ...genConfig, count: parseInt(e.target.value, 10) })}>
              {[1, 10, 50, 100, 250].map((n) => <option key={n} value={n}>Generate {n}</option>)}
            </select>
            <input type="text" placeholder="Seed (optional, for reproducibility)" aria-label="Seed" value={genConfig.seed} onChange={(e) => setGenConfig({ ...genConfig, seed: e.target.value })} style={styles.seedInput} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 12, color: "#475569", cursor: "pointer" }}>
              <input type="checkbox" checked={genConfig.adversarial} onChange={(e) => setGenConfig({ ...genConfig, adversarial: e.target.checked })} />
              Adversarial placement (fraud hides in marginal profiles)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 12, color: "#475569", cursor: "pointer" }}>
              <input type="checkbox" checked={creditMode} onChange={(e) => setCreditMode(e.target.checked)} data-testid="credit-risk-mode" />
              Credit Risk Mode
            </label>
            <button style={styles.btnPrimary} data-testid="generate" onClick={() => { generate(); setActiveTab("portfolio"); }}>Generate</button>
            <button style={styles.btnSecondary} onClick={() => { library.reset(); setActiveTab("overview"); }}>Reset library</button>
          </div>
        </aside>

        <main style={styles.main} className="ce-main">
          {creditMode && (
            <div style={{ marginBottom: 14 }}>
              <PortfolioStrip assessments={assessments} />
              <BenchmarkPanel cases={cases} baseConfig={demoConfig} profile={profile} />
            </div>
          )}
          <div className="ce-credit-layout">
          {creditMode && <UnderwritingSidebar key={selectedCase.id} caseData={selectedCase} assessment={assessments.get(selectedCase.id)} />}
          <div style={styles.detail} className="ce-detail">
            <div style={styles.tabs} role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id} role="tab" aria-selected={activeTab === t.id} onClick={() => setActiveTab(t.id)}
                  style={{ ...styles.tab, borderBottom: activeTab === t.id ? "3px solid #2563eb" : "3px solid transparent", color: activeTab === t.id ? "#2563eb" : "#64748b", fontWeight: activeTab === t.id ? 600 : 400 }}
                >{t.label}</button>
              ))}
            </div>
            <div style={styles.tabContent}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <Chip color={ALIGNMENT_COLORS[selectedCase.label.alignment_level]}>{selectedCase.label.alignment_level}</Chip>
                <strong>{selectedCase.applicant.name}</strong>
                <span style={{ color: "#64748b", fontSize: 13 }}>{titleCase(selectedCase.meta?.corruption_type)} · {selectedCase.id}</span>
              </div>

              {activeTab === "overview" && <OverviewTab caseData={selectedCase} />}
              {activeTab === "timeline" && <TimelineTab caseData={selectedCase} />}
              {activeTab === "alignment" && <AlignmentTab caseData={selectedCase} />}
              {activeTab === "truth_graph" && <TruthGraphTab caseData={selectedCase} />}
              {activeTab === "evidence" && <EvidenceTab caseData={selectedCase} />}
              {activeTab === "metadata" && <MetadataTab caseData={selectedCase} />}
              {activeTab === "decision" && <DecisionTab caseData={selectedCase} scored={scored} />}
              {activeTab === "outcome" && <OutcomeTab caseData={selectedCase} scored={scored} />}
              {activeTab === "explanation" && <ExplanationTab scored={scored} />}
              {activeTab === "fairness" && <FairnessTab caseData={selectedCase} counterfactual={counterfactual} />}
              {activeTab === "investigation" && <InvestigationTab caseData={selectedCase} scored={scored} {...investigation} />}
              {activeTab === "portfolio" && <DataTableTab cases={cases} onSelect={(id) => { select(id); setActiveTab("overview"); }} />}
              {activeTab === "network" && <NetworkTab cases={cases} />}
              {activeTab === "economics" && <EconomicsTab cases={cases} config={config} />}
              {activeTab === "validation" && <ValidationTab />}
            </div>
          </div>
          </div>
        </main>
      </div>
      <ComplianceFooter />
    </div>
  );
}

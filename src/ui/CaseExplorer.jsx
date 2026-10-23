// src/ui/CaseExplorer.jsx — Application shell: case library, tab routing and the guided tour.

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { styles, ALIGNMENT_COLORS, ALIGNMENT_DESCRIPTIONS, titleCase, scenarioLabel, REFERENCE_LABEL, REFERENCE_LABEL_NOTE } from "./theme.js";
import { CaseCard, CreditCaseCard, Chip } from "./components/primitives.jsx";
import { useCaseLibrary, DEMO_SEED } from "./hooks/useCaseLibrary.js";
import { useScoredCase, useInvestigation, useCounterfactualCheck } from "./hooks/useCaseAnalysis.js";
import { OverviewTab, TimelineTab, AlignmentTab, TruthGraphTab, EvidenceTab, MetadataTab } from "./tabs/caseTabs.jsx";
import { DecisionTab, ExplanationTab, FairnessTab, InvestigationTab } from "./tabs/decisionTabs.jsx";
import { TryAChangePanel } from "./tabs/TryAChangePanel.jsx";
import { OutcomeTab } from "./tabs/outcomeTab.jsx";
import { DataTableTab, NetworkTab, EconomicsTab, ValidationTab } from "./tabs/analyticsTabs.jsx";
import { TOUR_STEPS } from "./demo/tour.js";
import { GENERATOR_VERSION } from "../core/case.js";
import { ActiveProfileProvider, useActiveProfile } from "../profiles/activeProfile.js";
import { profileIdFromSearch, showsSolarLoan } from "../profiles/index.js";
import { proposedSolarLoan } from "../creditRisk.js";
import { demoConfig } from "./hooks/useCaseLibrary.js";
import { UnderwritingSidebar, PortfolioStrip, BenchmarkPanel, ComplianceFooter } from "./credit/CreditRisk.jsx";
import { useCreditAssessments, CREDIT_DECISION_COLORS } from "./credit/useCreditAssessments.js";
import { DealerViewTab } from "./dealers/DealerView.jsx";
import { useDealerPortfolio } from "./dealers/useDealerPortfolio.js";
import { FundingViewTab } from "./funding/FundingView.jsx";
import { PublicRecordTab } from "./publicRecord/PublicRecordView.jsx";
import { FindingsTab } from "./findings/FindingsView.jsx";
import { PolicySandboxTab } from "./sandbox/PolicySandboxView.jsx";
import { TAB_GROUPS, visibleTabs, groupOfTab } from "./navigation.js";

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

/**
 * `profileRegistry` replaces the lender profile registry, for example in tests. `?profile=solar-prime`
 * or `?profile=mortgage` in the page URL selects the profile on load; otherwise the default applies.
 */
export default function CaseExplorer({ profileRegistry } = {}) {
  const [initialProfileId] = useState(() => (typeof window === "undefined" ? null : profileIdFromSearch(window.location.search, profileRegistry)));
  return (
    <ActiveProfileProvider registry={profileRegistry} initialProfileId={initialProfileId ?? undefined}>
      <CaseExplorerShell />
    </ActiveProfileProvider>
  );
}

function CaseExplorerShell() {
  const library = useCaseLibrary();
  // The list shows the newest case first. Whenever the library changes (load, profile switch, reset
  // or new cases) it starts scrolled to the top rather than keeping the previous list's position.
  const caseListRef = useRef(null);
  useLayoutEffect(() => {
    if (caseListRef.current) caseListRef.current.scrollTop = 0;
  }, [library.cases]);
  const { registry, profileId, setProfileId, profile } = useActiveProfile();
  const { cases, selectedCase, selectedId, select, genConfig, setGenConfig, generate, generateOne, config } = library;
  const [activeTab, setActiveTab] = useState("overview");
  const [tourStep, setTourStep] = useState(null);
  const [creditMode, setCreditMode] = useState(false);
  // One set of credit assessments feeds the cards, the header counts and Credit Risk Mode, so they
  // cannot disagree. Computed when Credit Risk Mode is on or the profile uses the credit lens.
  const creditLens = profile.headerLens === "credit";
  const assessments = useCreditAssessments(cases, creditMode || creditLens, profile);
  const dealerPortfolio = useDealerPortfolio(demoConfig);

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
  // The selected tab picks the section; a tab the active profile cannot show falls back to the
  // first tab of its section.
  const group = groupOfTab(activeTab);
  const tabs = visibleTabs(group, profile);
  const currentTab = tabs.some((t) => t.id === activeTab) ? activeTab : tabs[0].id;
  const openGroup = (g) => setActiveTab(visibleTabs(g, profile)[0].id);

  // Header counts use the profile's lens: the credit policy for credit profiles, otherwise the
  // generator's reference label (computed from hidden truth: an answer key, not a system decision).
  const lens = profile.headerLens === "credit" ? "credit policy" : "reference label";
  const counts = useMemo(() => {
    const byOutcome = { APPROVE: 0, REVIEW: 0, DECLINE: 0 };
    for (const c of cases) {
      const outcome = creditLens ? assessments.get(c.id).policyDecision : c.label.expected_outcome === "MANUAL_REVIEW" ? "REVIEW" : c.label.expected_outcome;
      byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1;
    }
    return byOutcome;
  }, [cases, creditLens, assessments]);

  return (
    <div style={styles.app} className="ce-app">
      <header className="ce-header" data-testid="app-header">
        <div className="ce-header-text">
          <h1 className="ce-header-title">Case Explorer</h1>
          <p className="ce-header-subtitle" data-testid="header-subtitle">
            {profile.subtitle ?? profile.label} · generator {GENERATOR_VERSION} · {cases.length} cases
          </p>
          <div className="ce-header-chips" data-testid="header-counts" aria-label={`Case counts by ${lens}`}>
            <span className="ce-header-lens" title={lens === "credit policy" ? undefined : `${REFERENCE_LABEL}: ${REFERENCE_LABEL_NOTE}`}>{lens === "credit policy" ? "Credit policy" : REFERENCE_LABEL}</span>
            <span className="ce-chip" data-testid="count-approve">Approve <strong>{counts.APPROVE}</strong></span>
            <span className="ce-chip" data-testid="count-review">Review <strong>{counts.REVIEW}</strong></span>
            <span className="ce-chip" data-testid="count-decline">Decline <strong>{counts.DECLINE}</strong></span>
          </div>
        </div>
        <div className="ce-header-controls">
          <label className="ce-header-field">
            Portfolio profile
            <select className="ce-header-select" aria-label="Portfolio profile" value={profileId} onChange={(e) => setProfileId(e.target.value)} data-testid="portfolio-profile">
              {registry.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className="ce-header-toggle">
            <input type="checkbox" checked={creditMode} onChange={(e) => setCreditMode(e.target.checked)} data-testid="credit-risk-mode" />
            Credit Risk Mode
          </label>
          <button type="button" className="ce-header-button" onClick={startTour} data-testid="start-tour">
            Start guided walkthrough
          </button>
        </div>
      </header>

      {step && (
        <div style={{ background: "#0f172a", color: "white", padding: "12px 28px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }} className="ce-no-print" data-testid="tour-banner">
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
          <div ref={caseListRef} style={{ flex: 1, minHeight: 120, overflowY: "auto" }} className="ce-case-list" data-testid="case-list">
            {cases.slice().reverse().map((c) => (
              creditLens
                ? <CreditCaseCard key={c.id} caseData={c} selected={c.id === selectedId} assessment={assessments.get(c.id)} onClick={() => { select(c.id); if (tourStep === null) setActiveTab("overview"); }} />
                : <CaseCard key={c.id} caseData={c} selected={c.id === selectedId} loanAmount={showsSolarLoan(profile) ? proposedSolarLoan(c, profile)?.amount : undefined} accentColor={creditMode ? CREDIT_DECISION_COLORS[assessments.get(c.id)?.policyDecision] : undefined} onClick={() => { select(c.id); if (tourStep === null) setActiveTab("overview"); }} />
            ))}
          </div>
          <details style={styles.generatorPanel} data-testid="generator-panel">
            <summary style={{ ...styles.panelTitle, marginBottom: 0, cursor: "pointer" }}>Generate cases</summary>
            <div style={{ marginTop: 12 }}>
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
            <button style={styles.btnPrimary} data-testid="generate" onClick={() => { generate(); setActiveTab("portfolio"); }}>Generate</button>
            <button style={styles.btnSecondary} onClick={() => { library.reset(); setActiveTab("overview"); }}>Reset library</button>
            </div>
          </details>
        </aside>

        <main style={styles.main} className="ce-main">
          {creditMode && (
            <div style={{ marginBottom: 14 }}>
              <PortfolioStrip assessments={assessments} />
              <BenchmarkPanel cases={cases} baseConfig={demoConfig} />
            </div>
          )}
          <div className="ce-credit-layout">
          {creditMode && <UnderwritingSidebar key={selectedCase.id} caseData={selectedCase} assessment={assessments.get(selectedCase.id)} />}
          <div style={styles.detail} className="ce-detail">
            <div style={styles.segmented} className="ce-nav" role="group" aria-label="Sections" data-testid="section-control">
              {TAB_GROUPS.map((g) => (
                <button key={g.id} type="button" aria-pressed={group.id === g.id} onClick={() => openGroup(g)} data-testid={`section-${g.id}`}
                  style={{ ...styles.segment, ...(group.id === g.id ? styles.segmentActive : null) }}>{g.label}</button>
              ))}
            </div>
            <div style={styles.tabs} className="ce-nav" role="tablist" aria-label={`${group.label} tabs`}>
              {tabs.map((t) => (
                <button
                  key={t.id} role="tab" aria-selected={currentTab === t.id} onClick={() => setActiveTab(t.id)}
                  style={{ ...styles.tab, borderBottom: currentTab === t.id ? "3px solid #2563eb" : "3px solid transparent", color: currentTab === t.id ? "#2563eb" : "#64748b", fontWeight: currentTab === t.id ? 600 : 400 }}
                >{t.label}</button>
              ))}
            </div>
            <div style={styles.tabContent} className="ce-tab-content">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }} className="ce-case-strip">
                <Chip color={ALIGNMENT_COLORS[selectedCase.label.alignment_level]} title={ALIGNMENT_DESCRIPTIONS[selectedCase.label.alignment_level]}>{selectedCase.label.alignment_level}</Chip>
                <strong>{selectedCase.applicant.name}</strong>
                <span style={{ color: "#64748b", fontSize: 13 }}>{scenarioLabel(selectedCase.meta?.corruption_type)} · {selectedCase.id}</span>
              </div>

              {currentTab === "overview" && <OverviewTab caseData={selectedCase} />}
              {currentTab === "timeline" && <TimelineTab caseData={selectedCase} />}
              {currentTab === "alignment" && <AlignmentTab caseData={selectedCase} />}
              {currentTab === "truth_graph" && <TruthGraphTab caseData={selectedCase} />}
              {currentTab === "evidence" && <EvidenceTab caseData={selectedCase} />}
              {currentTab === "metadata" && <MetadataTab caseData={selectedCase} />}
              {currentTab === "decision" && <><DecisionTab caseData={selectedCase} scored={scored} /><TryAChangePanel caseData={selectedCase} profile={profile} config={config} /></>}
              {currentTab === "outcome" && <OutcomeTab caseData={selectedCase} scored={scored} />}
              {currentTab === "explanation" && <ExplanationTab scored={scored} />}
              {currentTab === "fairness" && <FairnessTab caseData={selectedCase} counterfactual={counterfactual} />}
              {currentTab === "investigation" && <InvestigationTab caseData={selectedCase} scored={scored} {...investigation} />}
              {currentTab === "portfolio" && <DataTableTab cases={cases} onSelect={(id) => { select(id); setActiveTab("overview"); }} />}
              {currentTab === "dealers" && <DealerViewTab portfolio={dealerPortfolio} />}
              {currentTab === "funding" && <FundingViewTab portfolio={dealerPortfolio} />}
              {currentTab === "public_record" && profile.publicRecord && <PublicRecordTab profile={profile} />}
              {currentTab === "findings" && profile.publicRecord && <FindingsTab profile={profile} portfolio={dealerPortfolio} onOpenTab={setActiveTab} />}
              {currentTab === "policy_sandbox" && profile.policySandbox && <PolicySandboxTab profile={profile} portfolio={dealerPortfolio} />}
              {currentTab === "network" && <NetworkTab cases={cases} />}
              {currentTab === "economics" && <EconomicsTab cases={cases} config={config} />}
              {currentTab === "validation" && <ValidationTab />}
            </div>
          </div>
          </div>
        </main>
      </div>
      <ComplianceFooter />
    </div>
  );
}

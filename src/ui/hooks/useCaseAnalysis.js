// src/ui/hooks/useCaseAnalysis.js — Scoring, investigation and fairness state for one case.

import { useCallback, useEffect, useMemo, useState } from "react";
import { scoreCase } from "../../decisioning/index.js";
import { openInvestigation, applyReviewAction, allowedActions, InvestigationError } from "../../decisioning/investigation/workflow.js";
import { makeCounterfactual } from "../../evaluation/fairness/index.js";
import { AGE_BANDS, FAMILY_STATUS_SCENARIOS } from "../../core/audit_attributes.js";

/** Score the selected case with the rule engine and underwriting policy. */
export function useScoredCase(caseData, config) {
  return useMemo(() => (caseData ? scoreCase(caseData, config, { now: caseData.meta?.as_of_date ?? "static" }) : null), [caseData, config]);
}

/** Investigation workflow bound to the selected case, kept per case id. */
export function useInvestigation(caseData, scored) {
  const [byCase, setByCase] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => { setError(null); }, [caseData?.id]);

  const investigation = caseData ? byCase[caseData.id] ?? null : null;

  // The transition runs outside the state updater: applyReviewAction is pure, and computing it
  // here lets a rejected transition surface its message instead of being swallowed by React.
  const act = useCallback((action) => {
    if (!caseData || !scored) return;
    const current = byCase[caseData.id] ?? openInvestigation(caseData, scored, { actor: "system", now: new Date().toISOString() });
    try {
      const next = applyReviewAction(current, action);
      setError(null);
      setByCase((prev) => ({ ...prev, [caseData.id]: next }));
    } catch (e) {
      if (!(e instanceof InvestigationError)) throw e;
      setError(e.message);
      setByCase((prev) => (prev[caseData.id] ? prev : { ...prev, [caseData.id]: current }));
    }
  }, [caseData, scored, byCase]);

  const open = useCallback(() => {
    if (!caseData || !scored) return;
    setByCase((prev) => (prev[caseData.id] ? prev : { ...prev, [caseData.id]: openInvestigation(caseData, scored, { actor: "system", now: new Date().toISOString() }) }));
  }, [caseData, scored]);

  const actions = investigation ? allowedActions(investigation) : [];
  return { investigation, actions, act, open, error };
}

/**
 * Live counterfactual check for the selected case: flip each sensitive attribute and confirm
 * the outcome and reason codes are identical. Any difference is a critical finding.
 */
export function useCounterfactualCheck(caseData, config) {
  return useMemo(() => {
    if (!caseData) return null;
    const base = scoreCase(caseData, config, { now: "cf" });
    const candidates = {
      age_band: AGE_BANDS,
      geography_group: ["HIGH_COST", "MEDIUM_COST", "LOW_COST"],
      family_status_scenario: FAMILY_STATUS_SCENARIOS,
      disability_income_scenario: [0, 1],
      persona: ["TEACHER", "NURSE", "SOFTWARE_ENGINEER", "RELOCATED_PROFESSIONAL", "ENTREPRENEUR"]
    };
    const rows = [];
    for (const [attr, values] of Object.entries(candidates)) {
      for (const v of values) {
        const current = caseData.audit_attributes?.[attr];
        if (String(v) === String(current)) continue;
        const twin = makeCounterfactual(caseData, attr, v);
        const alt = scoreCase(twin, config, { now: "cf" });
        const same = alt.decision.outcome === base.decision.outcome
          && JSON.stringify([...alt.decision.reason_codes].sort()) === JSON.stringify([...base.decision.reason_codes].sort());
        rows.push({ attribute: attr, from: String(current), to: String(v), outcome: alt.decision.outcome, unchanged: same });
      }
    }
    return {
      base_outcome: base.decision.outcome,
      base_reason_codes: base.decision.reason_codes,
      pairs: rows.length,
      changed: rows.filter((r) => !r.unchanged).length,
      rows
    };
  }, [caseData, config]);
}

// src/ui/credit/useCreditAssessments.js — Credit policy assessments for the loaded library.

import { useMemo } from "react";
import { assessCredit, ficoComparison } from "../../creditRisk.js";
import { applyProfile } from "../../profiles/index.js";
import { generateBlendedCase } from "../../generator.js";

export const CREDIT_DECISION_COLORS = { APPROVE: "#047857", REVIEW: "#b45309", DECLINE: "#b91c1c" };

export const COMPLIANCE_TEXT = "Demo only · Synthetic data · Not a consumer report · Not for credit decisions · Educational portfolio project";

/** Assess every loaded case once per library change; empty while Credit Risk Mode is off. */
export function useCreditAssessments(cases, enabled) {
  return useMemo(() => {
    const byId = new Map();
    if (enabled) for (const c of cases) byId.set(c.id, assessCredit(c));
    return byId;
  }, [cases, enabled]);
}

export const REFERENCE_SIZE = 2000;
export const REFERENCE_SEED = 42;
const referenceCache = new Map();

/**
 * FICO comparison for a profile's reference stream: 2,000 blended applications at seed 42,
 * the same sample `npm run test:credit` reports. Computed once per profile and cached.
 */
export function profileReference(baseConfig, profile) {
  if (!referenceCache.has(profile)) {
    const cfg = applyProfile(baseConfig, profile);
    const sample = Array.from({ length: REFERENCE_SIZE }, (_, i) => generateBlendedCase(i, cfg, REFERENCE_SEED));
    referenceCache.set(profile, ficoComparison(sample));
  }
  return referenceCache.get(profile);
}

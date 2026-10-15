// src/ui/credit/useCreditAssessments.js — Credit policy assessments for the loaded library.

import { useMemo } from "react";
import { assessCredit, ficoComparison, integrityFraudCodes } from "../../creditRisk.js";
import { applyProfile } from "../../profiles/index.js";
import { generateBlendedCase } from "../../generator.js";

export const CREDIT_DECISION_COLORS = { APPROVE: "#047857", REVIEW: "#b45309", DECLINE: "#b91c1c" };
export const CREDIT_DECISION_LABELS = { APPROVE: "Approve", REVIEW: "Review", DECLINE: "Decline" };

const titleCode = (code) => code.toLowerCase().replace(/_/g, " ");

/**
 * The reason a case card shows under the credit lens: the top decline flag for a decline, the top
 * review flag for a review. Formatting only; the policy's own labels are unchanged.
 */
export function cardReason(a) {
  if (!a || a.policyDecision === "APPROVE") return "Meets credit policy";
  const pool = a.policyDecision === "DECLINE"
    ? a.flags.filter((f) => f.code === "LOW_FICO" || f.code === "HIGH_DTI")
    : a.flags.filter((f) => f.code !== "LOW_FICO" && f.code !== "HIGH_DTI");
  const top = pool[0];
  if (!top) return "";
  const dtiPct = a.dti === null ? "" : ` ${Math.round(a.dti * 100)}%`;
  switch (top.code) {
    case "LOW_FICO": return top.label;
    case "HIGH_DTI": return `High DTI${dtiPct}`;
    case "ELEVATED_DTI": return `Elevated DTI${dtiPct}`;
    case "LIQUIDITY_RISK": return `Liquidity risk: checking $${(a.checking ?? 0).toLocaleString("en-US")}`;
    case "FRAUD_REVIEW": return `Fraud review: ${[...new Set(top.label.replace(/^Fraud review \(|\)$/g, "").split(", "))].map(titleCode).join(", ")}`;
    default: return top.label;
  }
}

/**
 * Secondary integrity badge, or null. Shown only when the generator's integrity check reviews or
 * declines the case for a fraud indicator or a verification failure; benign explainable variances
 * (timing drift, A1/A2 coherent-with-explainable-variances, credit-only reviews) show nothing on the
 * card and stay in the case's Decision tab. Uses the same reason-code rule as the integrity
 * disagreement callout.
 */
export function integrityBadge(a, label) {
  if (!a?.generatorDecision || a.generatorDecision === "APPROVE") return null;
  const codes = integrityFraudCodes(label);
  if (codes.length === 0) return null;
  return { text: `Integrity: ${a.generatorDecision.toLowerCase()}`, codes };
}

export const COMPLIANCE_TEXT = "Demo only · Synthetic data · Not a consumer report · Not for credit decisions · Educational portfolio project";

/** Assess every loaded case once per library change under the active profile; empty while Credit Risk Mode is off. */
export function useCreditAssessments(cases, enabled, profile) {
  return useMemo(() => {
    const byId = new Map();
    if (enabled) for (const c of cases) byId.set(c.id, assessCredit(c, profile));
    return byId;
  }, [cases, enabled, profile]);
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
    referenceCache.set(profile, ficoComparison(sample, profile));
  }
  return referenceCache.get(profile);
}

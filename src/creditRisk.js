// src/creditRisk.js — Credit policy overlay: back-end DTI, policy flags and adverse-action reasons.
//
// Pure module (no React) so the UI, scripts and tests share one implementation.
//
// Design rules:
//   * Underwrite on what the underwriter can see. Every input is a claimed value from
//     `presentation` or an underwriter-visible fraud-rule alert. World truth, the generator's
//     labels and `meta.corruption_type` are never policy inputs.
//   * The policy is a credit overlay, kept separate from the generator's own decision
//     (`label.expected_outcome`, shown as the "Integrity check"). Only two disagreements are
//     reported: integrity APPROVE with credit DECLINE, and integrity DECLINE (or REVIEW for
//     fraud or verification reasons) with credit APPROVE. They are reported, not resolved.
//   * The policy never uses geography, region, zip code, persona, age or regime.
//     `scripts/credit-risk.test.mjs` enforces this by changing those fields on a case and
//     asserting that `assessCredit` output is unchanged. No fair-lending claim is made:
//     disparate-impact testing is out of scope for synthetic data.

import { extractDecisionView } from "./ml/decision_features.js";
import { runFraudRules } from "./decisioning/fraud-rules/rules.js";
import { REASON_CODES, REASON_CATEGORIES } from "./decisioning/reason-codes/catalog.js";

export const CREDIT_POLICY = Object.freeze({
  ficoDecline: 660,
  dtiDecline: 0.45,
  dtiWatchLow: 0.36,
  liquidityCheckingMin: 1000,
  liquidityDtiMin: 0.40
});

// Adverse-action wording modelled on the Regulation B (12 CFR 1002) sample notice.
export const ADVERSE_ACTION = Object.freeze({
  LOW_FICO: "Credit score below program minimum",
  HIGH_DTI: "Excessive obligations in relation to income",
  FRAUD_REVIEW: "Unable to verify information provided"
});

/**
 * Back-end DTI = (non-housing monthly obligations + current monthly housing payment) / (salary / 12).
 *
 * The housing payment is the `monthly_payment` of the most recent `housing_history` entry. If no
 * housing payment is available the ratio falls back to non-housing obligations only and is
 * marked `partial: true`. Returns `dti: null` when there is no positive income to divide by.
 */
export function backEndDti(state = {}) {
  const nonHousing = Number(state.monthly_obligations) || 0;
  const monthlyIncome = (Number(state.salary) || 0) / 12;
  const history = Array.isArray(state.housing_history) ? state.housing_history : [];
  const withPayment = history
    .filter((h) => Number.isFinite(h?.monthly_payment))
    .sort((a, b) => String(a.t ?? "").localeCompare(String(b.t ?? "")));
  const housingPayment = withPayment.length ? withPayment[withPayment.length - 1].monthly_payment : null;
  const partial = housingPayment === null;
  const dti = monthlyIncome > 0 ? (nonHousing + (housingPayment ?? 0)) / monthlyIncome : null;
  return { dti, partial, nonHousing, housingPayment, monthlyIncome };
}

function studentLoanPayment(events = []) {
  return events
    .filter((e) => e?.type === "LIABILITY_OPENED" && e.type_detail === "STUDENT_LOAN")
    .reduce((sum, e) => sum + (Number(e.payment) || 0), 0);
}

/** HIGH-severity alerts from the underwriter-visible fraud rules (claims, evidence, metadata). */
function visibleFraudAlerts(caseObj) {
  const { alerts } = runFraudRules(extractDecisionView(caseObj));
  return alerts.filter((a) => a.severity === "HIGH");
}

/** The two disagreements worth a callout; every other mismatch is a difference of lens, not a conflict. */
export const DISAGREEMENT = Object.freeze({
  INTEGRITY_APPROVE_CREDIT_DECLINE: "INTEGRITY_APPROVE_CREDIT_DECLINE",
  INTEGRITY_FLAG_CREDIT_APPROVE: "INTEGRITY_FLAG_CREDIT_APPROVE"
});

const INTEGRITY_FRAUD_CATEGORIES = new Set([REASON_CATEGORIES.FRAUD_INDICATOR, REASON_CATEGORIES.VERIFICATION_FAILURE]);

/** Integrity-check reason codes that point at fraud or failed verification, not at credit quality. */
export function integrityFraudCodes(label) {
  return (label?.reason_codes ?? []).filter((code) => INTEGRITY_FRAUD_CATEGORIES.has(REASON_CODES[code]?.category));
}

function normaliseDecision(outcome) {
  return outcome === "MANUAL_REVIEW" ? "REVIEW" : outcome ?? null;
}

const pct = (v) => `${Math.round(v * 100)}%`;

/** Score a case against the credit policy using claimed values only. */
export function assessCredit(caseObj, policy = CREDIT_POLICY) {
  const claimed = caseObj?.presentation?.current_state ?? {};
  const fico = Number.isFinite(claimed.credit_score) ? claimed.credit_score : null;
  const { dti, partial: dtiPartial } = backEndDti(claimed);
  const studentPayment = studentLoanPayment(caseObj?.presentation?.events);
  const checking = Number.isFinite(claimed.checking_balance) ? claimed.checking_balance : null;
  const fraudAlerts = visibleFraudAlerts(caseObj);

  const flags = [];
  if (fico !== null && fico < policy.ficoDecline) {
    flags.push({ code: "LOW_FICO", label: `FICO ${fico} below ${policy.ficoDecline}`, severity: "high", adverseActionReason: ADVERSE_ACTION.LOW_FICO });
  }
  if (dti !== null && dti > policy.dtiDecline) {
    flags.push({ code: "HIGH_DTI", label: `Back-end DTI ${pct(dti)}`, severity: "high", adverseActionReason: ADVERSE_ACTION.HIGH_DTI });
  } else if (dti !== null && dti >= policy.dtiWatchLow) {
    flags.push({ code: "ELEVATED_DTI", label: "Elevated DTI", severity: "watch", adverseActionReason: null });
  }
  if (checking !== null && checking < policy.liquidityCheckingMin && dti !== null && dti > policy.liquidityDtiMin) {
    flags.push({ code: "LIQUIDITY_RISK", label: "Liquidity risk", severity: "high", adverseActionReason: null });
  }
  if (fraudAlerts.length) {
    flags.push({
      code: "FRAUD_REVIEW",
      label: `Fraud review (${[...new Set(fraudAlerts.map((a) => a.reason_code))].join(", ")})`,
      severity: "high",
      adverseActionReason: ADVERSE_ACTION.FRAUD_REVIEW
    });
  }

  // LOW_FICO and HIGH_DTI decline. FRAUD_REVIEW, LIQUIDITY_RISK and watch flags route to review:
  // a fraud alert is a verification question for a person, not an automated decline.
  const has = (code) => flags.some((f) => f.code === code);
  const declineFlags = flags.filter((f) => f.code === "LOW_FICO" || f.code === "HIGH_DTI");
  const reviewFlags = flags.filter((f) => f.code === "FRAUD_REVIEW" || f.code === "LIQUIDITY_RISK" || f.severity === "watch");
  const policyDecision = declineFlags.length ? "DECLINE" : reviewFlags.length ? "REVIEW" : "APPROVE";
  const reasons = policyDecision === "DECLINE"
    ? declineFlags.map((f) => f.adverseActionReason)
    : policyDecision === "REVIEW" ? reviewFlags.map((f) => f.label) : [];

  // The generator's own decision is the integrity check: a separate lens, never a policy input.
  const generatorDecision = normaliseDecision(caseObj?.label?.expected_outcome);
  const integrityFraudReview = generatorDecision === "REVIEW" && integrityFraudCodes(caseObj?.label).length > 0;
  let disagreement = null;
  if (generatorDecision === "APPROVE" && policyDecision === "DECLINE") {
    const driver = declineFlags[0];
    const detail = driver.code === "HIGH_DTI" ? `back-end DTI ${pct(dti)}` : `FICO ${fico}`;
    disagreement = {
      kind: DISAGREEMENT.INTEGRITY_APPROVE_CREDIT_DECLINE,
      generator: generatorDecision,
      policy: policyDecision,
      text: `Integrity check: APPROVE · Credit policy: DECLINE (${detail})`
    };
  } else if ((generatorDecision === "DECLINE" || integrityFraudReview) && policyDecision === "APPROVE") {
    const codes = integrityFraudCodes(caseObj?.label);
    disagreement = {
      kind: DISAGREEMENT.INTEGRITY_FLAG_CREDIT_APPROVE,
      generator: generatorDecision,
      policy: policyDecision,
      text: `Integrity check: ${generatorDecision}${integrityFraudReview ? " for fraud" : ""} · Credit policy: APPROVE${codes.length ? ` (${codes.join(", ")})` : ""}`
    };
  }

  return {
    fico,
    dti,
    dtiPartial,
    studentPayment,
    checking,
    flags,
    policyDecision,
    reasons,
    fraudFlag: has("FRAUD_REVIEW") ? "REVIEW" : "NONE",
    generatorDecision,
    disagreement
  };
}

/**
 * One-line summary, for example:
 *   Borrower: FICO 682, DTI 43%, Student $320/mo, Fraud: None, Policy: REVIEW - Elevated DTI | Integrity: APPROVE
 * "Integrity" is the generator's integrity-check decision. The " - <reasons>" part is omitted on
 * APPROVE; several reasons are joined with "; ".
 */
export function riskSummary(a) {
  const fico = a.fico ?? "n/a";
  const dti = a.dti === null ? "n/a" : `${pct(a.dti)}${a.dtiPartial ? " (partial)" : ""}`;
  const student = `$${Math.round(a.studentPayment).toLocaleString("en-US")}/mo`;
  const fraud = a.fraudFlag === "REVIEW" ? "Review" : "None";
  const policy = a.reasons.length ? `${a.policyDecision} - ${a.reasons.join("; ")}` : a.policyDecision;
  return `Borrower: FICO ${fico}, DTI ${dti}, Student ${student}, Fraud: ${fraud}, Policy: ${policy} | Integrity: ${a.generatorDecision ?? "n/a"}`;
}

/**
 * Mean claimed FICO over all applications and over the cases the credit policy approves.
 * A public benchmark that describes financed borrowers is compared with the approved-only mean;
 * see the `compareTo` field of each benchmark in src/profiles/.
 */
export function ficoComparison(cases, policy = CREDIT_POLICY) {
  const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
  const all = [], approved = [];
  for (const c of cases) {
    const fico = c?.presentation?.current_state?.credit_score;
    if (!Number.isFinite(fico)) continue;
    all.push(fico);
    if (assessCredit(c, policy).policyDecision === "APPROVE") approved.push(fico);
  }
  return { n: all.length, allMean: mean(all), approvedN: approved.length, approvedMean: mean(approved) };
}

// src/core/case.js — Case assembly: generateCase, generateBlendedCase, and helpers.

import { createRng } from "../utils/prng.js";
import { randomChoice, roundToInt } from "../utils/distributions.js";
import { generateLifeScript } from "./life.js";
import { corruptPresentation, tamperEvidence, corruptWorldTruth, applyTypologyEvidence } from "./corruption.js";
import { synthesizeEvidence } from "./evidence.js";
import { generateAlignmentFindings, generateGroundTruthFindings, computeDecision } from "./findings.js";
import { generateApplicationMetadata } from "./metadata.js";
import { deriveAuditAttributes } from "./audit_attributes.js";

export const GENERATOR_VERSION = "2.0.0";
export const CASE_SCHEMA_VERSION = "2.0.0";

const FIRST_NAMES = ["James", "Maria", "Robert", "Linda", "Michael", "Patricia", "David", "Jennifer", "John", "Elizabeth"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"];

function computeMortgagePayment(loanAmount, config) {
  const loanCfg = config.loan || { interest_rate: 0.07, term_years: 30, tax_insurance_rate: 0.012 };
  const r = loanCfg.interest_rate / 12;
  const n = loanCfg.term_years * 12;
  const pi = loanAmount * (r / (1 - Math.pow(1 + r, -n)));
  const taxInsurance = loanAmount * (loanCfg.tax_insurance_rate || 0) / 12;
  return roundToInt(pi + taxInsurance);
}

function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Resolve the simulation "as-of" date: config override, else today. */
export function resolveAsOfDate(config) {
  const cfg = config.generation?.as_of_date;
  return cfg ? new Date(cfg) : new Date();
}

// ─── CASE ASSEMBLY ──────────────────────────────────────────
export function generateCase(id, config, corruptionType = "NONE", severity = "LOW", seed, providedTruth) {
  const rng = createRng(seed);
  const asOf = resolveAsOfDate(config);
  const submitted = asOf.toISOString().split('T')[0];
  let truth = providedTruth || generateLifeScript(`gen-${id}`, config, rng);

  // A3 incoherent world: corrupt the underlying world truth, then honestly report it.
  if (corruptionType === "INCOHERENT") {
    truth = corruptWorldTruth(truth, rng);
  }

  const presentation = corruptPresentation(truth, corruptionType, severity, config, rng);
  let evidence = synthesizeEvidence(truth, rng, asOf);

  // FCGS layer-targeted mutation: tamper the evidence layer while leaving claim & truth intact.
  if (corruptionType === "EVIDENCE_TAMPERING") {
    evidence = tamperEvidence(truth, evidence, severity, rng, asOf);
  }
  evidence = applyTypologyEvidence(truth, presentation, evidence, corruptionType, severity, rng, asOf);

  const loanAmount = Math.floor(presentation.current_state.salary * 3.0);
  const monthlyMortgagePayment = computeMortgagePayment(loanAmount, config);
  for (const layer of [truth, presentation]) {
    layer.current_state.monthly_mortgage_payment = monthlyMortgagePayment;
    layer.current_state.loan_amount = loanAmount;
    const monthlyIncome = layer.current_state.salary / 12;
    const obligations = layer.current_state.monthly_obligations || 0;
    layer.current_state.backend_dti = monthlyIncome > 0 ? (obligations + monthlyMortgagePayment) / monthlyIncome : 0;
  }

  const applicationMetadata = generateApplicationMetadata(submitted, corruptionType, severity, rng, config.metadata?.fraud_signal_rate ?? 0.6);

  const findings = generateAlignmentFindings(truth, presentation, evidence, applicationMetadata);
  const groundTruthFindings = generateGroundTruthFindings(truth, presentation, evidence, corruptionType);
  const label = computeDecision(truth, presentation, evidence, findings, corruptionType, severity, rng, config);

  // Sensitive evaluation attributes: isolated from decision inputs, used only by fairness tests.
  const auditAttributes = deriveAuditAttributes(truth, config, rng);

  // Deterministic ids when seeded; wall-clock suffix only for unseeded generation.
  const caseId = rng.seeded
    ? `case-gen-${id}-${fnv1a(String(seed))}`
    : `case-gen-${id}-${Date.now()}`;

  return {
    id: caseId,
    schema_version: CASE_SCHEMA_VERSION,
    applicant: {
      name: `${randomChoice(FIRST_NAMES, rng)} ${randomChoice(LAST_NAMES, rng)}`,
      age: truth.demographics.age,
      ssn_last4: truth.demographics.ssn_last4,
      zip_code: truth.demographics.zip_code,
      region: truth.demographics.region
    },
    application: {
      loan_type: "MORTGAGE",
      loan_amount: loanAmount,
      purpose: randomChoice(["PURCHASE", "REFINANCE"], rng),
      submitted
    },
    application_metadata: applicationMetadata,
    audit_attributes: auditAttributes,
    truth,
    presentation,
    evidence,
    alignment_findings: findings,
    ground_truth_findings: groundTruthFindings,
    label: {
      ...label,
      conditions: label.conditions || []
    },
    meta: {
      seed: rng.seeded ? seed : null,
      generator_version: GENERATOR_VERSION,
      corruption_type: corruptionType,
      severity,
      as_of_date: submitted
    }
  };
}

export function generateBlendedCase(id, config, seed, adversarial = false) {
  const mixRng = createRng(seed !== undefined ? `${seed}-mix-${id}` : undefined);
  const caseSeed = seed !== undefined ? `${seed}-${id}` : undefined;
  const advCfg = config.adversarial;
  const useAdversarial = adversarial || advCfg?.enabled;

  if (useAdversarial) {
    const truthRng = createRng(seed !== undefined ? `${seed}-truth-${id}` : undefined);
    const truth = generateLifeScript(`gen-${id}`, config, truthRng);
    const dti = truth.current_state.dti;
    const credit = truth.current_state.credit_score;

    const weights = advCfg.weights || { inflation: 1, concealment: 1, fabrication: 1 };
    let inflationScore = 0, concealmentScore = 0, fabricationScore = 0;
    if (dti >= advCfg.inflation_dti_min && dti <= advCfg.inflation_dti_max) inflationScore = weights.inflation || 1;
    if (dti > advCfg.concealment_dti_threshold) concealmentScore = weights.concealment || 1;
    if (credit < advCfg.fabrication_credit_threshold) fabricationScore = weights.fabrication || 1;
    const total = inflationScore + concealmentScore + fabricationScore;

    let type = "NONE", sev = "LOW";
    if (total > 0 && mixRng.random() < advCfg.adversarial_rate) {
      const pick = mixRng.random() * total;
      if (pick < inflationScore) { type = "INFLATION"; sev = "MEDIUM"; }
      else if (pick < inflationScore + concealmentScore) { type = "CONCEALMENT"; sev = mixRng.random() > 0.5 ? "MEDIUM" : "HIGH"; }
      else { type = "FABRICATION"; sev = "HIGH"; }
    }
    return generateCase(id, config, type, sev, caseSeed, truth);
  }

  const mix = config.corruption?.blend || { clean: 0.85, concealment: 0.07, inflation: 0.05, fabrication: 0.03, bust_out: 0.01 };
  const r = mixRng.random();
  const order = [
    ["clean", "NONE", () => "LOW"],
    ["concealment", "CONCEALMENT", () => (mixRng.random() > 0.5 ? "MEDIUM" : "HIGH")],
    ["inflation", "INFLATION", () => "MEDIUM"],
    ["fabrication", "FABRICATION", () => "HIGH"],
    ["bust_out", "BUST_OUT", () => "HIGH"],
    ["evidence_tampering", "EVIDENCE_TAMPERING", () => (mixRng.random() > 0.5 ? "MEDIUM" : "HIGH")],
    ["occupancy_misrepresentation", "OCCUPANCY_MISREPRESENTATION", () => "MEDIUM"],
    ["gift_fund_misrepresentation", "GIFT_FUND_MISREPRESENTATION", () => "MEDIUM"],
    ["asset_seasoning", "ASSET_SEASONING", () => "MEDIUM"],
    ["straw_buyer", "STRAW_BUYER", () => "HIGH"],
    ["incoherent", "INCOHERENT", () => "HIGH"]
  ];
  let cumulative = 0;
  let type = "NONE", sev = "LOW";
  for (const [key, ctype, sevFn] of order) {
    const w = mix[key] || 0;
    if (w <= 0) continue;
    cumulative += w;
    if (r < cumulative) { type = ctype; sev = sevFn(); break; }
  }
  return generateCase(id, config, type, sev, caseSeed);
}

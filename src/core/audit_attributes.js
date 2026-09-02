// src/core/audit_attributes.js — Sensitive evaluation attributes.
//
// These attributes are attached to every generated case under `audit_attributes` so that
// fairness tests can slice outcomes by subgroup and run counterfactual pairs. They are
// classified SENSITIVE by the feature policy and are never read by the decision engine,
// the rule checker or the ML feature extractor. Several are synthetic *scenario* labels
// (family status, disability-related income) that exist purely so a reviewer can verify
// that changing them leaves the decision untouched.

import { randomCategorical } from "../utils/distributions.js";

export const AGE_BANDS = Object.freeze(["22-29", "30-39", "40-49", "50-59", "60+"]);
export const INCOME_BANDS = Object.freeze(["<50K", "50K-80K", "80K-120K", "120K-180K", "180K+"]);
export const FAMILY_STATUS_SCENARIOS = Object.freeze(["SINGLE", "MARRIED", "WITH_DEPENDENTS", "SINGLE_PARENT"]);

export function ageBand(age) {
  if (age < 30) return "22-29";
  if (age < 40) return "30-39";
  if (age < 50) return "40-49";
  if (age < 60) return "50-59";
  return "60+";
}

export function incomeBand(salary) {
  if (salary < 50000) return "<50K";
  if (salary < 80000) return "50K-80K";
  if (salary < 120000) return "80K-120K";
  if (salary < 180000) return "120K-180K";
  return "180K+";
}

export function deriveAuditAttributes(truth, config, rng = { random: () => Math.random() }) {
  const t = truth.current_state;
  const d = truth.demographics;
  const fairnessCfg = config.fairness?.scenario_attributes || {};
  const familyProbs = fairnessCfg.family_status_probabilities || [0.35, 0.35, 0.22, 0.08];
  const disabilityRate = fairnessCfg.disability_income_scenario_rate ?? 0.04;

  return {
    // Derived from generated financial life (not independently sampled)
    age_band: ageBand(d.age),
    geography_group: d.region,
    zip3: String(d.zip_code).slice(0, 3),
    income_band: incomeBand(t.salary),
    persona: t.persona,
    regime: t.regime,
    // Synthetic scenario attributes — sampled independently of financial variables by construction,
    // so any association between them and decisions is a defect by definition.
    family_status_scenario: randomCategorical(FAMILY_STATUS_SCENARIOS, familyProbs, rng),
    disability_income_scenario: rng.random() < disabilityRate ? 1 : 0,
    // Governance marker
    policy_class: "SENSITIVE",
    note: "Never used by rules or models. Available only to fairness testing."
  };
}

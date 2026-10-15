// src/loanSizing.js — Per-case loan amount under a profile's loan-amount distribution.
//
// Shared by the dealer simulation (exposure) and the credit policy (the solar DTI's proposed
// payment), so both use the same amount for the same case.

import { createRng } from "./utils/prng.js";
import { inverseNormalCDF } from "./utils/distributions.js";

/** Uniform draw in [0, 1) seeded by a string. */
export function unitHash(str) {
  return createRng(str).random();
}

/**
 * Loan amount for a case: the generated application amount, or, when `sizing` gives a loan-amount
 * distribution, a clipped lognormal draw seeded from the case ID (rounded to $100).
 */
export function loanAmount(caseObj, sizing = null) {
  if (!sizing) return caseObj.application?.loan_amount ?? 0;
  const u = Math.min(1 - 1e-12, Math.max(1e-12, unitHash(`loan-amount-${caseObj.id}`)));
  const raw = sizing.median.value * Math.exp(sizing.sigma.value * inverseNormalCDF(u));
  return Math.round(Math.min(sizing.max.value, Math.max(sizing.min.value, raw)) / 100) * 100;
}

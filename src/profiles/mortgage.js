// src/profiles/mortgage.js — Default lender profile: the generator's mortgage book, uncalibrated.

export const MORTGAGE_PROFILE = Object.freeze({
  id: "MORTGAGE",
  label: "Mortgage (default)",
  description: "The generator's default mortgage application stream. No calibration preset and no public benchmark.",
  // No overrides: generation uses src/distribution_config.json as is.
  preset: null,
  benchmarks: [],
  // No defaults are defined for the Dealer View or Funding & Rates tabs; a tab reading a null
  // default should say it is not configured for this profile rather than invent inputs.
  defaults: { dealerView: null, fundingRates: null },
  caseStudies: []
});

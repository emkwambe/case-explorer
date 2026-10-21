// src/profiles/mortgage.js — Default lender profile: the generator's mortgage book, uncalibrated.

export const MORTGAGE_PROFILE = Object.freeze({
  id: "MORTGAGE",
  label: "Mortgage (default)",
  description: "The generator's default mortgage application stream. No calibration preset and no public benchmark.",
  subtitle: "Mortgage risk simulation, fraud analytics and model validation",
  // Purchase or refinance mortgage: back-end DTI adds the proposed PITI (see caseDti in creditRisk.js).
  dti: Object.freeze({ basis: "PROPOSED_PITI", label: "Back-end DTI (incl. proposed PITI)" }),
  // Header counts use the generator's reference label (an answer key computed from hidden truth).
  headerLens: "integrity",
  // The opening library is the fraud-typology showcase used by the guided walkthrough.
  openingLibrary: { kind: "showcase" },
  // No overrides: generation uses src/distribution_config.json as is.
  preset: null,
  benchmarks: [],
  // No defaults are defined for the Dealer View or Funding & Rates tabs; a tab reading a null
  // default should say it is not configured for this profile rather than invent inputs.
  defaults: { dealerView: null, fundingRates: null },
  caseStudies: [],
  // No Policy Sandbox yet: the tab is shown only for profiles that turn it on.
  policySandbox: false
});

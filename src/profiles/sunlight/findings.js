// src/profiles/sunlight/findings.js — Copy for the Findings tab under the Solar prime profile: the
// research question, data, method, three findings and limits. Text only: every figure on the page
// is computed by the module that owns it and passed in, so nothing here is a typed-in number.
// Statements of fact follow the cited sources in caseStudies.js and data/public-record/events.json;
// interpretation is labelled as analysis.

export const SUNLIGHT_FINDINGS = Object.freeze({
  title: "Research brief: Sunlight Financial, 2021–2023",
  // The question quotes the profile's public FICO benchmark (benchmarks[].id).
  benchmarkId: "avg_fico_financed",
  question: (fico) => `Why did a lender whose borrowers averaged a ${fico} FICO end up in Chapter 11?`,
  questionNote: "The FICO figure is the average for all solar borrowers financed through the platform as of December 31, 2022, from the FY2022 Form 10-K. A prime borrower base points away from credit losses as the main cause; the findings test three other channels.",

  data: (f) => [
    `SEC XBRL company facts for Sunlight Financial Holdings Inc. (CIK 1821850), from ${f.xbrlFilings} filings, deduplicated to ${f.quarters} quarters (${f.firstQuarter} to ${f.lastQuarter}).`,
    "FRED daily series DFF (effective federal funds rate) and DGS10 (10-year Treasury yield), averaged by quarter.",
    `${f.manualRows} manual extractions (funded loans and platform fees) typed from ${f.manualDocuments} 10-Q and 10-K filings, each with its page reference and quoted label.`,
    `${f.gaps} gaps, each listed, none filled with an estimate.`
  ],

  method: (f) => [
    "Deduplication: facts are keyed by (concept, period start, period end, form, fiscal period), keeping the latest-filed value, then by (concept, period start, period end) across filings, again keeping the latest filed.",
    "Q4 derivation: a quarter not filed as such is the year-to-date figure minus the previous year-to-date figure (Q4 = full year minus nine months), marked derived and citing both filings; nothing crosses the July 2021 Predecessor/Successor break.",
    `Reconciliation: ${f.reconciliationMatches} of ${f.reconciliationChecks} checks of summed quarters against the filed year-to-date figure match.`,
    "Pricing model: a level-payment, monthly-amortising loan priced at the investor yield with constant prepayment (CPR); the platform fee is the dealer fee less the discount at sale, and the break-even shock is found by bisection.",
    `Dealer ratings: a one-sided binomial test of each synthetic dealer's 30+ DPD count against the portfolio rate; RED below p ${f.rating.redAlpha} after Bonferroni across rated dealers, YELLOW below p ${f.rating.yellowAlpha}, and no rating below ${f.rating.minLoans} loans.`,
    "Policy testing: the synthetic book is the funded book only (credit-policy approvals), and the approved-only average FICO is compared with the public benchmark in Credit Risk Mode."
  ],

  findings: [
    {
      id: "pricing-lag",
      title: "Pricing lag: the take rate fell as rates rose",
      claim: "Loans were priced at credit approval and sold later, and there was no interest-rate hedging program for the Bank Partner agreements (FY2022 Form 10-K). As the fed funds rate rose through 2022, the take rate fell and then turned negative.",
      analysis: "A long, low-coupon, fixed-rate loan priced at approval loses value quickly when rates rise before sale; at the model's default inputs the fee at sale reaches zero at the break-even shock shown, a move the fed funds rate exceeded during 2022.",
      evidenceTabs: ["public_record", "funding"]
    },
    {
      id: "concentration",
      title: "Concentration risk sat in a dealer the credit test rates green",
      claim: "On September 28, 2022, the company said one of its largest installers was winding down and that it expected to impair $30–33 million of advances to that installer.",
      analysis: "In the synthetic book, the dealer holding the largest advance (sized to that disclosure) passes the delinquency test, while the dealers the test flags RED are smaller books. A delinquency rating does not measure advance exposure, so the failure scenario, not the rating, shows the loss.",
      evidenceTabs: ["dealers"]
    },
    {
      id: "runway",
      title: "Burn-based runway misled",
      claim: "At December 31, 2022 the company missed the EBITDA requirement of its SVB revolving facility, and the Bank Partner's funded but unsold loans exceeded the loan cap. Chapter 11 petitions were filed on October 30, 2023.",
      analysis: "Runway computed as cash over trailing operating burn looked long at the end of 2022 and shows no burn in the quarters after it. It ignores covenants, the loan cap and fees that turn negative on unsold loans, which were the binding constraints.",
      chapter11EventId: "chapter-11",
      evidenceTabs: ["public_record"]
    }
  ],

  limits: [
    "Public data only: no loan-level tape, vintage curves or dealer-level data are public.",
    "Loans and dealers are synthetic; dealer metrics are simulated under a set dealer-effect strength, and dealer IDs are fictional.",
    "The correlation of take rate with fed funds is descriptive, not causal.",
    "Nothing after June 30, 2023: there are no later periodic filings."
  ]
});

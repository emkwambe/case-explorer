// src/profiles/sunlight/caseStudies.js — Sourced case-study facts about Sunlight Financial.
// Sourced facts only. Wording follows the cited source; dates are the event date (or, for
// 10-K statements, the fiscal year-end they describe). Each fact was checked against its source.

import { SUNLIGHT_10K_FY2022, SUNLIGHT_PR_2022_09_28, AG_LETTER_2022_11_22, SUNLIGHT_8K_CHAPTER_11, SUNLIGHT_EMERGENCE_PR, PV_MAGAZINE_2023_10_31 } from "./sources.js";

export const SUNLIGHT_CASE_STUDIES = Object.freeze([
  {
    id: "installer_risk",
    panel: "dealerView",
    title: "Case study: Sunlight Financial and installer risk",
    // Shown in the Dealer View when another profile is active.
    hint: "Switch to Solar prime to see the sourced Sunlight case study",
    facts: [
      { date: "2022-09-28", text: "Sunlight said one of its largest installers was winding down its operations and expected to impair $30–33 million of advances to that installer; its next three largest partner advances were $10 million, $7 million and $5 million.", source: SUNLIGHT_PR_2022_09_28 },
      { date: "2022-11-22", text: "Nine state attorneys general wrote to five solar lenders, including Sunlight Financial and Cross River Bank, about Pink Energy customers, asking them to suspend loan payments and interest for consumers whose systems were never installed or do not work properly, until an investigation can be completed.", source: AG_LETTER_2022_11_22 }
    ]
  },
  {
    id: "funding_history",
    panel: "fundingRates",
    title: "Sunlight history (sourced)",
    hint: "Switch to Solar prime to see the sourced Sunlight history",
    sources: [SUNLIGHT_10K_FY2022, SUNLIGHT_8K_CHAPTER_11, SUNLIGHT_EMERGENCE_PR, PV_MAGAZINE_2023_10_31],
    facts: [
      { date: "2022-12-31", text: "Sunlight earned platform fees, generally the margin between the contractor fee and the discount at which its capital provider funds or purchases a loan, and did not earn material revenue from loans held on its balance sheet.", source: SUNLIGHT_10K_FY2022 },
      { date: "2022-12-31", text: "In the indirect channel, loans were funded by Cross River Bank (the Bank Partner), then pooled and sold; prices were set at the credit approval event, and Sunlight had no interest rate risk hedging program for these agreements.", source: SUNLIGHT_10K_FY2022 },
      { date: "2022-12-31", text: "Sunlight recognized $22.7 million in negative platform fees in the three months ended December 31, 2022.", source: SUNLIGHT_10K_FY2022 },
      { date: "2022-12-31", text: "Sunlight said it may incur $45–55 million of negative platform fees, subject to significant uncertainty, on funded but unsold loans held by the Bank Partner at March 31, 2023.", source: SUNLIGHT_10K_FY2022 },
      { date: "2022-12-31", text: "Sunlight did not meet the EBITDA requirement of its $30.0 million SVB revolving facility, on which it had borrowed about $20.6 million; the facility's covenants also set minimum liquidity levels.", source: SUNLIGHT_10K_FY2022 },
      { date: "2022-12-31", text: "The Bank Partner's funded but unsold loans exceeded the loan cap in the Bank Partner agreements, so Sunlight was in default under them.", source: SUNLIGHT_10K_FY2022 },
      { date: "2023-04-25", text: "Sunlight entered amended Bank Partner agreements and a new secured term loan, in connection with which the SVB facility was repaid and terminated.", source: SUNLIGHT_10K_FY2022 },
      { date: "2023-10-30", text: "Sunlight filed Chapter 11 petitions in the United States Bankruptcy Court for the District of Delaware.", source: SUNLIGHT_8K_CHAPTER_11 },
      { date: "2023-12-07", text: "Sunlight completed its Chapter 11 restructuring; a consortium including affiliates of Greenbacker Capital Management, Sunstone Credit and IGS Ventures, together with Cross River Bank, owns 100% of the company.", source: SUNLIGHT_EMERGENCE_PR }
    ]
  }
]);

// src/profiles/sunlight/filingQuotes.js — Verbatim passages from Sunlight Financial's FY2022 Form
// 10-K for the Funding & Rates rate-path panel: how long the bank partner could hold a loan before
// sale, and the absence of interest rate hedging. Quoted word for word, never shortened: the 2022
// sale-timing wording carries an exception clause and is not a flat 180-day limit. Page numbers are
// the printed page footers of the filing; scripts/public-record.test.mjs checks each quote against
// the hashed filing when it is present locally.

import { SUNLIGHT_10K_FY2022 } from "./sources.js";

export const SUNLIGHT_RATE_PATH_QUOTES = Object.freeze({
  title: "In the filing’s words",
  quotes: Object.freeze([
    {
      id: "sale_timing",
      topic: "Bank partner sale timing",
      text: "The terms of Sunlight’s Bank Partner Agreements during 2022 provided that such sales must occur within a certain period of time, subject to certain exceptions (180 days from origination for solar system loans and home improvement loans that have been on its Bank Partner’s balance sheet for greater than 12 months). The amended terms of Sunlight’s Bank Partner Agreements provide that such sales must occur within a certain period of time, subject to certain exceptions (initially 360 days from origination, reducing to 210 days from origination on the 181st day after the Amended Bank Partner Agreements became effective).",
      citation: "Item 1A (Risk Factors), p. 12, under the risk factor beginning “During the year ended December 31, 2022, Sunlight funded approximately 26.8% of its total solar system loan volume”",
      source: SUNLIGHT_10K_FY2022
    },
    {
      id: "no_hedging",
      topic: "No interest rate hedging",
      text: "We do not currently have an interest rate risk hedging program or seek to hedge interest rate risks associated with our Bank Partner Agreements. Accordingly, when interest rates rose rapidly during 2022 it caused us to incur significant losses associated with the sale of Indirect Channel Loans because of the interest rate gap between the time the underlying Indirect Channel loan were processed at a lower rate to a later time when Sunlight was able to monetize the Indirect Channel loan after the interest rates have increased.",
      citation: "Item 1A (Risk Factors), p. 10, under the risk factor “We do not currently have an interest rate hedging program or seek to hedge interest rate risks associated with our Bank Partner Agreements, and therefore are not protected against significant increases in interest rates.”",
      source: SUNLIGHT_10K_FY2022
    }
  ])
});

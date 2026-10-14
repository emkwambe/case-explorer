// src/profiles/sunlight/publicRecordNotes.js — Text about the public-record snapshot, shared by the
// Public record tab and the README generator (scripts/public-record/provenance-md.mjs).

export const PUBLIC_RECORD_NOTES = Object.freeze({
  company: "Sunlight Financial Holdings Inc. (CIK 1821850)",
  chapter11: { date: "2023-10-30", label: "the October 30, 2023 Chapter 11 filing" },

  // Figures that come from each source.
  origins: {
    xbrl: "Balance sheet (cash, total assets, total liabilities, equity, retained earnings, line of credit), revenue, net income, operating income and operating cash flow, from SEC XBRL company facts.",
    manual: "Funded loans (MD&A key performance measures) and platform fees, net (revenue disaggregation in the notes), typed by hand from the 10-Q and 10-K filings with page references.",
    fred: "Effective federal funds rate (DFF) and 10-year Treasury constant-maturity yield (DGS10), daily, from FRED."
  },

  // Visible breaks in a series.
  breaks: [
    {
      metric: "platform_fees",
      quarter: "2023Q2",
      note: "From the Q2 2023 10-Q, \"Platform fees, net\" is a heading over two rows, \"Platform fees\" and \"Platform fees from affiliate\", with an unlabelled subtotal. The subtotal is used. Earlier filings print one \"Platform fees, net\" line whose footnote says it includes affiliate fees, and the same 10-Q's subtotal for Q2 2022 ($27,873k) equals the Q2 2022 10-Q's single line, so the subtotal is the comparable figure. The presentation changes here."
    }
  ],

  // The 2021 business combination.
  basisNote: "Sunlight became the public registrant on July 9, 2021, when it combined with Spartan Acquisition Corp. II. Figures for periods before July 10, 2021 are the Predecessor's (Sunlight Financial LLC) and come from comparative columns in later filings; the third quarter of 2021 is shown as two stubs (Predecessor July 1–9, Successor July 10–September 30) and never combined. The SPAC's own pre-merger filings are excluded.",

  // Figures deliberately not in the dataset.
  declaredGaps: [
    { metric: "contractor_advances", quarter: "all", detail: "Not extracted: no balance labelled as contractor advances was identified in the filings; left as a gap." },
    { metric: "adjusted_ebitda", quarter: "all", detail: "Optional; not extracted from the filings." }
  ],

  cannotSupport: [
    "Loan-level performance (defaults, delinquency, prepayment by loan)",
    "Vintage curves",
    "Dealer-level data",
    "Anything after June 30, 2023 (no later periodic filings)"
  ]
});

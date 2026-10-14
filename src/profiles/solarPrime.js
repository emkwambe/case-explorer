// src/profiles/solarPrime.js — Prime solar point-of-sale profile, anchored to Sunlight Financial's
// public filings. Every real-company fact and source lives in this file, not in components.

const SUNLIGHT_10K_FY2022 = Object.freeze({
  label: "Sunlight Financial FY2022 Form 10-K",
  url: "https://www.sec.gov/Archives/edgar/data/1821850/000182185023000025/sunl-20221231.htm"
});
const SUNLIGHT_PR_2022_09_28 = Object.freeze({
  label: "Sunlight Financial press release, September 28, 2022",
  url: "https://www.stocktitan.net/news/SUNL/sunlight-financial-announces-impact-to-full-year-2022-etzvsxyoia9a.html"
});
const AG_LETTER_2022_11_22 = Object.freeze({
  label: "State attorneys general letter to solar lenders, November 22, 2022",
  url: "https://ncdoj.gov/wp-content/uploads/2022/11/Attorney-General-Letter-To-Solar-Lenders.pdf"
});
const SUNLIGHT_8K_CHAPTER_11 = Object.freeze({
  label: "Sunlight Financial Form 8-K (Chapter 11)",
  url: "https://www.sec.gov/Archives/edgar/data/1821850/000110465923112707/tm2329469d1_8k.htm"
});
const SUNLIGHT_EMERGENCE_PR = Object.freeze({
  label: "Sunlight Financial emergence press release, December 7, 2023",
  url: "https://www.sec.gov/Archives/edgar/data/0001821850/000110465923124299/tm2332394d1_ex99-1.htm"
});
// Listed as further reading only. It describes Cross River Bank as part of the consortium, which
// the emergence press release does not, so no fact below is sourced to it.
const PV_MAGAZINE_2023_10_31 = Object.freeze({
  label: "pv magazine USA, October 31, 2023",
  url: "https://pv-magazine-usa.com/2023/10/31/sunlight-financial-files-bankruptcy-acquired-by-industry-consortium/"
});

export const SOLAR_PRIME_PROFILE = Object.freeze({
  id: "SOLAR_PRIME",
  label: "Solar prime (calibrated)",
  description: "Prime solar application stream. The approved-under-credit-policy population is calibrated to Sunlight Financial's reported average FICO of financed borrowers; every other distribution keeps the generator default and is uncalibrated.",

  // Calibration preset, deep-merged over src/distribution_config.json. The regime mix is mostly
  // PRIME, the SUBPRIME 680 cap is lifted and the PRIME 640 floor is neutralised so no score value
  // piles up at a clamp. There is no generator floor: the credit policy (FICO below 660 declines)
  // is the floor. The credit base mean/SD are the only parameters tuned to the benchmark.
  preset: Object.freeze({
    overrides: {
      regimes: {
        probabilities: [0.85, 0.05, 0.10],
        params: {
          PRIME: { credit_score_floor: 300 },
          SUBPRIME: { credit_score_cap: 850 }
        }
      },
      credit: {
        score_base: { mean: 755, stddev: 30, min: 300 }
      }
    }
  }),

  benchmarks: Object.freeze([
    {
      id: "avg_fico_financed",
      metric: "avg_fico",
      value: 748,
      // The figure describes financed borrowers, so the like-for-like synthetic population is the
      // set of applications the credit policy approves.
      compareTo: "approved",
      population: "Average FICO of all solar borrowers financed through Sunlight Financial's platform as of December 31, 2022",
      source: SUNLIGHT_10K_FY2022,
      note: "This is a single public benchmark. No loan-level Sunlight tape is public, so every other distribution in the solar profile remains uncalibrated."
    }
  ]),

  // Default inputs for the Dealer View and Funding & Rates tabs. Each value is an assumption
  // unless `status` says it is disclosed.
  defaults: Object.freeze({
    dealerView: {
      portfolio: { count: 10000, seed: 42 },
      // Solar loan amounts for exposure and expected loss, so loan losses and contractor advance
      // write-offs share a scale. The range is disclosed; the median is an assumption chosen so the
      // simulated mean (about $46,000) matches the disclosed FY2022 average solar loan balance.
      loanAmount: {
        distribution: "lognormal, clipped",
        min: { value: 10_000, status: "disclosed", source: SUNLIGHT_10K_FY2022 },
        max: { value: 150_000, status: "disclosed", source: SUNLIGHT_10K_FY2022 },
        median: { value: 40_700, status: "assumption", note: "Chosen so the clipped mean matches the disclosed FY2022 average solar loan balance of $46,000." },
        sigma: { value: 0.5, status: "assumption" },
        calibrationTarget: {
          metric: "mean loan amount",
          value: 46_000,
          status: "disclosed",
          source: SUNLIGHT_10K_FY2022,
          citation: "Item 7 (MD&A), \"Loan Characteristics\" table, p. 48: average characteristics of loans Sunlight facilitated for the year ended December 31, 2022 (USD in thousands); Solar, Loan Balance $46."
        }
      },
      exposureNote: "Simulated 10,000-loan sample; advance-to-loan ratios are not comparable to Sunlight's actual book.",
      network: {
        // The four largest contractor advances follow the disclosed amounts; which synthetic
        // dealers hold them, and every other advance, stay simulated.
        topAdvances: {
          values: [30_000_000, 10_000_000, 7_000_000, 5_000_000],
          status: "disclosed",
          note: "Largest installer: $30–33 million of advances expected to be impaired (low end used); next three largest partner advances: $10 million, $7 million and $5 million.",
          source: SUNLIGHT_PR_2022_09_28
        }
      },
      dealerFailure: {
        nonWorkingShare: { value: 0.30, status: "assumption" },
        baseRecovery: { value: 0.15, status: "assumption" }
      }
    },
    fundingRates: {
      coupon: { value: 0.0299, range: [0.0199, 0.0999], status: "disclosed range", source: SUNLIGHT_10K_FY2022 },
      termYears: { value: 25, range: [5, 25], status: "disclosed range", source: SUNLIGHT_10K_FY2022 },
      investorYieldAtApproval: { value: 0.05, status: "assumption" },
      dealerFeePct: { value: 20, status: "assumption" },
      cpr: { value: 0.05, status: "assumption" },
      rateShockBps: { value: 0, range: [0, 400], status: "slider" },
      unsoldBalance: { value: 500_000_000, status: "assumption" },
      cash: {
        value: 60_000_000, status: "assumption",
        note: "Sunlight reported about $64 million of cash and cash equivalents as of September 23, 2022.",
        source: SUNLIGHT_PR_2022_09_28
      },
      monthlyOpex: { value: 6_000_000, status: "assumption" },
      minLiquidity: { value: 20_000_000, status: "assumption" },
      loanCap: { value: 600_000_000, status: "assumption" },
      baseRecovery: { value: 0.15, status: "assumption" },
      // Not in the sprint table; the liquidity path needs them, so they are labelled assumptions.
      lossRecognitionMonths: { value: 6, status: "assumption" },
      monthlyNewFees: { value: 4_000_000, status: "assumption" },
      loanSize: {
        value: 46_000,
        status: "disclosed",
        source: SUNLIGHT_10K_FY2022,
        citation: "Item 7 (MD&A), \"Loan Characteristics\" table, p. 48: average solar loan balance of loans facilitated in the year ended December 31, 2022, $46 thousand."
      }
    }
  }),

  // Sourced facts only. Wording follows the cited source; dates are the event date (or, for
  // 10-K statements, the fiscal year-end they describe). Each fact was checked against its source.
  caseStudies: Object.freeze([
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
  ])
});

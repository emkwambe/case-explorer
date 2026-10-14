// src/profiles/solarPrime.js — Prime solar point-of-sale profile, anchored to Sunlight Financial's
// public filings. Real-company sources and facts live in src/profiles/sunlight/, never in components.

import { SUNLIGHT_10K_FY2022, SUNLIGHT_PR_2022_09_28 } from "./sunlight/sources.js";
import { SUNLIGHT_CASE_STUDIES } from "./sunlight/caseStudies.js";

export const SOLAR_PRIME_PROFILE = Object.freeze({
  id: "SOLAR_PRIME",
  label: "Solar prime (calibrated)",
  subtitle: "Prime solar lending: credit policy, dealer channel, funding stress and public record",
  // Header counts use the credit policy.
  headerLens: "credit",
  // The opening library is the first applications of the profile's own seeded stream, so it shows
  // the profile's natural mix rather than a fraud showcase.
  openingLibrary: { kind: "blended", count: 12 },
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

  caseStudies: SUNLIGHT_CASE_STUDIES,

  // Pinned public-record snapshot (SEC XBRL, FRED, hand extractions) for the Public record tab.
  // Loaded on demand so the main bundle and the Node test scripts never import the JSON.
  publicRecord: Object.freeze({
    load: () => import("./sunlight/publicRecordData.js").then((m) => m.PUBLIC_RECORD)
  })
});

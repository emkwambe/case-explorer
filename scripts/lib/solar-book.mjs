// scripts/lib/solar-book.mjs — The SOLAR_PRIME seed-42 funded book and application pool, built the
// way the Dealer View and Policy Sandbox build them (one pass in seed order: a pool record for every
// application, loan inputs for every credit-policy APPROVE, until the book holds 10,000 loans).
//
// Read-only reuse of the engine: nothing here changes a draw. Every random stream in the generator
// and the dealer simulation is keyed by case or dealer id, so building, re-reading or exporting the
// book consumes no shared randomness.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBlendedCase } from "../../src/generator.js";
import { applyProfile, getProfile } from "../../src/profiles/index.js";
import { CREDIT_POLICY } from "../../src/creditRisk.js";
import { buildDealerNetwork, dealerSettings, isFundedLoan, loanInputs, simulateLoans, aggregateDealers } from "../../src/dealers.js";
import { expectedLoss } from "../../src/fundingStress.js";
import { poolRecord, decide } from "../../src/policySandbox.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONFIG_PATH = path.join(ROOT, "src", "distribution_config.json");
export const AS_OF = "2026-01-15";

/** The demo configuration: distribution_config.json at the demo as-of date, as the UI's demoConfig. */
export function demoConfig() {
  const base = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  return { ...base, generation: { ...base.generation, as_of_date: AS_OF } };
}

/**
 * Build the book. `onCase(caseObj, record)` sees every generated application once, in seed order,
 * so callers can check per-case properties without keeping 18,674 full cases in memory.
 */
export function buildSolarBook({ onCase } = {}) {
  const solar = getProfile("SOLAR_PRIME");
  const settings = dealerSettings(solar.defaults.dealerView);
  const dealers = buildDealerNetwork(settings.network);
  const { count, seed } = settings.portfolio;
  const config = applyProfile(demoConfig(), solar);
  const lgd = 1 - settings.dealerFailure.baseRecovery.value;

  const inputs = [], pool = [], corruption = new Map();
  for (let i = 0; inputs.length < count; i++) {
    const c = generateBlendedCase(i, config, seed);
    const record = poolRecord(c, solar, settings.loanAmount);
    if (isFundedLoan(c, solar)) {
      inputs.push(loanInputs(c, settings.loanAmount, solar));
      corruption.set(c.id, c.meta.corruption_type);
    }
    pool.push(record);
    onCase?.(c, record);
  }
  const loans = simulateLoans(inputs, dealers, settings);
  const rows = aggregateDealers(loans, dealers, settings);
  return { solar, settings, dealers, seed, lgd, inputs, pool, corruption, loans, rows };
}

/** Totals the tape reconciles to. Pure function of the built book; also the second lock. */
export function reconciliation(book) {
  const { loans, rows, pool, lgd, seed } = book;
  const sum = (xs) => xs.reduce((s, v) => s + v, 0);
  const dpd30 = loans.filter((l) => l.dpd30).length;
  const mix = { APPROVE: 0, REVIEW: 0, DECLINE: 0 };
  for (const a of pool) mix[decide(a, CREDIT_POLICY)]++;
  const share = (n) => Number((n / pool.length).toFixed(6));
  return {
    profile: "SOLAR_PRIME",
    seed,
    loans: {
      count: loans.length,
      sum_ead: sum(loans.map((l) => l.ead)),
      expected_loss: Math.round(expectedLoss(loans, { lgd })),
      lgd,
      dpd30_count: dpd30,
      dpd30_rate: Number((dpd30 / loans.length).toFixed(6)),
      charged_off_count: loans.filter((l) => l.chargedOff).length
    },
    dealers: rows.filter((r) => r.loans > 0).map((r) => ({ dealer_id: r.dealerId, loans: r.loans, sum_ead: r.exposure, dpd30_count: r.dpd30Count, rating: r.rating })),
    pool: {
      applications: pool.length,
      funded: mix.APPROVE,
      funded_share: share(mix.APPROVE),
      policy_mix: { APPROVE: mix.APPROVE, REVIEW: mix.REVIEW, DECLINE: mix.DECLINE },
      policy_mix_share: { APPROVE: share(mix.APPROVE), REVIEW: share(mix.REVIEW), DECLINE: share(mix.DECLINE) },
      note: "Pool mix: credit-policy decisions over the 18,674 applications generated to fund the 10,000-loan book. It is not the 54.6 / 24.7 / 20.7 mix, which comes from the separate 2,000-application test:credit sample."
    }
  };
}

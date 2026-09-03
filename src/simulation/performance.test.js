// The performance simulation produces the observed outcome label. It replaces a label the
// generator's own rule engine produced, so these tests check the two things that make the
// replacement worth anything: it is independent of the policy, and it carries real signal.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateCase, generateBlendedCase } from "../generator.js";
import { simulateLoanPerformance, PERFORMANCE_STATUS, DEFAULT_PERFORMANCE_CONFIG } from "./performance.js";
import { createRng } from "../utils/prng.js";
import { generateLifeScript } from "../core/life.js";
import { enforceFeaturePolicy, classifyFeature, FEATURE_CLASSES } from "../decisioning/policies/feature_policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "distribution_config.json"), "utf8"));
CONFIG.generation = { as_of_date: "2026-01-15" };

const sample = (type, sev, n, seedTag = "p") =>
  Array.from({ length: n }, (_, i) => generateCase(i, CONFIG, type, sev, `${seedTag}-${type}-${i}`));
const defaultRate = (cases) => cases.filter((c) => c.performance.defaulted).length / cases.length;

// One blended population, shared by the signal tests. Generating it per test is slow enough
// under coverage instrumentation to trip the default timeout.
let blended;
const blendedPopulation = () => (blended ??= Array.from({ length: 3000 }, (_, i) => generateBlendedCase(i, CONFIG, "signal")));

describe("performance simulation", () => {
  it("attaches a well-formed outcome to every case", () => {
    for (const c of sample("NONE", "LOW", 30)) {
      const p = c.performance;
      expect(PERFORMANCE_STATUS).toContain(p.status);
      expect(p.defaulted).toBe(p.status === "DEFAULT" ? 1 : 0);
      expect(p.seriously_delinquent).toBe(p.status === "PERFORMING" ? 0 : 1);
      expect(p.horizon_months).toBe(CONFIG.performance.horizon_months);
      expect(p.months_paid).toBeLessThanOrEqual(p.horizon_months);
      expect(p.loss_given_default).toBeGreaterThanOrEqual(0);
      expect(p.loss_given_default).toBeLessThanOrEqual(1);
      if (p.status === "DEFAULT") {
        expect(p.months_to_default).toBeGreaterThan(0);
        expect(p.realized_loss).toBeGreaterThan(0);
      } else {
        expect(p.months_to_default).toBeNull();
        expect(p.realized_loss).toBe(0);
      }
    }
  });

  it("is deterministic for a given seed", () => {
    const a = sample("INFLATION", "HIGH", 15, "det");
    const b = sample("INFLATION", "HIGH", 15, "det");
    expect(JSON.stringify(a.map((c) => c.performance))).toBe(JSON.stringify(b.map((c) => c.performance)));
  });

  it("draws from a stream of its own, so it does not perturb any other generated value", () => {
    // Same seed, different performance parameters. Everything outside `performance` must be identical.
    const alt = { ...CONFIG, performance: { ...CONFIG.performance, horizon_months: 12, job_loss: { ...CONFIG.performance.job_loss, base_monthly_prob: 0.5 } } };
    const base = generateCase(3, CONFIG, "CONCEALMENT", "HIGH", "stream-1");
    const other = generateCase(3, alt, "CONCEALMENT", "HIGH", "stream-1");
    const strip = (c) => { const { performance: _p, ...rest } = c; return JSON.stringify(rest); };
    expect(strip(other)).toBe(strip(base));
    expect(other.performance.horizon_months).toBe(12);
  });

  it("reads world truth and the typology only, never a policy, label or finding", () => {
    const rng = createRng("iso");
    const truth = generateLifeScript("iso", CONFIG, rng);
    truth.current_state.loan_amount = 300000;
    truth.current_state.monthly_mortgage_payment = 2000;
    // The signature admits nothing else; calling it with only truth must work.
    const p = simulateLoanPerformance(truth, "NONE", CONFIG, createRng("iso-perf"));
    expect(PERFORMANCE_STATUS).toContain(p.status);
    expect(simulateLoanPerformance.length).toBeLessThanOrEqual(4);
  });

  it("is barred from decision inputs by the feature policy", () => {
    for (const f of ["defaulted", "realized_loss", "months_to_default", "first_payment_default", "loss_given_default", "performance_status"]) {
      expect(classifyFeature(f), `${f} must be prohibited`).toBe(FEATURE_CLASSES.PROHIBITED);
    }
    expect(classifyFeature("performance_anything_at_all")).toBe(FEATURE_CLASSES.PROHIBITED);
    expect(() => enforceFeaturePolicy({ claimed_salary: 1, defaulted: 1 })).toThrow(/prohibited/);
  });
});

describe("the outcome carries real signal", () => {
  // These generate large populations so the rates are stable rather than noisy.
  const SLOW = 30000;
  it("defaults a plausible share of clean borrowers", () => {
    const rate = defaultRate(sample("NONE", "LOW", 500, "clean"));
    expect(rate).toBeGreaterThan(0.001);
    expect(rate).toBeLessThan(0.06);
  }, SLOW);

  it("rises as true credit quality falls", () => {
    const cases = blendedPopulation();
    const band = (c) => {
      const s = c.truth.current_state.credit_score;
      return s < 620 ? "low" : s < 700 ? "mid" : "high";
    };
    const rateFor = (b) => {
      const sub = cases.filter((c) => band(c) === b);
      return sub.length ? defaultRate(sub) : null;
    };
    const [low, high] = [rateFor("low"), rateFor("high")];
    expect(low).toBeGreaterThan(high);
  }, SLOW);

  it("rises as the payment burden on true income rises", () => {
    const cases = blendedPopulation();
    const burden = (c) => {
      const s = c.truth.current_state;
      return s.monthly_mortgage_payment / Math.max(1, s.income_stream.monthly_net_deposit);
    };
    const heavy = cases.filter((c) => burden(c) > 0.4);
    const light = cases.filter((c) => burden(c) <= 0.35);
    expect(heavy.length).toBeGreaterThan(20);
    expect(defaultRate(heavy)).toBeGreaterThan(defaultRate(light));
  }, SLOW);

  it("punishes the two intent-driven typologies far harder than clean cases", () => {
    const clean = defaultRate(sample("NONE", "LOW", 200, "intent"));
    for (const t of ["BUST_OUT", "STRAW_BUYER"]) {
      const rate = defaultRate(sample(t, "HIGH", 200, "intent"));
      expect(rate, `${t} must default far more than a clean borrower`).toBeGreaterThan(clean + 0.2);
    }
  }, SLOW);

  it("does not make every typology default, because misrepresentation is not the same as inability to pay", () => {
    // Concealment hides existing debt from the lender. The borrower's own capacity is
    // unchanged, so their outcome should look much like a clean borrower's. The harm is
    // adverse selection into the approved pool, which the outcome evaluation measures.
    const clean = defaultRate(sample("NONE", "LOW", 400, "sel"));
    const concealed = defaultRate(sample("CONCEALMENT", "HIGH", 400, "sel"));
    expect(Math.abs(concealed - clean)).toBeLessThan(0.05);
  }, SLOW);

  it("charges a larger loss the earlier a loan defaults", () => {
    const defaulted = sample("BUST_OUT", "HIGH", 300, "lgd").map((c) => c.performance).filter((p) => p.defaulted);
    const early = defaulted.filter((p) => p.months_to_default <= 3);
    const late = defaulted.filter((p) => p.months_to_default > 12);
    expect(early.length).toBeGreaterThan(0);
    if (late.length > 3) {
      const mean = (a) => a.reduce((s, p) => s + p.loss_given_default, 0) / a.length;
      expect(mean(early)).toBeGreaterThan(mean(late));
    }
    for (const p of defaulted) {
      expect(p.loss_given_default).toBeGreaterThanOrEqual(DEFAULT_PERFORMANCE_CONFIG.loss_given_default.min);
      expect(p.loss_given_default).toBeLessThanOrEqual(DEFAULT_PERFORMANCE_CONFIG.loss_given_default.max);
    }
  });
});

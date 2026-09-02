import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateBlendedCase, generateCase } from "../generator.js";
import { evaluateGeneratorQuality, ledgerInvariantChecks, evidenceConsistencyChecks, missingFieldChecks, reproducibilityCheck } from "./generator-quality/index.js";
import { evaluateDetection, compareRulesets } from "./detection/index.js";
import { evaluateDecisions } from "./decision/index.js";
import { evaluateFairness, makeCounterfactual, counterfactualTests } from "./fairness/index.js";
import { evaluateGates, RELEASE_GATES } from "./gates.js";
import { ksTest, chiSquarePValue, confusion, jaccard, pearson } from "./stats.js";
import { FRAUD_RULES } from "../decisioning/fraud-rules/rules.js";
import { scoreCase } from "../decisioning/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "distribution_config.json"), "utf8"));
CONFIG.generation = { as_of_date: "2026-01-15" };

const POP = Array.from({ length: 300 }, (_, i) => generateBlendedCase(i, CONFIG, "eval-seed"));
const STRAT = ["NONE", "INFLATION", "CONCEALMENT", "FABRICATION", "BUST_OUT", "EVIDENCE_TAMPERING", "INCOHERENT", "ASSET_SEASONING"]
  .flatMap(t => Array.from({ length: 25 }, (_, i) => generateCase(i, CONFIG, t, "HIGH", `strat-${t}-${i}`)));

describe("stats helpers", () => {
  it("KS test accepts the right distribution and rejects the wrong one", () => {
    const u = Array.from({ length: 3000 }, (_, i) => (i + 0.5) / 3000);
    expect(ksTest(u, x => x).statistic).toBeLessThan(0.01);
    expect(ksTest(u, x => x * x).statistic).toBeGreaterThan(0.2);
  });
  it("chi-square p-values are sane", () => {
    expect(chiSquarePValue(0, 4)).toBe(1);
    expect(chiSquarePValue(3.36, 4)).toBeCloseTo(0.5, 1);
    expect(chiSquarePValue(40, 4)).toBeLessThan(1e-6);
  });
  it("confusion and jaccard", () => {
    const c = confusion([1, 1, 0, 0], [1, 0, 1, 0]);
    expect(c.precision).toBe(0.5); expect(c.recall).toBe(0.5); expect(c.fpr).toBe(0.5);
    expect(jaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });
});

describe("layer 1: generator quality", () => {
  it("ledger invariants hold on every case", () => {
    const r = ledgerInvariantChecks(POP);
    expect(r.all_pass).toBe(true);
  });
  it("clean evidence reconciles with the ledger within fidelity tolerance", () => {
    expect(evidenceConsistencyChecks(POP).rate).toBeGreaterThanOrEqual(0.99);
  });
  it("no required field is missing", () => {
    expect(missingFieldChecks(POP).missing).toBe(0);
  });
  it("seeded generation is reproducible", () => {
    expect(reproducibilityCheck(i => generateBlendedCase(i, CONFIG, "repro"), 10).identical).toBe(true);
  });
  it("full evaluation passes distribution and correlation gates", () => {
    const g = evaluateGeneratorQuality(POP, CONFIG, { seed: "eval-seed" });
    expect(g.distribution_pass_rate).toBeGreaterThanOrEqual(0.95);
    expect(g.correlation_within_tolerance_rate).toBeGreaterThanOrEqual(0.95);
  });
});

describe("layer 2: detection", () => {
  it("recovers injected deltas and keeps clean FPR low", () => {
    const d = evaluateDetection([...POP, ...STRAT]);
    expect(d.reconciliation.rate).toBeGreaterThanOrEqual(0.95);
    expect(d.fpr_on_clean).toBeLessThanOrEqual(0.05);
    expect(d.overall.recall).toBeGreaterThanOrEqual(0.9);
    expect(d.by_rule.length).toBe(FRAUD_RULES.length);
    expect(d.evidence_support_rate).toBeGreaterThan(0.9);
  });
  it("champion/challenger reports deltas", () => {
    const challenger = FRAUD_RULES.filter(r => r.id !== "FR-003");
    const cmp = compareRulesets(STRAT, FRAUD_RULES, challenger);
    expect(cmp.deltas.recall).toBeLessThanOrEqual(0);
  });
});

describe("layer 3: decisions", () => {
  it("agrees with labels, uses only permitted variables and passes governance", () => {
    const d = evaluateDecisions([...POP, ...STRAT], CONFIG);
    expect(d.agreement_rate).toBeGreaterThanOrEqual(0.95);
    expect(d.permissible_variables.violations).toBe(0);
    expect(d.governance.invalid_decisions).toBe(0);
    expect(d.rows.length).toBe(POP.length + STRAT.length);
  });
  it("approval rate rises with credit band on clean cases", () => {
    const d = evaluateDecisions(POP, CONFIG);
    const bands = d.calibration_by_credit_band.filter(b => b.n >= 10);
    for (let i = 1; i < bands.length; i++) expect(bands[i].approval_rate).toBeGreaterThanOrEqual(bands[i - 1].approval_rate - 0.05);
  });
});

describe("fairness", () => {
  it("counterfactual twins change only the sensitive attribute", () => {
    const c = POP[0];
    const twin = makeCounterfactual(c, "age_band", "60+");
    expect(twin.applicant.age).toBe(65);
    expect(twin.presentation.current_state.salary).toBe(c.presentation.current_state.salary);
    expect(twin.evidence).toEqual(c.evidence);
  });
  it("decisions are invariant to every sensitive attribute", () => {
    const r = counterfactualTests(POP, CONFIG, { maxCases: 60 });
    expect(r.changed).toBe(0);
    expect(r.invariance_rate).toBe(1);
  });
  it("a policy that reads a sensitive attribute is caught", () => {
    const c = POP.find(x => scoreCase(x, CONFIG).decision.outcome === "APPROVE") ?? POP[0];
    const biased = JSON.parse(JSON.stringify(c));
    // Simulate a leak: encode age into a permitted claim so the decision changes with the twin.
    const twin = makeCounterfactual(biased, "age_band", "22-29");
    twin.presentation.current_state.tenure_months = 1; // what a leaky policy would do
    const a = scoreCase(biased, CONFIG).decision.outcome;
    const b = scoreCase(twin, CONFIG).decision.outcome;
    expect(a).not.toBe(b);
  });
  it("full fairness evaluation returns a status and disclaimer", () => {
    const f = evaluateFairness(POP, CONFIG, { maxCounterfactualCases: 30 });
    expect(["PASS", "WARN", "FAIL"]).toContain(f.status);
    expect(f.disclaimer).toMatch(/not establish legal compliance/i);
    expect(f.subgroups.length).toBeGreaterThan(5);
  });
});

describe("release gates", () => {
  it("fails when a mandatory gate is violated and passes otherwise", () => {
    const ok = { generator: { ledger_invariants: { all_pass_rate: 1 }, evidence_consistency: { rate: 1 }, distribution_pass_rate: 1, correlation_within_tolerance_rate: 1, reproducibility: { rate: 1 }, missing_required_fields: { rate: 0 } }, detection: { reconciliation: { rate: 1 }, overall: { recall: 0.95 }, fpr_on_clean: 0.01 }, decision: { agreement_rate: 0.99, permissible_variables: { violations: 0 }, governance: { invalid_decisions: 0 } }, fairness: { counterfactual: { invariance_rate: 1 }, independent_attribute_min_selection_ratio: 1 }, network: { ring_recall: 1, non_ring_false_positive_rate: 0 } };
    expect(evaluateGates(ok).passed).toBe(true);
    const bad = JSON.parse(JSON.stringify(ok)); bad.decision.permissible_variables.violations = 1;
    const r = evaluateGates(bad);
    expect(r.passed).toBe(false);
    expect(r.failed_ids).toEqual(["permissible_variables"]);
    expect(RELEASE_GATES.filter(g => g.mandatory).length).toBeGreaterThanOrEqual(12);
  });
});

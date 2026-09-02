import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateCase, generateBlendedCase } from "../generator.js";
import { scoreCase, extractDecisionView, runFraudRules, decideCase } from "./index.js";
import { REASON_CODES, REASON_CATEGORIES, validateDecisionReasonCodes, adverseActionCodes, investigationCodes, isValidReasonCode } from "./reason-codes/catalog.js";
import { classifyFeature, enforceFeaturePolicy, FEATURE_CLASSES } from "./policies/feature_policy.js";
import { FRAUD_RULES, describeRules } from "./fraud-rules/rules.js";
import { extractDecisionFeatures, extractMLFeatures } from "../ml/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "distribution_config.json"), "utf8"));
CONFIG.generation = { as_of_date: "2026-01-15" };

describe("reason-code catalog", () => {
  it("every code is self-consistent and categorised", () => {
    for (const [code, def] of Object.entries(REASON_CODES)) {
      expect(def.code).toBe(code);
      expect(Object.values(REASON_CATEGORIES)).toContain(def.category);
      expect(typeof def.description).toBe("string");
      expect(Array.isArray(def.dimensions)).toBe(true);
    }
  });
  it("fraud indicators are never adverse-action eligible", () => {
    for (const def of Object.values(REASON_CODES)) {
      if (def.category === REASON_CATEGORIES.FRAUD_INDICATOR) expect(def.adverse_action).toBe(false);
    }
  });
  it("rejects declines justified only by fraud indicators", () => {
    const r = validateDecisionReasonCodes("DECLINE", ["HIGH_RISK_NETWORK_ORIGIN", "SUSPICIOUS_DOCUMENT_METADATA"]);
    expect(r.valid).toBe(false);
    expect(validateDecisionReasonCodes("DECLINE", ["EXCESSIVE_DTI"]).valid).toBe(true);
    expect(validateDecisionReasonCodes("DECLINE", ["NOT_A_CODE"]).valid).toBe(false);
    expect(isValidReasonCode("EXCESSIVE_DTI")).toBe(true);
  });
  it("splits adverse-action and investigation codes", () => {
    const codes = ["EXCESSIVE_DTI", "HIGH_RISK_NETWORK_ORIGIN", "UNVERIFIABLE_INCOME"];
    expect(adverseActionCodes(codes)).toEqual(["EXCESSIVE_DTI", "UNVERIFIABLE_INCOME"]);
    expect(investigationCodes(codes)).toEqual(["HIGH_RISK_NETWORK_ORIGIN"]);
  });
});

describe("feature policy", () => {
  it("classifies truth, labels and identity as prohibited", () => {
    expect(classifyFeature("truth_salary")).toBe(FEATURE_CLASSES.PROHIBITED);
    expect(classifyFeature("expected_outcome")).toBe(FEATURE_CLASSES.PROHIBITED);
    expect(classifyFeature("ssn_last4")).toBe(FEATURE_CLASSES.PROHIBITED);
    expect(classifyFeature("salary_diff")).toBe(FEATURE_CLASSES.PROHIBITED);
  });
  it("classifies protected-style attributes as sensitive", () => {
    for (const f of ["age", "zip_code", "region", "income_band", "family_status_scenario", "disability_income_scenario", "persona"]) {
      expect(classifyFeature(f)).toBe(FEATURE_CLASSES.SENSITIVE);
    }
  });
  it("throws when prohibited fields reach a model in strict mode", () => {
    expect(() => enforceFeaturePolicy({ claimed_salary: 1, truth_salary: 2 })).toThrow(/prohibited/);
    const r = enforceFeaturePolicy({ claimed_salary: 1, age: 30, truth_salary: 2 }, { strict: false, allowSensitive: true });
    expect(r.permitted).toEqual({ claimed_salary: 1 });
    expect(r.sensitive).toEqual({ age: 30 });
    expect(r.prohibited).toEqual(["truth_salary"]);
  });
  it("the legacy ML feature row is rejected by the policy (it contains truth_*)", () => {
    const c = generateCase(1, CONFIG, "NONE", "LOW", "fp-1");
    expect(() => enforceFeaturePolicy(extractMLFeatures(c))).toThrow();
    expect(() => extractDecisionFeatures(c)).not.toThrow();
  });
});

describe("decision view", () => {
  it("never exposes truth or labels", () => {
    const c = generateCase(2, CONFIG, "INFLATION", "HIGH", "dv-1");
    const json = JSON.stringify(extractDecisionView(c));
    expect(json).not.toContain("expected_outcome");
    expect(json).not.toContain("\"truth\"");
    const { features, sensitive, labels } = extractDecisionFeatures(c);
    expect(Object.keys(features).some(k => k.startsWith("truth_"))).toBe(false);
    expect(sensitive).toHaveProperty("age_band");
    expect(labels.is_fraud).toBe(1);
  });
});

describe("fraud rules", () => {
  it("every rule has governance metadata", () => {
    for (const r of describeRules()) {
      expect(r.id).toMatch(/^FR-\d{3}$/);
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.owner).toBeTruthy();
      expect(["APPROVED", "DRAFT", "RETIRED"]).toContain(r.approval_status);
      expect(REASON_CODES[r.reason_code]).toBeDefined();
      expect(r.features_used.length).toBeGreaterThan(0);
    }
    expect(FRAUD_RULES.length).toBeGreaterThanOrEqual(17);
  });
  const expectations = [
    ["INFLATION", "HIGH", "FR-001"],
    ["FABRICATION", "HIGH", "FR-002"],
    ["CONCEALMENT", "HIGH", "FR-003"],
    ["EVIDENCE_TAMPERING", "HIGH", "FR-006"],
    ["BUST_OUT", "HIGH", "FR-009"],
    ["INCOHERENT", "HIGH", "FR-013"],
    ["OCCUPANCY_MISREPRESENTATION", "MEDIUM", "FR-014"],
    ["GIFT_FUND_MISREPRESENTATION", "MEDIUM", "FR-015"],
    ["ASSET_SEASONING", "MEDIUM", "FR-016"],
    ["STRAW_BUYER", "HIGH", "FR-017"]
  ];
  for (const [type, sev, rule] of expectations) {
    it(`${rule} fires on most ${type} cases and cites evidence`, () => {
      let fired = 0;
      for (let i = 0; i < 40; i++) {
        const c = generateCase(i, CONFIG, type, sev, `rule-${type}-${i}`);
        const { alerts } = runFraudRules(extractDecisionView(c));
        const a = alerts.find(x => x.rule_id === rule);
        if (a) { fired++; expect(Array.isArray(a.evidence_citations)).toBe(true); }
      }
      expect(fired / 40).toBeGreaterThanOrEqual(0.8);
    });
  }
  it("rarely fires high-severity rules on clean cases", () => {
    let high = 0;
    for (let i = 0; i < 200; i++) {
      const c = generateCase(i, CONFIG, "NONE", "LOW", `clean-${i}`);
      const { alerts } = runFraudRules(extractDecisionView(c));
      if (alerts.some(a => a.severity === "HIGH")) high++;
    }
    expect(high).toBeLessThanOrEqual(2);
  });
});

describe("underwriting policy and explanation", () => {
  it("agrees with generated labels on at least 95% of blended cases", () => {
    let agree = 0; const n = 300;
    for (let i = 0; i < n; i++) {
      const c = generateBlendedCase(i, CONFIG, "policy-seed");
      const r = scoreCase(c, CONFIG);
      if (r.decision.outcome === c.label.expected_outcome) agree++;
    }
    expect(agree / n).toBeGreaterThanOrEqual(0.95);
  });
  it("every decline cites an adverse-action-eligible reason and passes governance", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateBlendedCase(i, CONFIG, "gov-seed");
      const r = scoreCase(c, CONFIG);
      expect(r.decision.governance.valid).toBe(true);
      if (r.decision.outcome === "DECLINE") expect(r.decision.adverse_action_reasons.length).toBeGreaterThan(0);
      if (r.decision.outcome === "APPROVE") expect(r.decision.reason_codes).toEqual([]);
    }
  });
  it("explanations answer the six governance questions", () => {
    const c = generateCase(7, CONFIG, "CONCEALMENT", "HIGH", "expl-1");
    const r = scoreCase(c, CONFIG, { modelVersion: "lr-1.0.0", modelScore: 0.9 });
    const e = r.explanation;
    expect(e.what_was_detected.length).toBeGreaterThan(0);
    expect(e.which_inputs_contributed.length).toBe(4);
    expect(e.which_evidence_supports.length).toBeGreaterThan(0);
    expect(e.which_versions_were_used.ruleset).toBeTruthy();
    expect(e.which_versions_were_used.model).toBe("lr-1.0.0");
    expect(e.what_would_change_the_outcome.length).toBeGreaterThan(0);
    expect(["AUTOMATED", "REQUIRES_HUMAN_REVIEW"]).toContain(e.automated_or_reviewed);
  });
  it("is deterministic for the same input", () => {
    const c = generateCase(9, CONFIG, "INFLATION", "MEDIUM", "det-1");
    const a = scoreCase(c, CONFIG, { now: "x" });
    const b = scoreCase(c, CONFIG, { now: "x" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("decideCase falls back to review when governance would be violated", () => {
    const view = extractDecisionView(generateCase(3, CONFIG, "NONE", "LOW", "gv-1"));
    const alerts = [{ rule_id: "X", rule_version: "1", severity: "MEDIUM", reason_code: "HIGH_RISK_NETWORK_ORIGIN", evidence_citations: [] }];
    const d = decideCase(view, alerts, CONFIG);
    expect(["DECLINE", "MANUAL_REVIEW"]).toContain(d.outcome);
    expect(d.governance.valid || d.pathway === "GOVERNANCE_FALLBACK").toBe(true);
  });
});

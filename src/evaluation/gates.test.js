// Release gates are the contract CI enforces, so each one is asserted individually:
// its threshold, its direction, whether it is mandatory, and that it actually reads the
// value it claims to read and flips exactly at the boundary.

import { describe, it, expect } from "vitest";
import { evaluateGates, RELEASE_GATES } from "./gates.js";

/** A results object where every gate passes. Each gate's reader is exercised against it. */
function passingResults() {
  return {
    generator: {
      ledger_invariants: { all_pass_rate: 1 },
      evidence_consistency: { rate: 1 },
      distribution_pass_rate: 1,
      correlation_within_tolerance_rate: 1,
      reproducibility: { rate: 1 },
      missing_required_fields: { rate: 0 }
    },
    detection: { reconciliation: { rate: 1 }, overall: { recall: 1 }, fpr_on_clean: 0 },
    decision: { agreement_rate: 1, permissible_variables: { violations: 0 }, governance: { invalid_decisions: 0 } },
    fairness: { counterfactual: { invariance_rate: 1 }, independent_attribute_min_selection_ratio: 1 },
    network: { ring_recall: 1, non_ring_false_positive_rate: 0 }
  };
}

/** Write a value into whatever nested location a gate's reader looks at. */
const SETTERS = {
  ledger_invariants: (r, v) => { r.generator.ledger_invariants.all_pass_rate = v; },
  evidence_consistency: (r, v) => { r.generator.evidence_consistency.rate = v; },
  distribution_tests: (r, v) => { r.generator.distribution_pass_rate = v; },
  correlation_targets: (r, v) => { r.generator.correlation_within_tolerance_rate = v; },
  reproducibility: (r, v) => { r.generator.reproducibility.rate = v; },
  missing_required_fields: (r, v) => { r.generator.missing_required_fields.rate = v; },
  ground_truth_reconciliation: (r, v) => { r.detection.reconciliation.rate = v; },
  decision_rule_agreement: (r, v) => { r.decision.agreement_rate = v; },
  permissible_variables: (r, v) => { r.decision.permissible_variables.violations = v; },
  reason_code_governance: (r, v) => { r.decision.governance.invalid_decisions = v; },
  counterfactual_invariance: (r, v) => { r.fairness.counterfactual.invariance_rate = v; },
  scenario_attribute_parity: (r, v) => { r.fairness.independent_attribute_min_selection_ratio = v; },
  fraud_recall_rules: (r, v) => { r.detection.overall.recall = v; },
  clean_false_positive_rate: (r, v) => { r.detection.fpr_on_clean = v; },
  network_ring_recall: (r, v) => { r.network.ring_recall = v; },
  network_false_positive_rate: (r, v) => { r.network.non_ring_false_positive_rate = v; }
};

// The exact contract. Changing a threshold here must be a deliberate, reviewed edit.
const EXPECTED = [
  ["ledger_invariants", "generator", ">=", 1.0, true],
  ["evidence_consistency", "generator", ">=", 0.995, true],
  ["distribution_tests", "generator", ">=", 0.95, true],
  ["correlation_targets", "generator", ">=", 0.95, true],
  ["reproducibility", "generator", ">=", 1.0, true],
  ["missing_required_fields", "generator", "<=", 0.0, true],
  ["ground_truth_reconciliation", "detection", ">=", 0.97, true],
  ["decision_rule_agreement", "decision", ">=", 0.95, true],
  ["permissible_variables", "decision", "<=", 0, true],
  ["reason_code_governance", "decision", "<=", 0, true],
  ["counterfactual_invariance", "fairness", ">=", 1.0, true],
  ["scenario_attribute_parity", "fairness", ">=", 0.8, true],
  ["fraud_recall_rules", "detection", ">=", 0.90, false],
  ["clean_false_positive_rate", "detection", "<=", 0.05, false],
  ["network_ring_recall", "network", ">=", 0.8, true],
  ["network_false_positive_rate", "network", "<=", 0.05, true]
];

describe("release gate contract", () => {
  it("declares exactly the expected gates with their thresholds and directions", () => {
    expect(RELEASE_GATES.map((g) => g.id)).toEqual(EXPECTED.map((e) => e[0]));
    for (const [id, layer, op, threshold, mandatory] of EXPECTED) {
      const gate = RELEASE_GATES.find((g) => g.id === id);
      expect(gate, `gate ${id} is missing`).toBeDefined();
      expect(gate.layer, `layer of ${id}`).toBe(layer);
      expect(gate.op, `operator of ${id}`).toBe(op);
      expect(gate.threshold, `threshold of ${id}`).toBe(threshold);
      expect(gate.mandatory, `mandatory flag of ${id}`).toBe(mandatory);
      expect(gate.label.length, `label of ${id}`).toBeGreaterThan(0);
      expect(typeof gate.read).toBe("function");
    }
  });

  it("passes when every measured value meets its threshold", () => {
    const r = evaluateGates(passingResults());
    expect(r.passed).toBe(true);
    expect(r.failed_ids).toEqual([]);
    expect(r.rows.every((row) => row.status === "PASS")).toBe(true);
    expect(r.rows.length).toBe(RELEASE_GATES.length);
  });

  for (const [id, , op, threshold, mandatory] of EXPECTED) {
    it(`gate ${id} reads its own value and flips exactly at ${op} ${threshold}`, () => {
      const eps = threshold === 0 ? 1 : Math.max(threshold * 0.01, 0.001);
      const atBoundary = threshold;
      const justOver = op === ">=" ? threshold - eps : threshold + eps;

      const boundary = passingResults();
      SETTERS[id](boundary, atBoundary);
      const boundaryRow = evaluateGates(boundary).rows.find((x) => x.id === id);
      expect(boundaryRow.value, `${id} must read the value it declares`).toBe(atBoundary);
      expect(boundaryRow.status, `${id} passes at the boundary`).toBe("PASS");

      const breached = passingResults();
      SETTERS[id](breached, justOver);
      const result = evaluateGates(breached);
      const row = result.rows.find((x) => x.id === id);
      expect(row.value).toBe(justOver);
      expect(row.status).toBe(mandatory ? "FAIL" : "WARN");
      expect(result.passed).toBe(!mandatory);
      if (mandatory) expect(result.failed_ids).toEqual([id]);
      // A breach in one gate must not disturb any other gate.
      for (const other of result.rows.filter((x) => x.id !== id)) expect(other.status).toBe("PASS");
    });
  }

  it("treats a missing or unreadable value as a failure rather than a pass", () => {
    const r = evaluateGates({});
    expect(r.passed).toBe(false);
    expect(r.failed_ids.length).toBe(EXPECTED.filter((e) => e[4]).length);
    for (const row of r.rows) {
      expect(row.value).toBeNull();
      expect(row.status).toBe(row.mandatory ? "FAIL" : "WARN");
    }
  });

  it("reports several simultaneous failures", () => {
    const bad = passingResults();
    SETTERS.ledger_invariants(bad, 0.9);
    SETTERS.permissible_variables(bad, 3);
    const r = evaluateGates(bad);
    expect(r.passed).toBe(false);
    expect(r.failed_ids.sort()).toEqual(["ledger_invariants", "permissible_variables"]);
  });

  it("accepts a custom gate list so a caller can evaluate a subset", () => {
    const one = RELEASE_GATES.filter((g) => g.id === "decision_rule_agreement");
    const r = evaluateGates(passingResults(), one);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe("decision_rule_agreement");
    expect(r.passed).toBe(true);
  });
});

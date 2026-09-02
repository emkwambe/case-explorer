// src/evaluation/gates.js — Explicit release gates. CI fails when a mandatory gate fails.

export const RELEASE_GATES = [
  { id: "ledger_invariants", label: "Ledger invariants", layer: "generator", threshold: 1.0, op: ">=", mandatory: true,
    read: r => r.generator.ledger_invariants.all_pass_rate },
  { id: "evidence_consistency", label: "Evidence consistency (clean cases)", layer: "generator", threshold: 0.995, op: ">=", mandatory: true,
    read: r => r.generator.evidence_consistency.rate },
  { id: "distribution_tests", label: "Distribution tests passing", layer: "generator", threshold: 0.95, op: ">=", mandatory: true,
    read: r => r.generator.distribution_pass_rate },
  { id: "correlation_targets", label: "Correlation targets within tolerance", layer: "generator", threshold: 0.95, op: ">=", mandatory: true,
    read: r => r.generator.correlation_within_tolerance_rate },
  { id: "reproducibility", label: "Reproducibility (seeded)", layer: "generator", threshold: 1.0, op: ">=", mandatory: true,
    read: r => r.generator.reproducibility.rate },
  { id: "missing_required_fields", label: "Missing required fields", layer: "generator", threshold: 0.0, op: "<=", mandatory: true,
    read: r => r.generator.missing_required_fields.rate },
  { id: "ground_truth_reconciliation", label: "Ground-truth reconciliation", layer: "detection", threshold: 0.97, op: ">=", mandatory: true,
    read: r => r.detection.reconciliation.rate },
  { id: "decision_rule_agreement", label: "Decision-rule agreement", layer: "decision", threshold: 0.95, op: ">=", mandatory: true,
    read: r => r.decision.agreement_rate },
  { id: "permissible_variables", label: "Prohibited variables in decision inputs", layer: "decision", threshold: 0, op: "<=", mandatory: true,
    read: r => r.decision.permissible_variables.violations },
  { id: "reason_code_governance", label: "Declines without adverse-action reason", layer: "decision", threshold: 0, op: "<=", mandatory: true,
    read: r => r.decision.governance.invalid_decisions },
  { id: "counterfactual_invariance", label: "Counterfactual fairness invariance", layer: "fairness", threshold: 1.0, op: ">=", mandatory: true,
    read: r => r.fairness.counterfactual.invariance_rate },
  { id: "scenario_attribute_parity", label: "Independent scenario attribute selection ratio", layer: "fairness", threshold: 0.8, op: ">=", mandatory: true,
    read: r => r.fairness.independent_attribute_min_selection_ratio },
  // Informational (reported, not enforced): detection quality of the rule baseline.
  { id: "fraud_recall_rules", label: "Rule-baseline fraud recall", layer: "detection", threshold: 0.90, op: ">=", mandatory: false,
    read: r => r.detection.overall.recall },
  { id: "clean_false_positive_rate", label: "Rule-baseline FPR on clean cases", layer: "detection", threshold: 0.05, op: "<=", mandatory: false,
    read: r => r.detection.fpr_on_clean },
  { id: "network_ring_recall", label: "Coordinated-ring recall (network analytics)", layer: "network", threshold: 0.8, op: ">=", mandatory: true,
    read: r => r.network.ring_recall },
  { id: "network_false_positive_rate", label: "Non-ring cases linked into clusters", layer: "network", threshold: 0.05, op: "<=", mandatory: true,
    read: r => r.network.non_ring_false_positive_rate }
];

export function evaluateGates(results, gates = RELEASE_GATES) {
  const rows = gates.map(g => {
    let value = null;
    try { value = g.read(results); } catch { value = null; }
    const pass = value === null || value === undefined ? false : (g.op === ">=" ? value >= g.threshold : value <= g.threshold);
    return { id: g.id, label: g.label, layer: g.layer, threshold: g.threshold, op: g.op, value, mandatory: g.mandatory, status: pass ? "PASS" : g.mandatory ? "FAIL" : "WARN" };
  });
  const failed = rows.filter(r => r.status === "FAIL");
  return { rows, passed: failed.length === 0, failed_ids: failed.map(r => r.id) };
}

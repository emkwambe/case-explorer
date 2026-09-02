#!/usr/bin/env node
// scripts/benchmark.js — The single authoritative benchmark command.
//
//   npm run benchmark -- [--count 2000] [--seed 42] [--out artifacts] [--verbose] [--no-fail]
//
// Generates a seeded population, runs the three independent evaluation layers
// (generator quality → detection → decision) plus fairness, evaluates release gates,
// and writes:
//   artifacts/validation-summary.json
//   artifacts/validation-report.md
//   artifacts/distribution-tests.csv
//   artifacts/correlation-results.csv
//   artifacts/reconciliation-results.csv
//   artifacts/decision-results.csv
//   artifacts/fairness-results.csv
//   artifacts/rule-analytics.csv
//   artifacts/benchmark-manifest.json
// Exits non-zero when any mandatory gate fails (unless --no-fail).

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { generateBlendedCase, generateCase } from "../src/generator.js";
import { GENERATOR_VERSION, CASE_SCHEMA_VERSION } from "../src/core/case.js";
import { evaluateGeneratorQuality } from "../src/evaluation/generator-quality/index.js";
import { evaluateDetection } from "../src/evaluation/detection/index.js";
import { evaluateDecisions } from "../src/evaluation/decision/index.js";
import { evaluateFairness } from "../src/evaluation/fairness/index.js";
import { evaluateGates } from "../src/evaluation/gates.js";
import { injectFraudRings } from "../src/simulation/rings.js";
import { analyzeNetwork, evaluateNetworkDetection } from "../src/analytics/network.js";
import { FRAUD_RULESET_VERSION } from "../src/decisioning/fraud-rules/rules.js";
import { UNDERWRITING_POLICY_VERSION } from "../src/decisioning/underwriting/policy.js";
import { REASON_CODE_CATALOG_VERSION } from "../src/decisioning/reason-codes/catalog.js";
import { FEATURE_POLICY_VERSION } from "../src/decisioning/policies/feature_policy.js";
import { toCsv, round } from "../src/evaluation/stats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { count: 2000, seed: "42", out: "artifacts", verbose: false, fail: true, stratified: 150, asOf: "2026-01-15" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--count") args.count = parseInt(argv[++i], 10);
    else if (a === "--seed") args.seed = String(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--stratified") args.stratified = parseInt(argv[++i], 10);
    else if (a === "--as-of") args.asOf = argv[++i];
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--no-fail") args.fail = false;
    else if (a === "--help" || a === "-h") { console.log("Usage: node scripts/benchmark.js [--count N] [--seed S] [--out DIR] [--stratified K] [--as-of YYYY-MM-DD] [--verbose] [--no-fail]"); process.exit(0); }
  }
  if (!Number.isInteger(args.count) || args.count < 100 || args.count > 200000) throw new Error("--count must be an integer between 100 and 200000");
  return args;
}

function gitCommit() {
  try { return execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; }
}

const STRATA = [
  ["NONE", "LOW"], ["INFLATION", "LOW"], ["INFLATION", "MEDIUM"], ["INFLATION", "HIGH"],
  ["CONCEALMENT", "MEDIUM"], ["CONCEALMENT", "HIGH"], ["FABRICATION", "HIGH"], ["BUST_OUT", "HIGH"],
  ["EVIDENCE_TAMPERING", "MEDIUM"], ["EVIDENCE_TAMPERING", "HIGH"], ["INCOHERENT", "HIGH"],
  ["OCCUPANCY_MISREPRESENTATION", "MEDIUM"], ["GIFT_FUND_MISREPRESENTATION", "MEDIUM"], ["ASSET_SEASONING", "MEDIUM"], ["STRAW_BUYER", "HIGH"]
];

export async function runBenchmark(args) {
  const started = Date.now();
  const configPath = path.join(ROOT, "src", "distribution_config.json");
  const configText = fs.readFileSync(configPath, "utf8");
  const config = JSON.parse(configText);
  config.generation = { ...(config.generation || {}), as_of_date: args.asOf };
  const configHash = crypto.createHash("sha256").update(configText).digest("hex");

  log(args, `Generating ${args.count} blended cases (seed ${args.seed}, as-of ${args.asOf})...`);
  const population = [];
  for (let i = 0; i < args.count; i++) population.push(generateBlendedCase(i, config, args.seed));

  log(args, `Generating stratified detection set (${STRATA.length} strata × ${args.stratified})...`);
  const stratified = [];
  let sid = 0;
  for (const [type, sev] of STRATA) for (let i = 0; i < args.stratified; i++) stratified.push(generateCase(sid++, config, type, sev, `${args.seed}-strat-${type}-${sev}-${i}`));
  const union = [...population, ...stratified];

  log(args, "Layer 1: generator quality...");
  const generator = evaluateGeneratorQuality(population, config, { seed: args.seed, regenerate: i => generateBlendedCase(i, config, args.seed) });
  log(args, "Layer 2: detection (rule baseline)...");
  const detection = evaluateDetection(union);
  log(args, "Layer 3: decision evaluation...");
  const decision = evaluateDecisions(union, config);
  log(args, "Fairness: subgroup + counterfactual...");
  const fairness = evaluateFairness(population, config, { maxCounterfactualCases: 300 });

  log(args, "Network analytics: ring injection + entity linkage...");
  const ringPopulation = JSON.parse(JSON.stringify(population));
  const rings = injectFraudRings(ringPopulation, { seed: `${args.seed}-rings`, ringCount: Math.max(3, Math.floor(population.length / 400)) });
  const networkAnalysis = analyzeNetwork(ringPopulation);
  const network = { ...evaluateNetworkDetection(ringPopulation, networkAnalysis), rings_injected_detail: rings.map(r => ({ ring_id: r.ring_id, size: r.size })), summary: networkAnalysis.summary };

  const results = { generator, detection, decision, fairness, network };
  const gates = evaluateGates(results);

  const manifest = {
    benchmark_version: "1.0.0",
    generated_at: new Date().toISOString(),
    generator_version: GENERATOR_VERSION,
    case_schema_version: CASE_SCHEMA_VERSION,
    ruleset_version: FRAUD_RULESET_VERSION,
    policy_version: UNDERWRITING_POLICY_VERSION,
    reason_code_catalog_version: REASON_CODE_CATALOG_VERSION,
    feature_policy_version: FEATURE_POLICY_VERSION,
    generator_commit: gitCommit(),
    configuration_hash: `sha256:${configHash}`,
    seed: args.seed,
    as_of_date: args.asOf,
    population_regime: "baseline",
    record_count: population.length,
    stratified_record_count: stratified.length,
    node_version: process.version,
    duration_seconds: null
  };

  const summary = {
    manifest,
    gates: { passed: gates.passed, failed: gates.failed_ids, rows: gates.rows },
    headline: {
      generated_cases: population.length + stratified.length,
      ledger_invariants: generator.ledger_invariants.all_pass_rate,
      evidence_consistency: generator.evidence_consistency.rate,
      distribution_tests_pass_rate: generator.distribution_pass_rate,
      correlation_within_tolerance: generator.correlation_within_tolerance_rate,
      reproducibility: generator.reproducibility.rate,
      missing_required_fields: generator.missing_required_fields.rate,
      ground_truth_reconciliation: detection.reconciliation.rate,
      rule_fraud_precision: detection.overall.precision,
      rule_fraud_recall: detection.overall.recall,
      rule_fraud_f1: detection.overall.f1,
      rule_fpr_on_clean: detection.fpr_on_clean,
      decision_rule_agreement: decision.agreement_rate,
      reason_code_adverse_action_overlap: decision.reason_codes.adverse_action_overlap_rate,
      reason_code_mean_jaccard: decision.reason_codes.mean_jaccard,
      prohibited_variable_violations: decision.permissible_variables.violations,
      counterfactual_invariance: fairness.counterfactual.invariance_rate,
      fairness_status: fairness.status,
      network_ring_recall: network.ring_recall,
      network_false_positive_rate: network.non_ring_false_positive_rate
    },
    network,
    generator: { ...generator, distribution_tests: undefined, correlation_results: undefined },
    detection: { ...detection, by_rule: undefined },
    decision: { ...decision, rows: undefined },
    fairness: { ...fairness, subgroups: undefined }
  };

  const outDir = path.resolve(ROOT, args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const write = (name, content) => fs.writeFileSync(path.join(outDir, name), content);
  manifest.duration_seconds = round((Date.now() - started) / 1000, 1);
  write("validation-summary.json", JSON.stringify(summary, null, 2));
  write("benchmark-manifest.json", JSON.stringify(manifest, null, 2));
  write("distribution-tests.csv", toCsv(generator.distribution_tests, ["name", "family", "test", "statistic", "p_value", "threshold", "n", "grade", "detail"]));
  write("correlation-results.csv", toCsv(generator.correlation_results, ["pair", "source", "target", "achieved", "diff", "tolerance", "within_tolerance"]));
  write("reconciliation-results.csv", toCsv([
    ...detection.reconciliation.by_type.map(r => ({ scope: "ground_truth_finding", key: r.finding_type, total: r.total, recovered: r.recovered, rate: r.rate })),
    ...detection.by_fraud_type.map(r => ({ scope: "fraud_type_alert_rate", key: r.fraud_type, total: r.n, recovered: r.alerted, rate: r.alert_rate }))
  ], ["scope", "key", "total", "recovered", "rate"]));
  write("decision-results.csv", toCsv(decision.rows));
  write("fairness-results.csv", toCsv(fairness.subgroups));
  write("counterfactual-findings.csv", toCsv(fairness.counterfactual.findings, ["case_id", "attribute", "from", "to", "base_outcome", "alt_outcome", "base_codes", "alt_codes", "severity"]));
  write("rule-analytics.csv", toCsv(detection.by_rule));
  write("network-results.csv", toCsv(networkAnalysis.clusters.map(c => ({ cluster_id: c.cluster_id, size: c.size, risk: c.risk, linking_entity_types: c.linking_entity_types.join("|"), density: c.density, cases: c.cases.join("|") })), ["cluster_id", "size", "risk", "linking_entity_types", "density", "cases"]));
  write("validation-report.md", renderReport(summary, generator, detection, decision, fairness, gates));

  if (args.verbose) printVerbose(generator, detection, decision, fairness);
  printGates(gates);
  console.log(`\nArtifacts written to ${path.relative(ROOT, outDir) || "."}/ (${manifest.duration_seconds}s)`);
  return { summary, gates, outDir };
}

function log(args, msg) { if (args.verbose) console.log(msg); else process.stdout.write(msg + "\n"); }

function printGates(gates) {
  console.log("\n=== Release Gates ===");
  console.table(gates.rows.map(r => ({ gate: r.label, layer: r.layer, required: `${r.op} ${r.threshold}`, value: r.value === null ? "n/a" : typeof r.value === "number" ? round(r.value, 4) : r.value, status: r.status })));
  console.log(gates.passed ? "ALL MANDATORY GATES PASSED" : `GATE FAILURES: ${gates.failed_ids.join(", ")}`);
}

function printVerbose(generator, detection, decision, fairness) {
  console.log("\n=== Distribution Tests ==="); console.table(generator.distribution_tests.map(({ detail: _d, ...r }) => r));
  console.log("\n=== Correlation Results ==="); console.table(generator.correlation_results);
  console.log("\n=== Ledger Invariants ==="); console.table(generator.ledger_invariants.rows);
  console.log("\n=== Evidence Consistency ==="); console.table([{ n: generator.evidence_consistency.n, pass: generator.evidence_consistency.pass, rate: generator.evidence_consistency.rate }]);
  console.log("\n=== Detection (rule baseline) ==="); console.table([detection.overall]);
  console.log("\n=== Detection by Fraud Type ==="); console.table(detection.by_fraud_type.map(({ missed_examples: _m, ...r }) => r));
  console.log("\n=== Ground-truth Reconciliation ==="); console.table(detection.reconciliation.by_type);
  console.log("\n=== Rule Analytics ==="); console.table(detection.by_rule.map(r => ({ rule: r.rule_id, sev: r.severity, alerts: r.alerts, tp: r.true_positives, fp: r.false_positives, precision: r.precision, target_recall: r.target_recall, fp_rate_clean: r.customer_impact_fp_rate })));
  console.log("\n=== Decision Agreement ==="); console.table(decision.by_fraud_type); console.log(decision.confusion); console.table([decision.reason_codes]);
  console.log("\n=== Calibration by credit band (clean) ==="); console.table(decision.calibration_by_credit_band);
  console.log("\n=== Fairness ==="); console.table(fairness.subgroups.map(({ top_reason_codes: _t, ...r }) => r)); console.table([fairness.counterfactual]);
}

function pct(x) { return x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`; }
function num(x, d = 3) { return x === null || x === undefined ? "n/a" : Number(x).toFixed(d); }

function renderReport(summary, generator, detection, decision, fairness, gates) {
  const network = summary.network;
  const m = summary.manifest;
  const h = summary.headline;
  const lines = [];
  lines.push(`# Validation Report`, ``, `Generated ${m.generated_at} · seed \`${m.seed}\` · ${m.record_count.toLocaleString()} blended + ${m.stratified_record_count.toLocaleString()} stratified cases · generator ${m.generator_version} · commit \`${m.generator_commit ? m.generator_commit.slice(0, 8) : "n/a"}\` · config \`${m.configuration_hash.slice(7, 19)}\``, ``);
  lines.push(`## Release gates — ${gates.passed ? "**PASS**" : "**FAIL**"}`, ``, `| Gate | Layer | Required | Value | Status |`, `|---|---|---|---|---|`);
  for (const r of gates.rows) lines.push(`| ${r.label} | ${r.layer} | ${r.op} ${r.threshold} | ${typeof r.value === "number" ? round(r.value, 4) : r.value} | ${r.status} |`);
  lines.push(``, `## Headline metrics`, ``, `| Capability | Result |`, `|---|---|`);
  lines.push(`| Generated cases | ${h.generated_cases.toLocaleString()} |`);
  lines.push(`| Ledger invariants | ${pct(h.ledger_invariants)} |`);
  lines.push(`| Evidence consistency | ${pct(h.evidence_consistency)} |`);
  lines.push(`| Distribution tests passing | ${pct(h.distribution_tests_pass_rate)} |`);
  lines.push(`| Correlation targets within tolerance | ${pct(h.correlation_within_tolerance)} |`);
  lines.push(`| Reproducibility | ${pct(h.reproducibility)} |`);
  lines.push(`| Missing required fields | ${pct(h.missing_required_fields)} |`);
  lines.push(`| Ground-truth reconciliation | ${pct(h.ground_truth_reconciliation)} |`);
  lines.push(`| Rule-baseline fraud precision / recall / F1 | ${num(h.rule_fraud_precision)} / ${num(h.rule_fraud_recall)} / ${num(h.rule_fraud_f1)} |`);
  lines.push(`| Rule-baseline false-positive rate (clean) | ${pct(h.rule_fpr_on_clean)} |`);
  lines.push(`| Decision-rule agreement | ${pct(h.decision_rule_agreement)} |`);
  lines.push(`| Adverse-action reason overlap | ${pct(h.reason_code_adverse_action_overlap)} |`);
  lines.push(`| Prohibited variables in decision inputs | ${h.prohibited_variable_violations} |`);
  lines.push(`| Counterfactual invariance | ${pct(h.counterfactual_invariance)} |`);
  lines.push(`| Fairness checks | ${h.fairness_status} |`);

  lines.push(``, `## Layer 1 — Generator validation`, ``, `Answers: are distributions correct, financial relationships coherent, evidence consistent, correlations realistic, seeds reproducible?`, ``, `| Test | Family | Statistic | p | Grade |`, `|---|---|---|---|---|`);
  for (const t of generator.distribution_tests) lines.push(`| ${t.name} | ${t.family} | ${t.statistic} | ${t.p_value ?? ""} | ${t.grade} |`);
  lines.push(``, `| Pair | Source | Target | Achieved | OK |`, `|---|---|---|---|---|`);
  for (const r of generator.correlation_results) lines.push(`| ${r.pair} | ${r.source} | ${r.target} | ${r.achieved} | ${r.within_tolerance ? "yes" : "no"} |`);
  lines.push(``, `| Ledger invariant | Pass rate |`, `|---|---|`);
  for (const r of generator.ledger_invariants.rows) lines.push(`| ${r.check} | ${pct(r.pass_rate)} (${r.pass}/${r.n}) |`);
  lines.push(``, `Evidence consistency on ${generator.evidence_consistency.n} clean cases: ${pct(generator.evidence_consistency.rate)} (tolerance = 3.5σ of configured document-fidelity noise).`);

  lines.push(``, `## Layer 2 — Detection evaluation (rule baseline, underwriter-visible data only)`, ``, `Answers: can rules identify injected fraud, which types are missed, what is the false-positive rate, which evidence supports each alert?`, ``);
  lines.push(`| Metric | Value |`, `|---|---|`, `| Precision | ${num(detection.overall.precision)} |`, `| Recall | ${num(detection.overall.recall)} |`, `| F1 | ${num(detection.overall.f1)} |`, `| FPR (all non-fraud) | ${num(detection.overall.fpr)} |`, `| FPR (clean only) | ${num(detection.fpr_on_clean)} |`, `| Specificity | ${num(detection.overall.specificity)} |`, `| Evidence-cited alerts | ${pct(detection.evidence_support_rate)} |`);
  lines.push(``, `| Fraud type | n | Alert rate | High-severity alert rate |`, `|---|---|---|---|`);
  for (const t of detection.by_fraud_type) lines.push(`| ${t.fraud_type} | ${t.n} | ${pct(t.alert_rate)} | ${pct(t.high_alert_rate)} |`);
  lines.push(``, `| Ground-truth finding | Total | Recovered | Rate |`, `|---|---|---|---|`);
  for (const t of detection.reconciliation.by_type) lines.push(`| ${t.finding_type} | ${t.total} | ${t.recovered} | ${pct(t.rate)} |`);
  lines.push(``, `| Rule | Sev | Alerts | TP | FP | Precision | Target recall | FP rate (clean) |`, `|---|---|---|---|---|---|---|---|`);
  for (const r of detection.by_rule) lines.push(`| ${r.rule_id}@${r.version} | ${r.severity} | ${r.alerts} | ${r.true_positives} | ${r.false_positives} | ${num(r.precision)} | ${num(r.target_recall)} | ${pct(r.customer_impact_fp_rate)} |`);

  lines.push(``, `## Layer 3 — Decision evaluation`, ``, `Answers: approve / decline / review agreement with the labelled outcome, permissible-variable audit, reason-code accuracy, calibration to risk.`, ``);
  lines.push(`| Fraud type | n | Agreement |`, `|---|---|---|`);
  for (const t of decision.by_fraud_type) lines.push(`| ${t.fraud_type} | ${t.n} | ${pct(t.agreement_rate)} |`);
  lines.push(``, `Confusion (expected → policy): ${Object.entries(decision.confusion).map(([k, v]) => `${k}: ${v}`).join(", ")}`, ``);
  lines.push(`Reason codes — mean Jaccard ${num(decision.reason_codes.mean_jaccard)}, exact match ${pct(decision.reason_codes.exact_match_rate)}, adverse-action overlap ${pct(decision.reason_codes.adverse_action_overlap_rate)}.`, ``);
  lines.push(`| Credit band (clean) | n | Approval rate | Decline rate |`, `|---|---|---|---|`);
  for (const r of decision.calibration_by_credit_band) lines.push(`| ${r.credit_band} | ${r.n} | ${pct(r.approval_rate)} | ${pct(r.decline_rate)} |`);
  lines.push(``, `| DTI band (clean) | n | Approval rate | Decline rate |`, `|---|---|---|---|`);
  for (const r of decision.calibration_by_dti_band) lines.push(`| ${r.dti_band} | ${r.n} | ${pct(r.approval_rate)} | ${pct(r.decline_rate)} |`);

  lines.push(``, `## Fairness controls — ${fairness.status}`, ``, `> ${fairness.disclaimer}`, ``);
  lines.push(`Counterfactual pairs: ${fairness.counterfactual.pairs} tested on ${fairness.counterfactual.cases_tested} cases; unchanged ${fairness.counterfactual.unchanged}; **changed ${fairness.counterfactual.changed}**.`, ``);
  lines.push(`| Attribute | Class | Group | n | Approval | Review | Decline | Selection ratio | FPR | FNR |`, `|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of fairness.subgroups) lines.push(`| ${r.attribute} | ${r.attribute_class} | ${r.group} | ${r.n} | ${pct(r.approval_rate)} | ${pct(r.manual_review_rate)} | ${pct(r.decline_rate)} | ${num(r.selection_rate_ratio)} | ${r.false_positive_rate === null ? "n/a" : num(r.false_positive_rate)} | ${r.false_negative_rate === null ? "n/a" : num(r.false_negative_rate)} |`);
  if (fairness.derived_attributes_below_four_fifths.length) lines.push(``, `Derived attributes below four-fifths (reported, expected to correlate with legitimate financial variables): ${fairness.derived_attributes_below_four_fifths.join("; ")}.`);
  lines.push(``, `## Entity and network analytics`, ``, `${network.rings_injected} coordinated rings injected into a copy of the population; ${network.rings_recovered} recovered (ring recall ${pct(network.ring_recall)}, member recall ${pct(network.member_recall)}, non-ring false-positive rate ${pct(network.non_ring_false_positive_rate)}). Shared devices ${network.summary.shared_devices}, shared IPs ${network.summary.shared_ips}, shared addresses ${network.summary.shared_addresses}, repeated document fingerprints ${network.summary.repeated_document_fingerprints}, clusters ${network.summary.clusters} (${network.summary.high_risk_clusters} high risk).`);
  lines.push(``, `## Versions`, ``, `| Component | Version |`, `|---|---|`, `| Generator | ${m.generator_version} |`, `| Case schema | ${m.case_schema_version} |`, `| Fraud ruleset | ${m.ruleset_version} |`, `| Underwriting policy | ${m.policy_version} |`, `| Reason-code catalog | ${m.reason_code_catalog_version} |`, `| Feature policy | ${m.feature_policy_version} |`, ``);
  return lines.join("\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { gates } = await runBenchmark(args);
    process.exit(gates.passed || !args.fail ? 0 : 1);
  } catch (err) {
    console.error(`Benchmark failed: ${err.message}`);
    console.error(err.stack);
    process.exit(2);
  }
}

#!/usr/bin/env node
// scripts/update_readme_metrics.js — Regenerate the verified-metrics table in README.md
// from artifacts/validation-summary.json (and analytics/artifacts/model-summary.json when present).
// Never type these numbers by hand. `--check` exits 1 if README is stale.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const README = path.join(ROOT, "README.md");
const SUMMARY = path.join(ROOT, "artifacts", "validation-summary.json");
const MODEL_SUMMARY = path.join(ROOT, "analytics", "artifacts", "model-summary.json");
const START = "<!-- metrics:start -->";
const END = "<!-- metrics:end -->";
const MSTART = "<!-- model-metrics:start -->";
const MEND = "<!-- model-metrics:end -->";

function pct(x) { return x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`; }
function num(x, d = 3) { return x === null || x === undefined ? "n/a" : Number(x).toFixed(d); }

export function renderMetrics() {
  if (!fs.existsSync(SUMMARY)) throw new Error("artifacts/validation-summary.json not found — run `npm run benchmark` first");
  const s = JSON.parse(fs.readFileSync(SUMMARY, "utf8"));
  const h = s.headline;
  const m = s.manifest;
  const rows = [
    ["Generated cases (benchmark run)", h.generated_cases.toLocaleString()],
    ["Ledger invariants", pct(h.ledger_invariants)],
    ["Evidence consistency", pct(h.evidence_consistency)],
    ["Distribution tests passing", pct(h.distribution_tests_pass_rate)],
    ["Correlation targets within tolerance", pct(h.correlation_within_tolerance)],
    ["Reproducibility (seeded)", pct(h.reproducibility)],
    ["Ground-truth reconciliation", pct(h.ground_truth_reconciliation)],
    ["Rule-baseline fraud recall / precision", `${num(h.rule_fraud_recall)} / ${num(h.rule_fraud_precision)}`],
    ["Rule-baseline false-positive rate (clean)", pct(h.rule_fpr_on_clean)],
    ["Policy discrimination on outcomes (AUC)", num(h.policy_discrimination_auc)],
    ["Population bad rate / approved-pool bad rate", `${pct(h.population_bad_rate)} / ${pct(h.approved_bad_rate)}`],
    ["Approved-pool risk separation", pct(h.approval_risk_separation)],
    ["False decline rate", pct(h.false_decline_rate)],
    ["Prohibited variables in decision inputs", String(h.prohibited_variable_violations)],
    ["Counterfactual fairness invariance", pct(h.counterfactual_invariance)],
    ["Coordinated-ring recall (network analytics)", pct(h.network_ring_recall)],
    ["Fairness checks", h.fairness_status],
    ["Release gates", s.gates.passed ? "PASS" : `FAIL (${s.gates.failed.join(", ")})`]
  ];
  return [
    START,
    `_Generated from \`artifacts/validation-summary.json\` (benchmark seed ${m.seed}, ${m.record_count.toLocaleString()} blended + ${m.stratified_record_count.toLocaleString()} stratified cases) by \`npm run readme:metrics\`. Do not edit by hand._`,
    "",
    "| Capability | Result |",
    "|---|---|",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    END
  ].join("\n");
}

export function renderModelMetrics() {
  const model = fs.existsSync(MODEL_SUMMARY) ? JSON.parse(fs.readFileSync(MODEL_SUMMARY, "utf8")) : null;
  const best = model?.champion ?? null;
  if (!best) return null;
  const t = best.test ?? best.splits?.test ?? {};
  const oot = best.out_of_time ?? {};
  const rows = [
    ["Champion model", `${best.model} (${best.backend})`],
    ["Fraud PR-AUC (held-out test)", num(t.pr_auc)],
    ["Fraud ROC-AUC (held-out test)", num(t.roc_auc)],
    [`Recall at selected threshold (${num(best.threshold, 2)})`, num(t.recall)],
    ["Precision at threshold", num(t.precision)],
    ["False-positive rate at threshold", num(t.fpr)],
    ["Calibration error (ECE)", num(t.ece)],
    ["Brier score", num(t.brier)],
    ["Out-of-time PR-AUC / recall", `${num(oot.pr_auc)} / ${num(oot.recall)}`],
    ["Adversarial-set PR-AUC", num(best.adversarial?.pr_auc)],
    ["Clean-control false-positive rate", num(best.clean_control_fpr)]
  ];
  for (const other of model.models ?? []) {
    if ((other.model ?? other.name) === best.model) continue;
    rows.push([`Challenger ${other.model ?? other.name} PR-AUC (test)`, num(other.test?.pr_auc)]);
  }
  return [
    MSTART,
    `_Generated from \`analytics/artifacts/model-summary.json\` (governed splits from \`scripts/build_datasets.js\`) by \`npm run readme:metrics\`. Do not edit by hand._`,
    "",
    "| Model metric | Result |",
    "|---|---|",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    MEND
  ].join("\n");
}

export function updateReadme({ check = false } = {}) {
  let readme = fs.readFileSync(README, "utf8");
  const original = readme;
  const replaceBlock = (text, start, end, block) => {
    const a = text.indexOf(start), b = text.indexOf(end);
    if (a < 0 || b < 0) throw new Error(`README.md must contain ${start} and ${end} markers`);
    return text.slice(0, a) + block + text.slice(b + end.length);
  };
  readme = replaceBlock(readme, START, END, renderMetrics());
  const modelBlock = renderModelMetrics();
  // Model artifacts are produced by a separate job; only compare that block when they exist locally.
  if (modelBlock) readme = replaceBlock(readme, MSTART, MEND, modelBlock);
  const stale = readme !== original;
  if (check) {
    if (stale) { console.error("README metrics are stale. Run `npm run readme:metrics`."); return false; }
    console.log("README metrics are up to date."); return true;
  }
  fs.writeFileSync(README, readme);
  console.log(stale ? "README metrics updated." : "README metrics unchanged.");
  return true;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ok = updateReadme({ check: process.argv.includes("--check") });
  process.exit(ok ? 0 : 1);
}

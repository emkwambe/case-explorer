#!/usr/bin/env node
// scripts/prepare_demo_assets.js — Copy published artifacts into public/artifacts so the demo
// can read real benchmark and model numbers instead of hard-coded values. Missing artifacts are
// skipped; the UI degrades to a "not published" notice.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "public", "artifacts");
const SOURCES = [
  [path.join(ROOT, "artifacts"), ["validation-summary.json", "validation-report.md", "decision-results.csv", "rule-analytics.csv", "fairness-results.csv", "reconciliation-results.csv", "distribution-tests.csv", "correlation-results.csv", "network-results.csv", "benchmark-manifest.json"]],
  [path.join(ROOT, "analytics", "artifacts"), ["model-summary.json", "model-comparison.md", "validation-package.md", "threshold-economics.csv", "fairness-report.json", "monitoring-report.json", "registry.json", "pr_curves.png", "calibration.png", "pdp.png", "shap_summary_random_forest.png", "shap_summary_gradient_boosting.png", "shap_summary_logistic_regression.png"]]
];

fs.mkdirSync(DEST, { recursive: true });
let copied = 0, missing = 0;
for (const [dir, files] of SOURCES) {
  for (const f of files) {
    const src = path.join(dir, f);
    if (!fs.existsSync(src)) { missing++; continue; }
    fs.copyFileSync(src, path.join(DEST, f));
    copied++;
  }
}
console.log(`Demo assets: ${copied} copied, ${missing} not present (run npm run benchmark and the analytics pipeline to populate).`);

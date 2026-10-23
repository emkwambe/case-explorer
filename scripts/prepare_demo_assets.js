#!/usr/bin/env node
// scripts/prepare_demo_assets.js — Copy published artifacts into public/artifacts so the demo
// can read real benchmark and model numbers instead of hard-coded values. Missing artifacts are
// skipped; the UI degrades to a "not published" notice.
//
// Model outputs come from analytics/artifacts/ when present. A file missing there (always on a Vercel
// build, where the folder is gitignored) is taken from the committed snapshot in
// artifacts/model-snapshot/ instead, and public/artifacts/model-snapshot.json records which files and
// the snapshot's date, so the tabs can say they show a snapshot.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "public", "artifacts");
const SNAPSHOT = path.join(ROOT, "artifacts", "model-snapshot");
const MARKER = path.join(DEST, "model-snapshot.json");
const SOURCES = [
  [path.join(ROOT, "artifacts"), ["validation-summary.json", "validation-report.md", "decision-results.csv", "rule-analytics.csv", "fairness-results.csv", "reconciliation-results.csv", "distribution-tests.csv", "correlation-results.csv", "network-results.csv", "benchmark-manifest.json"]],
  // The credit PD model's committed snapshot (analytics/src/case_analytics/credit/), read by the Credit model tab.
  [path.join(ROOT, "artifacts", "credit-model-snapshot"), ["credit-model-summary.json", "credit-model-cases.json"]],
  [path.join(ROOT, "analytics", "artifacts"), ["model-summary.json", "model-comparison.md", "validation-package.md", "threshold-economics.csv", "fairness-report.json", "monitoring-report.json", "registry.json", "pr_curves.png", "calibration.png", "pdp.png", "shap_summary_random_forest.png", "shap_summary_gradient_boosting.png", "shap_summary_logistic_regression.png"], SNAPSHOT]
];

fs.mkdirSync(DEST, { recursive: true });
if (fs.existsSync(MARKER)) fs.rmSync(MARKER);
let copied = 0, missing = 0;
const fromSnapshot = [];
for (const [dir, files, fallback] of SOURCES) {
  for (const f of files) {
    let src = path.join(dir, f);
    if (!fs.existsSync(src) && fallback && fs.existsSync(path.join(fallback, f))) {
      src = path.join(fallback, f);
      fromSnapshot.push(f);
    }
    if (!fs.existsSync(src)) { missing++; continue; }
    fs.copyFileSync(src, path.join(DEST, f));
    copied++;
  }
}
if (fromSnapshot.length) {
  const snapshot = JSON.parse(fs.readFileSync(path.join(SNAPSHOT, "SNAPSHOT.json"), "utf8"));
  fs.writeFileSync(MARKER, JSON.stringify({ generated_at: snapshot.generated_at, generator_commit: snapshot.generator_commit, files: fromSnapshot }, null, 2));
}
console.log(`Demo assets: ${copied} copied (${fromSnapshot.length} from the committed model snapshot), ${missing} not present (run npm run benchmark and the analytics pipeline to populate).`);

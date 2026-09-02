// src/api/services/models.js — Bridge to the Python model registry and pipeline.
//
// Training runs the Python pipeline as a background job (python -m case_analytics.pipeline).
// Registry, evaluations and validation packages are read from analytics/artifacts. When the
// Python layer is absent the API degrades gracefully: the rule baseline remains available.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { extractDecisionFeatures } from "../../ml/decision_features.js";
import { runFraudRules, extractDecisionView } from "../../decisioning/index.js";
import { alertsToScore } from "../../evaluation/economics/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ANALYTICS = path.join(ROOT, "analytics");
const ARTIFACTS = path.join(ANALYTICS, "artifacts");

export function readJsonIfExists(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
export function readTextIfExists(p) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } }

export function modelSummary() { return readJsonIfExists(path.join(ARTIFACTS, "model-summary.json")); }
export function registry() { return readJsonIfExists(path.join(ARTIFACTS, "registry.json")); }

/** Rules baseline is always available as a model-like scorer. */
export const RULES_BASELINE = { id: "rules-baseline", name: "Underwriting rules baseline", strategy: "rules", version: "1.3.0", backend: "javascript", state: "PRODUCTION" };

export function listModels() {
  const s = modelSummary();
  const models = [RULES_BASELINE];
  if (s?.models) for (const m of s.models) models.push({ id: m.model ?? m.name, name: m.model ?? m.name, strategy: m.strategy ?? m.model, version: m.version, backend: m.backend, state: m.state ?? "VALIDATED", threshold: m.threshold, test: m.test, out_of_time: m.out_of_time, champion: s.champion?.model === (m.model ?? m.name) });
  return { champion: s?.champion?.model ?? RULES_BASELINE.id, models, python_layer_available: !!s };
}

export function getModel(id) {
  return listModels().models.find(m => m.id === id) ?? null;
}

/**
 * Score a case with a named model. The JS process cannot run the Python estimators, so
 * non-rule models are scored through the pipeline's exported scorer when present
 * (analytics/artifacts/scorer.json holds logistic-regression coefficients); tree models fall
 * back to the rules score with a note.
 */
export async function modelScoreForCase(c, modelId) {
  const model = getModel(modelId);
  if (!model) { const e = new Error(`Unknown model ${modelId}`); e.status = 404; throw e; }
  const { features } = extractDecisionFeatures(c);
  if (model.strategy === "rules" || model.id === "rules-baseline") {
    const { alerts } = runFraudRules(extractDecisionView(c));
    const score = alertsToScore(alerts);
    return { model_id: model.id, model_version: `${model.id}@${model.version}`, score, threshold: 0.39, predicted_fraud: score >= 0.39, scored_at: new Date().toISOString(), note: "Rule-severity score" };
  }
  const scorer = readJsonIfExists(path.join(ARTIFACTS, "scorer.json"));
  if (scorer && scorer.model === model.id && scorer.type === "logistic_regression") {
    let z = scorer.intercept;
    for (const [f, coef] of Object.entries(scorer.coefficients)) {
      const x = features[f] ?? 0;
      const mean = scorer.scaler_mean?.[f] ?? 0, scale = scorer.scaler_scale?.[f] ?? 1;
      z += coef * ((x - mean) / (scale || 1));
    }
    const score = 1 / (1 + Math.exp(-z));
    const contributions = Object.entries(scorer.coefficients).map(([f, coef]) => ({ feature: f, contribution: coef * (((features[f] ?? 0) - (scorer.scaler_mean?.[f] ?? 0)) / ((scorer.scaler_scale?.[f] ?? 1) || 1)) })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 8);
    return { model_id: model.id, model_version: `${model.id}@${model.version}`, score, threshold: model.threshold ?? 0.5, predicted_fraud: score >= (model.threshold ?? 0.5), top_contributions: contributions, scored_at: new Date().toISOString() };
  }
  const { alerts } = runFraudRules(extractDecisionView(c));
  const score = alertsToScore(alerts);
  return { model_id: model.id, model_version: `${model.id}@${model.version}`, score, threshold: model.threshold ?? 0.5, predicted_fraud: score >= (model.threshold ?? 0.5), scored_at: new Date().toISOString(), note: "Tree-model online scoring is not available in the JavaScript runtime; rule-severity score returned. Use the Python pipeline for batch scoring." };
}

const jobs = new Map();

export function startTrainingJob(req, { actor = "api" } = {}) {
  const id = `job-${crypto.randomUUID().slice(0, 8)}`;
  const job = { id, type: "TRAIN", status: "QUEUED", requested_by: actor, request: req, started_at: new Date().toISOString(), finished_at: null, log: [], exit_code: null };
  jobs.set(id, job);
  if (!fs.existsSync(path.join(ANALYTICS, "pyproject.toml"))) {
    job.status = "FAILED"; job.finished_at = new Date().toISOString(); job.log.push("Python analytics layer not present");
    return job;
  }
  const args = ["-m", "case_analytics.pipeline", "--data", "data", "--out", "artifacts"];
  if (req.quick) args.push("--quick");
  const child = spawn(process.env.PYTHON ?? "python", args, { cwd: ANALYTICS, env: { ...process.env, PYTHONPATH: path.join(ANALYTICS, "src") } });
  job.status = "RUNNING";
  child.stdout.on("data", d => { job.log.push(String(d)); if (job.log.length > 500) job.log.shift(); });
  child.stderr.on("data", d => { job.log.push(String(d)); if (job.log.length > 500) job.log.shift(); });
  child.on("error", e => { job.status = "FAILED"; job.finished_at = new Date().toISOString(); job.log.push(e.message); });
  child.on("close", code => { job.exit_code = code; job.status = code === 0 ? "COMPLETED" : "FAILED"; job.finished_at = new Date().toISOString(); });
  return job;
}

export function getJob(id) { return jobs.get(id) ?? null; }

export function evaluationReport(id) {
  // Well-known ids map to generated artifacts; anything else is looked up in the store by the controller.
  if (id === "benchmark-latest" || id === "benchmark") {
    const summary = readJsonIfExists(path.join(ROOT, "artifacts", "validation-summary.json"));
    const md = readTextIfExists(path.join(ROOT, "artifacts", "validation-report.md"));
    return summary ? { id: "benchmark-latest", subject_type: "BENCHMARK", subject_id: summary.manifest?.generator_commit ?? "working-tree", metrics: summary.headline, gates: summary.gates, manifest: summary.manifest, report_markdown: md } : null;
  }
  if (id === "model-validation-package" || id === "validation-package") {
    const md = readTextIfExists(path.join(ARTIFACTS, "validation-package.md"));
    const s = modelSummary();
    return md ? { id: "model-validation-package", subject_type: "MODEL_VERSION", subject_id: s?.champion?.model ?? null, metrics: s?.champion ?? {}, report_markdown: md } : null;
  }
  if (id === "model-comparison") {
    const md = readTextIfExists(path.join(ARTIFACTS, "model-comparison.md"));
    const s = modelSummary();
    return md ? { id: "model-comparison", subject_type: "MODEL_SUITE", subject_id: "champion-challenger", metrics: { champion: s?.champion, models: s?.models }, report_markdown: md } : null;
  }
  const s = modelSummary();
  const m = s?.models?.find(x => (x.model ?? x.name) === id);
  return m ? { id, subject_type: "MODEL_VERSION", subject_id: id, metrics: m, report_markdown: null } : null;
}

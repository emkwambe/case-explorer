import { parseOrThrow, TrainModelRequest, EvaluateModelRequest } from "../../contracts/index.js";
import { listModels, getModel, startTrainingJob, getJob, evaluationReport, modelSummary, registry } from "../services/models.js";

export function modelsController(store) {
  return {
    list(_req, res) { res.json(listModels()); },
    get(req, res) {
      const m = getModel(req.params.id);
      if (!m) return res.status(404).json({ error: "Model not found" });
      const reg = registry();
      const lifecycle = reg?.model_versions?.filter?.(v => v.model_id === m.id || v.model === m.id) ?? [];
      res.json({ ...m, lifecycle });
    },
    async train(req, res, next) {
      try {
        const body = parseOrThrow(TrainModelRequest, req.body ?? {}, "train request");
        const job = startTrainingJob(body, { actor: req.apiKeyId ?? "api" });
        await store.appendAudit({ event_type: "MODEL_REGISTERED", actor: req.apiKeyId ?? "api", payload: { job_id: job.id, strategies: body.strategies, status: job.status } });
        res.status(202).json({ job_id: job.id, status: job.status, poll: `/api/jobs/${job.id}` });
      } catch (e) { next(e); }
    },
    job(req, res) {
      const j = getJob(req.params.id);
      if (!j) return res.status(404).json({ error: "Job not found" });
      res.json({ ...j, log: j.log.slice(-40) });
    },
    async evaluate(req, res, next) {
      try {
        const body = parseOrThrow(EvaluateModelRequest, req.body ?? {}, "evaluate request");
        const m = getModel(req.params.id);
        if (!m) return res.status(404).json({ error: "Model not found" });
        const s = modelSummary();
        const entry = s?.models?.find(x => (x.model ?? x.name) === m.id);
        const metrics = m.id === "rules-baseline"
          ? { note: "Rule baseline is evaluated by npm run benchmark; see /api/evaluations/benchmark-latest/report", split: body.split }
          : (entry?.[body.split] ?? entry?.splits?.[body.split] ?? null);
        if (!metrics) return res.status(404).json({ error: `No evaluation for ${m.id} on split ${body.split}. Run POST /api/models/train first.` });
        const id = await store.saveEvaluation({ subject_type: "MODEL_VERSION", subject_id: m.id, split: body.split, metrics, evaluated_by: req.apiKeyId ?? "api" });
        await store.appendAudit({ event_type: "EVALUATION_RECORDED", actor: req.apiKeyId ?? "api", model_version: `${m.id}@${m.version}`, payload: { evaluation_id: id, split: body.split } });
        res.status(201).json({ evaluation_id: id, model_id: m.id, split: body.split, metrics, report: `/api/evaluations/${id}/report` });
      } catch (e) { next(e); }
    },
    async report(req, res, next) {
      try {
        const known = evaluationReport(req.params.id);
        const stored = known ?? await store.getEvaluation(req.params.id);
        if (!stored) return res.status(404).json({ error: "Evaluation not found" });
        if ((req.get("accept") || "").includes("text/markdown") && stored.report_markdown) { res.type("text/markdown").send(stored.report_markdown); return; }
        res.json(stored);
      } catch (e) { next(e); }
    },
    async listEvaluations(_req, res, next) { try { res.json({ evaluations: await store.listEvaluations(), well_known: ["benchmark-latest", "model-validation-package", "model-comparison"] }); } catch (e) { next(e); } }
  };
}

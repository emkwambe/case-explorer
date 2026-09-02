import { parseOrThrow, GenerateDatasetRequest } from "../../contracts/index.js";
import { generateDataset } from "../services/generation.js";
import { analyzeNetwork } from "../../analytics/network.js";
import { metrics } from "../../observability/metrics.js";

export function datasetsController(store) {
  return {
    async generate(req, res, next) {
      try {
        const body = parseOrThrow(GenerateDatasetRequest, req.body, "dataset request");
        let ds;
        try { ds = generateDataset(body, { requestedBy: req.apiKeyId ?? "api" }); metrics.recordGeneration(ds.cases.length); }
        catch (e) { metrics.recordGenerationFailure(); throw e; }
        await store.saveDataset(ds);
        await store.appendAudit({ event_type: "DATASET_GENERATED", actor: req.apiKeyId ?? "api", payload: { dataset_id: ds.id, record_count: ds.cases.length, seed: ds.manifest.seed, configuration_hash: ds.manifest.configuration_hash } });
        res.status(201).json({ id: ds.id, manifest: ds.manifest, case_ids: ds.cases.map(c => c.id), sample: ds.cases.slice(0, Math.min(5, ds.cases.length)) });
      } catch (e) { next(e); }
    },
    async list(_req, res, next) { try { res.json({ datasets: await store.listDatasets() }); } catch (e) { next(e); } },
    async get(req, res, next) {
      try {
        const ds = await store.getDataset(req.params.id);
        if (!ds) return res.status(404).json({ error: "Dataset not found" });
        res.json(ds);
      } catch (e) { next(e); }
    },
    async cases(req, res, next) {
      try {
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
        const ds = await store.getDataset(req.params.id);
        if (!ds) return res.status(404).json({ error: "Dataset not found" });
        res.json({ dataset_id: ds.id, limit, offset, total: ds.case_ids.length, cases: await store.listCases(ds.id, { limit, offset }) });
      } catch (e) { next(e); }
    },
    async network(req, res, next) {
      try {
        const ds = await store.getDataset(req.params.id);
        if (!ds) return res.status(404).json({ error: "Dataset not found" });
        const cases = await store.listCases(ds.id, { limit: 10000 });
        const { case_findings, ...analysis } = analyzeNetwork(cases);
        res.json({ dataset_id: ds.id, ...analysis, flagged_cases: Object.keys(case_findings).length });
      } catch (e) { next(e); }
    }
  };
}

import { z } from "zod";
import { parseOrThrow } from "../../contracts/index.js";
import { thresholdSweep, alertsToScore, DEFAULT_ASSUMPTIONS } from "../../evaluation/economics/index.js";
import { runFraudRules, extractDecisionView } from "../../decisioning/index.js";
import { isFraudCase } from "../../ml/decision_features.js";
import { describeRules, FRAUD_RULESET_VERSION } from "../../decisioning/fraud-rules/rules.js";
import { REASON_CODES, REASON_CODE_CATALOG_VERSION } from "../../decisioning/reason-codes/catalog.js";
import { exportPolicy } from "../../decisioning/policies/feature_policy.js";
import { modelScoreForCase } from "../services/models.js";

const SimulateRequest = z.object({
  dataset_id: z.string(),
  model_id: z.string().default("rules-baseline"),
  assumptions: z.object({
    fraud_prevalence: z.number().min(0).max(1).nullable().optional(),
    average_loss_given_fraud: z.number().min(0).max(1).optional(),
    average_loan_amount: z.number().positive().nullable().optional(),
    manual_review_cost: z.number().nonnegative().optional(),
    review_minutes_per_alert: z.number().positive().optional(),
    false_decline_cost: z.number().nonnegative().optional(),
    customer_friction_cost: z.number().nonnegative().optional(),
    model_operating_cost_per_case: z.number().nonnegative().optional(),
    investigation_capacity: z.number().int().positive().nullable().optional()
  }).default({})
});

export function analyticsController(store) {
  return {
    rules(_req, res) { res.json({ ruleset_version: FRAUD_RULESET_VERSION, rules: describeRules() }); },
    reasonCodes(_req, res) { res.json({ catalog_version: REASON_CODE_CATALOG_VERSION, codes: Object.values(REASON_CODES) }); },
    featurePolicy(_req, res) { res.json(exportPolicy()); },
    async simulate(req, res, next) {
      try {
        const body = parseOrThrow(SimulateRequest, req.body ?? {}, "simulation request");
        const ds = await store.getDataset(body.dataset_id);
        if (!ds) return res.status(404).json({ error: "Dataset not found" });
        const cases = await store.listCases(ds.id, { limit: 10000 });
        const scored = [];
        for (const c of cases) {
          const score = body.model_id === "rules-baseline" ? alertsToScore(runFraudRules(extractDecisionView(c)).alerts) : (await modelScoreForCase(c, body.model_id)).score;
          scored.push({ score, is_fraud: isFraudCase(c) ? 1 : 0, loan_amount: c.application.loan_amount });
        }
        const sweep = thresholdSweep(scored, body.assumptions);
        res.json({ dataset_id: ds.id, model_id: body.model_id, cases: scored.length, defaults: DEFAULT_ASSUMPTIONS, ...sweep });
      } catch (e) { next(e); }
    }
  };
}

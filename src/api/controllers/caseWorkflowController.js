import { parseOrThrow, ReviewAction, ScoreCaseRequest, GenerateCaseRequest } from "../../contracts/index.js";
import { scoreCase } from "../../decisioning/index.js";
import { openInvestigation, applyReviewAction, allowedActions } from "../../decisioning/investigation/workflow.js";
import { generateSingle, loadConfig } from "../services/generation.js";
import { modelScoreForCase } from "../services/models.js";
import { metrics } from "../../observability/metrics.js";

const CONFIG = loadConfig();

export function caseWorkflowController(store) {
  async function loadCase(req, res) {
    const c = await store.getCase(req.params.id);
    if (!c) { res.status(404).json({ error: "Case not found" }); return null; }
    return c;
  }
  return {
    async generate(req, res, next) {
      try {
        const body = parseOrThrow(GenerateCaseRequest, req.body ?? {}, "case request");
        const c = generateSingle(body);
        metrics.recordGeneration(1);
        await store.saveCase(c);
        res.json(c);
      } catch (e) { next(e); }
    },
    async get(req, res, next) { try { const c = await loadCase(req, res); if (c) res.json(c); } catch (e) { next(e); } },

    async score(req, res, next) {
      try {
        const body = parseOrThrow(ScoreCaseRequest, req.body ?? {}, "score request");
        const c = await loadCase(req, res); if (!c) return;
        const t0 = performance.now();
        const model = body.model_id ? await modelScoreForCase(c, body.model_id) : null;
        const record = scoreCase(c, CONFIG, model ? { modelVersion: model.model_version, modelScore: model.score } : {});
        if (model) record.model_output = model;
        metrics.recordScore(record, performance.now() - t0);
        const decisionId = await store.saveDecision(record);
        await store.appendAudit({ event_type: "CASE_SCORED", actor: req.apiKeyId ?? "api", case_version: c.id, policy_version: record.versions.policy, model_version: record.versions.model, payload: { decision_id: decisionId, alerts: record.alerts.length } });
        await store.appendAudit({ event_type: "DECISION_ISSUED", actor: "policy-engine", case_version: c.id, policy_version: record.versions.policy, model_version: record.versions.model, new_state: record.decision.outcome, payload: { decision_id: decisionId, reason_codes: record.decision.reason_codes } });
        res.status(201).json({ decision_id: decisionId, ...record });
      } catch (e) { next(e); }
    },

    async explanation(req, res, next) {
      try {
        const c = await loadCase(req, res); if (!c) return;
        let latest = await store.latestDecision(c.id);
        if (!latest) {
          const record = scoreCase(c, CONFIG);
          const decisionId = await store.saveDecision(record);
          await store.appendAudit({ event_type: "DECISION_ISSUED", actor: "policy-engine", case_version: c.id, policy_version: record.versions.policy, new_state: record.decision.outcome, payload: { decision_id: decisionId, reason_codes: record.decision.reason_codes } });
          latest = { id: decisionId, ...record };
        }
        res.json({ case_id: c.id, decision_id: latest.id, scored_at: latest.scored_at, versions: latest.versions, outcome: latest.decision.outcome, reason_codes: latest.decision.reason_codes, explanation: latest.explanation, model_output: latest.model_output ?? null });
      } catch (e) { next(e); }
    },

    async review(req, res, next) {
      try {
        const action = parseOrThrow(ReviewAction, req.body ?? {}, "review action");
        const c = await loadCase(req, res); if (!c) return;
        let inv = await store.getInvestigation(c.id);
        if (!inv) {
          let latest = await store.latestDecision(c.id);
          if (!latest) { const record = scoreCase(c, CONFIG); const id = await store.saveDecision(record); latest = { id, ...record }; }
          inv = openInvestigation(c, latest, { actor: action.actor, previousHash: await store.lastAuditHash() });
        }
        const prev = inv.state;
        const next_ = applyReviewAction(inv, action);
        await store.saveInvestigation(next_);
        await store.saveReviewAction(next_.investigation_id, action, prev, next_.state);
        await store.appendAuditEvents(next_.audit_events);
        metrics.recordReview(prev === "NEW" && next_.timeline.length === 2);
        metrics.recordAudit(1);
        res.status(201).json({ investigation: next_, allowed_actions: allowedActions(next_) });
      } catch (e) { next(e); }
    },

    async investigation(req, res, next) {
      try {
        const c = await loadCase(req, res); if (!c) return;
        const inv = await store.getInvestigation(c.id);
        if (!inv) return res.status(404).json({ error: "No investigation opened for this case. POST a review action to open one." });
        res.json({ investigation: inv, allowed_actions: allowedActions(inv) });
      } catch (e) { next(e); }
    },

    async audit(req, res, next) {
      try {
        const c = await loadCase(req, res); if (!c) return;
        const events = await store.auditForCase(c.id);
        res.json({ case_id: c.id, events, count: events.length });
      } catch (e) { next(e); }
    }
  };
}

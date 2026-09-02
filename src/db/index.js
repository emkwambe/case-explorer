// src/db/index.js — Storage abstraction: PostgreSQL when DATABASE_URL is set, in-memory otherwise.
//
// Both stores implement the same interface so the API, tests and seed scripts are storage-agnostic.
// Immutable entities (decisions, explanations, evaluations, audit events, dataset versions) are
// append-only in both implementations.

import crypto from "crypto";
import { createAuditEvent, verifyForest } from "../governance/audit.js";

export function newId(prefix) { return `${prefix}-${crypto.randomUUID()}`; }

// ── In-memory store ──────────────────────────────────────────────────────
export class MemoryStore {
  constructor() {
    this.kind = "memory";
    this.datasets = new Map(); this.datasetVersions = new Map(); this.cases = new Map(); this.caseDataset = new Map();
    this.models = new Map(); this.modelVersions = new Map(); this.evaluations = new Map();
    this.decisions = []; this.explanations = new Map(); this.investigations = new Map(); this.reviewActions = [];
    this.audit = []; this.jobs = new Map();
  }
  async init() { return this; }
  async close() {}

  async saveDataset({ id, name, manifest, cases }) {
    this.datasets.set(id, { id, name: name ?? id, created_at: manifest.generated_at });
    this.datasetVersions.set(id, { id, dataset_id: id, ...manifest });
    for (const c of cases) { this.cases.set(c.id, c); this.caseDataset.set(c.id, id); }
    return { id, record_count: cases.length };
  }
  async getDataset(id) {
    const v = this.datasetVersions.get(id);
    if (!v) return null;
    return { ...v, case_ids: [...this.caseDataset.entries()].filter(([, d]) => d === id).map(([c]) => c) };
  }
  async listDatasets() { return [...this.datasetVersions.values()].map(v => ({ id: v.id, population_regime: v.population_regime, record_count: v.record_count, seed: v.seed, generated_at: v.generated_at })); }
  async getCase(id) { return this.cases.get(id) ?? null; }
  async listCases(datasetId, { limit = 100, offset = 0 } = {}) {
    const ids = [...this.caseDataset.entries()].filter(([, d]) => d === datasetId).map(([c]) => c);
    return ids.slice(offset, offset + limit).map(id => this.cases.get(id));
  }
  async saveCase(c, datasetId = null) { this.cases.set(c.id, c); if (datasetId) this.caseDataset.set(c.id, datasetId); return c.id; }

  async saveDecision(record) {
    const id = newId("dec");
    const row = { id, ...record };
    this.decisions.push(row);
    this.explanations.set(id, record.explanation);
    return id;
  }
  async latestDecision(caseId) { return [...this.decisions].reverse().find(d => d.case_ref === caseId) ?? null; }
  async decisionsForCase(caseId) { return this.decisions.filter(d => d.case_ref === caseId); }

  async saveInvestigation(inv) { this.investigations.set(inv.case_ref, inv); return inv.investigation_id; }
  async getInvestigation(caseId) { return this.investigations.get(caseId) ?? null; }
  async saveReviewAction(investigationId, action, prevState, newState) { this.reviewActions.push({ id: newId("ra"), investigation_id: investigationId, ...action, previous_state: prevState, new_state: newState, created_at: new Date().toISOString() }); }

  async lastAuditHash() { return this.audit.length ? this.audit[this.audit.length - 1].hash : null; }
  async appendAudit(fields, opts) { const e = createAuditEvent(fields, await this.lastAuditHash(), opts); this.audit.push(e); return e; }
  async appendAuditEvents(events) { for (const e of events) if (!this.audit.some(x => x.event_id === e.event_id)) this.audit.push(e); }
  async auditForCase(caseVersion) { return this.audit.filter(e => e.case_version === caseVersion); }
  async verifyAudit() { return verifyForest(this.audit); }

  async upsertModel(model) { this.models.set(model.id, { ...(this.models.get(model.id) || {}), ...model }); return model.id; }
  async saveModelVersion(mv) { this.modelVersions.set(mv.id, mv); return mv.id; }
  async listModels() { return [...this.models.values()].map(m => ({ ...m, versions: [...this.modelVersions.values()].filter(v => v.model_id === m.id) })); }
  async getModel(id) { const m = this.models.get(id); return m ? { ...m, versions: [...this.modelVersions.values()].filter(v => v.model_id === id) } : null; }
  async saveEvaluation(ev) { const id = ev.id ?? newId("eval"); this.evaluations.set(id, { ...ev, id, created_at: new Date().toISOString() }); return id; }
  async getEvaluation(id) { return this.evaluations.get(id) ?? null; }
  async listEvaluations() { return [...this.evaluations.values()].map(({ report_markdown: _r, ...e }) => e); }

  async saveJob(job) { this.jobs.set(job.id, job); return job.id; }
  async getJob(id) { return this.jobs.get(id) ?? null; }
}

// ── PostgreSQL store ─────────────────────────────────────────────────────
export class PostgresStore {
  constructor(connectionString) {
    this.kind = "postgres";
    this.connectionString = connectionString;
    this.pool = null;
    this.memoryJobs = new Map();
  }
  async init() {
    const { default: pg } = await import("pg");
    this.pool = new pg.Pool({ connectionString: this.connectionString, max: 8 });
    await this.pool.query("SELECT 1");
    return this;
  }
  async close() { await this.pool?.end(); }
  q(text, params) { return this.pool.query(text, params); }

  async saveDataset({ id, name, manifest, cases }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO datasets (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [id, name ?? id]);
      await client.query(
        `INSERT INTO dataset_versions (id, dataset_id, dataset_version, generator_version, generator_commit, configuration_hash, seed, population_regime, as_of_date, record_count, manifest)
         VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, manifest.dataset_version, manifest.generator_version, manifest.generator_commit ?? null, manifest.configuration_hash, manifest.seed == null ? null : String(manifest.seed), manifest.population_regime, manifest.as_of_date ?? null, cases.length, manifest]);
      await client.query("INSERT INTO generation_runs (id, dataset_version_id, requested_by, request, finished_at) VALUES ($1,$2,$3,$4,now())", [newId("run"), id, manifest.requested_by ?? "api", manifest.request ?? {}]);
      for (let i = 0; i < cases.length; i += 200) {
        const chunk = cases.slice(i, i + 200);
        const values = [];
        const params = [];
        chunk.forEach((c, k) => {
          const b = k * 7;
          values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
          params.push(c.id, id, c.schema_version, c.meta.corruption_type, c.meta.severity, c.label.expected_outcome, c);
        });
        await client.query(`INSERT INTO cases (id, dataset_version_id, schema_version, corruption_type, severity, expected_outcome, body) VALUES ${values.join(",")} ON CONFLICT (id) DO NOTHING`, params);
      }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    return { id, record_count: cases.length };
  }
  async getDataset(id) {
    const r = await this.q("SELECT manifest FROM dataset_versions WHERE id = $1", [id]);
    if (!r.rows.length) return null;
    const ids = await this.q("SELECT id FROM cases WHERE dataset_version_id = $1 ORDER BY created_at, id", [id]);
    return { id, ...r.rows[0].manifest, case_ids: ids.rows.map(x => x.id) };
  }
  async listDatasets() {
    const r = await this.q("SELECT id, population_regime, record_count, seed, created_at FROM dataset_versions ORDER BY created_at DESC LIMIT 200");
    return r.rows.map(x => ({ id: x.id, population_regime: x.population_regime, record_count: x.record_count, seed: x.seed, generated_at: x.created_at }));
  }
  async getCase(id) { const r = await this.q("SELECT body FROM cases WHERE id = $1", [id]); return r.rows[0]?.body ?? null; }
  async listCases(datasetId, { limit = 100, offset = 0 } = {}) { const r = await this.q("SELECT body FROM cases WHERE dataset_version_id = $1 ORDER BY created_at, id LIMIT $2 OFFSET $3", [datasetId, limit, offset]); return r.rows.map(x => x.body); }
  async saveCase(c, datasetId = null) { await this.q("INSERT INTO cases (id, dataset_version_id, schema_version, corruption_type, severity, expected_outcome, body) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING", [c.id, datasetId, c.schema_version, c.meta.corruption_type, c.meta.severity, c.label.expected_outcome, c]); return c.id; }

  async saveDecision(record) {
    const id = newId("dec");
    await this.q(`INSERT INTO case_decisions (id, case_id, case_version, policy_version, ruleset_version, model_version, outcome, reason_codes, alerts, decision, scored_at) VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, record.case_ref, record.versions.policy, record.versions.ruleset, record.versions.model ?? null, record.decision.outcome, record.decision.reason_codes, JSON.stringify(record.alerts), record.decision, record.scored_at]);
    await this.q("INSERT INTO decision_explanations (id, decision_id, explanation) VALUES ($1,$2,$3)", [newId("expl"), id, record.explanation]);
    return id;
  }
  async latestDecision(caseId) {
    const r = await this.q(`SELECT d.id, d.case_id, d.policy_version, d.ruleset_version, d.model_version, d.alerts, d.decision, d.scored_at, e.explanation FROM case_decisions d JOIN decision_explanations e ON e.decision_id = d.id WHERE d.case_id = $1 ORDER BY d.scored_at DESC LIMIT 1`, [caseId]);
    const x = r.rows[0]; if (!x) return null;
    return { id: x.id, case_ref: x.case_id, scored_at: x.scored_at, versions: { policy: x.policy_version, ruleset: x.ruleset_version, model: x.model_version }, alerts: x.alerts, decision: x.decision, explanation: x.explanation };
  }
  async decisionsForCase(caseId) { const r = await this.q("SELECT id, outcome, reason_codes, policy_version, ruleset_version, model_version, scored_at FROM case_decisions WHERE case_id = $1 ORDER BY scored_at", [caseId]); return r.rows; }

  async saveInvestigation(inv) {
    await this.q(`INSERT INTO investigations (id, case_id, state, body, opened_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, body = EXCLUDED.body, updated_at = EXCLUDED.updated_at`,
      [inv.investigation_id, inv.case_ref, inv.state, inv, inv.opened_at, inv.updated_at]);
    return inv.investigation_id;
  }
  async getInvestigation(caseId) { const r = await this.q("SELECT body FROM investigations WHERE case_id = $1", [caseId]); return r.rows[0]?.body ?? null; }
  async saveReviewAction(investigationId, action, prevState, newState) { await this.q("INSERT INTO review_actions (id, investigation_id, action, actor, role, previous_state, new_state, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [newId("ra"), investigationId, action.action, action.actor, action.role ?? "INVESTIGATOR", prevState, newState, action]); }

  async lastAuditHash() { const r = await this.q("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1"); return r.rows[0]?.hash ?? null; }
  async appendAudit(fields, opts) { const e = createAuditEvent(fields, await this.lastAuditHash(), opts); await this.insertAudit(e); return e; }
  async insertAudit(e) {
    await this.q(`INSERT INTO audit_events (event_id, event_type, actor, ts, case_version, model_version, policy_version, previous_state, new_state, reason, payload, previous_hash, hash, body) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (event_id) DO NOTHING`,
      [e.event_id, e.event_type, e.actor, e.timestamp, e.case_version, e.model_version, e.policy_version, e.previous_state, e.new_state, e.reason, e.payload, e.previous_hash, e.hash, e]);
  }
  async appendAuditEvents(events) { for (const e of events) await this.insertAudit(e); }
  async auditForCase(caseVersion) { const r = await this.q("SELECT body FROM audit_events WHERE case_version = $1 ORDER BY seq", [caseVersion]); return r.rows.map(x => x.body); }
  async verifyAudit() {
    const r = await this.q("SELECT body FROM audit_events ORDER BY seq");
    return verifyForest(r.rows.map(x => x.body));
  }

  async upsertModel(model) { await this.q("INSERT INTO models (id, name, purpose, owner) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, purpose = EXCLUDED.purpose, owner = EXCLUDED.owner", [model.id, model.name, model.purpose ?? null, model.owner ?? null]); return model.id; }
  async saveModelVersion(mv) { await this.q(`INSERT INTO model_versions (id, model_id, version, strategy, backend, developer, feature_schema_version, dataset_version_id, training_manifest, state, threshold) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, threshold = EXCLUDED.threshold, training_manifest = EXCLUDED.training_manifest`, [mv.id, mv.model_id, mv.version, mv.strategy, mv.backend ?? null, mv.developer ?? null, mv.feature_schema_version ?? null, mv.dataset_version_id ?? null, mv.training_manifest ?? {}, mv.state ?? "DRAFT", mv.threshold ?? null]); return mv.id; }
  async listModels() { const m = await this.q("SELECT * FROM models ORDER BY created_at"); const v = await this.q("SELECT * FROM model_versions ORDER BY created_at"); return m.rows.map(x => ({ ...x, versions: v.rows.filter(y => y.model_id === x.id) })); }
  async getModel(id) { const m = await this.q("SELECT * FROM models WHERE id = $1", [id]); if (!m.rows.length) return null; const v = await this.q("SELECT * FROM model_versions WHERE model_id = $1 ORDER BY created_at", [id]); return { ...m.rows[0], versions: v.rows }; }
  async saveEvaluation(ev) { const id = ev.id ?? newId("eval"); await this.q("INSERT INTO evaluations (id, subject_type, subject_id, split, metrics, report_markdown, evaluated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING", [id, ev.subject_type, ev.subject_id, ev.split ?? null, ev.metrics, ev.report_markdown ?? null, ev.evaluated_by ?? null]); return id; }
  async getEvaluation(id) { const r = await this.q("SELECT * FROM evaluations WHERE id = $1", [id]); return r.rows[0] ?? null; }
  async listEvaluations() { const r = await this.q("SELECT id, subject_type, subject_id, split, evaluated_by, created_at FROM evaluations ORDER BY created_at DESC LIMIT 200"); return r.rows; }

  async saveJob(job) { this.memoryJobs.set(job.id, job); return job.id; }
  async getJob(id) { return this.memoryJobs.get(id) ?? null; }
}

let singleton = null;
export async function createStore({ connectionString = process.env.DATABASE_URL, fresh = false } = {}) {
  if (singleton && !fresh) return singleton;
  const store = connectionString ? new PostgresStore(connectionString) : new MemoryStore();
  await store.init();
  if (!fresh) singleton = store;
  return store;
}

// End-to-end API workflow: generate → score → explain → investigate → audit → economics → network.
// Runs against the in-memory store by default; set DATABASE_URL (with migrations applied) to run
// the same suite against PostgreSQL.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { createStore } from "../db/index.js";

const API_KEY = "test-key";
process.env.API_KEYS = API_KEY;
process.env.RATE_LIMIT_MAX_REQUESTS = "1000";

describe(`API workflow (${process.env.DATABASE_URL ? "postgres" : "memory"})`, () => {
  let app, store, datasetId, caseId;
  const auth = r => r.set("X-API-Key", API_KEY);

  beforeAll(async () => {
    store = await createStore({ fresh: true });
    app = createApp({ store });
  });
  afterAll(async () => { await store.close(); });

  it("serves OpenAPI and docs without auth", async () => {
    expect((await request(app).get("/api/openapi.yaml")).status).toBe(200);
    expect((await request(app).get("/api/docs")).status).toBe(200);
    const h = await request(app).get("/api/health/store");
    expect(h.body.store).toBe(process.env.DATABASE_URL ? "postgres" : "memory");
  });

  it("generates a manifested dataset with a population regime", async () => {
    const res = await auth(request(app).post("/api/datasets/generate")).send({ count: 40, seed: "wf-1", population_regime: "high_cost_markets", as_of_date: "2026-01-15" });
    expect(res.status).toBe(201);
    expect(res.body.manifest.population_regime).toBe("high_cost_markets");
    expect(res.body.manifest.configuration_hash).toMatch(/^sha256:/);
    expect(res.body.case_ids.length).toBe(40);
    datasetId = res.body.id;
    const ds = await auth(request(app).get(`/api/datasets/${datasetId}`));
    expect(ds.body.record_count).toBe(40);
    const page = await auth(request(app).get(`/api/datasets/${datasetId}/cases?limit=5`));
    expect(page.body.cases.length).toBe(5);
    expect(page.body.total).toBe(40);
    caseId = page.body.cases.find(c => c.label.expected_outcome === "DECLINE")?.id ?? page.body.cases[0].id;
  });

  it("rejects invalid requests with 400", async () => {
    const res = await auth(request(app).post("/api/datasets/generate")).send({ count: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/count/);
  });

  it("scores a case, issues an immutable decision and an explanation", async () => {
    const res = await auth(request(app).post(`/api/cases/${caseId}/score`)).send({});
    expect(res.status).toBe(201);
    expect(res.body.decision.outcome).toMatch(/APPROVE|MANUAL_REVIEW|DECLINE/);
    expect(res.body.versions.ruleset).toBeTruthy();
    const ex = await auth(request(app).get(`/api/cases/${caseId}/explanation`));
    expect(ex.status).toBe(200);
    expect(ex.body.explanation.which_versions_were_used.policy).toBeTruthy();
    expect(ex.body.explanation.automated_or_reviewed).toBeTruthy();
    const withModel = await auth(request(app).post(`/api/cases/${caseId}/score`)).send({ model_id: "rules-baseline" });
    expect(withModel.status).toBe(201);
    expect(withModel.body.model_output.score).toBeGreaterThanOrEqual(0);
  });

  it("runs an investigation with four-eyes approval and a verifiable audit trail", async () => {
    const act = (body) => auth(request(app).post(`/api/cases/${caseId}/review`)).send(body);
    let r = await act({ action: "TRIAGE", actor: "ana" });
    expect(r.status).toBe(201);
    expect(r.body.investigation.state).toBe("TRIAGED");
    r = await act({ action: "START_REVIEW", actor: "ana" });
    r = await act({ action: "CITE_EVIDENCE", actor: "ana", citations: [{ source: "BANK_STATEMENT", field: "checking_balance" }], note: "balance checked" });
    r = await act({ action: "CONFIRM", actor: "ana", reason: "material discrepancy confirmed" });
    expect(r.body.investigation.disposition.status).toBe("PROPOSED");
    r = await act({ action: "APPROVE_DISPOSITION", actor: "ana", role: "REVIEWER" });
    expect(r.status).toBe(403);
    r = await act({ action: "CLOSE", actor: "ana" });
    expect(r.status).toBe(409);
    r = await act({ action: "APPROVE_DISPOSITION", actor: "rev", role: "REVIEWER" });
    expect(r.status).toBe(201);
    r = await act({ action: "CLOSE", actor: "ana" });
    expect(r.body.investigation.state).toBe("CLOSED");
    const inv = await auth(request(app).get(`/api/cases/${caseId}/investigation`));
    expect(inv.body.investigation.timeline.length).toBeGreaterThanOrEqual(7);
    expect(JSON.stringify(inv.body)).not.toMatch(/SAR/);
    const audit = await auth(request(app).get(`/api/cases/${caseId}/audit`));
    expect(audit.body.count).toBeGreaterThanOrEqual(8);
    const types = audit.body.events.map(e => e.event_type);
    expect(types).toContain("DECISION_ISSUED");
    expect(types).toContain("DISPOSITION_APPROVED");
    const health = await request(app).get("/api/health/store");
    expect(health.body.audit_chain.valid).toBe(true);
  });

  it("exposes governed catalogs, economics and network analytics", async () => {
    expect((await auth(request(app).get("/api/rules"))).body.rules.length).toBeGreaterThanOrEqual(17);
    expect((await auth(request(app).get("/api/reason-codes"))).body.codes.length).toBeGreaterThan(20);
    expect((await auth(request(app).get("/api/feature-policy"))).body.prohibited_prefixes).toContain("truth_");
    const eco = await auth(request(app).post("/api/economics/simulate")).send({ dataset_id: datasetId, assumptions: { investigation_capacity: 5 } });
    expect(eco.status).toBe(200);
    expect(eco.body.rows.length).toBe(19);
    expect(eco.body.optimal_threshold).not.toBeNull();
    const net = await auth(request(app).get(`/api/datasets/${datasetId}/network`));
    expect(net.status).toBe(200);
    expect(net.body.summary).toHaveProperty("clusters");
    const models = await auth(request(app).get("/api/models"));
    expect(models.body.models[0].id).toBe("rules-baseline");
    const rep = await auth(request(app).get("/api/evaluations/benchmark-latest/report"));
    expect([200, 404]).toContain(rep.status);
  });
});

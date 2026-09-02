import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fc from "fast-check";
import { generateBlendedCase } from "../generator.js";
import { scoreCase } from "../decisioning/index.js";
import { validateCase, parseOrThrow, GenerateDatasetRequest, ReviewAction, ScoreRecord, AuditEvent } from "../contracts/index.js";
import { createAuditEvent, verifyChain, AuditLog } from "./audit.js";
import { openInvestigation, applyReviewAction, allowedActions, CASE_STATES, InvestigationError } from "../decisioning/investigation/workflow.js";
import { injectFraudRings } from "../simulation/rings.js";
import { analyzeNetwork, evaluateNetworkDetection, extractEntities } from "../analytics/network.js";
import { simulateThreshold, thresholdSweep, alertsToScore } from "../evaluation/economics/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "distribution_config.json"), "utf8"));
CONFIG.generation = { as_of_date: "2026-01-15" };
const CASES = Array.from({ length: 200 }, (_, i) => generateBlendedCase(i, CONFIG, "gov-42"));

describe("contracts", () => {
  it("every generated case satisfies the Case contract", () => {
    for (const c of CASES) {
      const r = validateCase(c);
      if (!r.success) throw new Error(JSON.stringify(r.error.issues.slice(0, 3)));
    }
  });
  it("score records and audit events satisfy their contracts", () => {
    const s = scoreCase(CASES[0], CONFIG);
    expect(ScoreRecord.safeParse(s).success).toBe(true);
    const e = createAuditEvent({ event_type: "CASE_SCORED", actor: "t", case_version: CASES[0].id });
    expect(AuditEvent.safeParse(e).success).toBe(true);
  });
  it("rejects invalid API payloads with a 400-style error", () => {
    expect(() => parseOrThrow(GenerateDatasetRequest, { count: 0 })).toThrow(/count/);
    expect(() => parseOrThrow(GenerateDatasetRequest, { count: 50000 })).toThrow();
    expect(parseOrThrow(GenerateDatasetRequest, { count: 5 }).adversarial).toBe(false);
    expect(() => parseOrThrow(ReviewAction, { action: "NUKE", actor: "x" })).toThrow();
  });
  it("property: any count in range parses and out of range fails", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 10000 }), n => GenerateDatasetRequest.safeParse({ count: n }).success));
    fc.assert(fc.property(fc.integer({ min: 10001, max: 1e9 }), n => !GenerateDatasetRequest.safeParse({ count: n }).success));
  });
});

describe("audit events", () => {
  it("chains hashes and detects tampering", () => {
    const log = new AuditLog();
    log.append({ event_type: "CASE_GENERATED", actor: "gen", case_version: "c1" }, { now: "2026-01-01T00:00:00Z" });
    log.append({ event_type: "DECISION_ISSUED", actor: "policy", case_version: "c1", new_state: "DECLINE" }, { now: "2026-01-01T00:00:01Z" });
    expect(log.verify().valid).toBe(true);
    const tampered = JSON.parse(JSON.stringify(log.events));
    tampered[0].actor = "someone-else";
    expect(verifyChain(tampered).valid).toBe(false);
    expect(verifyChain(tampered).broken_at).toBe(0);
  });
  it("events are frozen and require actor and known type", () => {
    const e = createAuditEvent({ event_type: "ESCALATED", actor: "a" });
    expect(Object.isFrozen(e)).toBe(true);
    expect(() => createAuditEvent({ event_type: "NOPE", actor: "a" })).toThrow();
    expect(() => createAuditEvent({ event_type: "ESCALATED" })).toThrow();
  });
});

describe("investigation workflow", () => {
  const c = CASES.find(x => x.label.expected_outcome === "DECLINE");
  const score = scoreCase(c, CONFIG);
  const step = (inv, action) => applyReviewAction(inv, { role: "INVESTIGATOR", ...action }, { now: "2026-01-16T00:00:00Z" });

  it("walks the happy path with four-eyes approval and a verifiable audit trail", () => {
    let inv = openInvestigation(c, score, { actor: "system", now: "2026-01-15T00:00:00Z" });
    expect(inv.state).toBe("NEW");
    inv = step(inv, { action: "TRIAGE", actor: "ana" });
    inv = step(inv, { action: "START_REVIEW", actor: "ana" });
    inv = step(inv, { action: "CITE_EVIDENCE", actor: "ana", citations: [{ source: "W2_DOCUMENT", field: "w2_wages" }] });
    inv = step(inv, { action: "REQUEST_INFORMATION", actor: "ana", note: "Please provide pay stubs" });
    expect(inv.state).toBe("INFORMATION_REQUESTED");
    inv = step(inv, { action: "RECEIVE_INFORMATION", actor: "ana", note: "received" });
    inv = step(inv, { action: "CONFIRM", actor: "ana", reason: "Income cannot be verified" });
    expect(inv.disposition.status).toBe("PROPOSED");
    expect(() => step(inv, { action: "CLOSE", actor: "ana" })).toThrow(InvestigationError);
    expect(() => step(inv, { action: "APPROVE_DISPOSITION", actor: "ana", role: "REVIEWER" })).toThrow(/Four-eyes/);
    inv = step(inv, { action: "APPROVE_DISPOSITION", actor: "rev", role: "REVIEWER" });
    inv = step(inv, { action: "CLOSE", actor: "ana" });
    expect(inv.state).toBe("CLOSED");
    expect(verifyChain(inv.audit_events).valid).toBe(true);
    expect(inv.audit_events.length).toBe(9);
    expect(inv.timeline.at(-1).to).toBe("CLOSED");
    expect(allowedActions(inv).map(a => a.action)).toEqual(["REOPEN"]);
  });
  it("never mutates the input and rejects illegal transitions", () => {
    const inv = openInvestigation(c, score, { actor: "system" });
    const next = step(inv, { action: "TRIAGE", actor: "ana" });
    expect(inv.state).toBe("NEW");
    expect(next.state).toBe("TRIAGED");
    expect(() => step(inv, { action: "CLOSE", actor: "ana" })).toThrow();
    expect(() => step(next, { action: "ESCALATE", actor: "ana" })).toThrow(/reason/);
    expect(JSON.stringify(inv)).not.toContain("SAR");
  });
  it("property: any legal action sequence keeps the chain valid and the state known", () => {
    const actionArb = fc.constantFrom("TRIAGE", "START_REVIEW", "ADD_NOTE", "REQUEST_INFORMATION", "RECEIVE_INFORMATION", "ESCALATE", "CLEAR", "CONFIRM", "APPROVE_DISPOSITION", "REJECT_DISPOSITION", "CLOSE", "REOPEN");
    fc.assert(fc.property(fc.array(actionArb, { maxLength: 15 }), seq => {
      let inv = openInvestigation(c, score, { actor: "system" });
      for (const action of seq) {
        const isReview = ["APPROVE_DISPOSITION", "REJECT_DISPOSITION"].includes(action);
        try { inv = step(inv, { action, actor: isReview ? "rev" : "ana", role: isReview ? "REVIEWER" : "INVESTIGATOR", reason: "r", note: "n" }); }
        catch (e) { if (!(e instanceof InvestigationError)) throw e; }
      }
      return CASE_STATES.includes(inv.state) && verifyChain(inv.audit_events).valid;
    }), { numRuns: 60 });
  });
});

describe("network analytics", () => {
  it("recovers injected rings without linking unrelated cases", () => {
    const pop = JSON.parse(JSON.stringify(CASES));
    const rings = injectFraudRings(pop, { seed: "t-rings", ringCount: 3 });
    expect(rings.length).toBe(3);
    const analysis = analyzeNetwork(pop);
    const ev = evaluateNetworkDetection(pop, analysis);
    expect(ev.ring_recall).toBeGreaterThanOrEqual(0.66);
    expect(ev.non_ring_false_positive_rate).toBeLessThanOrEqual(0.02);
    expect(analysis.case_findings[rings[0].members[0]]?.reason_code).toBe("SHARED_ENTITY_LINKAGE");
  });
  it("extracts device, ip, employer, address and document entities from visible layers only", () => {
    const ents = extractEntities(CASES[0]);
    const types = new Set(ents.map(e => e.type));
    expect(types.has("DEVICE") && types.has("IP") && types.has("EMPLOYER") && types.has("DOCUMENT")).toBe(true);
    expect(JSON.stringify(ents)).not.toContain("truth");
  });
});

describe("decision economics", () => {
  const scored = CASES.map(c => { const s = scoreCase(c, CONFIG); return { score: alertsToScore(s.alerts), is_fraud: ["NONE", "INCOHERENT"].includes(c.meta.corruption_type) ? 0 : 1, loan_amount: c.application.loan_amount }; });
  it("accounts add up and capacity caps review hours", () => {
    const r = simulateThreshold(scored, 0.3, { investigation_capacity: 10, review_minutes_per_alert: 60 });
    expect(r.alerts).toBeCloseTo(r.fraud_captured + r.false_positives + (r.capacity_exceeded ? r.alerts - 10 : 0), 0);
    expect(r.review_hours).toBeLessThanOrEqual(10);
    expect(r.net_expected_benefit).toBe(r.fraud_loss_avoided - r.review_cost - r.customer_friction_cost - r.false_decline_cost - r.model_operating_cost);
  });
  it("a sweep picks the EV-optimal threshold and reweights prevalence", () => {
    const sw = thresholdSweep(scored, { fraud_prevalence: 0.02 });
    expect(sw.rows.length).toBe(19);
    expect(sw.optimal.net_expected_benefit).toBe(Math.max(...sw.rows.map(r => r.net_expected_benefit)));
    const total = sw.rows[0].fraud_captured + sw.rows[0].fraud_missed;
    expect(total / scored.length).toBeCloseTo(0.02, 1);
  });
  it("property: captured + missed fraud is constant across thresholds", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), t => {
      const r = simulateThreshold(scored, t);
      const fraud = scored.filter(s => s.is_fraud).length;
      return Math.abs(r.fraud_captured + r.fraud_missed - fraud) < 1e-6;
    }));
  });
});

// Audit events are the evidence a model-risk or audit function reads, so every field and
// every tamper-detection path is asserted directly.

import { describe, it, expect } from "vitest";
import { createAuditEvent, hashEvent, verifyChain, verifyForest, AuditLog, AUDIT_EVENT_TYPES, AUDIT_SCHEMA_VERSION } from "./audit.js";

const base = { event_type: "DECISION_ISSUED", actor: "policy-engine", case_version: "case-1" };
const at = (n) => `2026-01-0${n}T00:00:00.000Z`;

describe("audit event shape", () => {
  it("carries every governance field with explicit nulls for what is absent", () => {
    const e = createAuditEvent(base, null, { now: at(1), id: "evt-1" });
    expect(e.schema_version).toBe(AUDIT_SCHEMA_VERSION);
    expect(e.event_id).toBe("evt-1");
    expect(e.event_type).toBe("DECISION_ISSUED");
    expect(e.actor).toBe("policy-engine");
    expect(e.timestamp).toBe(at(1));
    expect(e.case_version).toBe("case-1");
    expect(e.model_version).toBeNull();
    expect(e.policy_version).toBeNull();
    expect(e.previous_state).toBeNull();
    expect(e.new_state).toBeNull();
    expect(e.reason).toBeNull();
    expect(e.payload).toEqual({});
    expect(e.previous_hash).toBeNull();
    expect(e.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("preserves supplied governance fields", () => {
    const e = createAuditEvent({
      ...base, event_type: "INVESTIGATION_STATE_CHANGED", model_version: "rf@1.0.0", policy_version: "2.1.0",
      previous_state: "TRIAGED", new_state: "IN_REVIEW", reason: "escalated", payload: { k: 1 }
    }, "sha256:prev", { now: at(2) });
    expect(e.model_version).toBe("rf@1.0.0");
    expect(e.policy_version).toBe("2.1.0");
    expect(e.previous_state).toBe("TRIAGED");
    expect(e.new_state).toBe("IN_REVIEW");
    expect(e.reason).toBe("escalated");
    expect(e.payload).toEqual({ k: 1 });
    expect(e.previous_hash).toBe("sha256:prev");
  });

  it("is frozen so it cannot be edited in place", () => {
    const e = createAuditEvent(base, null, { now: at(1) });
    expect(Object.isFrozen(e)).toBe(true);
    expect(() => { "use strict"; e.actor = "someone"; }).toThrow();
  });

  it("rejects an unknown event type and a missing actor", () => {
    expect(() => createAuditEvent({ ...base, event_type: "NOT_A_TYPE" })).toThrow(/Unknown audit event type/);
    expect(() => createAuditEvent({ event_type: "ESCALATED" })).toThrow(/actor/);
    expect(() => createAuditEvent({ event_type: "ESCALATED", actor: "" })).toThrow(/actor/);
  });

  it("covers the event types the system actually emits", () => {
    for (const t of ["CASE_GENERATED", "CASE_SCORED", "DECISION_ISSUED", "DECISION_REVIEWED", "INVESTIGATION_OPENED",
      "INVESTIGATION_STATE_CHANGED", "INVESTIGATION_NOTE_ADDED", "EVIDENCE_CITED", "INFORMATION_REQUESTED",
      "INFORMATION_RECEIVED", "ESCALATED", "DISPOSITION_PROPOSED", "DISPOSITION_APPROVED", "DISPOSITION_REJECTED",
      "MODEL_REGISTERED", "MODEL_STATE_CHANGED", "SEGREGATION_OVERRIDE", "POLICY_VERSION_CHANGED",
      "DATASET_GENERATED", "EVALUATION_RECORDED"]) {
      expect(AUDIT_EVENT_TYPES, `${t} must be a known event type`).toContain(t);
      expect(() => createAuditEvent({ event_type: t, actor: "a" })).not.toThrow();
    }
  });

  it("hashes content, so any changed field changes the hash", () => {
    const e = createAuditEvent(base, null, { now: at(1), id: "evt-1" });
    const { hash, ...rest } = e;
    expect(hashEvent(rest)).toBe(hash);
    for (const field of ["event_type", "actor", "timestamp", "case_version", "reason", "new_state"]) {
      const altered = { ...rest, [field]: field === "event_type" ? "ESCALATED" : "changed" };
      expect(hashEvent(altered), `changing ${field} must change the hash`).not.toBe(hash);
    }
    expect(hashEvent({ ...rest, payload: { x: 1 } })).not.toBe(hash);
  });
});

describe("chain verification", () => {
  const chain = () => {
    const log = new AuditLog();
    log.append({ ...base, event_type: "CASE_GENERATED" }, { now: at(1) });
    log.append(base, { now: at(2) });
    log.append({ ...base, event_type: "ESCALATED", reason: "r" }, { now: at(3) });
    return log;
  };

  it("accepts an untouched chain and links each event to the previous", () => {
    const log = chain();
    expect(log.verify().valid).toBe(true);
    expect(log.events[0].previous_hash).toBeNull();
    expect(log.events[1].previous_hash).toBe(log.events[0].hash);
    expect(log.events[2].previous_hash).toBe(log.events[1].hash);
    expect(log.lastHash).toBe(log.events[2].hash);
  });

  it("detects edited content at the exact index", () => {
    const events = JSON.parse(JSON.stringify(chain().events));
    events[1].reason = "tampered";
    const r = verifyChain(events);
    expect(r.valid).toBe(false);
    expect(r.broken_at).toBe(1);
    expect(r.reason).toMatch(/hash mismatch/);
  });

  it("detects a removed event, which breaks the link", () => {
    const events = JSON.parse(JSON.stringify(chain().events));
    events.splice(1, 1);
    const r = verifyChain(events);
    expect(r.valid).toBe(false);
    expect(r.broken_at).toBe(1);
    expect(r.reason).toMatch(/previous_hash/);
  });

  it("detects a reordered chain", () => {
    const events = JSON.parse(JSON.stringify(chain().events));
    const r = verifyChain([events[1], events[0], events[2]]);
    expect(r.valid).toBe(false);
    expect(r.broken_at).toBe(0);
  });

  it("accepts an empty chain", () => {
    expect(verifyChain([]).valid).toBe(true);
    expect(verifyChain([]).broken_at).toBeNull();
  });

  it("verifyForest allows branches but still rejects tampering and dangling links", () => {
    const root = createAuditEvent({ ...base, event_type: "CASE_GENERATED" }, null, { now: at(1) });
    const branchA = createAuditEvent(base, root.hash, { now: at(2) });
    const branchB = createAuditEvent({ ...base, event_type: "ESCALATED", reason: "other branch" }, root.hash, { now: at(3) });
    const forest = [root, branchA, branchB];
    expect(verifyForest(forest).valid).toBe(true);
    expect(verifyForest(forest).events).toBe(3);
    // A linear check would reject the branch; the forest check accepts it.
    expect(verifyChain(forest).valid).toBe(false);

    const tampered = JSON.parse(JSON.stringify(forest));
    tampered[2].actor = "someone-else";
    expect(verifyForest(tampered).valid).toBe(false);
    expect(verifyForest(tampered).broken_at).toBe(2);

    const dangling = [createAuditEvent(base, "sha256:nothing", { now: at(4) })];
    const r = verifyForest(dangling);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/previous_hash/);
  });
});

describe("AuditLog", () => {
  it("filters by case and starts from a null hash", () => {
    const log = new AuditLog();
    expect(log.lastHash).toBeNull();
    log.append({ ...base, case_version: "case-1" }, { now: at(1) });
    log.append({ ...base, case_version: "case-2" }, { now: at(2) });
    log.append({ ...base, case_version: "case-1" }, { now: at(3) });
    expect(log.forCase("case-1").length).toBe(2);
    expect(log.forCase("case-2").length).toBe(1);
    expect(log.forCase("case-3")).toEqual([]);
    expect(log.toJSON().length).toBe(3);
    expect(log.verify().valid).toBe(true);
  });
});

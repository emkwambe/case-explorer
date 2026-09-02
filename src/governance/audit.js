// src/governance/audit.js — Immutable, hash-chained audit events.
//
// Every consequential event (decision, review action, state change, model lifecycle change)
// is captured as an append-only event. Each event carries the hash of the previous event so
// tampering with history is detectable. Persistence is delegated to a repository (in-memory
// or PostgreSQL); this module owns the event shape and the chain.

import crypto from "crypto";

export const AUDIT_SCHEMA_VERSION = "1.0.0";

export const AUDIT_EVENT_TYPES = Object.freeze([
  "CASE_GENERATED", "CASE_SCORED", "DECISION_ISSUED", "DECISION_REVIEWED",
  "INVESTIGATION_OPENED", "INVESTIGATION_STATE_CHANGED", "INVESTIGATION_NOTE_ADDED", "EVIDENCE_CITED",
  "INFORMATION_REQUESTED", "INFORMATION_RECEIVED", "ESCALATED", "DISPOSITION_PROPOSED", "DISPOSITION_APPROVED", "DISPOSITION_REJECTED",
  "MODEL_REGISTERED", "MODEL_STATE_CHANGED", "SEGREGATION_OVERRIDE", "POLICY_VERSION_CHANGED", "DATASET_GENERATED", "EVALUATION_RECORDED"
]);

/**
 * Deterministic serialisation with recursively sorted object keys.
 *
 * A replacer array cannot be used here: JSON.stringify applies it at every depth, so nested
 * payload keys would be stripped and their contents left outside the hash. The whole event,
 * payload included, must be covered or tampering inside a payload would be undetectable.
 */
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

export function hashEvent(eventWithoutHash) {
  return "sha256:" + crypto.createHash("sha256").update(canonical(eventWithoutHash)).digest("hex");
}

/**
 * Build an audit event linked to the previous one.
 * @param {object} fields  { event_type, actor, case_version?, model_version?, policy_version?, previous_state?, new_state?, reason?, payload? }
 * @param {string|null} previousHash
 * @param {object} opts    { now?: string, id?: string }
 */
export function createAuditEvent(fields, previousHash = null, { now, id } = {}) {
  if (!AUDIT_EVENT_TYPES.includes(fields.event_type)) throw new Error(`Unknown audit event type ${fields.event_type}`);
  if (!fields.actor) throw new Error("Audit event requires an actor");
  const base = {
    schema_version: AUDIT_SCHEMA_VERSION,
    event_id: id ?? crypto.randomUUID(),
    event_type: fields.event_type,
    actor: fields.actor,
    timestamp: now ?? new Date().toISOString(),
    case_version: fields.case_version ?? null,
    model_version: fields.model_version ?? null,
    policy_version: fields.policy_version ?? null,
    previous_state: fields.previous_state ?? null,
    new_state: fields.new_state ?? null,
    reason: fields.reason ?? null,
    payload: fields.payload ?? {},
    previous_hash: previousHash
  };
  return Object.freeze({ ...base, hash: hashEvent(base) });
}

/** Verify a chain of events in order. Returns { valid, broken_at }. */
export function verifyChain(events) {
  let prev = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const { hash, ...rest } = e;
    if (e.previous_hash !== prev) return { valid: false, broken_at: i, reason: "previous_hash mismatch" };
    if (hashEvent(rest) !== hash) return { valid: false, broken_at: i, reason: "hash mismatch" };
    prev = hash;
  }
  return { valid: true, broken_at: null };
}

/**
 * Verify a hash forest: events are appended in order, each must hash correctly and its
 * previous_hash must reference an earlier event (or null for a root). Investigation sub-chains
 * branch off the global chain, so a strict single linear chain is not required.
 */
export function verifyForest(events) {
  const seen = new Set();
  for (let i = 0; i < events.length; i++) {
    const { hash, ...rest } = events[i];
    if (hashEvent(rest) !== hash) return { valid: false, broken_at: i, reason: "hash mismatch (content altered)" };
    if (events[i].previous_hash !== null && !seen.has(events[i].previous_hash)) return { valid: false, broken_at: i, reason: "previous_hash does not reference an earlier event" };
    seen.add(hash);
  }
  return { valid: true, broken_at: null, events: events.length };
}

/** In-memory append-only log used by tests and the API when no database is configured. */
export class AuditLog {
  constructor() { this.events = []; }
  get lastHash() { return this.events.length ? this.events[this.events.length - 1].hash : null; }
  append(fields, opts) {
    const e = createAuditEvent(fields, this.lastHash, opts);
    this.events.push(e);
    return e;
  }
  forCase(caseVersion) { return this.events.filter(e => e.case_version === caseVersion); }
  verify() { return verifyChain(this.events); }
  toJSON() { return this.events; }
}

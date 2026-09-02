// src/decisioning/investigation/workflow.js — Case investigation workflow.
//
// States: NEW → TRIAGED → IN_REVIEW → (INFORMATION_REQUESTED ⇄ IN_REVIEW) → (ESCALATED) → CLEARED | CONFIRMED → CLOSED
// Every transition and note produces an immutable audit event. Dispositions proposed by an
// investigator require approval by a different actor with the REVIEWER role (four-eyes).
// Simulated cases are never labelled "SAR-ready": that determination is a regulated, human,
// confidential process outside this system.

import { createAuditEvent } from "../../governance/audit.js";
import { REASON_CODES } from "../reason-codes/catalog.js";

export const INVESTIGATION_WORKFLOW_VERSION = "1.0.0";
export const CASE_STATES = Object.freeze(["NEW", "TRIAGED", "IN_REVIEW", "INFORMATION_REQUESTED", "ESCALATED", "CLEARED", "CONFIRMED", "CLOSED"]);

const TRANSITIONS = Object.freeze({
  TRIAGE: { from: ["NEW"], to: "TRIAGED", event: "INVESTIGATION_STATE_CHANGED" },
  START_REVIEW: { from: ["TRIAGED", "INFORMATION_REQUESTED", "ESCALATED"], to: "IN_REVIEW", event: "INVESTIGATION_STATE_CHANGED" },
  REQUEST_INFORMATION: { from: ["IN_REVIEW", "ESCALATED"], to: "INFORMATION_REQUESTED", event: "INFORMATION_REQUESTED" },
  RECEIVE_INFORMATION: { from: ["INFORMATION_REQUESTED"], to: "IN_REVIEW", event: "INFORMATION_RECEIVED" },
  ESCALATE: { from: ["IN_REVIEW", "TRIAGED"], to: "ESCALATED", event: "ESCALATED", requiresReason: true },
  CLEAR: { from: ["IN_REVIEW", "ESCALATED"], to: "CLEARED", event: "DISPOSITION_PROPOSED", proposes: "CLEARED" },
  CONFIRM: { from: ["IN_REVIEW", "ESCALATED"], to: "CONFIRMED", event: "DISPOSITION_PROPOSED", proposes: "CONFIRMED_MISREPRESENTATION", requiresReason: true },
  APPROVE_DISPOSITION: { from: ["CLEARED", "CONFIRMED"], to: null, event: "DISPOSITION_APPROVED", reviewerOnly: true },
  REJECT_DISPOSITION: { from: ["CLEARED", "CONFIRMED"], to: "IN_REVIEW", event: "DISPOSITION_REJECTED", reviewerOnly: true, requiresReason: true },
  CLOSE: { from: ["CLEARED", "CONFIRMED"], to: "CLOSED", event: "INVESTIGATION_STATE_CHANGED", requiresApprovedDisposition: true },
  REOPEN: { from: ["CLOSED"], to: "IN_REVIEW", event: "INVESTIGATION_STATE_CHANGED", requiresReason: true },
  ADD_NOTE: { from: CASE_STATES.filter(s => s !== "CLOSED"), to: null, event: "INVESTIGATION_NOTE_ADDED" },
  CITE_EVIDENCE: { from: CASE_STATES.filter(s => s !== "CLOSED"), to: null, event: "EVIDENCE_CITED" }
});

export class InvestigationError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

/**
 * Open an investigation for a scored case.
 * @param {object} c       generated case
 * @param {object} score   scoreCase() result (alerts, decision, explanation)
 * @param {object} opts    { actor, now, previousHash }
 */
export function openInvestigation(c, score, { actor = "system", now, previousHash = null } = {}) {
  const ts = now ?? new Date().toISOString();
  const findings = score.alerts.map(a => ({
    kind: "RULE", id: `${a.rule_id}@${a.rule_version}`, reason_code: a.reason_code,
    category: REASON_CODES[a.reason_code]?.category ?? null, severity: a.severity, detail: a.detail, evidence_citations: a.evidence_citations
  }));
  if (score.explanation?.which_versions_were_used?.model) {
    findings.push({ kind: "MODEL", id: score.explanation.which_versions_were_used.model, score: score.explanation.which_versions_were_used.model_score, detail: "Model score", evidence_citations: [] });
  }
  const opened = createAuditEvent({
    event_type: "INVESTIGATION_OPENED", actor, case_version: c.id, policy_version: score.versions.policy, model_version: score.versions.model,
    previous_state: null, new_state: "NEW", reason: `Opened from decision ${score.decision.outcome}`, payload: { outcome: score.decision.outcome, reason_codes: score.decision.reason_codes }
  }, previousHash, { now: ts });
  return {
    workflow_version: INVESTIGATION_WORKFLOW_VERSION,
    investigation_id: `inv-${c.id}`,
    case_ref: c.id,
    case_version: c.id,
    state: "NEW",
    opened_at: ts,
    updated_at: ts,
    automated_decision: { outcome: score.decision.outcome, pathway: score.decision.pathway, reason_codes: score.decision.reason_codes, versions: score.versions },
    findings,
    notes: [],
    citations: [],
    information_requests: [],
    escalation: null,
    disposition: null,
    timeline: [{ at: ts, actor, action: "OPEN", from: null, to: "NEW" }],
    audit_events: [opened]
  };
}

/**
 * Apply a review action. Returns a NEW investigation object (the input is never mutated)
 * with the audit event appended.
 * @param {object} inv     investigation
 * @param {object} action  validated ReviewAction { action, actor, role, note, citations, reason, disposition }
 * @param {object} opts    { now }
 */
export function applyReviewAction(inv, action, { now } = {}) {
  const rule = TRANSITIONS[action.action];
  if (!rule) throw new InvestigationError(`Unknown action ${action.action}`, 400);
  if (!rule.from.includes(inv.state)) throw new InvestigationError(`Action ${action.action} is not allowed in state ${inv.state}`);
  if (rule.requiresReason && !action.reason) throw new InvestigationError(`Action ${action.action} requires a reason`, 400);
  if (rule.reviewerOnly && action.role !== "REVIEWER") throw new InvestigationError(`Action ${action.action} requires the REVIEWER role`, 403);
  if (rule.reviewerOnly && inv.disposition?.proposed_by === action.actor) throw new InvestigationError("Four-eyes control: the proposer cannot approve or reject their own disposition", 403);
  if (rule.requiresApprovedDisposition && inv.disposition?.status !== "APPROVED") throw new InvestigationError("Cannot close: disposition has not been approved by a reviewer");
  if (action.action === "ADD_NOTE" && !action.note) throw new InvestigationError("ADD_NOTE requires a note", 400);
  if (action.action === "CITE_EVIDENCE" && !(action.citations?.length)) throw new InvestigationError("CITE_EVIDENCE requires at least one citation", 400);

  const ts = now ?? new Date().toISOString();
  const next = JSON.parse(JSON.stringify(inv));
  const prevState = inv.state;
  const newState = rule.to ?? inv.state;
  const previousHash = inv.audit_events.length ? inv.audit_events[inv.audit_events.length - 1].hash : null;

  switch (action.action) {
    case "ADD_NOTE": next.notes.push({ at: ts, actor: action.actor, note: action.note }); break;
    case "CITE_EVIDENCE": next.citations.push(...action.citations.map(ci => ({ ...ci, cited_by: action.actor, at: ts, note: action.note ?? null }))); break;
    case "REQUEST_INFORMATION": next.information_requests.push({ requested_at: ts, by: action.actor, request: action.note ?? action.reason ?? "Additional documentation", received_at: null }); break;
    case "RECEIVE_INFORMATION": { const open = next.information_requests.find(r => !r.received_at); if (open) { open.received_at = ts; open.response = action.note ?? null; } break; }
    case "ESCALATE": next.escalation = { at: ts, by: action.actor, reason: action.reason }; break;
    case "CLEAR":
    case "CONFIRM":
      next.disposition = { proposed: action.disposition ?? rule.proposes, proposed_by: action.actor, proposed_at: ts, rationale: action.reason ?? action.note ?? null, status: "PROPOSED", approved_by: null, approved_at: null };
      break;
    case "APPROVE_DISPOSITION": next.disposition = { ...next.disposition, status: "APPROVED", approved_by: action.actor, approved_at: ts, approval_note: action.note ?? null }; break;
    case "REJECT_DISPOSITION": next.disposition = { ...next.disposition, status: "REJECTED", rejected_by: action.actor, rejected_at: ts, rejection_reason: action.reason }; break;
    case "REOPEN": next.disposition = null; break;
    default: break;
  }

  next.state = newState;
  next.updated_at = ts;
  next.timeline.push({ at: ts, actor: action.actor, action: action.action, from: prevState, to: newState, reason: action.reason ?? null });
  next.audit_events.push(createAuditEvent({
    event_type: rule.event, actor: action.actor, case_version: inv.case_version,
    policy_version: inv.automated_decision.versions.policy, model_version: inv.automated_decision.versions.model,
    previous_state: prevState, new_state: newState, reason: action.reason ?? action.note ?? null,
    payload: { action: action.action, role: action.role, disposition: next.disposition?.proposed ?? null, citations: action.citations ?? [] }
  }, previousHash, { now: ts }));
  return next;
}

export function allowedActions(inv) {
  return Object.entries(TRANSITIONS).filter(([, r]) => r.from.includes(inv.state)).map(([name, r]) => ({ action: name, to: r.to ?? inv.state, reviewer_only: !!r.reviewerOnly, requires_reason: !!r.requiresReason }));
}

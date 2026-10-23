// src/challenge/score.js — The challenge-mode rubric: a pure, deterministic function of a teaching
// case and a learner's attempt. No React, browser or LLM dependency. docs/SCORING.md explains every
// line with worked examples.
//
// 100 points: decision 50 (from the matrix), reason codes 30, evidence 20. Passed at 70 or more.
// The learner is scored against the teaching answer (`expected`), never against the engine.

import { keyEvidence, evidenceLabel } from "./evidence.js";

export const DECISIONS = Object.freeze(["APPROVE", "REVIEW", "DECLINE"]);

/** Decision points: rows are the expected decision, columns the learner's. */
export const DECISION_POINTS = Object.freeze({
  APPROVE: Object.freeze({ APPROVE: 50, REVIEW: 20, DECLINE: 0 }),
  REVIEW: Object.freeze({ APPROVE: 0, REVIEW: 50, DECLINE: 20 }),
  DECLINE: Object.freeze({ APPROVE: 0, REVIEW: 25, DECLINE: 50 })
});

export const REASON_POINTS = 30;
export const EXTRA_CODE_PENALTY = 10;
export const EVIDENCE_POINTS = 20;
export const PASS_MARK = 70;

const title = (d) => d.charAt(0) + d.slice(1).toLowerCase();

/**
 * attempt: { decision: "APPROVE" | "REVIEW" | "DECLINE", reasonCodes: string[], evidence: item id }.
 * Returns { total, passed, decisionCorrect, parts: { decision, reasons, evidence }, explanation }.
 */
export function scoreAttempt(teachingCase, attempt) {
  const expected = teachingCase.expected;
  if (!DECISIONS.includes(attempt?.decision)) throw new Error(`scoreAttempt: unknown decision ${attempt?.decision}`);

  // Decision: straight from the matrix.
  const decision = DECISION_POINTS[expected.decision][attempt.decision];

  // Reason codes: 30 × (required codes chosen ÷ required codes), minus 10 per chosen code that is
  // neither required nor acceptable, floored at 0. With no required codes, coverage is full.
  const required = expected.reason_codes, acceptable = expected.acceptable_codes ?? [];
  const chosen = [...new Set(attempt.reasonCodes ?? [])];
  const hits = chosen.filter((c) => required.includes(c));
  const extras = chosen.filter((c) => !required.includes(c) && !acceptable.includes(c));
  const missed = required.filter((c) => !chosen.includes(c));
  const coverage = required.length === 0 ? REASON_POINTS : (REASON_POINTS * hits.length) / required.length;
  const reasons = Math.max(0, coverage - EXTRA_CODE_PENALTY * extras.length);

  // Evidence: full points when the chosen item carries the case's deciding value.
  const keys = keyEvidence(teachingCase);
  const evidence = keys.includes(attempt.evidence) ? EVIDENCE_POINTS : 0;

  const total = decision + reasons + evidence;
  return {
    total, passed: total >= PASS_MARK, decisionCorrect: attempt.decision === expected.decision,
    parts: { decision, reasons, evidence },
    explanation: {
      decision: attempt.decision === expected.decision
        ? `${title(expected.decision)} is the expected decision: ${decision} of 50.`
        : `Expected ${title(expected.decision)}, chosen ${title(attempt.decision)}: ${decision} of 50.`,
      reasons: [
        required.length ? `${hits.length} of ${required.length} required code${required.length === 1 ? "" : "s"} chosen (${Math.round(coverage * 10) / 10} of 30)` : "No codes required (30 of 30)",
        missed.length ? `missed ${missed.join(", ")}` : null,
        extras.length ? `${extras.length} extra code${extras.length === 1 ? "" : "s"} (${extras.join(", ")}), −${EXTRA_CODE_PENALTY * extras.length}` : null,
        `${reasons} of 30.`
      ].filter(Boolean).join("; "),
      evidence: evidence
        ? `${evidenceLabel(attempt.evidence)} carries the deciding value: 20 of 20.`
        : `The deciding value is in ${keys.map(evidenceLabel).join(" or ")}: 0 of 20.`
    }
  };
}

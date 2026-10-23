// src/challenge/gaps.js — What kind of gap a teaching case is, derived from its two answers, never set
// by hand: "decision" when the engine decides differently from the teaching answer, "reasons" when it
// reaches the same decision with different reason codes.

export const GAP_KIND_TEXT = Object.freeze({
  decision: "Decision differs.",
  reasons: "Reasons differ: the engine reaches the right decision but can't name the cause; Reg B requires specific principal reasons for adverse action."
});

/** The gap kind of a teaching entry, or null when the teaching answer and the engine agree. */
export function gapKind(entry) {
  if (!entry.gap) return null;
  return entry.expected.decision !== entry.system.decision ? "decision" : "reasons";
}

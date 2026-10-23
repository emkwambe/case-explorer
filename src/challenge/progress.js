// src/challenge/progress.js — Challenge progress kept in the learner's browser.
//
// One localStorage key holds a versioned record of sessions and attempts. Every read and write is
// wrapped in try/catch: with storage unavailable (a private window, blocked site data) the mode still
// works, it just remembers nothing between visits. Attempts carry the teaching set's SHA-256; those
// made against another SHA are kept but marked and left out of current scores. Nothing identifying
// the learner is stored.

export const STORAGE_KEY = "case-explorer.challenge.v1";
export const SCHEMA = 1;

const empty = () => ({ schema: SCHEMA, sessions: [], attempts: [] });

/** The browser's localStorage, or null when it cannot be reached. */
export function browserStorage() {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** A progress store over a Storage-like object (getItem/setItem/removeItem), or none. */
export function createProgressStore(storage = browserStorage()) {
  let memory = empty();
  let available = Boolean(storage);
  const read = () => {
    if (!available) return memory;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : empty();
      return parsed?.schema === SCHEMA && Array.isArray(parsed.attempts) && Array.isArray(parsed.sessions) ? parsed : empty();
    } catch {
      available = false;
      return memory;
    }
  };
  const write = (record) => {
    memory = record;
    if (!available) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch {
      available = false;
    }
  };
  return {
    get available() { return available; },
    load: read,
    /** Add or replace a session (by id). */
    saveSession(session) { const r = read(); write({ ...r, sessions: [...r.sessions.filter((s) => s.id !== session.id), session] }); },
    /** Record one committed attempt. */
    addAttempt(attempt) { const r = read(); write({ ...r, attempts: [...r.attempts, attempt] }); },
    /** The stored record as JSON text, for the export download. */
    exportJson() { return `${JSON.stringify(read(), null, 2)}\n`; },
    /** Delete Case Explorer's challenge progress, and nothing else. */
    reset() {
      memory = empty();
      if (!available) return;
      try { storage.removeItem(STORAGE_KEY); } catch { available = false; }
    }
  };
}

/** Attempts split by whether they were answered against the current teaching set. */
export function splitBySha(record, sha) {
  const current = [], earlier = [];
  for (const a of record.attempts) (a.teachingSha === sha ? current : earlier).push(a);
  return { current, earlier };
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const stats = (as) => ({ attempted: as.length, passed: as.filter((a) => a.score.passed).length, meanScore: mean(as.map((a) => a.score.total)), decisionAccuracy: mean(as.map((a) => (a.score.decisionCorrect ? 1 : 0))) });

/**
 * Summary over current attempts: by difficulty tier and by pack (the latest attempt per case and pack
 * counts), packs started and completed, and the reason codes most often missed.
 */
export function summarize(record, data) {
  const { current, earlier } = splitBySha(record, data.teaching_sha256);
  const byCase = new Map(data.cases.map((e) => [e.id, e]));
  const latest = new Map();
  for (const a of current) if (byCase.has(a.caseId)) latest.set(`${a.pack}|${a.caseId}`, a);
  const as = [...latest.values()];
  const tiers = Object.fromEntries(["easy", "medium", "hard"].map((t) => [t, stats(as.filter((a) => byCase.get(a.caseId).difficulty === t))]));
  const packs = data.packs.map((p) => {
    const mine = as.filter((a) => a.pack === p.id);
    return { id: p.id, name: p.name, size: p.caseIds.length, ...stats(mine), started: mine.length > 0, completed: p.caseIds.every((id) => mine.some((a) => a.caseId === id)) };
  });
  const missed = {};
  for (const a of as) for (const c of byCase.get(a.caseId).expected.reason_codes) if (!a.answer.reasonCodes.includes(c)) missed[c] = (missed[c] ?? 0) + 1;
  return { tiers, packs, missedCodes: Object.entries(missed).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])), earlierCount: earlier.length };
}

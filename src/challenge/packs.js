// src/challenge/packs.js — Scenario packs and their seeded order. The pack contents are derived from
// the teaching set's own fields (scripts/challenge-docs.mjs writes them to packs.json with the set's
// SHA-256); this module holds the rules and the ordering, both pure.
//
// Order: a seeded shuffle, then rebuilt so that two cases from the same base (twins, or the near-
// threshold cases that share an applicant) are never next to each other. The full set runs easy →
// medium → hard, keeping the rule across tier boundaries.

import { createRng } from "../utils/prng.js";

export const TIERS = Object.freeze(["easy", "medium", "hard"]);

/** Pack rules over teaching-set entries; `all` is every entry, for rules that look across cases. */
export const PACK_RULES = Object.freeze([
  { id: "first-week", name: "First week", skill: "Reading an application against its evidence",
    description: "Easy cases only, as whole pairs: each clean approval with the fraud twin that one clear fact turns into a referral.",
    select: (e, all) => Boolean(e.pair) && all.filter((x) => x.pair === e.pair).every((x) => x.difficulty === "easy") },
  { id: "on-the-line", name: "On the line", skill: "Applying the policy's cut-offs exactly",
    description: "Cases one step either side of the credit score minimum, the debt-to-income watch line and cap, and the liquidity rule.",
    select: (e) => e.group === "near-threshold" },
  { id: "judgment-calls", name: "Judgment calls", skill: "Materiality: what changes the decision and what doesn't",
    description: "Conflicting signals and missing documents.",
    select: (e) => e.group === "conflicting" || e.group === "thin-evidence" },
  { id: "causal-pairs", name: "Causal pairs", skill: "Spotting the one fact that changes the outcome",
    description: "Clean and fraud twins, mixed: each pair differs in one fact.",
    select: (e) => e.group === "causal-pair" },
  { id: "engine-limits", name: "Where the engine is wrong", skill: "Knowing a system's limits",
    description: "Every case where the teaching answer and the credit policy differ, in the decision or in its reasons.",
    select: (e) => Boolean(e.gap) },
  { id: "full-set", name: "Full set", skill: "Assessment", description: "All cases, easy to hard.", select: () => true, tiered: true }
]);

/** The case ids of each pack, in teaching-file order. */
export function buildPacks(entries) {
  return PACK_RULES.map(({ select, ...p }) => ({ ...p, caseIds: entries.filter((e) => select(e, entries)).map((e) => e.id) }));
}

// Can `counts` (cases left per base) still be laid out with no base twice in a row, starting after `prev`?
function feasible(counts, prev) {
  let rem = 0;
  for (const c of counts.values()) rem += c;
  for (const [b, c] of counts) if (c > Math.ceil(rem / 2) || (b === prev && c > Math.floor(rem / 2))) return false;
  return true;
}

function orderGroup(items, rng, prev) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const counts = new Map();
  for (const it of pool) counts.set(it.base, (counts.get(it.base) ?? 0) + 1);
  if (!feasible(counts, prev)) throw new Error("orderPack: no order keeps same-base cases apart");
  const out = [];
  while (pool.length) {
    // The first shuffled item from another base that leaves the rest arrangeable.
    const k = pool.findIndex((it) => {
      if (it.base === prev) return false;
      counts.set(it.base, counts.get(it.base) - 1);
      const ok = feasible(counts, it.base);
      counts.set(it.base, counts.get(it.base) + 1);
      return ok;
    });
    const [it] = pool.splice(k, 1);
    counts.set(it.base, counts.get(it.base) - 1);
    out.push(it.id);
    prev = it.base;
  }
  return { ids: out, prev };
}

/**
 * A pack's order for one session. `entries` are teaching-set entries (id, base.case_id, difficulty);
 * the same pack and seed always give the same order.
 */
export function orderPack(pack, entries, seed) {
  if (seed === undefined || seed === null || seed === "") throw new Error("orderPack: a seed is required");
  const byId = new Map(entries.map((e) => [e.id, e]));
  const items = pack.caseIds.map((id) => ({ id, base: byId.get(id).base.case_id, difficulty: byId.get(id).difficulty }));
  const rng = createRng(`${pack.id}:${seed}`);
  if (!pack.tiered) return orderGroup(items, rng, null).ids;
  let prev = null;
  const out = [];
  for (const tier of TIERS) {
    const r = orderGroup(items.filter((i) => i.difficulty === tier), rng, prev);
    out.push(...r.ids);
    prev = r.prev;
  }
  return out;
}

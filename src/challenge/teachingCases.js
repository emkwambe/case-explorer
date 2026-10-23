// src/challenge/teachingCases.js — Rebuild a teaching case from its recipe: the seeded base case
// (profile, seed, index) and the recorded mutations, exactly as scripts/lib/teaching-set.mjs built
// it. The browser ships the recipes, not 79 case documents; npm run test:challenge checks that every
// rebuilt case hashes to the committed system.hash.

import { generateBlendedCase } from "../generator.js";
import { applyProfile, getProfile } from "../profiles/index.js";
import { applyMutations } from "../mutations.js";

/** The profile and config the teaching set was built under (`baseConfig` is distribution_config.json). */
export function teachingContext(data, baseConfig) {
  const profile = getProfile(data.profile);
  const config = applyProfile({ ...baseConfig, generation: { ...(baseConfig.generation || {}), as_of_date: data.as_of } }, profile);
  return { profile, config };
}

/** One teaching entry's case. */
export function buildTeachingCase(entry, data, ctx) {
  const base = generateBlendedCase(entry.base.index, ctx.config, data.seed);
  if (base.id !== entry.base.case_id) throw new Error(`teaching case ${entry.id}: base ${base.id} is not ${entry.base.case_id}`);
  return entry.mutations.length ? applyMutations(base, entry.mutations, ctx) : base;
}

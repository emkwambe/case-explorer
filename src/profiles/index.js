// src/profiles/index.js — Lender profile registry.
//
// A profile bundles everything lender-specific: its calibration preset, its public benchmarks,
// default inputs for the Dealer View and Funding & Rates tabs, and sourced case-study facts.
// Components read these from the active profile (see activeProfile.js) and never hard-code a
// real company, figure or source.

import { MORTGAGE_PROFILE } from "./mortgage.js";
import { SOLAR_PRIME_PROFILE } from "./solarPrime.js";

export const PROFILES = Object.freeze([MORTGAGE_PROFILE, SOLAR_PRIME_PROFILE]);
export const DEFAULT_PROFILE_ID = MORTGAGE_PROFILE.id;

export function getProfile(id, registry = PROFILES) {
  const profile = registry.find((p) => p.id === id);
  if (!profile) throw new Error(`Unknown lender profile: ${id}`);
  return profile;
}

/** True when the profile shows a solar loan instead of the generator's mortgage application. */
export function showsSolarLoan(profile) {
  return profile?.application?.kind === "SOLAR_LOAN";
}

/** URL form of a profile id: SOLAR_PRIME is "solar-prime". */
export function profileSlug(id) {
  return String(id).toLowerCase().replace(/_/g, "-");
}

/**
 * Profile id named by a `?profile=` query string (for example `?profile=solar-prime`), or null when
 * the parameter is absent or names no profile in the registry, so the default applies.
 */
export function profileIdFromSearch(search, registry = PROFILES) {
  let slug;
  try {
    slug = new URLSearchParams(search ?? "").get("profile");
  } catch {
    return null;
  }
  if (!slug) return null;
  const wanted = slug.trim().toLowerCase().replace(/_/g, "-");
  return registry.find((p) => profileSlug(p.id) === wanted)?.id ?? null;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(base, overrides) {
  const out = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Generator config for a profile (object or id): the defaults with its preset merged on top. */
export function applyProfile(config, profileOrId, registry = PROFILES) {
  const profile = typeof profileOrId === "string" ? getProfile(profileOrId, registry) : profileOrId;
  const overrides = profile?.preset?.overrides;
  return overrides ? deepMerge(config, overrides) : config;
}

/** Shape check used by tests and by the provider; returns a list of problems (empty when valid). */
export function profileProblems(p) {
  const problems = [];
  if (!p?.id || typeof p.id !== "string") problems.push("id must be a non-empty string");
  if (!p?.label) problems.push(`${p?.id}: label is required`);
  if (p?.preset !== null && !isPlainObject(p?.preset?.overrides)) problems.push(`${p?.id}: preset must be null or have overrides`);
  if (!Array.isArray(p?.benchmarks)) problems.push(`${p?.id}: benchmarks must be an array`);
  for (const b of p?.benchmarks ?? []) {
    if (!Number.isFinite(b.value) || !b.population || !b.source?.url) problems.push(`${p.id}/${b.id}: benchmark needs value, population and source.url`);
  }
  if (!isPlainObject(p?.defaults) || !("dealerView" in p.defaults) || !("fundingRates" in p.defaults)) problems.push(`${p?.id}: defaults needs dealerView and fundingRates (null allowed)`);
  if (!Array.isArray(p?.caseStudies)) problems.push(`${p?.id}: caseStudies must be an array`);
  for (const cs of p?.caseStudies ?? []) {
    for (const f of cs.facts ?? []) {
      if (!f.text || !f.date || !f.source?.url) problems.push(`${p.id}/${cs.id}: every fact needs text, date and source.url`);
    }
  }
  return problems;
}

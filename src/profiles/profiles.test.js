// Lender profile registry: every profile is well formed, presets apply, and real-company names
// live only in src/profiles/ so none can leak into the synthetic generator or the UI code.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILES, DEFAULT_PROFILE_ID, getProfile, applyProfile, profileProblems } from "./index.js";
import CONFIG from "../distribution_config.json";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILES_DIR = path.join(SRC, "profiles");
const REAL_NAMES = ["Sunlight", "Pink Energy", "Cross River"];

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    if (/\.test\.[cm]?[jt]sx?$/.test(e.name) || e.name === "test-setup.js") return [];
    return /\.(js|jsx|mjs|cjs|ts|tsx|json|css|html|md)$/.test(e.name) ? [full] : [];
  });
}

describe("lender profile registry", () => {
  it("registers well-formed profiles with unique ids and a default", () => {
    expect(new Set(PROFILES.map((p) => p.id)).size).toBe(PROFILES.length);
    expect(getProfile(DEFAULT_PROFILE_ID).id).toBe(DEFAULT_PROFILE_ID);
    for (const p of PROFILES) expect(profileProblems(p)).toEqual([]);
    expect(() => getProfile("NOPE")).toThrow(/Unknown lender profile/);
  });

  it("leaves the default config untouched and merges presets without mutating it", () => {
    const before = JSON.stringify(CONFIG);
    expect(applyProfile(CONFIG, "MORTGAGE")).toBe(CONFIG);
    const solar = applyProfile(CONFIG, "SOLAR_PRIME");
    expect(solar.credit.score_base.mean).toBe(getProfile("SOLAR_PRIME").preset.overrides.credit.score_base.mean);
    expect(solar.regimes.categories).toEqual(CONFIG.regimes.categories);
    expect(solar.regimes.params.PRIME.financial_health_shift).toBe(CONFIG.regimes.params.PRIME.financial_health_shift);
    expect(JSON.stringify(CONFIG)).toBe(before);
    expect(CONFIG.presets).toBeUndefined();
  });

  it("keeps real-company names inside src/profiles/ only", () => {
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      if (file.startsWith(PROFILES_DIR + path.sep)) continue;
      const text = fs.readFileSync(file, "utf8").toLowerCase();
      for (const name of REAL_NAMES) if (text.includes(name.toLowerCase())) offenders.push(`${path.relative(SRC, file)}: ${name}`);
    }
    expect(offenders).toEqual([]);
  });
});

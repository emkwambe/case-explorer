// src/ui/hooks/useCaseLibrary.js — Case generation and selection state.
//
// The initial library is generated deterministically from a fixed seed, so the demo opens on
// the same cases for every reviewer without shipping a stale JSON fixture.

import { useCallback, useMemo, useState } from "react";
import CONFIG from "../../distribution_config.json";
import { generateCase, generateBlendedCase } from "../../generator.js";

export const DEMO_SEED = "demo-2026";
export const DEMO_AS_OF = "2026-01-15";

/** Config with a fixed as-of date so evidence dates and tenure are stable across reloads. */
export const demoConfig = { ...CONFIG, generation: { ...(CONFIG.generation || {}), as_of_date: DEMO_AS_OF } };

/** A curated opening set: one clean approval, one review, and one of each headline typology. */
export function buildInitialCases() {
  const curated = [
    ["NONE", "LOW"], ["NONE", "LOW"], ["INFLATION", "HIGH"], ["CONCEALMENT", "HIGH"],
    ["FABRICATION", "HIGH"], ["BUST_OUT", "HIGH"], ["EVIDENCE_TAMPERING", "HIGH"],
    ["OCCUPANCY_MISREPRESENTATION", "MEDIUM"], ["GIFT_FUND_MISREPRESENTATION", "MEDIUM"],
    ["ASSET_SEASONING", "MEDIUM"], ["STRAW_BUYER", "HIGH"], ["INCOHERENT", "HIGH"]
  ];
  return curated.map(([type, sev], i) => generateCase(i, demoConfig, type, sev, `${DEMO_SEED}-${type}-${i}`));
}

export function useCaseLibrary() {
  const initial = useMemo(buildInitialCases, []);
  const [cases, setCases] = useState(initial);
  const [selectedId, setSelectedId] = useState(initial[0].id);
  const [genConfig, setGenConfig] = useState({ corruptionType: "MIXED", severity: "HIGH", count: 10, seed: "", adversarial: false });

  const selectedCase = useMemo(() => cases.find((c) => c.id === selectedId) ?? cases[0], [cases, selectedId]);
  const seedValue = genConfig.seed.trim() === "" ? undefined : genConfig.seed.trim();

  const addCases = useCallback((newCases) => {
    if (!newCases.length) return;
    setCases((prev) => [...prev, ...newCases]);
    setSelectedId(newCases[0].id);
  }, []);

  const generate = useCallback(() => {
    const produced = [];
    const base = seedValue ?? `run-${Date.now()}`;
    for (let i = 0; i < genConfig.count; i++) {
      if (genConfig.corruptionType === "MIXED") produced.push(generateBlendedCase(i, demoConfig, base, genConfig.adversarial));
      else produced.push(generateCase(i, demoConfig, genConfig.corruptionType, genConfig.severity, `${base}-${i}`));
    }
    addCases(produced);
    return produced;
  }, [genConfig, seedValue, addCases]);

  const generateOne = useCallback((corruptionType, severity, seed) => {
    const c = generateCase(0, demoConfig, corruptionType, severity, seed ?? `${DEMO_SEED}-tour-${corruptionType}`);
    addCases([c]);
    return c;
  }, [addCases]);

  const select = useCallback((id) => setSelectedId(id), []);
  const reset = useCallback(() => { const fresh = buildInitialCases(); setCases(fresh); setSelectedId(fresh[0].id); }, []);

  return { cases, selectedCase, selectedId, select, genConfig, setGenConfig, generate, generateOne, addCases, reset, config: demoConfig };
}

// src/ui/dealers/useDealerPortfolio.js — Generates the dealer-channel portfolio in time slices.
//
// The 10,000-case book is built in short time slices between paints, so the page keeps
// responding and shows progress. Only the per-loan inputs are kept (no case list is rendered);
// loan outcomes are re-simulated from them, so changing the dealer-effect strength is instant.

import { useCallback, useEffect, useRef, useState } from "react";
import { generateBlendedCase } from "../../generator.js";
import { applyProfile } from "../../profiles/index.js";
import { buildDealerNetwork, dealerSettings, loanInputs } from "../../dealers.js";

// Each slice works for at most this long before yielding, so the page keeps painting.
const SLICE_MS = 25;

export function useDealerPortfolio(baseConfig) {
  const [state, setState] = useState({ status: "idle", progress: 0, inputs: null, profile: null, settings: null, dealers: null });
  // The last "Fail this dealer" result, shared so other tabs can apply it. Cleared on regeneration.
  const [lastFailure, setLastFailure] = useState(null);
  const cancelRun = useRef(() => {});

  const generate = useCallback((profile) => {
    cancelRun.current();
    let cancelled = false;
    cancelRun.current = () => { cancelled = true; };

    const settings = dealerSettings(profile.defaults?.dealerView);
    const dealers = buildDealerNetwork(settings.network);
    const { count, seed } = settings.portfolio;
    const config = applyProfile(baseConfig, profile);
    const inputs = [];
    let i = 0;
    setState({ status: "running", progress: 0, inputs: null, profile, settings, dealers });
    setLastFailure(null);

    const step = () => {
      if (cancelled) return;
      const deadline = performance.now() + SLICE_MS;
      while (i < count && performance.now() < deadline) {
        inputs.push(loanInputs(generateBlendedCase(i, config, seed), settings.loanAmount, profile));
        i++;
      }
      if (i < count) {
        setState((s) => ({ ...s, progress: i / count }));
        setTimeout(step, 0);
      } else {
        setState((s) => ({ ...s, status: "done", progress: 1, inputs }));
      }
    };
    setTimeout(step, 0);
  }, [baseConfig]);

  useEffect(() => () => cancelRun.current(), []);

  return { ...state, generate, lastFailure, setLastFailure };
}

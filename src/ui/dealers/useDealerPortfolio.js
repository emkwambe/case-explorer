// src/ui/dealers/useDealerPortfolio.js — Generates the dealer-channel portfolio in time slices.
//
// The book is the funded book: applications are generated in seed order and only those the
// credit policy approves are kept, until `count` loans are funded. It is built in short time
// slices between paints, so the page keeps responding and shows progress. Only the per-loan inputs are kept (no case list is rendered);
// loan outcomes are re-simulated from them, so changing the dealer-effect strength is instant.
//
// The same pass also keeps the application pool for the Policy Sandbox: one small record per
// generated application, funded or not, in separate state so the funded book's inputs never change.

import { useCallback, useEffect, useRef, useState } from "react";
import { generateBlendedCase } from "../../generator.js";
import { applyProfile } from "../../profiles/index.js";
import { buildDealerNetwork, dealerSettings, isFundedLoan, loanInputs } from "../../dealers.js";
import { poolRecord } from "../../policySandbox.js";

// Each slice works for at most this long before yielding, so the page keeps painting.
const SLICE_MS = 25;
// Stop after this many applications per requested loan, so a policy that approves almost
// nothing cannot loop forever; the summary then shows the shortfall.
const MAX_APPLICATIONS_PER_LOAN = 50;

export function useDealerPortfolio(baseConfig) {
  const [state, setState] = useState({ status: "idle", progress: 0, inputs: null, applications: 0, profile: null, settings: null, dealers: null });
  // The last "Fail this dealer" result, shared so other tabs can apply it. Cleared on regeneration.
  const [lastFailure, setLastFailure] = useState(null);
  // Every application the run generated, as Policy Sandbox pool records.
  const [pool, setPool] = useState(null);
  const cancelRun = useRef(() => {});

  const generate = useCallback((profile) => {
    cancelRun.current();
    let cancelled = false;
    cancelRun.current = () => { cancelled = true; };

    const settings = dealerSettings(profile.defaults?.dealerView);
    const dealers = buildDealerNetwork(settings.network);
    const { count, seed } = settings.portfolio;
    const config = applyProfile(baseConfig, profile);
    const maxApplications = count * MAX_APPLICATIONS_PER_LOAN;
    const inputs = [];
    const applicationPool = [];
    let i = 0;
    setState({ status: "running", progress: 0, inputs: null, applications: 0, profile, settings, dealers });
    setLastFailure(null);
    setPool(null);

    const step = () => {
      if (cancelled) return;
      const deadline = performance.now() + SLICE_MS;
      while (inputs.length < count && i < maxApplications && performance.now() < deadline) {
        const c = generateBlendedCase(i, config, seed);
        if (isFundedLoan(c, profile)) inputs.push(loanInputs(c, settings.loanAmount, profile));
        applicationPool.push(poolRecord(c, profile, settings.loanAmount));
        i++;
      }
      if (inputs.length < count && i < maxApplications) {
        setState((s) => ({ ...s, progress: inputs.length / count, applications: i }));
        setTimeout(step, 0);
      } else {
        setPool(applicationPool);
        setState((s) => ({ ...s, status: "done", progress: 1, inputs, applications: i }));
      }
    };
    setTimeout(step, 0);
  }, [baseConfig]);

  useEffect(() => () => cancelRun.current(), []);

  return { ...state, pool, generate, lastFailure, setLastFailure };
}

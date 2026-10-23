// src/ui/challenge/challengeGate.js — The one challenge-mode gate. The shell provides `active` (the
// learner is in challenge mode); the challenge view provides `blind` (the current case has not been
// committed). Components ask the gate instead of deciding for themselves: while active, the shell
// renders only the challenge view, and while blind, shared components drop anything that hints at
// the answer.

import { createContext, useContext } from "react";

export const ChallengeGateContext = createContext(Object.freeze({ active: false, blind: false }));

export const useChallengeGate = () => useContext(ChallengeGateContext);

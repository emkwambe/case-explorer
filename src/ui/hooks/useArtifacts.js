// src/ui/hooks/useArtifacts.js — Load published benchmark and model artifacts.
//
// The deployed demo serves artifacts under <base>/artifacts/. When they are absent (a plain
// `npm run dev` before `npm run benchmark`) the UI says so rather than inventing numbers.

import { useEffect, useState } from "react";

const BASE = (import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "");
export const artifactUrl = (name) => `${BASE}/artifacts/${name}`;

export function useArtifact(name) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  useEffect(() => {
    let cancelled = false;
    if (typeof fetch !== "function") { setState({ status: "unavailable", data: null, error: "fetch unavailable" }); return; }
    fetch(artifactUrl(name))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => { if (!cancelled) setState({ status: "ready", data, error: null }); })
      .catch((e) => { if (!cancelled) setState({ status: "unavailable", data: null, error: e.message }); });
    return () => { cancelled = true; };
  }, [name]);
  return state;
}

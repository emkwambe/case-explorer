// src/ui/hooks/useArtifacts.js — Load published benchmark and model artifacts.
//
// The deployed demo serves artifacts under <base>/artifacts/. When they are absent (a plain
// `npm run dev` before `npm run benchmark`) the UI says so rather than inventing numbers.

import { useEffect, useState } from "react";

const BASE = (import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "");
export const artifactUrl = (name) => `${BASE}/artifacts/${name}`;

/**
 * When the model outputs were generated, and whether they are the committed snapshot
 * (artifacts/model-snapshot/, copied in by the prebuild when analytics/artifacts/ is absent) or a
 * pipeline run. The snapshot marker counts only when its date matches the summary's own, so a
 * pipeline run copied over the snapshot afterwards is never labelled as the snapshot.
 */
export function modelProvenance(summary, marker) {
  if (!summary?.generated_at) return null;
  const date = new Date(summary.generated_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const snapshot = Boolean(marker?.generated_at && marker.generated_at === summary.generated_at && marker.files?.includes("model-summary.json"));
  const commit = snapshot ? String(marker.generator_commit ?? "").slice(0, 7) : null;
  return {
    date,
    snapshot,
    text: snapshot
      ? `Model outputs generated ${date}: a committed snapshot${commit ? ` (commit ${commit})` : ""}, not rebuilt by this deploy.`
      : `Model outputs generated ${date} by the analytics pipeline.`
  };
}

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

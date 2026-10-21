// modelProvenance: the model tabs say when their outputs were generated, and say "snapshot" only when
// the committed snapshot's marker matches the summary actually served.

import { describe, it, expect } from "vitest";
import { modelProvenance } from "./useArtifacts.js";

const summary = { generated_at: "2026-10-14T18:17:18.856229+00:00" };
const marker = { generated_at: "2026-10-14T18:17:18.856229+00:00", generator_commit: "8aaa130fb28b8702ee47e80486e544cd83f1ea0a", files: ["model-summary.json", "pr_curves.png"] };

describe("modelProvenance", () => {
  it("labels the committed snapshot with its generated date and commit", () => {
    const p = modelProvenance(summary, marker);
    expect(p.snapshot).toBe(true);
    expect(p.date).toBe("October 14, 2026");
    expect(p.text).toBe("Model outputs generated October 14, 2026: a committed snapshot (commit 8aaa130), not rebuilt by this deploy.");
  });

  it("labels a pipeline run when there is no marker, or the marker is for a different summary", () => {
    expect(modelProvenance(summary, null).text).toBe("Model outputs generated October 14, 2026 by the analytics pipeline.");
    const fresh = { generated_at: "2026-10-22T09:00:00+00:00" };
    expect(modelProvenance(fresh, marker)).toMatchObject({ snapshot: false, date: "October 22, 2026" });
    expect(modelProvenance(summary, { ...marker, files: ["pr_curves.png"] }).snapshot).toBe(false);
  });

  it("returns null without a summary date", () => {
    expect(modelProvenance(null, marker)).toBeNull();
    expect(modelProvenance({}, marker)).toBeNull();
  });
});

// Marker-label placement: the public-record events on the cash charts' quarter axis get labels that
// neither overlap within a row nor run past the plot's edges.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutMarkerLabels } from "./markerLabels.js";
import { eventX } from "../publicRecord/format.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const events = JSON.parse(fs.readFileSync(path.join(ROOT, "data/public-record/events.json"), "utf8")).events;

// The cash charts' geometry: 12 quarters (Q1 2021 to Q4 2023) across a 640-wide chart.
const W = 640, LEFT = 64, RIGHT = W - 20;
const sx = (x) => LEFT + (x / 11) * (RIGHT - LEFT);

describe("layoutMarkerLabels", () => {
  const markers = events.map((e) => ({ x: eventX(e.date), label: e.dateLabel }));
  const placed = layoutMarkerLabels(markers, sx, RIGHT);

  it("keeps every label inside the plot", () => {
    for (const p of placed) {
      expect(p.left).toBeGreaterThanOrEqual(LEFT);
      expect(p.right).toBeLessThanOrEqual(RIGHT);
    }
  });

  it("never overlaps two labels in the same row, including events on the same date", () => {
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        if (placed[a].row !== placed[b].row) continue;
        expect(placed[a].right <= placed[b].left || placed[b].right <= placed[a].left).toBe(true);
      }
    }
    expect(new Set(placed.map((p) => p.row)).size).toBeGreaterThan(1);
  });

  it("draws a label left of its line only when it would cross the right edge", () => {
    for (const [i, p] of placed.entries()) {
      const fits = sx(markers[i].x) + 4 + (p.right - p.left) <= RIGHT;
      expect(p.anchor).toBe(fits ? "start" : "end");
    }
  });

  it("leaves a marker with a y value on the first row", () => {
    expect(layoutMarkerLabels([{ x: 1, y: 0, label: "Break-even 112.8 bps" }, { x: 1, y: 0, label: "Other" }], sx, RIGHT).map((p) => p.row)).toEqual([0, 0]);
  });
});

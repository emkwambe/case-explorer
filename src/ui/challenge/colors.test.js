// src/ui/challenge/colors.test.js — Challenge-mode text colours meet WCAG 2.1 AA contrast (4.5:1).
// jsdom cannot compute rendered contrast, so the axe check in ChallengeView.test.jsx leaves it to this test.

import { describe, it, expect } from "vitest";
import { CHALLENGE_COLORS, CONTRAST_PAIRS, contrastRatio } from "./colors.js";

describe("challenge-mode colours", () => {
  it("computes known ratios (black on white is 21:1, a colour on itself 1:1)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#1d4ed8", "#1d4ed8")).toBeCloseTo(1, 5);
  });

  it.each(CONTRAST_PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(contrastRatio(CHALLENGE_COLORS[fg], CHALLENGE_COLORS[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

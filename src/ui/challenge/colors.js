// src/ui/challenge/colors.js — Challenge-mode colours. Every text colour is checked against its
// background at WCAG 2.1 AA (4.5:1 for normal text) by src/ui/challenge/colors.test.js.

export const CHALLENGE_COLORS = Object.freeze({
  surface: "#ffffff",
  text: "#0f172a",
  muted: "#475569",
  border: "#94a3b8",
  accent: "#1d4ed8",
  onAccent: "#ffffff",
  warnBg: "#fffbeb",
  warnText: "#78350f",
  warnBorder: "#b45309"
});

/** Text/background pairs used by the challenge view. */
export const CONTRAST_PAIRS = Object.freeze([
  ["text", "surface"], ["muted", "surface"], ["accent", "surface"], ["onAccent", "accent"], ["warnText", "warnBg"], ["text", "warnBg"]
]);

const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

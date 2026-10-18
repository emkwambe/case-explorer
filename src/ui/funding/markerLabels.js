// src/ui/funding/markerLabels.js — Placement of LineChart marker labels. Labels of markers without
// a y value are packed into rows, left to right, so no two in a row overlap; a label that would run
// past the plot's right edge is drawn to the left of its marker line instead. Widths are estimated
// from the label length at the chart's 10-unit font, with a margin.

export const LABEL_CHAR_WIDTH = 6;
export const LABEL_GAP = 6;
const OFFSET = 4;

/**
 * markers: [{ x, y?, label }]; sx maps data x to chart x; right is the plot's right edge in chart
 * units. Returns one { x, anchor, row, left, right } per marker, in the input order.
 */
export function layoutMarkerLabels(markers, sx, right) {
  const rowEnds = [];
  const placed = new Array(markers.length);
  const order = markers.map((m, i) => i).sort((a, b) => sx(markers[a].x) - sx(markers[b].x));
  for (const i of order) {
    const m = markers[i];
    const width = String(m.label).length * LABEL_CHAR_WIDTH;
    const line = sx(m.x);
    const flip = line + OFFSET + width > right;
    const left = flip ? line - OFFSET - width : line + OFFSET;
    let row = 0;
    if (!Number.isFinite(m.y)) {
      row = rowEnds.findIndex((end) => left >= end + LABEL_GAP);
      if (row < 0) { row = rowEnds.length; rowEnds.push(-Infinity); }
      rowEnds[row] = left + width;
    }
    placed[i] = { x: flip ? line - OFFSET : line + OFFSET, anchor: flip ? "end" : "start", row, left, right: left + width };
  }
  return placed;
}

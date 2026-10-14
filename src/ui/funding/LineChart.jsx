// src/ui/funding/LineChart.jsx — Single-series SVG line chart with reference lines, point
// markers, a hover crosshair readout and a data-table fallback.

import React, { useState } from "react";
import { styles } from "../theme.js";

const W = 640, H = 240, PAD = { top: 16, right: 20, bottom: 40, left: 64 };
const SERIES = "#2563eb";
const INK = "#334155", MUTED = "#64748b", GRID = "#e2e8f0";

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = (span / count) / step;
  const nice = err >= 7.5 ? 10 * step : err >= 3.5 ? 5 * step : err >= 1.5 ? 2 * step : step;
  const ticks = [];
  for (let v = Math.ceil(min / nice) * nice; v <= max + 1e-9; v += nice) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/**
 * points: [{ x, y }] in ascending x. refLines: [{ y, label }]. markers: [{ x, y, label }].
 * formatX / formatY format values for axes, tooltip and table.
 */
export function LineChart({ points, title, xLabel, yLabel, refLines = [], markers = [], formatX = String, formatY = String, testId }) {
  const [hover, setHover] = useState(null);
  const xs = points.map((p) => p.x);
  const ys = [...points.map((p) => p.y), ...refLines.map((r) => r.y)];
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad; yMax += yPad;
  const sx = (x) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD.left - PAD.right);
  const sy = (y) => PAD.top + (1 - (y - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const path = points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = points[0];
    for (const p of points) if (Math.abs(sx(p.x) - x) < Math.abs(sx(best.x) - x)) best = p;
    setHover(best);
  };

  return (
    <figure style={{ margin: "8px 0 0" }} data-testid={testId}>
      <figcaption style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 4 }}>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: "block", maxWidth: W, touchAction: "none" }}>
        {niceTicks(yMin, yMax).map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 6} y={sy(t) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{formatY(t)}</text>
          </g>
        ))}
        {niceTicks(xMin, xMax, 6).map((t) => (
          <text key={`x${t}`} x={sx(t)} y={H - PAD.bottom + 16} textAnchor="middle" fontSize={11} fill={MUTED}>{formatX(t)}</text>
        ))}
        <text x={(PAD.left + W - PAD.right) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={MUTED}>{xLabel}</text>
        <text x={12} y={(PAD.top + H - PAD.bottom) / 2} textAnchor="middle" fontSize={11} fill={MUTED} transform={`rotate(-90 12 ${(PAD.top + H - PAD.bottom) / 2})`}>{yLabel}</text>
        {refLines.map((r) => (
          <g key={`r${r.label}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(r.y)} y2={sy(r.y)} stroke={INK} strokeWidth={1} strokeDasharray="4 3" />
            <text x={W - PAD.right} y={sy(r.y) - 4} textAnchor="end" fontSize={11} fill={INK}>{r.label}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />
        {markers.map((m) => (
          <g key={`m${m.label}`}>
            <line x1={sx(m.x)} x2={sx(m.x)} y1={PAD.top} y2={H - PAD.bottom} stroke={MUTED} strokeWidth={1} strokeDasharray="2 3" />
            <circle cx={sx(m.x)} cy={sy(m.y)} r={5} fill={SERIES} stroke="white" strokeWidth={2} />
            <text x={sx(m.x) + 6} y={PAD.top + 12} fontSize={11} fill={INK}>{m.label}</text>
          </g>
        ))}
        {hover && (
          <g pointerEvents="none">
            <line x1={sx(hover.x)} x2={sx(hover.x)} y1={PAD.top} y2={H - PAD.bottom} stroke={MUTED} strokeWidth={1} />
            <circle cx={sx(hover.x)} cy={sy(hover.y)} r={4} fill={SERIES} stroke="white" strokeWidth={2} />
            <rect x={Math.min(sx(hover.x) + 8, W - PAD.right - 150)} y={PAD.top} width={150} height={36} rx={4} fill="white" stroke={GRID} />
            <text x={Math.min(sx(hover.x) + 8, W - PAD.right - 150) + 8} y={PAD.top + 15} fontSize={11} fill={MUTED}>{xLabel}: {formatX(hover.x)}</text>
            <text x={Math.min(sx(hover.x) + 8, W - PAD.right - 150) + 8} y={PAD.top + 29} fontSize={12} fontWeight={600} fill={INK}>{formatY(hover.y)}</text>
          </g>
        )}
      </svg>
      <details style={{ fontSize: 12, marginTop: 4 }}>
        <summary style={{ cursor: "pointer", color: MUTED }}>Show data</summary>
        <table style={{ ...styles.table, fontSize: 12 }}>
          <thead><tr><th style={styles.th}>{xLabel}</th><th style={styles.th}>{yLabel}</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.x}><td style={styles.td}>{formatX(p.x)}</td><td style={styles.td}>{formatY(p.y)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

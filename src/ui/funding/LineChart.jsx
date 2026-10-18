// src/ui/funding/LineChart.jsx — Single-series SVG line chart with reference lines, markers, a
// hover crosshair readout and a data-table fallback. Points with a null y break the line (gaps are
// never bridged). Optional per-point click handler (used for data lineage).

import React, { useState } from "react";
import { styles } from "../theme.js";
import { layoutMarkerLabels } from "./markerLabels.js";

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
 * points: [{ x, y, label? }] in ascending x; y may be null for a gap. refLines: [{ y, label }].
 * markers: [{ x, y?, label }] (no dot when y is absent). bands: [{ from, to, label, fill }] in y.
 * xTicks: optional [{ x, label }] replacing numeric ticks. onPointClick(point) makes points buttons.
 */
export function LineChart({ points, title, xLabel, yLabel, refLines = [], markers = [], bands = [], xTicks, formatX = String, formatY = String, onPointClick, testId }) {
  const [hover, setHover] = useState(null);
  const present = points.filter((p) => p.y !== null && p.y !== undefined);
  const xs = points.map((p) => p.x);
  const ys = [...present.map((p) => p.y), ...refLines.map((r) => r.y), ...bands.flatMap((b) => [b.from, b.to]).filter(Number.isFinite)];
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  let yMin = ys.length ? Math.min(...ys) : 0, yMax = ys.length ? Math.max(...ys) : 1;
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad; yMax += yPad;
  const sx = (x) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD.left - PAD.right);
  const sy = (y) => PAD.top + (1 - (y - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const clampY = (y) => Math.max(yMin, Math.min(yMax, y));

  // One path segment per run of consecutive present points.
  const segments = [];
  let run = [];
  for (const p of points) {
    if (p.y === null || p.y === undefined) { if (run.length) segments.push(run); run = []; }
    else run.push(p);
  }
  if (run.length) segments.push(run);

  const onMove = (e) => {
    if (!present.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = present[0];
    for (const p of present) if (Math.abs(sx(p.x) - x) < Math.abs(sx(best.x) - x)) best = p;
    setHover(best);
  };
  const tipX = (x) => Math.min(sx(x) + 8, W - PAD.right - 170);
  const labels = layoutMarkerLabels(markers, sx, W - PAD.right);

  return (
    <figure style={{ margin: "8px 0 0" }} data-testid={testId}>
      <figcaption style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 4 }}>{title}</figcaption>
      <div className="ce-chart-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: "block", maxWidth: W, touchAction: "pan-x pan-y" }}>
          {bands.map((b) => (
            <g key={`b${b.label}`}>
              <rect x={PAD.left} width={W - PAD.left - PAD.right} y={sy(clampY(Math.min(b.to, yMax)))} height={Math.max(0, sy(clampY(Math.max(b.from, yMin))) - sy(clampY(Math.min(b.to, yMax))))} fill={b.fill} />
              <text x={PAD.left + 4} y={sy(clampY(Math.min(b.to, yMax))) + 12} fontSize={10} fill={MUTED}>{b.label}</text>
            </g>
          ))}
          {niceTicks(yMin, yMax).map((t) => (
            <g key={`y${t}`}>
              <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 6} y={sy(t) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{formatY(t)}</text>
            </g>
          ))}
          {(xTicks ?? niceTicks(xMin, xMax, 6).map((t) => ({ x: t, label: formatX(t) }))).map((t) => (
            <text key={`x${t.x}`} x={sx(t.x)} y={H - PAD.bottom + 16} textAnchor="middle" fontSize={10} fill={MUTED}>{t.label}</text>
          ))}
          <text x={(PAD.left + W - PAD.right) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={MUTED}>{xLabel}</text>
          <text x={12} y={(PAD.top + H - PAD.bottom) / 2} textAnchor="middle" fontSize={11} fill={MUTED} transform={`rotate(-90 12 ${(PAD.top + H - PAD.bottom) / 2})`}>{yLabel}</text>
          {refLines.map((r) => (
            <g key={`r${r.label}`}>
              <line x1={PAD.left} x2={W - PAD.right} y1={sy(r.y)} y2={sy(r.y)} stroke={INK} strokeWidth={1} strokeDasharray="4 3" />
              <text x={W - PAD.right} y={sy(r.y) - 4} textAnchor="end" fontSize={11} fill={INK}>{r.label}</text>
            </g>
          ))}
          {segments.map((seg, i) => (
            <path key={`s${i}`} d={seg.map((p, k) => `${k ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ")} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />
          ))}
          {onPointClick && present.map((p) => (
            <circle key={`p${p.x}`} cx={sx(p.x)} cy={sy(p.y)} r={9} fill="transparent" style={{ cursor: "pointer" }} onClick={() => onPointClick(p)} role="button" aria-label={`Source for ${p.label ?? formatX(p.x)}`} data-testid={testId ? `${testId}-point` : undefined} />
          ))}
          {present.map((p) => <circle key={`d${p.x}`} cx={sx(p.x)} cy={sy(p.y)} r={3} fill={SERIES} pointerEvents="none" />)}
          {markers.map((m, i) => (
            <g key={`m${m.label}`}>
              <line x1={sx(m.x)} x2={sx(m.x)} y1={PAD.top} y2={H - PAD.bottom} stroke={MUTED} strokeWidth={1} strokeDasharray="2 3" />
              {Number.isFinite(m.y) && <circle cx={sx(m.x)} cy={sy(m.y)} r={5} fill={SERIES} stroke="white" strokeWidth={2} />}
              <text x={labels[i].x} y={PAD.top + 12 + labels[i].row * 14} textAnchor={labels[i].anchor} fontSize={10} fill={INK} data-marker-label="">{m.label}</text>
            </g>
          ))}
          {hover && (
            <g pointerEvents="none">
              <line x1={sx(hover.x)} x2={sx(hover.x)} y1={PAD.top} y2={H - PAD.bottom} stroke={MUTED} strokeWidth={1} />
              <rect x={tipX(hover.x)} y={PAD.top} width={170} height={36} rx={4} fill="white" stroke={GRID} />
              <text x={tipX(hover.x) + 8} y={PAD.top + 15} fontSize={11} fill={MUTED}>{hover.label ?? `${xLabel}: ${formatX(hover.x)}`}</text>
              <text x={tipX(hover.x) + 8} y={PAD.top + 29} fontSize={12} fontWeight={600} fill={INK}>{formatY(hover.y)}</text>
            </g>
          )}
        </svg>
      </div>
      <details style={{ fontSize: 12, marginTop: 4 }}>
        <summary style={{ cursor: "pointer", color: MUTED }}>Show data</summary>
        <table style={{ ...styles.table, fontSize: 12 }}>
          <thead><tr><th style={styles.th}>{xLabel}</th><th style={styles.th}>{yLabel}</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.x}><td style={styles.td}>{p.label ?? formatX(p.x)}</td><td style={styles.td}>{p.y === null || p.y === undefined ? "—" : formatY(p.y)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

/** Single-series bar chart; null values are shown as gaps. Bars are clickable when onBarClick is set. */
export function BarChart({ bars, title, yLabel, formatY = String, onBarClick, testId }) {
  const values = bars.map((b) => b.y).filter(Number.isFinite);
  const max = Math.max(0, ...values), min = Math.min(0, ...values);
  const span = max - min || 1;
  const innerW = W - PAD.left - PAD.right, innerH = H - PAD.top - PAD.bottom;
  const band = innerW / bars.length, barW = Math.max(4, band - 6);
  const sy = (y) => PAD.top + ((max - y) / span) * innerH;
  return (
    <figure style={{ margin: "8px 0 0" }} data-testid={testId}>
      <figcaption style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 4 }}>{title}</figcaption>
      <div className="ce-chart-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} style={{ display: "block", maxWidth: W }}>
          {niceTicks(min, max).map((t) => (
            <g key={`y${t}`}>
              <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 6} y={sy(t) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{formatY(t)}</text>
            </g>
          ))}
          <text x={12} y={(PAD.top + H - PAD.bottom) / 2} textAnchor="middle" fontSize={11} fill={MUTED} transform={`rotate(-90 12 ${(PAD.top + H - PAD.bottom) / 2})`}>{yLabel}</text>
          {bars.map((b, i) => {
            const x = PAD.left + i * band + (band - barW) / 2;
            const has = Number.isFinite(b.y);
            const top = has ? Math.min(sy(b.y), sy(0)) : sy(0);
            const height = has ? Math.max(1, Math.abs(sy(b.y) - sy(0))) : 0;
            return (
              <g key={b.label}>
                {has && <rect x={x} y={top} width={barW} height={height} rx={2} fill={SERIES} style={onBarClick ? { cursor: "pointer" } : undefined} onClick={onBarClick ? () => onBarClick(b) : undefined} role={onBarClick ? "button" : undefined} aria-label={onBarClick ? `Source for ${b.label}` : undefined} data-testid={testId ? `${testId}-bar` : undefined}><title>{`${b.label}: ${formatY(b.y)}`}</title></rect>}
                {!has && <text x={x + barW / 2} y={sy(0) - 4} textAnchor="middle" fontSize={10} fill={MUTED}>{b.note ?? "gap"}</text>}
                <text x={x + barW / 2} y={H - PAD.bottom + 16} textAnchor="middle" fontSize={10} fill={MUTED}>{b.label}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <details style={{ fontSize: 12, marginTop: 4 }}>
        <summary style={{ cursor: "pointer", color: MUTED }}>Show data</summary>
        <table style={{ ...styles.table, fontSize: 12 }}>
          <thead><tr><th style={styles.th}>Quarter</th><th style={styles.th}>{yLabel}</th></tr></thead>
          <tbody>{bars.map((b) => <tr key={b.label}><td style={styles.td}>{b.label}</td><td style={styles.td}>{Number.isFinite(b.y) ? formatY(b.y) : b.note ?? "—"}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

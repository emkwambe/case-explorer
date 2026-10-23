// src/ui/publicRecord/format.js — Formatting shared by the Public record and Findings tabs.

export const qLabel = (code) => `${code.slice(4)} ${code.slice(0, 4)}`;
export const toMillions = (m) => (m.unit === "USD thousands" ? m.value / 1e3 : m.unit === "USD" ? m.value / 1e6 : m.value);
export const fmtM = (v) => (v === null || v === undefined ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(1)}M`);
export const fmtPct = (v, d = 2) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`);
export const fmtRate = (v) => (v === null || v === undefined ? "—" : `${v.toFixed(2)}%`);

const dayFraction = (y, m, d) => (d - 1) / new Date(Date.UTC(y, m, 0)).getUTCDate();

/** x position of a dated event on a quarter axis whose points sit at x = 0, 1, … from quarter code `first` (each point at its quarter's start). */
export function quarterAxisX(dateIso, first) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const index = (y - Number(first.slice(0, 4))) * 4 + Math.floor((m - 1) / 3) - (Number(first.slice(5)) - 1);
  return index + ((m - 1) % 3 + dayFraction(y, m, d)) / 3;
}

/** x position of a dated event on a month axis whose points sit at x = 0, 1, … from month code `first` ("2019-01"). */
export function monthAxisX(dateIso, first) {
  const [y, m, d] = dateIso.split("-").map(Number);
  return (y - Number(first.slice(0, 4))) * 12 + (m - Number(first.slice(5, 7))) + dayFraction(y, m, d);
}

/** x position of a dated event on a quarter axis whose quarter-end points sit at x = 0, 1, … from Q1 2021. */
export function eventX(dateIso) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const q = Math.ceil(m / 3);
  const qIndex = (y - 2021) * 4 + (q - 1); // index of the quarter whose end point is at x = qIndex
  const qStart = new Date(Date.UTC(y, (q - 1) * 3, 1)), qEnd = new Date(Date.UTC(y, q * 3, 0));
  const frac = (Date.UTC(y, m - 1, d) - qStart) / (qEnd - qStart);
  return qIndex - 1 + frac;
}

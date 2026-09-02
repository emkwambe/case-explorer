// src/evaluation/stats.js — Shared statistical helpers for evaluation modules.

import { normalCDF, lognormalCDF, betaCDF } from "../utils/distributions.js";

export { normalCDF, lognormalCDF, betaCDF };

export function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
export function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export function quantile(a, q) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export function round(x, d = 4) { const m = 10 ** d; return Math.round(x * m) / m; }

export function pearson(a, b) {
  const n = a.length;
  if (n === 0) return 0;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Two-sided one-sample Kolmogorov–Smirnov test against a theoretical CDF. */
export function ksTest(samples, cdf) {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  let maxDiff = 0;
  for (let i = 0; i < n; i++) {
    const theoretical = cdf(sorted[i]);
    maxDiff = Math.max(maxDiff, Math.abs((i + 1) / n - theoretical), Math.abs(i / n - theoretical));
  }
  const lambda = (Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n)) * maxDiff;
  const pValue = Math.min(1, 2 * Math.exp(-2 * lambda * lambda));
  return { statistic: maxDiff, pValue, n };
}

/** Chi-square goodness of fit for binned data. bins: [{min,max,lower?,upper?}] */
export function chiSquareTest(samples, bins, cdf) {
  const observed = new Array(bins.length).fill(0);
  for (const v of samples) {
    let idx = bins.findIndex(b => v >= b.min && v < b.max);
    if (idx < 0 && v === bins[bins.length - 1].max) idx = bins.length - 1;
    if (idx >= 0) observed[idx]++;
  }
  const expected = bins.map(b => {
    const lo = b.lower !== undefined ? b.lower : b.min;
    const hi = b.upper !== undefined ? b.upper : b.max;
    const pLo = lo === -Infinity ? 0 : cdf(lo);
    const pHi = hi === Infinity ? 1 : cdf(hi);
    return samples.length * (pHi - pLo);
  });
  let chi2 = 0;
  for (let i = 0; i < bins.length; i++) if (expected[i] > 0) chi2 += (observed[i] - expected[i]) ** 2 / expected[i];
  return { statistic: chi2, df: bins.length - 1, observed, expected, pValue: chiSquarePValue(chi2, bins.length - 1) };
}

/** Chi-square test for categorical mixture vs expected probabilities. */
export function categoricalChiSquare(counts, probabilities) {
  const n = counts.reduce((a, b) => a + b, 0);
  let chi2 = 0;
  for (let i = 0; i < counts.length; i++) {
    const e = n * probabilities[i];
    if (e > 0) chi2 += (counts[i] - e) ** 2 / e;
  }
  return { statistic: chi2, df: counts.length - 1, pValue: chiSquarePValue(chi2, counts.length - 1) };
}

/** Upper-tail chi-square p-value via regularized gamma Q(k/2, x/2). */
export function chiSquarePValue(x, k) {
  if (x <= 0 || k <= 0) return 1;
  return regularizedGammaQ(k / 2, x / 2);
}

function logGamma(z) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function regularizedGammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a, term = 1 / a;
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  return 1 - regularizedGammaQcf(a, x);
}

function regularizedGammaQcf(a, x) {
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

function regularizedGammaQ(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - regularizedGammaP(a, x);
  return regularizedGammaQcf(a, x);
}

export function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / new Set([...A, ...B]).size;
}

export function confusion(yTrue, yPred) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < yTrue.length; i++) {
    if (yTrue[i] && yPred[i]) tp++;
    else if (!yTrue[i] && yPred[i]) fp++;
    else if (yTrue[i] && !yPred[i]) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  return {
    tp, fp, fn, tn,
    precision, recall, f1,
    fpr: fp + tn ? fp / (fp + tn) : 0,
    fnr: tp + fn ? fn / (tp + fn) : 0,
    specificity: fp + tn ? tn / (fp + tn) : 0,
    accuracy: yTrue.length ? (tp + tn) / yTrue.length : 0
  };
}

export function toCsv(rows, columns) {
  if (!rows.length) return columns ? columns.join(",") + "\n" : "";
  const cols = columns || Object.keys(rows[0]);
  const esc = v => {
    if (v === undefined || v === null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return cols.join(",") + "\n" + rows.map(r => cols.map(c => esc(r[c])).join(",")).join("\n") + "\n";
}

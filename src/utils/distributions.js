// src/utils/distributions.js — Statistical sampling primitives and distribution helpers.

function randomNormal(mean, stddev, rng) {
  const u1 = rng.random(), u2 = rng.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2) * stddev + mean;
}
function randomLognormal(median, gini, rng) {
  const sigma = Math.sqrt(2 * Math.log(1 + Math.pow(gini, 2)));
  const mu = Math.log(median) - (sigma * sigma) / 2;
  return Math.exp(randomNormal(0, 1, rng) * sigma + mu);
}
function randomGamma(shape, scale, rng) {
  if (shape < 1) return randomGamma(shape + 1, scale, rng) * Math.pow(rng.random(), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = randomNormal(0, 1, rng), v = Math.pow(1 + c * x, 3);
    if (v > 0) {
      const u = rng.random();
      if (u < 1 - 0.0331 * Math.pow(x, 4) || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
    }
  }
}
function randomBeta(alpha, beta, rng) {
  const x = randomGamma(alpha, 1, rng), y = randomGamma(beta, 1, rng);
  return x / (x + y);
}
function randomExponential(rate, rng) { return -Math.log(1 - rng.random()) / rate; }
function randomCategorical(categories, probabilities, rng) {
  const rand = rng.random(); let cumulative = 0;
  for (let i = 0; i < probabilities.length; i++) {
    cumulative += probabilities[i];
    if (rand < cumulative) return categories[i];
  }
  return categories[categories.length - 1];
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function roundToInt(value) { return Math.round(value); }
function randomInt(min, max, rng) { return Math.floor(rng.random() * (max - min + 1)) + min; }
function randomChoice(arr, rng) { return arr[Math.floor(rng.random() * arr.length)]; }
function fidelityNoise(value, fidelity, rng) {
  const errorRate = 1 - fidelity;
  return roundToInt(value * (1 + randomNormal(0, errorRate, rng)));
}
function formatMoney(n) { return `$${Math.round(n).toLocaleString()}`; }

// ─── COPULA MATH HELPERS ────────────────────────────────────
function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCDF(x, mean = 0, stddev = 1) {
  return 0.5 * (1 + erf((x - mean) / (stddev * Math.sqrt(2))));
}

// Peter J. Acklam's rational approximation for inverse normal CDF
function inverseNormalCDF(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  const a1 = -3.969683028665376e+01, a2 = 2.209460984245205e+02, a3 = -2.759285104469687e+02;
  const a4 = 1.383577518672690e+02, a5 = -3.066479806614716e+01, a6 = 2.506628277459239e+00;
  const b1 = -5.447609879822406e+01, b2 = 1.615858368580409e+02, b3 = -1.556989798598866e+02;
  const b4 = 6.680131188771972e+01, b5 = -1.328068155288572e+01;
  const c1 = -7.784894002430293e-03, c2 = -3.223964580411365e-01, c3 = -2.400758277161838e+00;
  const c4 = -2.549732539343734e+00, c5 = 4.374664141464968e+00, c6 = 2.938163982698783e+00;
  const d1 = 7.784695709041462e-03, d2 = 3.224671290700398e-01, d3 = 2.445134137142996e+00;
  const d4 = 3.754408661907416e+00;
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q / (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
}

function lognormalCDF(x, median, gini) {
  if (x <= 0) return 0;
  const sigma = Math.sqrt(2 * Math.log(1 + gini * gini));
  const mu = Math.log(median) - (sigma * sigma) / 2;
  return normalCDF(Math.log(x), mu, sigma);
}

function lognormalInverseCDF(p, median, gini) {
  const sigma = Math.sqrt(2 * Math.log(1 + gini * gini));
  const mu = Math.log(median) - (sigma * sigma) / 2;
  return Math.exp(inverseNormalCDF(p) * sigma + mu);
}

function betaCDF(x, alpha, beta) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const normalizer = (gamma(alpha) * gamma(beta)) / gamma(alpha + beta);
  const steps = 200;
  let sum = 0;
  const dt = x / steps;
  for (let i = 0; i < steps; i++) {
    const t1 = i * dt;
    const t2 = (i + 1) * dt;
    const f1 = Math.pow(t1, alpha - 1) * Math.pow(1 - t1, beta - 1);
    const f2 = Math.pow(t2, alpha - 1) * Math.pow(1 - t2, beta - 1);
    sum += (f1 + f2) / 2 * dt;
  }
  return sum / normalizer;
}

function inverseBetaCDF(p, alpha, beta, tol = 1e-6, maxIter = 100) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0, hi = 1, mid;
  for (let i = 0; i < maxIter; i++) {
    mid = (lo + hi) / 2;
    const cdf = betaCDF(mid, alpha, beta);
    if (Math.abs(cdf - p) < tol) return mid;
    if (cdf < p) lo = mid;
    else hi = mid;
  }
  return mid;
}

function gamma(z) {
  // Lanczos approximation for gamma function (accurate enough for beta CDF)
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const g = 7;
  const C = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
  ];
  z -= 1;
  let x = C[0];
  for (let i = 1; i < g + 2; i++) x += C[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

function cholesky(matrix) {
  const n = matrix.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) {
        const val = matrix[i][i] - sum;
        if (val <= 0) throw new Error("Correlation matrix is not positive definite");
        L[i][j] = Math.sqrt(val);
      } else {
        L[i][j] = (matrix[i][j] - sum) / L[j][j];
      }
    }
  }
  return L;
}

function sampleCorrelatedNormals(L, rng) {
  const z = Array.from({ length: L.length }, () => randomNormal(0, 1, rng));
  return L.map(row => row.reduce((sum, coeff, i) => sum + coeff * z[i], 0));
}

export {
  randomNormal,
  randomLognormal,
  randomGamma,
  randomBeta,
  randomExponential,
  randomCategorical,
  clamp,
  roundToInt,
  randomInt,
  randomChoice,
  fidelityNoise,
  formatMoney,
  erf,
  normalCDF,
  inverseNormalCDF,
  lognormalCDF,
  lognormalInverseCDF,
  betaCDF,
  inverseBetaCDF,
  gamma,
  cholesky,
  sampleCorrelatedNormals
};

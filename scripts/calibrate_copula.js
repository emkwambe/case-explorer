// scripts/calibrate_copula.js — Empirically calibrate the copula target matrix.
// Usage: node scripts/calibrate_copula.js [samples] [iterations]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateBlendedCase } from '../src/generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'distribution_config.json'), 'utf8'));

const SAMPLES = parseInt(process.argv[2], 10) || 3000;
const ITERATIONS = parseInt(process.argv[3], 10) || 8;
const SEED = 'calibrate';

const VARIABLES = CONFIG.copula.variables;
const DESIRED = CONFIG.copula.correlation_matrix;

function pearson(a, b) {
  const n = a.length;
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA, db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  return num / Math.sqrt(denA * denB);
}

function measureAchieved(matrix) {
  const cfg = JSON.parse(JSON.stringify(CONFIG));
  cfg.copula.correlation_matrix = matrix;

  const cases = [];
  for (let i = 0; i < SAMPLES; i++) {
    cases.push(generateBlendedCase(i, cfg, SEED));
  }

  const samples = cases.map(c => ({
    age: c.truth.demographics.age,
    salary_base: c.truth.current_state.salary,
    dti: c.truth.current_state.dti,
    checking_balance: c.truth.current_state.checking_balance,
    credit_score: c.truth.current_state.credit_score
  }));

  const achieved = [];
  for (let i = 0; i < VARIABLES.length; i++) {
    const row = [];
    for (let j = 0; j < VARIABLES.length; j++) {
      const valsA = samples.map(s => s[VARIABLES[i]]);
      const valsB = samples.map(s => s[VARIABLES[j]]);
      row.push(pearson(valsA, valsB));
    }
    achieved.push(row);
  }
  return achieved;
}

function cloneMatrix(m) {
  return m.map(row => [...row]);
}

function adjustMatrix(current, desired, achieved, step) {
  const next = cloneMatrix(current);
  for (let i = 0; i < VARIABLES.length; i++) {
    for (let j = i + 1; j < VARIABLES.length; j++) {
      const error = desired[i][j] - achieved[i][j];
      next[i][j] = clamp(next[i][j] + error * step, -0.99, 0.99);
      next[j][i] = next[i][j];
    }
  }
  return next;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function nearestPositiveDefinite(m) {
  // Simple shrinkage toward identity if eigenvalues are non-positive.
  // This is a pragmatic fallback; for a production system use a proper NPD algorithm.
  let attempt = cloneMatrix(m);
  for (let shrink = 0; shrink <= 0.5; shrink += 0.02) {
    const test = attempt.map((row, i) => row.map((v, j) => (i === j ? 1 : v * (1 - shrink) + shrink * (i === j ? 1 : 0))));
    try {
      const L = cholesky(test);
      if (L) return test;
    } catch {
      // continue shrinking
    }
  }
  return attempt.map((row, i) => row.map((v, j) => (i === j ? 1 : 0)));
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
        if (val <= 0) throw new Error('not positive definite');
        L[i][j] = Math.sqrt(val);
      } else {
        L[i][j] = (matrix[i][j] - sum) / L[j][j];
      }
    }
  }
  return L;
}

function matrixDiff(a, b) {
  let max = 0;
  for (let i = 0; i < VARIABLES.length; i++) {
    for (let j = i + 1; j < VARIABLES.length; j++) {
      max = Math.max(max, Math.abs(a[i][j] - b[i][j]));
    }
  }
  return max;
}

function printMatrix(label, m) {
  console.log(`\n${label}`);
  console.log('[');
  for (const row of m) {
    console.log('  [' + row.map(v => v.toFixed(3)).join(', ') + '],');
  }
  console.log(']');
}

let current = cloneMatrix(DESIRED);
let best = { matrix: current, maxDiff: Infinity };

for (let iter = 0; iter < ITERATIONS; iter++) {
  const achieved = measureAchieved(current);
  const maxDiff = matrixDiff(DESIRED, achieved);
  const withinTolerance = countWithinTolerance(DESIRED, achieved, 0.1);

  console.log(`\nIteration ${iter + 1}: max diff = ${maxDiff.toFixed(4)}, within ±0.10 = ${withinTolerance}/${VARIABLES.length * (VARIABLES.length - 1) / 2}`);

  if (maxDiff < best.maxDiff) {
    best = { matrix: cloneMatrix(current), maxDiff, achieved: cloneMatrix(achieved) };
  }

  const step = Math.max(0.1, 0.6 - iter * 0.06);
  current = adjustMatrix(current, DESIRED, achieved, step);
  current = nearestPositiveDefinite(current);
}

const finalAchieved = measureAchieved(best.matrix);
printMatrix('Desired matrix', DESIRED);
printMatrix('Best calibrated target matrix', best.matrix);
printMatrix('Achieved correlations with calibrated matrix', finalAchieved);

function countWithinTolerance(desired, achieved, tol) {
  let count = 0;
  for (let i = 0; i < VARIABLES.length; i++) {
    for (let j = i + 1; j < VARIABLES.length; j++) {
      if (Math.abs(desired[i][j] - achieved[i][j]) <= tol) count++;
    }
  }
  return count;
}

console.log(`\nWithin ±0.10 tolerance: ${countWithinTolerance(DESIRED, finalAchieved, 0.1)}/${VARIABLES.length * (VARIABLES.length - 1) / 2}`);
console.log(`Within ±0.15 tolerance: ${countWithinTolerance(DESIRED, finalAchieved, 0.15)}/${VARIABLES.length * (VARIABLES.length - 1) / 2}`);
console.log(`Within ±0.25 tolerance: ${countWithinTolerance(DESIRED, finalAchieved, 0.25)}/${VARIABLES.length * (VARIABLES.length - 1) / 2}`);

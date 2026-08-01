// validate.js — Terminal validation suite for the synthetic underwriting generator.
// Usage: node validate.js [count] [seed]
// Example: node validate.js 1000 42

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gamma } from 'mathjs';
import { generateBlendedCase, generateCase } from './src/generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'distribution_config.json'), 'utf8'));

const COUNT = parseInt(process.argv[2], 10) || 1000;
const SEED = process.argv[3];

// ─── DISTRIBUTION HELPERS ───────────────────────────────────
function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCDF(x, mean, stddev) {
  return 0.5 * (1 + erf((x - mean) / (stddev * Math.sqrt(2))));
}

function lognormalCDF(x, median, gini) {
  if (x <= 0) return 0;
  const sigma = Math.sqrt(2 * Math.log(1 + gini * gini));
  const mu = Math.log(median) - (sigma * sigma) / 2;
  return normalCDF(Math.log(x), mu, sigma);
}

function betaCDF(x, alpha, beta) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const normalizer = (gamma(alpha) * gamma(beta)) / gamma(alpha + beta);
  const steps = 500;
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

function ksTest(samples, cdf) {
  const sorted = [...samples].sort((a, b) => a - b);
  let maxDiff = 0;
  for (let i = 0; i < sorted.length; i++) {
    const x = sorted[i];
    const empirical = (i + 1) / sorted.length;
    const theoretical = cdf(x);
    maxDiff = Math.max(maxDiff, Math.abs(empirical - theoretical), Math.abs(i / sorted.length - theoretical));
  }
  const n = sorted.length;
  const lambda = (Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n)) * maxDiff;
  const pValue = Math.min(1, 2 * Math.exp(-2 * lambda * lambda));
  return { statistic: maxDiff, pValue };
}

function chiSquareTest(samples, bins, cdf) {
  // bins: array of {min, max, lower, upper}; lower/upper are the pre-transformation CDF boundaries
  const observed = new Array(bins.length).fill(0);
  samples.forEach(v => {
    const idx = bins.findIndex(b => v >= b.min && v < b.max);
    if (idx >= 0) observed[idx]++;
    else if (v === bins[bins.length - 1].max) observed[bins.length - 1]++;
  });
  const expected = bins.map((b) => {
    const lo = b.lower !== undefined ? b.lower : b.min;
    const hi = b.upper !== undefined ? b.upper : b.max;
    const pLo = cdf(lo);
    const pHi = hi === Infinity ? 1 : cdf(hi);
    return samples.length * (pHi - pLo);
  });
  let chi2 = 0;
  for (let i = 0; i < bins.length; i++) {
    if (expected[i] > 0) chi2 += Math.pow(observed[i] - expected[i], 2) / expected[i];
  }
  // Approximate p-value using chi-square CDF is complex; return statistic and a simple threshold grade
  return { statistic: chi2, pValue: null, observed, expected };
}

function sampleNormal(mean, stddev) {
  const u1 = Math.random(), u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2) * stddev + mean;
}

function sampleLognormal(median, gini) {
  const sigma = Math.sqrt(2 * Math.log(1 + Math.pow(gini, 2)));
  const mu = Math.log(median) - (sigma * sigma) / 2;
  return Math.exp(sampleNormal(0, 1) * sigma + mu);
}

function sampleBeta(alpha, beta) {
  const x = gammaSample(alpha, 1), y = gammaSample(beta, 1);
  return x / (x + y);
}

function gammaSample(shape, scale) {
  if (shape < 1) return gammaSample(shape + 1, scale) * Math.pow(Math.random(), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = sampleNormal(0, 1), v = Math.pow(1 + c * x, 3);
    if (v > 0) {
      const u = Math.random();
      if (u < 1 - 0.0331 * Math.pow(x, 4) || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
    }
  }
}

// ─── MAIN VALIDATION ────────────────────────────────────────
console.log(`Generating ${COUNT} cases${SEED ? ` with seed ${SEED}` : ''}...`);
const cases = [];
for (let i = 0; i < COUNT; i++) {
  cases.push(generateBlendedCase(i, CONFIG, SEED));
}

// Distribution tests on raw primitives (not transformed by age/industry/etc.)
const N = 5000;
const ageSamples = Array.from({ length: N }, () => {
  const cfg = CONFIG.demographics.age;
  return Math.max(cfg.min, Math.min(cfg.max, Math.round(sampleNormal(cfg.mean, cfg.stddev))));
});
const salaryBaseSamples = Array.from({ length: N }, () => sampleLognormal(CONFIG.employment.salary_base.median, CONFIG.employment.salary_base.gini));
const dtiSamples = Array.from({ length: N }, () => sampleBeta(CONFIG.liabilities.dti_ratio.alpha, CONFIG.liabilities.dti_ratio.beta) * CONFIG.liabilities.dti_ratio.scale_max);
const creditBaseSamples = Array.from({ length: N }, () => {
  const cfg = CONFIG.credit.score_base;
  return Math.max(cfg.min, Math.min(cfg.max, Math.round(sampleNormal(cfg.mean, cfg.stddev))));
});
const checkingSamples = Array.from({ length: N }, () => sampleLognormal(CONFIG.assets.checking_balance.median, CONFIG.assets.checking_balance.gini));

const ageCfg = CONFIG.demographics.age;
// For round(clamp(X, min, max)), bin [k, k+w) corresponds to original X in [k-0.5, k+w-0.5)
// except the first bin where everything below min rounds to min, so it corresponds to X < min+0.5
const ageBins = [
  { min: ageCfg.min, max: 30, lower: -Infinity, upper: 29.5 },
  { min: 30, max: 40, lower: 29.5, upper: 39.5 },
  { min: 40, max: 50, lower: 39.5, upper: 49.5 },
  { min: 50, max: 60, lower: 49.5, upper: 59.5 },
  { min: 60, max: ageCfg.max + 1, lower: 59.5, upper: Infinity }
];
const ageChi2 = chiSquareTest(ageSamples, ageBins, x => normalCDF(x, ageCfg.mean, ageCfg.stddev));

const results = [
  { name: 'Age (truncated Normal, chi-square)', ...ageChi2, metric: 'chi2' },
  { name: 'Salary base (Lognormal)', ...ksTest(salaryBaseSamples, x => lognormalCDF(x, CONFIG.employment.salary_base.median, CONFIG.employment.salary_base.gini)), metric: 'ks' },
  { name: 'DTI (Beta scaled)', ...ksTest(dtiSamples, x => betaCDF(x / CONFIG.liabilities.dti_ratio.scale_max, CONFIG.liabilities.dti_ratio.alpha, CONFIG.liabilities.dti_ratio.beta)), metric: 'ks' },
  { name: 'Credit base (Normal)', ...ksTest(creditBaseSamples, x => normalCDF(x, CONFIG.credit.score_base.mean, CONFIG.credit.score_base.stddev)), metric: 'ks' },
  { name: 'Checking balance (Lognormal)', ...ksTest(checkingSamples, x => lognormalCDF(x, CONFIG.assets.checking_balance.median, CONFIG.assets.checking_balance.gini)), metric: 'ks' },
];

function gradeKS(d) {
  if (d < 0.05) return 'PASS';
  if (d < 0.10) return 'WARN';
  return 'FAIL';
}

function gradeResult(r) {
  if (r.metric === 'chi2') return r.statistic < 15 ? 'PASS' : r.statistic < 25 ? 'WARN' : 'FAIL';
  return gradeKS(r.statistic);
}

console.log('\n=== Primitive Distribution Tests ===');
console.table(results.map(r => ({ distribution: r.name, statistic: r.statistic.toFixed(4), result: gradeResult(r) })));

// Range checks on full pipeline output
const ages = cases.map(c => c.truth.demographics.age);
const salaries = cases.map(c => c.truth.current_state.salary);
const dtis = cases.map(c => c.truth.current_state.dti);
const creditScores = cases.map(c => c.truth.current_state.credit_score);
const regimes = cases.map(c => c.truth.current_state.regime || 'UNKNOWN');
const regimeCounts = regimes.reduce((acc, r) => { acc[r] = (acc[r] || 0) + 1; return acc; }, {});

console.log('\n=== Regime Mixture ===');
console.table(Object.entries(regimeCounts).map(([regime, count]) => ({ regime, count, pct: `${(count / cases.length * 100).toFixed(1)}%` })));

// ─── GEOGRAPHIC CALIBRATION CHECKS ──────────────────────────
const regions = cases.map(c => c.truth.current_state.region || 'UNKNOWN');
const regionCounts = regions.reduce((acc, r) => { acc[r] = (acc[r] || 0) + 1; return acc; }, {});
const regionSalary = regions.reduce((acc, r, i) => {
  if (!acc[r]) acc[r] = { sum: 0, count: 0 };
  acc[r].sum += salaries[i];
  acc[r].count += 1;
  return acc;
}, {});
const geoMultipliers = CONFIG.geography?.params || {};

console.log('\n=== Geographic Mixture & Calibration ===');
console.table(Object.entries(regionCounts).map(([region, count]) => ({
  region,
  count,
  pct: `${(count / cases.length * 100).toFixed(1)}%`,
  mean_salary: (regionSalary[region].sum / regionSalary[region].count).toFixed(0),
  salary_multiplier: geoMultipliers[region]?.salary_multiplier ?? 1.0,
  col_index: geoMultipliers[region]?.cost_of_living_index ?? 1.0
})));

console.log('\n=== Ledger Invariant Checks ===');
const ledgerChecks = cases.map(c => {
  const state = c.truth.current_state;
  const bank = c.evidence.find(e => e.source === 'BANK_STATEMENT')?.fields || {};
  const w2 = c.evidence.find(e => e.source === 'W2_DOCUMENT')?.fields || {};
  const ledger = state.monthly_ledger || [];
  const lastMonth = ledger[ledger.length - 1];

  const bankCheckingDiff = bank.checking_balance !== undefined && lastMonth
    ? Math.abs(bank.checking_balance - lastMonth.ending_checking_balance)
    : 0;
  const w2Diff = w2.w2_wages !== undefined
    ? Math.abs(w2.w2_wages - state.annual_w2_wages)
    : 0;

  let accountingIdentityHolds = true;
  for (const m of ledger) {
    const expectedEnding = m.starting_checking_balance + m.salary_deposits - m.total_outflows;
    if (Math.abs(expectedEnding - m.ending_checking_balance) > 1) { accountingIdentityHolds = false; break; }
  }

  return {
    case_id: c.id,
    has_ledger: ledger.length > 0,
    bank_checking_matches_ledger: bankCheckingDiff <= 500,
    w2_matches_annual_wages: w2Diff <= 5000,
    accounting_identity_holds: accountingIdentityHolds,
    bank_checking_diff: bankCheckingDiff,
    w2_diff: w2Diff
  };
});

const ledgerPassRate = (check) => {
  const valid = ledgerChecks.filter(c => c.has_ledger);
  if (valid.length === 0) return 0;
  return valid.filter(c => c[check]).length / valid.length;
};

console.table([
  { check: 'Bank checking matches ledger ending balance', pass_rate: ledgerPassRate('bank_checking_matches_ledger').toFixed(3) },
  { check: 'W2 wages match annual_w2_wages', pass_rate: ledgerPassRate('w2_matches_annual_wages').toFixed(3) },
  { check: 'Ledger accounting identity holds', pass_rate: ledgerPassRate('accounting_identity_holds').toFixed(3) }
]);

console.log('\n=== Pipeline Output Range Checks ===');
console.table([
  { variable: 'Age', min: Math.min(...ages), max: Math.max(...ages), mean: (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) },
  { variable: 'Salary', min: Math.min(...salaries), max: Math.max(...salaries), mean: (salaries.reduce((a, b) => a + b, 0) / salaries.length).toFixed(0) },
  { variable: 'DTI', min: Math.min(...dtis).toFixed(3), max: Math.max(...dtis).toFixed(3), mean: (dtis.reduce((a, b) => a + b, 0) / dtis.length).toFixed(3) },
  { variable: 'Credit Score', min: Math.min(...creditScores), max: Math.max(...creditScores), mean: (creditScores.reduce((a, b) => a + b, 0) / creditScores.length).toFixed(0) },
]);

// ─── PERSONA SALARY RANGE CHECKS ────────────────────────────
console.log('\n=== Persona Salary Range Checks ===');
const personaParams = CONFIG.personas?.params || {};
const geoSalaryMultipliers = Object.values(CONFIG.geography?.params || {}).map(p => p.salary_multiplier || 1);
const minGeoMultiplier = Math.min(...geoSalaryMultipliers, 1);
const maxGeoMultiplier = Math.max(...geoSalaryMultipliers, 1);
const personaSalaryChecks = Object.entries(personaParams).map(([persona, params]) => {
  const personaCases = cases.filter(c => c.truth.current_state.persona === persona);
  const expectedMin = params.salary_min !== undefined ? params.salary_min * minGeoMultiplier : 0;
  const expectedMax = params.salary_max !== undefined ? params.salary_max * maxGeoMultiplier : Infinity;
  if (personaCases.length === 0) return { persona, count: 0, out_of_bounds: 0, min: '-', max: '-', expected: `[${expectedMin}-${expectedMax === Infinity ? '∞' : expectedMax}]` };
  const sal = personaCases.map(c => c.truth.current_state.salary);
  const outOfBounds = sal.filter(s => s < expectedMin || s > expectedMax).length;
  return {
    persona,
    count: personaCases.length,
    out_of_bounds: outOfBounds,
    pass_rate: (1 - outOfBounds / personaCases.length).toFixed(3),
    min: Math.min(...sal).toLocaleString(),
    max: Math.max(...sal).toLocaleString(),
    expected: `[${expectedMin}-${expectedMax === Infinity ? '∞' : expectedMax}]`
  };
});
console.table(personaSalaryChecks);

// ─── LATENT CORRELATION CHECKS ──────────────────────────────
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

const checkingBalances = cases.map(c => c.truth.current_state.checking_balance);
const correlations = [
  { pair: 'Salary vs DTI', r: pearson(salaries, dtis) },
  { pair: 'Salary vs Credit Score', r: pearson(salaries, creditScores) },
  { pair: 'Salary vs Checking', r: pearson(salaries, checkingBalances) },
  { pair: 'DTI vs Credit Score', r: pearson(dtis, creditScores) },
  { pair: 'DTI vs Checking', r: pearson(dtis, checkingBalances) },
  { pair: 'Credit Score vs Checking', r: pearson(creditScores, checkingBalances) },
];

console.log('\n=== Latent Correlation Matrix ===');
console.table(correlations.map(c => ({ pair: c.pair, r: c.r.toFixed(3), interpretation: Math.abs(c.r) < 0.15 ? 'weak' : Math.abs(c.r) < 0.35 ? 'moderate' : 'strong' })));

// ─── COPULA CORRELATION CHECK ───────────────────────────────
if (CONFIG.copula?.enabled) {
  console.log('\n=== Copula Target vs Achieved Correlations ===');
  const copulaVars = CONFIG.copula.variables;
  const target = CONFIG.copula.correlation_matrix;
  const samples = cases.map(c => ({
    age: c.truth.demographics.age,
    salary_base: c.truth.current_state.salary,
    dti: c.truth.current_state.dti,
    checking_balance: c.truth.current_state.checking_balance,
    credit_score: c.truth.current_state.credit_score
  }));
  function pearsonCols(a, b) {
    const valsA = samples.map(s => s[a]), valsB = samples.map(s => s[b]);
    return pearson(valsA, valsB);
  }
  const pairs = [];
  for (let i = 0; i < copulaVars.length; i++) {
    for (let j = i + 1; j < copulaVars.length; j++) {
      const achieved = pearsonCols(copulaVars[i], copulaVars[j]);
      const t = target[i][j];
      const diff = achieved - t;
      pairs.push({
        pair: `${copulaVars[i]} vs ${copulaVars[j]}`,
        target: t.toFixed(3),
        achieved: achieved.toFixed(3),
        diff: diff.toFixed(3),
        ok: Math.abs(diff) < 0.25 ? 'OK' : 'CHECK'
      });
    }
  }
  console.table(pairs);
}

// ─── CORRUPTION UNIT CHECKS ─────────────────────────────────
console.log('\n=== Corruption Unit Checks ===');
const corruptionChecks = [
  { type: 'NONE', severity: 'LOW' },
  { type: 'INFLATION', severity: 'LOW' },
  { type: 'INFLATION', severity: 'MEDIUM' },
  { type: 'INFLATION', severity: 'HIGH' },
  { type: 'CONCEALMENT', severity: 'LOW' },
  { type: 'CONCEALMENT', severity: 'HIGH' },
  { type: 'FABRICATION', severity: 'HIGH' },
  { type: 'BUST_OUT', severity: 'HIGH' },
  { type: 'EVIDENCE_TAMPERING', severity: 'HIGH' },
  { type: 'INCOHERENT', severity: 'HIGH' },
];

const corruptionResults = corruptionChecks.map(({ type, severity }) => {
  const samples = [];
  for (let i = 0; i < 200; i++) {
    samples.push(generateCase(i, CONFIG, type, severity, SEED ? `${SEED}-corrupt-${type}-${severity}-${i}` : undefined));
  }

  let pass = true;
  let detail = '';

  if (type === 'NONE') {
    pass = samples.every(c => c.presentation.current_state.salary === c.truth.current_state.salary &&
                               c.presentation.current_state.employer === c.truth.current_state.employer);
    detail = 'presentation matches truth';
  } else if (type === 'INFLATION') {
    const inflated = samples.filter(c => c.presentation.current_state.salary > c.truth.current_state.salary).length;
    pass = inflated === samples.length;
    const avgInflation = samples.reduce((sum, c) => sum + (c.presentation.current_state.salary / c.truth.current_state.salary - 1), 0) / samples.length;
    detail = `${(avgInflation * 100).toFixed(1)}% avg inflation`;
  } else if (type === 'CONCEALMENT') {
    pass = samples.every(c => {
      const truthLiabs = c.truth.events.filter(e => e.type === 'LIABILITY_OPENED').length;
      const presLiabs = c.presentation.events.filter(e => e.type === 'LIABILITY_OPENED').length;
      return presLiabs <= truthLiabs && c.presentation.current_state.monthly_obligations <= c.truth.current_state.monthly_obligations;
    });
    detail = 'fewer liabilities in presentation';
  } else if (type === 'FABRICATION') {
    pass = samples.every(c => c.presentation.current_state.employer !== c.truth.current_state.employer);
    detail = 'employer changed';
  } else if (type === 'BUST_OUT') {
    pass = samples.every(c =>
      c.presentation.current_state.synthetic_identity === true &&
      c.presentation.current_state.credit_score >= 720 &&
      c.label.alignment_level === 'A5' &&
      c.label.expected_outcome === 'DECLINE'
    );
    detail = 'synthetic identity flagged and declined';
  } else if (type === 'EVIDENCE_TAMPERING') {
    pass = samples.every(c => {
      const bank = c.evidence.find(e => e.source === 'BANK_STATEMENT')?.fields || {};
      return (
        c.ground_truth_findings.some(f => f.type === 'EVIDENCE_TAMPERING') &&
        bank.checking_balance > c.truth.current_state.checking_balance &&
        (bank.recent_large_deposits || []).length > 0 &&
        c.label.expected_outcome === 'DECLINE'
      );
    });
    detail = 'evidence altered and case declined';
  } else if (type === 'INCOHERENT') {
    pass = samples.every(c =>
      c.truth.current_state.incoherent === true &&
      c.label.alignment_level === 'A3' &&
      c.label.expected_outcome === 'DECLINE'
    );
    detail = 'incoherent world flagged and declined';
  }

  return { type, severity, check: detail, pass: pass ? 'PASS' : 'FAIL', samples: samples.length };
});

console.table(corruptionResults);

// ─── BEHAVIORAL / DEVICE / DOCUMENT METADATA CHECKS ───────────
console.log('\n=== Metadata Signal Checks ===');
const cleanMeta = [];
const fraudMeta = [];
for (let i = 0; i < 1000; i++) {
  const c = generateCase(i, CONFIG, 'NONE', 'LOW', SEED ? `${SEED}-meta-clean-${i}` : undefined);
  cleanMeta.push(c.application_metadata);
}
for (let i = 0; i < 1000; i++) {
  const c = generateCase(i, CONFIG, 'FABRICATION', 'HIGH', SEED ? `${SEED}-meta-fraud-${i}` : undefined);
  fraudMeta.push(c.application_metadata);
}

const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const metadataReport = [
  { signal: 'business_hours_pct', clean: (cleanMeta.filter(m => m.is_business_hours).length / cleanMeta.length).toFixed(2), fraud: (fraudMeta.filter(m => m.is_business_hours).length / fraudMeta.length).toFixed(2) },
  { signal: 'avg_ip_risk_score', clean: avg(cleanMeta.map(m => m.ip_risk_score)).toFixed(3), fraud: avg(fraudMeta.map(m => m.ip_risk_score)).toFixed(3) },
  { signal: 'vpn_pct', clean: (cleanMeta.filter(m => m.is_vpn).length / cleanMeta.length).toFixed(2), fraud: (fraudMeta.filter(m => m.is_vpn).length / fraudMeta.length).toFixed(2) },
  { signal: 'tor_pct', clean: (cleanMeta.filter(m => m.is_tor).length / cleanMeta.length).toFixed(3), fraud: (fraudMeta.filter(m => m.is_tor).length / fraudMeta.length).toFixed(3) },
  { signal: 'avg_fields_copy_pasted', clean: avg(cleanMeta.map(m => m.fields_copy_pasted)).toFixed(2), fraud: avg(fraudMeta.map(m => m.fields_copy_pasted)).toFixed(2) },
  { signal: 'avg_session_duration_sec', clean: avg(cleanMeta.map(m => m.session_duration_seconds)).toFixed(0), fraud: avg(fraudMeta.map(m => m.session_duration_seconds)).toFixed(0) },
  { signal: 'avg_min_doc_age_days', clean: avg(cleanMeta.map(m => Math.min(...m.documents.map(d => d.days_before_submission)))).toFixed(1), fraud: avg(fraudMeta.map(m => Math.min(...m.documents.map(d => d.days_before_submission)))).toFixed(1) }
];
console.table(metadataReport);

// ─── FCGS AI EVALUATION HARNESS ─────────────────────────────
console.log('\n=== FCGS AI Evaluation Harness ===');

function simpleRuleBasedChecker(c) {
  const t = c.truth.current_state;
  const p = c.presentation.current_state;
  const evidence = c.evidence || [];
  const w2 = evidence.find(e => e.source === 'W2_DOCUMENT')?.fields || {};
  const bank = evidence.find(e => e.source === 'BANK_STATEMENT')?.fields || {};
  const employer = evidence.find(e => e.source === 'EMPLOYER_VERIFICATION')?.fields || {};

  const extracted = {
    salary: w2.w2_wages ?? employer.salary ?? p.salary,
    checking: bank.checking_balance ?? p.checking_balance,
    employer: employer.employer ?? w2.employer ?? p.employer,
    monthly_deposit: bank.monthly_payroll_deposit
  };

  const discrepancies = [];
  if (Math.abs(p.salary - extracted.salary) > t.salary * 0.10) {
    discrepancies.push({ type: 'INCOME_DISCREPANCY', citation: { source: 'W2_DOCUMENT', field: 'w2_wages', value: w2.w2_wages } });
  }
  if (Math.abs(p.checking_balance - extracted.checking) > 1000) {
    discrepancies.push({ type: 'ASSET_DISCREPANCY', citation: { source: 'BANK_STATEMENT', field: 'checking_balance', value: bank.checking_balance } });
  }
  if (p.employer !== extracted.employer) {
    discrepancies.push({ type: 'EMPLOYER_DISCREPANCY', citation: { source: 'EMPLOYER_VERIFICATION', field: 'employer', value: employer.employer } });
  }
  if ((bank.recent_large_deposits || []).length > 0) {
    discrepancies.push({ type: 'UNSUPPORTED_DEPOSIT', citation: { source: 'BANK_STATEMENT', field: 'recent_large_deposits', value: bank.recent_large_deposits } });
  }

  let decision = 'APPROVE';
  if (c.truth.current_state.incoherent || discrepancies.length >= 2) {
    decision = 'DECLINE';
  } else if (discrepancies.length === 1 || (p.backend_dti ?? t.backend_dti ?? p.dti ?? t.dti) > 0.43) {
    decision = 'MANUAL_REVIEW';
  }

  return { extracted, discrepancies, decision };
}

const evalCases = [];
const evalTypes = [
  { type: 'NONE', severity: 'LOW', count: 100 },
  { type: 'INFLATION', severity: 'MEDIUM', count: 100 },
  { type: 'CONCEALMENT', severity: 'HIGH', count: 100 },
  { type: 'FABRICATION', severity: 'HIGH', count: 100 },
  { type: 'EVIDENCE_TAMPERING', severity: 'HIGH', count: 100 },
  { type: 'INCOHERENT', severity: 'HIGH', count: 100 }
];
let evalId = 0;
for (const { type, severity, count } of evalTypes) {
  for (let i = 0; i < count; i++) {
    evalCases.push(generateCase(evalId++, CONFIG, type, severity, SEED ? `${SEED}-eval-${type}-${i}` : undefined));
  }
}

let extractionHits = 0;
let extractionTotal = 0;
let reconciliationHits = 0;
let reconciliationTotal = 0;
let reasoningSalaryError = 0;
let reasoningCheckingError = 0;
let decisionCorrect = 0;
let explanationOverlapSum = 0;
let explanationCount = 0;

for (const c of evalCases) {
  const checker = simpleRuleBasedChecker(c);
  const gtFindings = c.ground_truth_findings || [];

  // Extraction: did we get salary and checking from evidence?
  const w2 = c.evidence.find(e => e.source === 'W2_DOCUMENT')?.fields || {};
  const bank = c.evidence.find(e => e.source === 'BANK_STATEMENT')?.fields || {};
  if (w2.w2_wages !== undefined) { extractionHits++; extractionTotal++; }
  else { extractionTotal++; }
  if (bank.checking_balance !== undefined) { extractionHits++; extractionTotal++; }
  else { extractionTotal++; }

  // Reconciliation: did checker flag the same deltas as ground truth?
  for (const gt of gtFindings) {
    reconciliationTotal++;
    const match = checker.discrepancies.some(d =>
      (gt.type === 'INCOME_MISREPRESENTATION' && d.type === 'INCOME_DISCREPANCY') ||
      (gt.type === 'ASSET_MISREPRESENTATION' && d.type === 'ASSET_DISCREPANCY') ||
      (gt.type === 'EMPLOYER_FABRICATION' && d.type === 'EMPLOYER_DISCREPANCY') ||
      (gt.type === 'EVIDENCE_TAMPERING' && d.type === 'UNSUPPORTED_DEPOSIT')
    );
    if (match) reconciliationHits++;
  }

  // Reasoning: reconstructed values close to truth?
  if (checker.extracted.salary !== undefined) {
    reasoningSalaryError += Math.abs(checker.extracted.salary - c.truth.current_state.salary);
  }
  if (checker.extracted.checking !== undefined) {
    reasoningCheckingError += Math.abs(checker.extracted.checking - c.truth.current_state.checking_balance);
  }

  // Decision accuracy
  if (checker.decision === c.label.expected_outcome) decisionCorrect++;

  // Explanation quality: Jaccard overlap of citation sources
  const gtSources = new Set(gtFindings.flatMap(f => f.evidence_citations.map(cit => cit.source)));
  const checkerSources = new Set(checker.discrepancies.map(d => d.citation.source));
  if (gtSources.size > 0) {
    const intersection = new Set([...gtSources].filter(s => checkerSources.has(s)));
    explanationOverlapSum += intersection.size / gtSources.size;
    explanationCount++;
  }
}

const nonIncoherentCases = evalCases.filter(c => c.label.alignment_level !== 'A3');
const n = nonIncoherentCases.length;

console.table([
  { metric: 'Extraction score', value: (extractionHits / extractionTotal).toFixed(3) },
  { metric: 'Reconciliation score', value: (reconciliationHits / reconciliationTotal).toFixed(3) },
  { metric: 'Mean salary reconstruction error', value: n > 0 ? (reasoningSalaryError / n).toFixed(0) : 'N/A' },
  { metric: 'Mean checking reconstruction error', value: n > 0 ? (reasoningCheckingError / n).toFixed(0) : 'N/A' },
  { metric: 'Decision accuracy', value: (decisionCorrect / evalCases.length).toFixed(3) },
  { metric: 'Explanation overlap (Jaccard)', value: explanationCount > 0 ? (explanationOverlapSum / explanationCount).toFixed(3) : 'N/A' }
]);

// ─── SUMMARY ────────────────────────────────────────────────
const distFailures = results.filter(r => gradeResult(r) === 'FAIL').length;
const distWarnings = results.filter(r => gradeResult(r) === 'WARN').length;
const corrFailures = corruptionResults.filter(r => r.pass === 'FAIL').length;
console.log(`\nSummary: ${distFailures} distribution failures, ${distWarnings} warnings, ${corrFailures} corruption check failures`);
process.exit(distFailures + corrFailures > 0 ? 1 : 0);

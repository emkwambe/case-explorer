// src/generator.js — Pure JavaScript synthetic underwriting case generator.
// This module contains no React code and can be used in the browser (Vite) or Node.

const FIRST_NAMES = ["James", "Maria", "Robert", "Linda", "Michael", "Patricia", "David", "Jennifer", "John", "Elizabeth"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"];

// ─── 0. SEEDED PRNG (Mulberry32) ───────────────────────────
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed) {
  if (seed === undefined || seed === null || seed === "") return { random: () => Math.random(), seeded: false };
  let s = typeof seed === "number" ? seed : hashString(String(seed));
  return {
    seeded: true,
    random: () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };
}

// ─── 1. STATISTICAL SAMPLING PRIMITIVES ─────────────────────
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

// ─── 1b. COPULA MATH HELPERS ────────────────────────────────
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

// ─── 2. GENERATION LOGIC ────────────────────────────────────
function generateDemographics(config, rng, ageOverride) {
  const cfg = config.demographics.age;
  return {
    age: ageOverride ?? roundToInt(clamp(randomNormal(cfg.mean, cfg.stddev, rng), cfg.min, cfg.max)),
    ssn_last4: String(randomInt(config.demographics.ssn_last4.min, config.demographics.ssn_last4.max, rng))
  };
}

function sampleCorrelatedPrimitives(config, rng) {
  const copulaCfg = config.copula;
  if (!copulaCfg?.enabled) return null;
  const vars = copulaCfg.variables;
  const corr = copulaCfg.correlation_matrix;
  const L = cholesky(corr);
  const correlatedNormals = sampleCorrelatedNormals(L, rng);
  const uniforms = correlatedNormals.map(z => normalCDF(z));

  const result = {};
  vars.forEach((name, i) => {
    const u = uniforms[i];
    if (name === "age") {
      const cfg = config.demographics.age;
      result[name] = clamp(roundToInt(inverseNormalCDF(u) * cfg.stddev + cfg.mean), cfg.min, cfg.max);
    } else if (name === "salary_base") {
      const cfg = config.employment.salary_base;
      result[name] = lognormalInverseCDF(u, cfg.median, cfg.gini);
    } else if (name === "dti") {
      const cfg = config.liabilities.dti_ratio;
      const scaleMin = cfg.scale_min || 0;
      const scaleMax = cfg.scale_max;
      result[name] = inverseBetaCDF(u, cfg.alpha, cfg.beta) * (scaleMax - scaleMin) + scaleMin;
    } else if (name === "checking_balance") {
      const cfg = config.assets.checking_balance;
      result[name] = lognormalInverseCDF(u, cfg.median, cfg.gini);
    } else if (name === "credit_score") {
      const cfg = config.credit.score_base;
      result[name] = clamp(roundToInt(inverseNormalCDF(u) * cfg.stddev + cfg.mean), cfg.min, cfg.max);
    }
  });
  return result;
}

function generateEmployment(age, config, rng, financialHealth = 0, regime = "GENERIC", persona = null, salaryBaseOverride, geoSalaryMultiplier = 1.0) {
  const empCfg = config.employment;
  const latentCfg = config.latent?.financial_health || {};
  const regimeParams = config.regimes?.params?.[regime] || {};
  const personaParams = persona ? config.personas?.params?.[persona] || {} : {};
  const isSelfEmployed = regime === "SELF_EMPLOYED";
  const industry = isSelfEmployed
    ? "Professional Services"
    : (personaParams.industry || randomCategorical(empCfg.industry.categories, empCfg.industry.probabilities, rng));
  // Use persona-specific salary distribution when available; otherwise fall back to global.
  // Scale the persona salary center by the regional cost-of-labor multiplier so the same
  // job in a high-cost market earns more, without breaking the persona-specific realism band.
  const personaHasSalary = personaParams.salary_median !== undefined;
  const salaryParams = personaHasSalary
    ? { median: personaParams.salary_median * geoSalaryMultiplier, gini: personaParams.salary_gini ?? empCfg.salary_base.gini }
    : { median: empCfg.salary_base.median * geoSalaryMultiplier, gini: empCfg.salary_base.gini };
  const gini = regimeParams.income_gini_multiplier
    ? salaryParams.gini * regimeParams.income_gini_multiplier
    : salaryParams.gini;

  let salary;
  if (salaryBaseOverride !== undefined && personaHasSalary) {
    // Map the global copula sample to the region-adjusted persona-specific distribution via percentile.
    const percentile = clamp(lognormalCDF(salaryBaseOverride, empCfg.salary_base.median, empCfg.salary_base.gini), 0.001, 0.999);
    const sigma = Math.sqrt(2 * Math.log(1 + gini * gini));
    const mu = Math.log(salaryParams.median) - (sigma * sigma) / 2;
    salary = Math.exp(inverseNormalCDF(percentile) * sigma + mu);
  } else if (salaryBaseOverride !== undefined) {
    salary = salaryBaseOverride * geoSalaryMultiplier;
  } else {
    salary = randomLognormal(salaryParams.median, gini, rng);
  }

  salary += age * empCfg.salary_by_age.age_coefficient;
  if (age > empCfg.salary_by_age.peak_age) {
    salary *= Math.pow(1 - empCfg.salary_by_age.decline_rate, age - empCfg.salary_by_age.peak_age);
  }
  salary *= (empCfg.industry_salary_multiplier[industry] || 1.0);
  salary *= (personaParams.salary_multiplier || 1.0);
  const incomeSensitivity = latentCfg.income_sensitivity ?? 0.25;
  salary *= Math.max(0.5, 1 + financialHealth * incomeSensitivity);

  // Clamp to region-adjusted persona-specific realistic bounds (or global floor if none).
  if (personaHasSalary) {
    const min = (personaParams.salary_min ?? 0) * geoSalaryMultiplier;
    const max = (personaParams.salary_max ?? Infinity) * geoSalaryMultiplier;
    salary = clamp(salary, min, max);
  }
  const tenureRate = regimeParams.tenure_rate_multiplier
    ? empCfg.tenure_months.rate * regimeParams.tenure_rate_multiplier
    : empCfg.tenure_months.rate;
  const tenureMonths = roundToInt(clamp(randomExponential(tenureRate, rng), empCfg.tenure_months.min, empCfg.tenure_months.max));
  return {
    industry,
    salary: roundToInt(salary),
    tenureMonths,
    hasGap: rng.random() < empCfg.employment_gap_prob.p,
    isSelfEmployed,
    persona,
    tenureStability: personaParams.tenure_stability || "stable"
  };
}

function generateLiabilities(salary, config, rng, financialHealth = 0, regime = "GENERIC", dtiOverride) {
  const liabCfg = config.liabilities;
  const latentCfg = config.latent?.financial_health || {};
  const regimeParams = config.regimes?.params?.[regime] || {};
  const scaleMin = liabCfg.dti_ratio.scale_min || 0;
  const scaleMax = Math.min(regimeParams.max_dti_ratio ?? liabCfg.dti_ratio.scale_max, liabCfg.dti_ratio.scale_max);
  let dti = dtiOverride ?? randomBeta(liabCfg.dti_ratio.alpha, liabCfg.dti_ratio.beta, rng) * (scaleMax - scaleMin);
  const dtiSensitivity = latentCfg.dti_sensitivity ?? 0.30;
  dti *= Math.max(0.25, 1 - financialHealth * dtiSensitivity);
  dti = clamp(dti, 0, scaleMax - scaleMin);
  dti += scaleMin;
  const totalMonthlyDebt = salary * dti / 12;
  const hasStudentLoan = rng.random() < liabCfg.student_loan_prob.p;
  const studentLoanPayment = hasStudentLoan
    ? randomLognormal(liabCfg.student_loan_amount.median, liabCfg.student_loan_amount.gini, rng) * 0.01
    : 0;
  const hasAutoLoan = rng.random() < liabCfg.auto_loan_prob.p;
  const autoPayment = hasAutoLoan
    ? clamp(randomNormal(liabCfg.auto_loan_payment.mean, liabCfg.auto_loan_payment.stddev, rng), liabCfg.auto_loan_payment.min, liabCfg.auto_loan_payment.max)
    : 0;
  return {
    dti,
    studentLoanPayment: roundToInt(studentLoanPayment),
    autoPayment: roundToInt(autoPayment),
    otherDebt: roundToInt(Math.max(0, totalMonthlyDebt - studentLoanPayment - autoPayment))
  };
}

function generateHousingHistory(startDate, tenureMonths, rng, rentMultiplier = 1.0) {
  const events = [];
  const moveInDate = new Date(startDate);
  moveInDate.setMonth(moveInDate.getMonth() - Math.min(tenureMonths + randomInt(6, 36, rng), 120));
  const firstRent = Math.round(randomInt(1000, 2200, rng) * rentMultiplier);
  events.push({
    t: moveInDate.toISOString().split('T')[0],
    type: "ADDRESS_CHANGE",
    type_detail: "RENTED",
    address: `${randomInt(100, 9999, rng)} ${randomChoice(["Oak", "Maple", "Pine", "Cedar", "Elm"], rng)} ${randomChoice(["St", "Ave", "Blvd", "Dr"], rng)}`,
    monthly_payment: firstRent
  });
  if (rng.random() < 0.35) {
    const moveDate = new Date(moveInDate);
    moveDate.setMonth(moveDate.getMonth() + randomInt(12, 48, rng));
    if (moveDate < startDate) {
      events.push({
        t: moveDate.toISOString().split('T')[0],
        type: "ADDRESS_CHANGE",
        type_detail: "RENTED",
        address: `${randomInt(100, 9999, rng)} ${randomChoice(["Willow", "Birch", "Spruce", "Ash"], rng)} ${randomChoice(["St", "Ave", "Blvd", "Dr"], rng)}`,
        monthly_payment: Math.round(firstRent * (1 + randomBeta(2, 5, rng) * 0.4))
      });
    }
  }
  return events;
}

function generateAssets(salary, config, rng, financialHealth = 0, regime = "GENERIC", checkingOverride) {
  const assetCfg = config.assets;
  const latentCfg = config.latent?.financial_health || {};
  const regimeParams = config.regimes?.params?.[regime] || {};
  const rate = randomBeta(assetCfg.savings_rate.alpha, assetCfg.savings_rate.beta, rng);
  const monthlySavings = (salary / 12) * rate;
  const downPaymentMonths = roundToInt(clamp(
    randomNormal(assetCfg.down_payment_months.mean, assetCfg.down_payment_months.stddev, rng),
    assetCfg.down_payment_months.min,
    assetCfg.down_payment_months.max
  ));
  let checkingBalance = checkingOverride ?? randomLognormal(assetCfg.checking_balance.median, assetCfg.checking_balance.gini, rng);
  const checkingSensitivity = latentCfg.checking_sensitivity ?? 0.40;
  checkingBalance *= Math.max(0.25, 1 + financialHealth * checkingSensitivity);
  if (regimeParams.checking_balance_multiplier) {
    checkingBalance *= regimeParams.checking_balance_multiplier;
  }
  return {
    checkingBalance: roundToInt(checkingBalance),
    downPaymentAmount: roundToInt(monthlySavings * downPaymentMonths)
  };
}

function generateCreditScore(dti, config, rng, financialHealth = 0, regime = "GENERIC", creditScoreOverride) {
  const creditCfg = config.credit;
  const latentCfg = config.latent?.financial_health || {};
  const regimeParams = config.regimes?.params?.[regime] || {};
  let score = creditScoreOverride ?? roundToInt(clamp(
    randomNormal(creditCfg.score_base.mean, creditCfg.score_base.stddev, rng),
    creditCfg.score_base.min,
    creditCfg.score_base.max
  ));
  score += (dti * 100) * (creditCfg.score_by_dti.dti_penalty / 10);
  const creditSensitivity = latentCfg.credit_sensitivity ?? 25;
  score += financialHealth * creditSensitivity;
  if (rng.random() < 0.12) score -= randomInt(40, 120, rng);
  if (regimeParams.credit_score_cap !== undefined) {
    score = Math.min(score, regimeParams.credit_score_cap);
  }
  if (regimeParams.credit_score_floor !== undefined) {
    score = Math.max(score, regimeParams.credit_score_floor);
  }
  return roundToInt(clamp(score, creditCfg.score_base.min, creditCfg.score_base.max));
}

// ─── 2b. INCOME / EXPENSE / LEDGER PRIMITIVES ───────────────
function generateIncomeStream(salary, config, rng) {
  const incomeCfg = config.income;
  const frequency = randomCategorical(
    incomeCfg.pay_frequency.categories,
    incomeCfg.pay_frequency.probabilities,
    rng
  );
  const checksPerYear = frequency === "BIWEEKLY" ? 26 : frequency === "SEMIMONTHLY" ? 24 : 12;
  const deductionRate = randomBeta(
    incomeCfg.pretax_deduction_rate.alpha,
    incomeCfg.pretax_deduction_rate.beta,
    rng
  ) * ((incomeCfg.pretax_deduction_rate.scale_max || 1) - (incomeCfg.pretax_deduction_rate.scale_min || 0))
    + (incomeCfg.pretax_deduction_rate.scale_min || 0);
  const grossPerCheck = salary / checksPerYear;
  const netPerCheck = roundToInt(grossPerCheck * (1 - deductionRate));
  const annualW2Wages = roundToInt(salary * (1 - deductionRate));
  return {
    gross_annual_salary: salary,
    pay_frequency: frequency,
    checks_per_year: checksPerYear,
    gross_per_check: roundToInt(grossPerCheck),
    pretax_deduction_rate: roundToInt(deductionRate * 1000) / 1000,
    net_per_check: netPerCheck,
    annual_w2_wages: annualW2Wages,
    monthly_net_deposit: roundToInt(netPerCheck * (checksPerYear / 12))
  };
}

function generateExpenseObligations(salary, rent, monthlyLiabilities, config, rng) {
  const expenseCfg = config.expenses;
  const utilities = roundToInt(clamp(
    randomNormal(expenseCfg.utility_amount.mean, expenseCfg.utility_amount.stddev, rng),
    expenseCfg.utility_amount.min,
    expenseCfg.utility_amount.max
  ));
  const discretionaryRate = randomBeta(expenseCfg.discretionary_rate.alpha, expenseCfg.discretionary_rate.beta, rng)
    * ((expenseCfg.discretionary_rate.scale_max || 1) - (expenseCfg.discretionary_rate.scale_min || 0))
    + (expenseCfg.discretionary_rate.scale_min || 0);
  const discretionary = roundToInt((salary / 12) * discretionaryRate);
  return {
    rent: roundToInt(rent),
    utilities,
    liabilities: roundToInt(monthlyLiabilities),
    discretionary,
    total_monthly: roundToInt(rent + utilities + monthlyLiabilities + discretionary)
  };
}

function simulateMonthlyLedger(truth, config, months, rng) {
  const state = truth.current_state;
  const income = state.income_stream;
  const expenses = state.expense_obligations;
  const ledgerCfg = config.ledger || { statement_months: 3, overdraft_fee: 35 };
  const housingEvents = state.housing_history || [];
  const currentHousing = housingEvents[housingEvents.length - 1] || { monthly_payment: expenses.rent };
  const applicationDate = new Date();

  const ledger = [];
  let endingBalance = state.checking_balance;
  let overdraftCount = 0;

  for (let i = 0; i < months; i++) {
    const monthDate = new Date(applicationDate);
    monthDate.setMonth(monthDate.getMonth() - i);
    const monthRent = currentHousing.monthly_payment || expenses.rent;

    // Payroll deposits vary slightly month-to-month
    const payrollVariance = config.income?.payroll_variance || { stddev: 0.02 };
    const depositNoise = 1 + randomNormal(0, payrollVariance.stddev || 0.02, rng);
    const monthlyDeposit = roundToInt(income.monthly_net_deposit * depositNoise);

    // Discretionary spending varies more
    const discretionaryNoise = 1 + randomNormal(0, 0.12, rng);
    const monthlyDiscretionary = roundToInt(Math.max(0, expenses.discretionary * discretionaryNoise));

    const outflows = monthRent + expenses.utilities + expenses.liabilities + monthlyDiscretionary;
    const startingBalance = endingBalance - monthlyDeposit + outflows;

    const monthEntry = {
      month: monthDate.toISOString().slice(0, 7),
      salary_deposits: monthlyDeposit,
      rent_paid: monthRent,
      utilities_paid: expenses.utilities,
      liability_payments: expenses.liabilities,
      discretionary_spent: monthlyDiscretionary,
      total_outflows: outflows,
      starting_checking_balance: roundToInt(startingBalance),
      ending_checking_balance: roundToInt(endingBalance),
      events: []
    };

    if (startingBalance < 0) {
      overdraftCount++;
      monthEntry.events.push({ type: "OVERDRAFT", fee: ledgerCfg.overdraft_fee || 35 });
    }

    ledger.unshift(monthEntry);
    endingBalance = startingBalance;
  }

  return { ledger, overdraft_count: overdraftCount };
}

export function generateLifeScript(entityId, config, rng = { random: () => Math.random() }) {
  const copulaCfg = config.copula;
  const copulaEnabled = copulaCfg?.enabled ?? false;
  const copulaPrimitives = copulaEnabled ? sampleCorrelatedPrimitives(config, rng) : null;
  const dampenLatent = copulaEnabled ? (copulaCfg.dampen_latent_health ?? 0.25) : 1.0;

  const latentCfg = config.latent?.financial_health || { distribution: "normal", mean: 0, stddev: 1 };
  const regimeCfg = config.regimes || { categories: ["GENERIC"], probabilities: [1] };
  const personaCfg = config.personas || { categories: ["GENERIC"], probabilities: [1] };
  const regime = randomCategorical(regimeCfg.categories, regimeCfg.probabilities, rng);
  const persona = randomCategorical(personaCfg.categories, personaCfg.probabilities, rng);
  const regimeParams = regimeCfg.params?.[regime] || {};

  const geoCfg = config.geography || { categories: ["MEDIUM_COST"], probabilities: [1], params: { MEDIUM_COST: { zip_prefixes: ["00"], cost_of_living_index: 1, rent_multiplier: 1, salary_multiplier: 1, checking_multiplier: 1 } } };
  const region = randomCategorical(geoCfg.categories, geoCfg.probabilities, rng);
  const geoParams = geoCfg.params?.[region] || { zip_prefixes: ["00"], cost_of_living_index: 1, rent_multiplier: 1, salary_multiplier: 1, checking_multiplier: 1 };
  const zipPrefix = randomChoice(geoParams.zip_prefixes, rng);
  const zipCode = zipPrefix + String(randomInt(1000, 9999, rng)).padStart(4, '0');

  let financialHealth = randomNormal(latentCfg.mean ?? 0, latentCfg.stddev ?? 1, rng);
  financialHealth += regimeParams.financial_health_shift ?? 0;
  financialHealth *= dampenLatent;

  const { age, ssn_last4 } = generateDemographics(config, rng, copulaPrimitives?.age);
  const geoSalaryMultiplier = geoParams.salary_multiplier || 1.0;
  const emp = generateEmployment(age, config, rng, financialHealth, regime, persona, copulaPrimitives?.salary_base, geoSalaryMultiplier);
  const personaParams = config.personas?.params?.[persona] || {};
  const regionAdjustedSalaryMax = personaParams.salary_max !== undefined ? personaParams.salary_max * geoSalaryMultiplier : Infinity;
  const regionAdjustedSalaryMin = personaParams.salary_min !== undefined ? personaParams.salary_min * geoSalaryMultiplier : 0;
  const liab = generateLiabilities(emp.salary, config, rng, financialHealth, regime, copulaPrimitives?.dti);
  const assets = generateAssets(emp.salary, config, rng, financialHealth, regime, copulaPrimitives?.checking_balance);
  assets.checkingBalance = roundToInt(assets.checkingBalance * (geoParams.checking_multiplier || 1.0));
  const creditScore = generateCreditScore(liab.dti, config, rng, financialHealth, regime, copulaPrimitives?.credit_score);
  const startDate = new Date(2024, 0, 1);
  const events = [];
  const empStartDate = new Date(startDate);
  empStartDate.setMonth(empStartDate.getMonth() - emp.tenureMonths);
  const employerName = emp.isSelfEmployed ? `${randomChoice(["Smith", "Johnson", "Williams", "Brown"], rng)} Consulting LLC` : emp.industry + " Corp";
  events.push({
    t: empStartDate.toISOString().split('T')[0],
    type: "EMPLOYMENT_START",
    entity: employerName,
    salary: emp.salary
  });
  if (emp.tenureMonths > 18 && rng.random() > 0.4) {
    const raiseDate = new Date(empStartDate);
    raiseDate.setMonth(raiseDate.getMonth() + randomInt(12, emp.tenureMonths, rng));
    if (raiseDate < startDate) {
      events.push({
        t: raiseDate.toISOString().split('T')[0],
        type: "SALARY_INCREASE",
        salary: roundToInt(emp.salary * (1 + randomBeta(2, 5, rng) * 0.15))
      });
    }
  }
  if (liab.studentLoanPayment > 0) {
    events.push({
      t: empStartDate.toISOString().split('T')[0],
      type: "LIABILITY_OPENED",
      type_detail: "STUDENT_LOAN",
      payment: liab.studentLoanPayment
    });
  }
  if (liab.autoPayment > 0) {
    const autoDate = new Date(empStartDate);
    autoDate.setMonth(autoDate.getMonth() + randomInt(3, Math.min(24, emp.tenureMonths), rng));
    if (autoDate < startDate) {
      events.push({
        t: autoDate.toISOString().split('T')[0],
        type: "LIABILITY_OPENED",
        type_detail: "AUTO_LOAN",
        payment: liab.autoPayment
      });
    }
  }

  // Housing / rent history
  const housingEvents = generateHousingHistory(startDate, emp.tenureMonths, rng, geoParams.rent_multiplier || 1.0);
  events.push(...housingEvents);

  let currentSalary = events.filter(e => e.type === "SALARY_INCREASE").pop()?.salary || emp.salary;
  // Ensure a late-career raise does not push the persona outside its region-adjusted band.
  currentSalary = clamp(currentSalary, regionAdjustedSalaryMin, regionAdjustedSalaryMax);
  const obligations = liab.studentLoanPayment + liab.autoPayment + liab.otherDebt;

  // Build closed-loop income / expense / ledger from the sampled financial state.
  const incomeStream = generateIncomeStream(currentSalary, config, rng);
  const currentHousing = housingEvents[housingEvents.length - 1] || { monthly_payment: 0 };
  const expenseObligations = generateExpenseObligations(
    currentSalary,
    currentHousing.monthly_payment || 0,
    obligations,
    config,
    rng
  );
  const statementMonths = config.ledger?.statement_months || 3;
  const { ledger, overdraft_count: overdraftCount } = simulateMonthlyLedger(
    {
      current_state: {
        income_stream: incomeStream,
        expense_obligations: expenseObligations,
        checking_balance: assets.checkingBalance,
        housing_history: housingEvents
      }
    },
    config,
    statementMonths,
    rng
  );

  return {
    entityId,
    demographics: { age, ssn_last4, zip_code: zipCode, region },
    events,
    current_state: {
      employment_status: "ACTIVE",
      employer: employerName,
      industry: emp.industry,
      persona: emp.persona,
      tenure_stability: emp.tenureStability,
      salary: currentSalary,
      tenure_months: emp.tenureMonths,
      checking_balance: assets.checkingBalance,
      monthly_obligations: obligations,
      dti: liab.dti,
      credit_score: creditScore,
      down_payment: assets.downPaymentAmount,
      regime,
      region,
      zip_code: zipCode,
      cost_of_living_index: geoParams.cost_of_living_index,
      housing_history: housingEvents,
      income_stream: incomeStream,
      expense_obligations: expenseObligations,
      monthly_ledger: ledger,
      overdraft_count: overdraftCount,
      annual_w2_wages: incomeStream.annual_w2_wages
    }
  };
}

export function corruptPresentation(truth, corruptionType, severity, config, rng = { random: () => Math.random() }) {
  const presentation = JSON.parse(JSON.stringify(truth));
  if (corruptionType === "NONE") return presentation;
  const mult = severity === "HIGH" ? 0.20 : severity === "MEDIUM" ? 0.10 : 0.05;
  if (corruptionType === "INFLATION") {
    presentation.current_state.salary = Math.floor(presentation.current_state.salary * (1 + mult));
  } else if (corruptionType === "CONCEALMENT") {
    const numToRemove = severity === "HIGH" ? 2 : 1;
    let removed = 0;
    presentation.events = presentation.events.filter(e => {
      if (e.type === "LIABILITY_OPENED" && removed < numToRemove) { removed++; return false; }
      return true;
    });
    presentation.current_state.monthly_obligations = presentation.events
      .filter(e => e.type === "LIABILITY_OPENED")
      .reduce((sum, e) => sum + e.payment, 0);
  } else if (corruptionType === "FABRICATION") {
    const industries = config.employment.industry.categories;
    presentation.current_state.employer = "Global " + randomChoice(industries, rng);
    presentation.current_state.salary = randomInt(120000, 180000, rng);
    presentation.current_state.checking_balance = randomInt(40000, 80000, rng);
    presentation.events.unshift({
      t: "2021-01-01",
      type: "EMPLOYMENT_START",
      entity: presentation.current_state.employer,
      salary: presentation.current_state.salary
    });
  } else if (corruptionType === "BUST_OUT") {
    // Synthetic identity: build a 24-month fake prime profile over a thin-file truth.
    const industries = config.employment.industry.categories;
    const syntheticStart = new Date(2022, 0, 1);
    const fakeEmployer = "Apex " + randomChoice(industries, rng);
    const fakeSalary = randomInt(110000, 160000, rng);
    const fakeCreditScore = randomInt(720, 780, rng);
    const fakeChecking = randomInt(35000, 70000, rng);

    presentation.current_state.employer = fakeEmployer;
    presentation.current_state.salary = fakeSalary;
    presentation.current_state.checking_balance = fakeChecking;
    presentation.current_state.credit_score = fakeCreditScore;
    presentation.current_state.dti = randomBeta(2, 8, rng) * 0.25; // artificially low DTI
    presentation.current_state.monthly_obligations = Math.round(fakeSalary * presentation.current_state.dti / 12);
    presentation.current_state.synthetic_identity = true;

    // Replace real events with a compressed, fake credit-building timeline.
    presentation.events = [
      {
        t: syntheticStart.toISOString().split('T')[0],
        type: "EMPLOYMENT_START",
        entity: fakeEmployer,
        salary: fakeSalary
      },
      {
        t: syntheticStart.toISOString().split('T')[0],
        type: "LIABILITY_OPENED",
        type_detail: "CREDIT_CARD",
        payment: Math.round(fakeSalary * 0.01)
      },
      {
        t: new Date(syntheticStart.getFullYear(), syntheticStart.getMonth() + 3, 1).toISOString().split('T')[0],
        type: "LIABILITY_OPENED",
        type_detail: "AUTO_LOAN",
        payment: Math.round(fakeSalary * 0.015)
      }
    ];

    // Add synthetic payment-history events at regular intervals to simulate seasoning.
    for (let m = 6; m < 24; m += 3) {
      const paymentDate = new Date(syntheticStart.getFullYear(), syntheticStart.getMonth() + m, 1);
      presentation.events.push({
        t: paymentDate.toISOString().split('T')[0],
        type: "PAYMENT_MADE",
        type_detail: "CREDIT_CARD",
        amount: Math.round(fakeSalary * 0.01)
      });
    }
  }
  return presentation;
}

// ─── 2d. EVIDENCE-TAMPERING MUTATION OPERATOR ───────────────
// FCGS layer-targeted mutation: modifies the Evidence (E) layer while
// the Claimed Truth (C) and World Truth (S_t) remain internally consistent.
export function tamperEvidence(truth, evidence, severity, rng = { random: () => Math.random() }) {
  const mult = severity === "HIGH" ? 0.50 : severity === "MEDIUM" ? 0.35 : 0.20;
  const t = truth.current_state;
  const bank = evidence.find(e => e.source === "BANK_STATEMENT");
  const w2 = evidence.find(e => e.source === "W2_DOCUMENT");
  const employer = evidence.find(e => e.source === "EMPLOYER_VERIFICATION");

  if (bank) {
    // Inflate checking balance without changing the claimed application value.
    bank.fields.checking_balance = roundToInt(bank.fields.checking_balance * (1 + mult));

    // Inject an unexplained large deposit that has no source in the life-script events.
    const depositAmount = roundToInt(t.salary * (0.15 + rng.random() * 0.25));
    bank.fields.recent_large_deposits = [{
      date: new Date().toISOString().split('T')[0],
      amount: depositAmount,
      description: "Wire transfer",
      source: "Unverified"
    }];

    // Optionally make the stated monthly payroll deposit inconsistent with W-2.
    if (rng.random() < 0.6) {
      bank.fields.monthly_payroll_deposit = roundToInt(bank.fields.monthly_payroll_deposit * (1 + mult * 0.8));
    }
  }

  // Subtle document-level inconsistency: W-2 lists a slightly different employer name.
  if (w2 && rng.random() < 0.4) {
    w2.fields.employer = t.employer + " LLC";
  }

  // Employer verification may list a different salary than W-2 to create cross-document noise.
  if (employer && rng.random() < 0.3) {
    employer.fields.salary = roundToInt(employer.fields.salary * (1 + mult * 0.5));
  }

  return evidence;
}

// ─── 2e. INCOHERENT WORLD MUTATION (A3 NEGATIVE CONTROL) ────
// Intentionally violates accounting or timeline invariants in the World Truth (S_t).
// The applicant honestly reports this broken world, so the case should be declined
// for physical impossibility rather than fraud.
export function corruptWorldTruth(truth, rng = { random: () => Math.random() }) {
  const t = truth.current_state;
  const mode = randomInt(0, 3, rng);

  if (mode === 0) {
    // Liability payment exceeds monthly income (impossible to sustain).
    const impossiblePayment = roundToInt(t.salary * 0.95 / 12);
    t.monthly_obligations = impossiblePayment;
    const liabEvents = truth.events.filter(e => e.type === "LIABILITY_OPENED");
    if (liabEvents.length > 0) {
      liabEvents[0].payment = impossiblePayment;
    } else {
      truth.events.push({
        t: "2020-01-01",
        type: "LIABILITY_OPENED",
        type_detail: "PERSONAL_LOAN",
        payment: impossiblePayment
      });
    }
    t.dti = 0.95;
  } else if (mode === 1) {
    // Rent payment appears before lease start.
    const housingEvents = truth.events.filter(e => e.type === "ADDRESS_CHANGE");
    if (housingEvents.length > 0) {
      const leaseStart = new Date(housingEvents[0].t);
      leaseStart.setMonth(leaseStart.getMonth() + 3);
      truth.events.push({
        t: leaseStart.toISOString().split('T')[0],
        type: "RENT_PAYMENT",
        entity: housingEvents[0].address,
        amount: housingEvents[0].monthly_payment
      });
    }
  } else if (mode === 2) {
    // Employment start date is after the first recorded salary deposit.
    const empStart = truth.events.find(e => e.type === "EMPLOYMENT_START");
    if (empStart) {
      const depositDate = new Date(empStart.t);
      depositDate.setMonth(depositDate.getMonth() + 2);
      truth.events.push({
        t: depositDate.toISOString().split('T')[0],
        type: "SALARY_DEPOSIT",
        entity: empStart.entity,
        amount: roundToInt(t.salary / 12)
      });
    }
  } else {
    // W-2 wages exceed gross annual salary.
    t.annual_w2_wages = roundToInt(t.salary * 1.25);
    if (t.income_stream) {
      t.income_stream.annual_w2_wages = t.annual_w2_wages;
    }
  }

  truth.current_state.incoherent = true;
  return truth;
}

// ─── 3. EVIDENCE SYNTHESIS ──────────────────────────────────
export function synthesizeEvidence(truth, rng = { random: () => Math.random() }) {
  const state = truth.current_state;
  const fidelity = () => clamp(randomNormal(0.97, 0.02, rng), 0.90, 0.999);
  const liabilities = truth.events
    .filter(e => e.type === "LIABILITY_OPENED")
    .map(e => ({ type: e.type_detail, payment: e.payment }));
  const recurringDebits = liabilities.map(l => {
    const payeeMap = { STUDENT_LOAN: "Student Loan Servicer", AUTO_LOAN: "Auto Finance", CREDIT_CARD: "Credit Card Servicer", PERSONAL_LOAN: "Personal Loan Servicer" };
    return { payee: payeeMap[l.type] || "Lender", amount: l.payment };
  });
  // Add rent and utilities as recurring debits when present.
  if (state.expense_obligations) {
    if (state.expense_obligations.rent > 0) {
      recurringDebits.push({ payee: "Property Management", amount: state.expense_obligations.rent });
    }
    if (state.expense_obligations.utilities > 0) {
      recurringDebits.push({ payee: "Utility Providers", amount: state.expense_obligations.utilities });
    }
  }
  const empStartEvent = truth.events.find(e => e.type === "EMPLOYMENT_START");
  const hireDate = empStartEvent ? empStartEvent.t : "2020-01-01";
  const housingEvents = truth.events.filter(e => e.type === "ADDRESS_CHANGE");
  const currentHousing = housingEvents[housingEvents.length - 1];

  // Derive evidence from the closed-loop monthly ledger.
  const ledger = state.monthly_ledger || [];
  const lastLedgerMonth = ledger[ledger.length - 1] || null;
  const ledgerCheckingBalance = lastLedgerMonth ? lastLedgerMonth.ending_checking_balance : state.checking_balance;
  const avgMonthlyDeposit = ledger.length
    ? roundToInt(ledger.reduce((sum, m) => sum + m.salary_deposits, 0) / ledger.length)
    : (state.income_stream?.monthly_net_deposit || Math.round(state.salary / 12 * 0.72));
  const rentPayments = ledger.map(m => ({ month: m.month, amount: m.rent_paid }));
  const overdraftCount = state.overdraft_count ?? 0;
  const statementMonths = ledger.length || 3;

  return [
    {
      source: "W2_DOCUMENT",
      date: new Date().toISOString().split('T')[0],
      fields: { w2_wages: fidelityNoise(state.annual_w2_wages ?? state.salary, 0.98, rng), employer: state.employer, tax_year: 2024 },
      fidelity: fidelity()
    },
    {
      source: "EMPLOYER_VERIFICATION",
      date: new Date().toISOString().split('T')[0],
      fields: {
        employer: state.employer,
        salary: state.salary,
        net_per_check: state.income_stream?.net_per_check,
        pay_frequency: state.income_stream?.pay_frequency,
        status: state.employment_status,
        hire_date: hireDate,
        tenure_stability: state.tenure_stability
      },
      fidelity: fidelity()
    },
    {
      source: "BANK_STATEMENT",
      date: new Date().toISOString().split('T')[0],
      fields: {
        checking_balance: fidelityNoise(ledgerCheckingBalance, 0.99, rng),
        recurring_debits: recurringDebits,
        monthly_payroll_deposit: avgMonthlyDeposit,
        rent_payments: rentPayments,
        overdraft_count: overdraftCount,
        recent_large_deposits: [],
        months_of_statements: statementMonths
      },
      fidelity: fidelity()
    },
    {
      source: "CREDIT_BUREAU",
      date: new Date().toISOString().split('T')[0],
      fields: { credit_score: fidelityNoise(state.credit_score, 0.99, rng), open_accounts: liabilities.length + randomInt(1, 4, rng), liabilities, persona: state.persona },
      fidelity: fidelity()
    },
    {
      source: "RENT_VERIFICATION",
      date: new Date().toISOString().split('T')[0],
      fields: {
        current_address: currentHousing?.address || "Unknown",
        monthly_rent: currentHousing?.monthly_payment || 0,
        lease_start: housingEvents[0]?.t || "2020-01-01",
        payment_history: "CURRENT"
      },
      fidelity: fidelity()
    },
    {
      source: "GEOGRAPHIC_VERIFICATION",
      date: new Date().toISOString().split('T')[0],
      fields: {
        zip_code: state.zip_code,
        region: state.region,
        cost_of_living_index: state.cost_of_living_index
      },
      fidelity: fidelity()
    }
  ];
}

// ─── 4. ALIGNMENT FINDINGS ENGINE (Nine Checks) ─────────────
function pushFinding(findings, dimension, level, status, details) {
  findings.push({ dimension, level, status, details });
}

export function generateAlignmentFindings(truth, presentation, evidence, metadata = {}) {
  const findings = [];
  const t = truth.current_state;
  const p = presentation.current_state;
  const w2 = evidence.find(e => e.source === "W2_DOCUMENT")?.fields || {};
  const bank = evidence.find(e => e.source === "BANK_STATEMENT")?.fields || {};

  // 1. Identity alignment
  if (p.synthetic_identity) {
    pushFinding(findings, "identity", "A5", "SYNTHETIC_IDENTITY", "Presentation flagged as a synthetic identity with compressed credit-building history.");
  } else {
    // Heuristic synthetic-identity signals
    const liabEvents = presentation.events.filter(e => e.type === "LIABILITY_OPENED");
    const dates = liabEvents.map(e => new Date(e.t)).sort((a, b) => a - b);
    const clustered = dates.length >= 2 && (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24) <= 90;
    const thinButPrime = (p.credit_score ?? t.credit_score) >= 720 && liabEvents.length <= 2;
    if (clustered && thinButPrime) {
      pushFinding(findings, "identity", "A4", "PROBABLE_SYNTHETIC_IDENTITY", "Credit accounts are tightly clustered and score is high despite thin file; possible synthetic identity.");
    } else {
      pushFinding(findings, "identity", "A0", "ALIGNED", "Applicant name, age, and SSN are consistent across application and evidence.");
    }
  }

  // 2. Employer alignment
  if (p.employer !== t.employer) {
    pushFinding(findings, "employment", "A4", "PROBABLE_MANIPULATION", `Application claims ${p.employer}; employer verification shows ${t.employer}.`);
  } else {
    pushFinding(findings, "employment", "A0", "ALIGNED", `Employer ${t.employer} verified.`);
  }

  // 3. Income reconciliation
  const w2Wages = w2.w2_wages ?? t.salary;
  const salaryDiff = p.salary - t.salary;
  if (Math.abs(salaryDiff) <= 1000) {
    pushFinding(findings, "income", "A0", "ALIGNED", `Self-reported ${formatMoney(p.salary)} matches verified income ${formatMoney(t.salary)}.`);
  } else if (salaryDiff > 0 && salaryDiff <= t.salary * 0.15) {
    pushFinding(findings, "income", "A1", "ROUNDING_VARIANCE", `Self-reported ${formatMoney(p.salary)} is ${formatMoney(salaryDiff)} higher than verified ${formatMoney(t.salary)}.`);
  } else if (salaryDiff > t.salary * 0.15) {
    pushFinding(findings, "income", "A4", "PROBABLE_MANIPULATION", `Self-reported ${formatMoney(p.salary)} is ${formatMoney(salaryDiff)} higher than verified ${formatMoney(t.salary)} / W-2 ${formatMoney(w2Wages)}.`);
  } else {
    pushFinding(findings, "income", "A2", "EXPLAINABLE_DISCREPANCY", `Self-reported ${formatMoney(p.salary)} is ${formatMoney(Math.abs(salaryDiff))} lower than verified ${formatMoney(t.salary)}.`);
  }

  // 4. Asset reconciliation
  const bankBalance = bank.checking_balance ?? t.checking_balance;
  const checkingDiff = p.checking_balance - t.checking_balance;
  if (Math.abs(checkingDiff) <= 500) {
    pushFinding(findings, "assets", "A0", "ALIGNED", `Self-reported checking ${formatMoney(p.checking_balance)} matches bank statement ${formatMoney(bankBalance)}.`);
  } else if (checkingDiff > 0) {
    pushFinding(findings, "assets", "A3", "MATERIAL_MISMATCH", `Self-reported checking ${formatMoney(p.checking_balance)} is ${formatMoney(checkingDiff)} higher than bank ${formatMoney(t.checking_balance)}.`);
  } else {
    pushFinding(findings, "assets", "A1", "ROUNDING_VARIANCE", `Self-reported checking ${formatMoney(p.checking_balance)} is slightly lower than bank ${formatMoney(t.checking_balance)}.`);
  }

  // 5. Liability reconciliation
  const disclosedCount = truth.events.filter(e => e.type === "LIABILITY_OPENED").length;
  const presentedCount = presentation.events.filter(e => e.type === "LIABILITY_OPENED").length;
  const actualObligations = t.monthly_obligations;
  const presentedObligations = p.monthly_obligations;
  if (presentedObligations < actualObligations) {
    const hidden = actualObligations - presentedObligations;
    pushFinding(findings, "liabilities", "A3", "MATERIAL_MISMATCH", `Application discloses ${presentedCount} liability/liabilities ($${presentedObligations}/mo); credit bureau shows ${disclosedCount} ($${actualObligations}/mo). Hidden debt: $${hidden}/mo.`);
  } else {
    pushFinding(findings, "liabilities", "A0", "ALIGNED", `Application liabilities match credit bureau (${presentedCount} accounts, $${presentedObligations}/mo).`);
  }

  // 6. Address alignment (no address data yet)
  pushFinding(findings, "address", "A0", "NOT_VERIFIED", "Address data not collected in current model; assumed consistent.");

  // 7. Timeline consistency
  const presEmpStart = presentation.events.find(e => e.type === "EMPLOYMENT_START");
  const truthEmpStart = truth.events.find(e => e.type === "EMPLOYMENT_START");
  if (presEmpStart && truthEmpStart && presEmpStart.entity !== truthEmpStart.entity) {
    pushFinding(findings, "timeline", "A4", "IMPOSSIBLE_SEQUENCE", `Employment history claims ${presEmpStart.entity} but verification shows ${truthEmpStart.entity}.`);
  } else {
    pushFinding(findings, "timeline", "A0", "ALIGNED", `Employment and liability timeline is consistent.`);
  }

  // 8. Cash-flow consistency
  const monthlyIncome = p.salary / 12;
  const housingPayment = p.monthly_mortgage_payment ?? 0;
  const monthlyOutflow = presentedObligations + housingPayment;
  const residualIncome = monthlyIncome - monthlyOutflow;
  if (residualIncome < 0) {
    pushFinding(findings, "cash_flow", "A3", "NEGATIVE_RESIDUAL", `Monthly income ${formatMoney(monthlyIncome)} is insufficient for obligations ${formatMoney(presentedObligations)} plus proposed mortgage ${formatMoney(housingPayment)}.`);
  } else if (residualIncome < monthlyIncome * 0.05) {
    pushFinding(findings, "cash_flow", "A2", "TIGHT_RESIDUAL", `Residual income is tight after obligations and proposed mortgage.`);
  } else {
    pushFinding(findings, "cash_flow", "A0", "ALIGNED", `Cash flow supports disclosed obligations and proposed mortgage with comfortable residual income.`);
  }

  // 9. Loan affordability / decision consistency
  const backendDti = p.backend_dti ?? t.backend_dti ?? p.dti ?? t.dti;
  const pitiText = housingPayment > 0 ? ` (PITI ${formatMoney(housingPayment)})` : '';
  if (backendDti > 0.50) {
    pushFinding(findings, "affordability", "A4", "EXCESSIVE_DTI", `Back-end DTI ${(backendDti * 100).toFixed(1)}%${pitiText} exceeds policy maximum.`);
  } else if (backendDti > 0.43) {
    pushFinding(findings, "affordability", "A3", "ELEVATED_DTI", `Back-end DTI ${(backendDti * 100).toFixed(1)}%${pitiText} is elevated.`);
  } else {
    pushFinding(findings, "affordability", "A0", "STRONG", `Back-end DTI ${(backendDti * 100).toFixed(1)}%${pitiText} is within policy guidelines.`);
  }

  // 10. Behavioral / device / document metadata checks
  if (metadata.documents) {
    const recentDocs = metadata.documents.filter(d => d.days_before_submission <= 2).length;
    if (recentDocs >= 3) {
      pushFinding(findings, "document_metadata", "A3", "SUSPICIOUS_DOCUMENT_AGES", `${recentDocs} of 4 supporting documents were created within 2 days of submission.`);
    } else if (recentDocs >= 1) {
      pushFinding(findings, "document_metadata", "A1", "RECENT_DOCUMENTS", `${recentDocs} document(s) created shortly before submission.`);
    } else {
      pushFinding(findings, "document_metadata", "A0", "DOCUMENT_AGES_NORMAL", "Supporting documents have plausible ages.");
    }
  }
  if (metadata.ip_risk_score !== undefined) {
    if (metadata.ip_risk_score > 0.7 || metadata.is_tor) {
      pushFinding(findings, "network", "A4", "HIGH_RISK_IP", `IP risk score ${metadata.ip_risk_score}; origin is high-risk or anonymized.`);
    } else if (metadata.ip_risk_score > 0.35 || metadata.is_vpn) {
      pushFinding(findings, "network", "A2", "ANONYMIZED_OR_VPN", "Application originated from VPN or elevated-risk IP.");
    } else {
      pushFinding(findings, "network", "A0", "IP_TRUSTED", "IP origin is low-risk and not anonymized.");
    }
  }
  if (metadata.hour_of_day !== undefined) {
    if (!metadata.is_business_hours) {
      pushFinding(findings, "behavioral", "A2", "OFF_HOURS_SUBMISSION", `Submitted at hour ${metadata.hour_of_day} on day ${metadata.day_of_week}; outside typical business hours.`);
    } else {
      pushFinding(findings, "behavioral", "A0", "BUSINESS_HOURS", "Submitted during normal business hours.");
    }
  }
  if (metadata.fields_copy_pasted !== undefined) {
    if (metadata.fields_copy_pasted >= 4) {
      pushFinding(findings, "behavioral", "A3", "EXCESSIVE_COPY_PASTE", `${metadata.fields_copy_pasted} fields were copy-pasted; inconsistent with natural typing.`);
    } else if (metadata.fields_copy_pasted >= 2) {
      pushFinding(findings, "behavioral", "A1", "SOME_COPY_PASTE", `${metadata.fields_copy_pasted} fields were copy-pasted.`);
    } else {
      pushFinding(findings, "behavioral", "A0", "TYPED_NATURALLY", "Few or no fields copy-pasted.");
    }
  }

  return findings;
}

// ─── 4b. GROUND-TRUTH FINDINGS GRAPH ────────────────────────
// Emits deterministic, citable ground truth for each delta between
// Claimed Truth (C), World Truth (S_t), and Evidence (E).
export function generateGroundTruthFindings(truth, presentation, evidence, corruptionType = "NONE") {
  const findings = [];
  const t = truth.current_state;
  const p = presentation.current_state;

  const w2 = evidence.find(e => e.source === "W2_DOCUMENT")?.fields || {};
  const bank = evidence.find(e => e.source === "BANK_STATEMENT")?.fields || {};
  const employerVerif = evidence.find(e => e.source === "EMPLOYER_VERIFICATION")?.fields || {};

  function cite(source, field, value) {
    return { source, field, value };
  }

  function push(type, targetLayer, claimedValue, trueValue, classification, citations, details) {
    findings.push({
      type,
      target_layer: targetLayer,
      claimed_value: claimedValue,
      true_value: trueValue,
      classification,
      evidence_citations: citations,
      details
    });
  }

  // Income misrepresentation
  if (p.salary !== t.salary) {
    push(
      "INCOME_MISREPRESENTATION",
      "CLAIMED_TRUTH",
      p.salary,
      t.salary,
      p.salary > t.salary * 1.15 ? "A4" : "A1",
      [cite("W2_DOCUMENT", "w2_wages", w2.w2_wages), cite("EMPLOYER_VERIFICATION", "salary", employerVerif.salary), cite("BANK_STATEMENT", "monthly_payroll_deposit", bank.monthly_payroll_deposit)],
      `Application claims ${formatMoney(p.salary)}; verified income is ${formatMoney(t.salary)}.`
    );
  }

  // Asset misrepresentation
  if (p.checking_balance !== t.checking_balance) {
    push(
      "ASSET_MISREPRESENTATION",
      "CLAIMED_TRUTH",
      p.checking_balance,
      t.checking_balance,
      p.checking_balance > t.checking_balance ? "A3" : "A1",
      [cite("BANK_STATEMENT", "checking_balance", bank.checking_balance)],
      `Application checking ${formatMoney(p.checking_balance)} vs bank statement ${formatMoney(t.checking_balance)}.`
    );
  }

  // Employer fabrication
  if (p.employer !== t.employer) {
    push(
      "EMPLOYER_FABRICATION",
      "CLAIMED_TRUTH",
      p.employer,
      t.employer,
      "A4",
      [cite("W2_DOCUMENT", "employer", w2.employer), cite("EMPLOYER_VERIFICATION", "employer", employerVerif.employer)],
      `Application employer ${p.employer} does not match verified employer ${t.employer}.`
    );
  }

  // Liability concealment
  const truthLiabs = truth.events.filter(e => e.type === "LIABILITY_OPENED");
  const presLiabs = presentation.events.filter(e => e.type === "LIABILITY_OPENED");
  if (presLiabs.length < truthLiabs.length || p.monthly_obligations < t.monthly_obligations) {
    push(
      "LIABILITY_CONCEALMENT",
      "CLAIMED_TRUTH",
      p.monthly_obligations,
      t.monthly_obligations,
      "A4",
      [cite("BANK_STATEMENT", "recurring_debits", bank.recurring_debits), cite("CREDIT_BUREAU", "liabilities", truthLiabs.map(l => ({ type: l.type_detail, payment: l.payment })))],
      `Application discloses ${presLiabs.length} liabilities (${formatMoney(p.monthly_obligations)}/mo); truth has ${truthLiabs.length} (${formatMoney(t.monthly_obligations)}/mo).`
    );
  }

  // Synthetic identity / bust-out
  if (corruptionType === "BUST_OUT" || p.synthetic_identity) {
    push(
      "SYNTHETIC_IDENTITY",
      "WORLD",
      null,
      null,
      "A5",
      [cite("BANK_STATEMENT", "checking_balance", bank.checking_balance), cite("CREDIT_BUREAU", "credit_score", bank.credit_score)],
      "Presentation is a synthetic identity with compressed credit-building history."
    );
  }

  // Evidence tampering
  if (corruptionType === "EVIDENCE_TAMPERING") {
    const largeDeposits = bank.recent_large_deposits || [];
    push(
      "EVIDENCE_TAMPERING",
      "EVIDENCE",
      bank.checking_balance,
      t.checking_balance,
      "A4",
      [cite("BANK_STATEMENT", "checking_balance", bank.checking_balance), cite("BANK_STATEMENT", "recent_large_deposits", largeDeposits), cite("W2_DOCUMENT", "w2_wages", w2.w2_wages)],
      "Bank statement appears altered: inflated balance and/or unsupported deposits."
    );
  }

  return findings;
}

// ─── 5. DECISION ENGINE ─────────────────────────────────────
function maxAlignmentLevel(findings) {
  const order = ["A0", "A1", "A2", "A3", "A4", "A5"];
  let max = "A0";
  for (const f of findings) {
    if (order.indexOf(f.level) > order.indexOf(max)) max = f.level;
  }
  return max;
}

function mapFraudRisk(maxLevel) {
  if (maxLevel === "A0") return "NONE";
  if (maxLevel === "A1") return "NONE";
  if (maxLevel === "A2") return "LOW";
  if (maxLevel === "A3") return "MODERATE";
  if (maxLevel === "A4") return "HIGH";
  return "CRITICAL";
}

function mapCoherence(maxLevel) {
  if (maxLevel === "A0") return "COHERENT";
  if (maxLevel === "A1") return "MOSTLY_COHERENT";
  if (maxLevel === "A2") return "PARTIALLY_INCOHERENT";
  if (maxLevel === "A3") return "MATERIALLY_INCOHERENT";
  return "INTENTIONALLY_ADVERSARIAL";
}

function mapCaseCoherenceStatus(maxLevel) {
  if (maxLevel === "A0") return "COHERENT";
  if (maxLevel === "A1" || maxLevel === "A2") return "COHERENT_WITH_EXPLAINABLE_VARIANCES";
  if (maxLevel === "A3") return "INCOHERENT";
  return "FRAUDULENT";
}

export function computeDecision(truth, presentation, evidence, findings, corruptionType, severity, rng = { random: () => Math.random() }, config = {}) {
  const t = truth.current_state;
  const p = presentation.current_state;
  const bank = evidence.find(e => e.source === "BANK_STATEMENT")?.fields || {};
  const w2 = evidence.find(e => e.source === "W2_DOCUMENT")?.fields || {};

  const maxLevel = maxAlignmentLevel(findings);
  const fraudRisk = mapFraudRisk(maxLevel);
  const coherence = mapCoherence(maxLevel);
  const caseCoherenceStatus = mapCaseCoherenceStatus(maxLevel);

  const u = config.underwriting || {};
  const dtiApproveMax = (u.dti?.approve_max ?? 0.38) * 100;
  const dtiManualMax = (u.dti?.manual_review_max ?? 0.47) * 100;
  const creditApproveMin = u.credit_score?.approve_min ?? 640;
  const creditManualMin = u.credit_score?.manual_review_min ?? 600;
  const reservesApproveMin = u.reserves?.approve_min_months ?? 0.25;
  const reservesManualMin = u.reserves?.manual_review_min_months ?? 0.1;
  const tenureApproveMin = u.tenure?.approve_min_months ?? 12;
  const tenureManualMin = u.tenure?.manual_review_min_months ?? 6;

  const monthlyIncome = p.salary / 12;
  const backendDti = p.backend_dti ?? t.backend_dti ?? p.dti ?? t.dti;
  const reservesMonths = monthlyIncome > 0 ? (bank.checking_balance ?? p.checking_balance) / monthlyIncome : 0;
  const creditScore = t.credit_score;
  const tenureMonths = p.tenure_months ?? t.tenure_months;

  const conditions = [];
  let outcome = "APPROVE";
  let reason = "";
  let difficulty = "BASIC";

  // Fraud / manipulation overrides
  if (corruptionType === "BUST_OUT" || p.synthetic_identity || maxLevel === "A5") {
    outcome = "DECLINE";
    reason = randomChoice([
      "rejected for suspected synthetic identity",
      "rejected for compressed credit history inconsistent with score",
      "rejected for identity that cannot be verified across bureaus"
    ], rng);
    conditions.push("Escalate to fraud investigation unit");
    conditions.push("Request full credit report and identity verification");
    difficulty = "ADVANCED";
    return { alignment_level: maxLevel, fraud_risk_level: fraudRisk, coherence_status: coherence, case_coherence_status: caseCoherenceStatus, expected_outcome: outcome, difficulty, conditions, reason };
  }

  // Incoherent world (A3 negative control) — check before metadata-driven fraud signals
  // so the case is labeled for its physical impossibility rather than fraud artifacts.
  if (corruptionType === "INCOHERENT" || t.incoherent) {
    outcome = "DECLINE";
    reason = randomChoice([
      "rejected for impossible debt-to-income profile",
      "rejected for timeline inconsistency across documents",
      "rejected for W-2 wages exceeding reported gross salary"
    ], rng);
    conditions.push("Review for data entry errors or impossible financial scenario");
    difficulty = "ADVANCED";
    return {
      alignment_level: "A3",
      fraud_risk_level: "MODERATE",
      coherence_status: "MATERIALLY_INCOHERENT",
      case_coherence_status: "INCOHERENT",
      expected_outcome: outcome,
      difficulty,
      conditions,
      reason
    };
  }

  // Metadata-driven fraud signals (network/behavior/docs) can independently trigger decline
  const hasHighRiskNetwork = findings.some(f => f.dimension === "network" && f.level === "A4");
  const hasSuspiciousDocuments = findings.some(f => f.dimension === "document_metadata" && f.level === "A3");
  if (hasHighRiskNetwork || hasSuspiciousDocuments) {
    outcome = "DECLINE";
    reason = randomChoice([
      "rejected for high-risk network origin",
      "rejected for suspicious document metadata",
      "rejected for behavioral and document inconsistencies"
    ], rng);
    conditions.push("Verify applicant identity and device provenance");
    conditions.push("Request original source documents");
    difficulty = "ADVANCED";
    return { alignment_level: maxLevel, fraud_risk_level: fraudRisk, coherence_status: coherence, case_coherence_status: caseCoherenceStatus, expected_outcome: outcome, difficulty, conditions, reason };
  }

  if (corruptionType === "FABRICATION") {
    outcome = "DECLINE";
    reason = randomChoice([
      "rejected for unverifiable income",
      "rejected for unverifiable employment",
      "rejected for suspected fabricated assets"
    ], rng);
    conditions.push("Escalate to fraud investigation unit");
    conditions.push("Request source-of-funds documentation");
    difficulty = "ADVANCED";
    return { alignment_level: maxLevel, fraud_risk_level: fraudRisk, coherence_status: coherence, case_coherence_status: caseCoherenceStatus, expected_outcome: outcome, difficulty, conditions, reason };
  }

  // Concealment
  if (corruptionType === "CONCEALMENT") {
    outcome = "DECLINE";
    reason = randomChoice([
      "rejected for undisclosed debt",
      "rejected for insufficient cash after undisclosed obligations",
      "rejected for excessive DTI after including hidden liabilities",
      "rejected for insufficient cash or undisclosed debt"
    ], rng);
    conditions.push("Explain all undisclosed liabilities");
    conditions.push("Provide updated debt schedule");
    difficulty = "INTERMEDIATE";
    return { alignment_level: maxLevel, fraud_risk_level: fraudRisk, coherence_status: coherence, case_coherence_status: caseCoherenceStatus, expected_outcome: outcome, difficulty, conditions, reason };
  }

  // Income inflation
  if (corruptionType === "INFLATION") {
    outcome = "DECLINE";
    reason = randomChoice([
      "rejected for unverifiable income",
      "rejected for inflated salary relative to W-2"
    ], rng);
    conditions.push("Provide additional income documentation");
    difficulty = "INTERMEDIATE";
    return { alignment_level: maxLevel, fraud_risk_level: fraudRisk, coherence_status: coherence, case_coherence_status: caseCoherenceStatus, expected_outcome: outcome, difficulty, conditions, reason };
  }

  // Evidence tampering
  if (corruptionType === "EVIDENCE_TAMPERING") {
    outcome = "DECLINE";
    reason = randomChoice([
      "rejected for altered bank statement",
      "rejected for unsupported deposit inconsistent with income",
      "rejected for document-level manipulation"
    ], rng);
    conditions.push("Request original bank statements from institution");
    conditions.push("Verify large deposits with source documentation");
    difficulty = "ADVANCED";
    return { alignment_level: maxLevel, fraud_risk_level: fraudRisk, coherence_status: coherence, case_coherence_status: caseCoherenceStatus, expected_outcome: outcome, difficulty, conditions, reason };
  }

  // Clean / timing drift cases — use holistic underwriting calibrated to generated population
  const dtiPct = backendDti * 100;
  const failDti = dtiPct > dtiManualMax;
  const failCredit = creditScore < creditManualMin;
  const failReserves = reservesMonths < reservesManualMin;
  const failTenure = tenureMonths < tenureManualMin;

  const strongReserves = reservesMonths >= 2.0;
  const lowDti = dtiPct <= 30;
  const moderateDti = dtiPct > 30 && dtiPct <= dtiApproveMax;
  const stableTenure = tenureMonths >= 24;
  const strongCredit = creditScore >= 720;

  if (dtiPct <= dtiApproveMax && creditScore >= creditApproveMin && reservesMonths >= reservesApproveMin && tenureMonths >= tenureApproveMin) {
    outcome = "APPROVE";
    if (strongReserves && lowDti) {
      reason = "approved with strong reserves";
    } else if (moderateDti) {
      reason = "approved despite moderate DTI because of stable income";
    } else if (stableTenure) {
      reason = "approved for stable employment and verified income";
    } else if (strongCredit) {
      reason = "approved for strong credit profile and acceptable DTI";
    } else {
      reason = "approved with verified income and assets";
    }
    difficulty = "BASIC";
  } else if (dtiPct <= dtiManualMax && creditScore >= creditManualMin && !failReserves && !failTenure) {
    outcome = "MANUAL_REVIEW";
    if (dtiPct > dtiApproveMax) {
      reason = "flagged for elevated DTI";
    } else if (creditScore < creditApproveMin) {
      reason = "flagged for low credit score";
    } else if (tenureMonths < tenureApproveMin) {
      reason = "flagged for insufficient employment history";
    } else if ((bank.recent_large_deposits || []).length > 0) {
      reason = "flagged for unsupported deposit";
    } else if (w2.employer && w2.employer !== t.employer) {
      reason = "flagged for employer-name variation";
    } else {
      reason = "flagged for manual review";
    }
    conditions.push("Verify large deposits");
    conditions.push("Obtain written VOE");
    difficulty = "INTERMEDIATE";
  } else {
    outcome = "DECLINE";
    const reasons = [];
    if (failDti) reasons.push("excessive DTI");
    if (failCredit) reasons.push("low credit score");
    if (failReserves) reasons.push("insufficient cash");
    if (failTenure) reasons.push("insufficient employment history");
    if (reasons.length === 0) reasons.push("excessive risk profile");
    reason = "rejected for " + (reasons.length > 1 ? reasons.slice(0, -1).join(", ") + " and " + reasons.slice(-1) : reasons[0]);
    conditions.push("Reduce DTI or increase income");
    difficulty = severity === "HIGH" ? "ADVANCED" : "INTERMEDIATE";
  }

  return { alignment_level: maxLevel, fraud_risk_level: fraudRisk, coherence_status: coherence, case_coherence_status: caseCoherenceStatus, expected_outcome: outcome, difficulty, conditions, reason };
}

// ─── 6. APPLICATION & DOCUMENT METADATA ─────────────────────
function generateIpAddress(rng) {
  return `${randomInt(1, 255, rng)}.${randomInt(0, 255, rng)}.${randomInt(0, 255, rng)}.${randomInt(1, 254, rng)}`;
}

function generateDeviceFingerprint(rng) {
  const chars = "0123456789abcdef";
  return Array.from({ length: 32 }, () => chars[Math.floor(rng.random() * chars.length)]).join("");
}

function generateDocumentMetadata(source, submissionDate, isFraud, rng) {
  const submitted = new Date(submissionDate);
  // Fraudsters generate docs right before submission; legitimate docs are older
  const maxAgeDays = isFraud ? 3 : 180;
  const minAgeDays = isFraud ? 0 : 14;
  const ageDays = minAgeDays + Math.floor(rng.random() * (maxAgeDays - minAgeDays + 1));
  const created = new Date(submitted);
  created.setDate(created.getDate() - ageDays);
  const modified = new Date(created);
  modified.setHours(modified.getHours() + Math.floor(rng.random() * 24));
  return {
    source,
    created: created.toISOString().split('T')[0],
    modified: modified.toISOString().split('T')[0],
    pdf_generator: randomChoice(["Adobe PDF Library", "Microsoft Print to PDF", "Chrome PDF Generator", "DocuSign", "Smallpdf"], rng),
    days_before_submission: ageDays
  };
}

export function generateApplicationMetadata(submissionDate, corruptionType, severity, rng = { random: () => Math.random() }) {
  const isFraud = corruptionType !== "NONE" && corruptionType !== "TIMING_DRIFT";
  const fraudIntensity = severity === "HIGH" ? 1.0 : severity === "MEDIUM" ? 0.6 : 0.3;

  // Submission timing
  let hour, dayOfWeek;
  if (isFraud && rng.random() < 0.45 * fraudIntensity) {
    hour = randomInt(0, 5, rng); // late-night fraudster hours
    dayOfWeek = randomChoice([0, 6, 5], rng); // weekend/night
  } else {
    hour = randomInt(9, 17, rng);
    dayOfWeek = randomInt(1, 5, rng);
  }
  const submitted = new Date(submissionDate);
  submitted.setHours(hour, randomInt(0, 59, rng), 0, 0);

  // IP / device
  const ipRiskBase = isFraud ? 0.55 : 0.08;
  const ipRiskScore = clamp(ipRiskBase + rng.random() * (isFraud ? 0.45 : 0.15), 0, 1);
  const isVpn = isFraud ? rng.random() < 0.35 * fraudIntensity : rng.random() < 0.05;
  const isTor = isFraud ? rng.random() < 0.12 * fraudIntensity : rng.random() < 0.005;

  // Behavioral biometrics
  const typingSpeed = isFraud
    ? clamp(randomNormal(65, 25, rng), 25, 140) // fast / robotic
    : clamp(randomNormal(42, 12, rng), 18, 90);
  const fieldsCopyPasted = isFraud
    ? randomInt(2, 8, rng)
    : randomInt(0, 2, rng);
  const sessionDuration = isFraud
    ? clamp(randomNormal(180, 90, rng), 45, 600) // short, rushed
    : clamp(randomNormal(480, 180, rng), 120, 1800);
  const usedAutofill = isFraud ? rng.random() < 0.25 : rng.random() < 0.65;

  return {
    submitted: submitted.toISOString(),
    hour_of_day: hour,
    day_of_week: dayOfWeek,
    is_business_hours: hour >= 9 && hour <= 17 && dayOfWeek >= 1 && dayOfWeek <= 5 ? 1 : 0,
    device_fingerprint: generateDeviceFingerprint(rng),
    ip_address: generateIpAddress(rng),
    ip_risk_score: parseFloat(ipRiskScore.toFixed(3)),
    is_vpn: isVpn ? 1 : 0,
    is_tor: isTor ? 1 : 0,
    isp: randomChoice(["Comcast", "Verizon", "AT&T", "Spectrum", "T-Mobile", "Google Fiber", "Unknown ISP"], rng),
    typing_speed_wpm: Math.round(typingSpeed),
    fields_copy_pasted: fieldsCopyPasted,
    session_duration_seconds: Math.round(sessionDuration),
    used_autofill: usedAutofill ? 1 : 0,
    documents: [
      generateDocumentMetadata("W2_DOCUMENT", submissionDate, isFraud, rng),
      generateDocumentMetadata("BANK_STATEMENT", submissionDate, isFraud, rng),
      generateDocumentMetadata("CREDIT_BUREAU", submissionDate, isFraud, rng),
      generateDocumentMetadata("EMPLOYER_VERIFICATION", submissionDate, isFraud, rng)
    ]
  };
}

function computeMortgagePayment(loanAmount, config) {
  const loanCfg = config.loan || { interest_rate: 0.07, term_years: 30, tax_insurance_rate: 0.012 };
  const r = loanCfg.interest_rate / 12;
  const n = loanCfg.term_years * 12;
  const pi = loanAmount * (r / (1 - Math.pow(1 + r, -n)));
  const taxInsurance = loanAmount * (loanCfg.tax_insurance_rate || 0) / 12;
  return roundToInt(pi + taxInsurance);
}

// ─── 7. CASE ASSEMBLY ───────────────────────────────────────
export function generateCase(id, config, corruptionType = "NONE", severity = "LOW", seed, providedTruth) {
  const rng = createRng(seed);
  let truth = providedTruth || generateLifeScript(`gen-${id}`, config, rng);

  // A3 incoherent world: corrupt the underlying world truth, then honestly report it.
  if (corruptionType === "INCOHERENT") {
    truth = corruptWorldTruth(truth, rng);
  }

  const presentation = corruptPresentation(truth, corruptionType, severity, config, rng);
  let evidence = synthesizeEvidence(truth, rng);

  // FCGS layer-targeted mutation: tamper the evidence layer while leaving claim & truth intact.
  if (corruptionType === "EVIDENCE_TAMPERING") {
    evidence = tamperEvidence(truth, evidence, severity, rng);
  }

  const loanAmount = Math.floor(presentation.current_state.salary * 3.0);
  const monthlyMortgagePayment = computeMortgagePayment(loanAmount, config);
  for (const layer of [truth, presentation]) {
    layer.current_state.monthly_mortgage_payment = monthlyMortgagePayment;
    layer.current_state.loan_amount = loanAmount;
    const monthlyIncome = layer.current_state.salary / 12;
    const obligations = layer.current_state.monthly_obligations || 0;
    layer.current_state.backend_dti = monthlyIncome > 0 ? (obligations + monthlyMortgagePayment) / monthlyIncome : 0;
  }

  const submitted = new Date().toISOString().split('T')[0];
  const applicationMetadata = generateApplicationMetadata(submitted, corruptionType, severity, rng);

  const findings = generateAlignmentFindings(truth, presentation, evidence, applicationMetadata);
  const groundTruthFindings = generateGroundTruthFindings(truth, presentation, evidence, corruptionType);
  const label = computeDecision(truth, presentation, evidence, findings, corruptionType, severity, rng, config);

  return {
    id: `case-gen-${id}-${Date.now()}`,
    applicant: {
      name: `${randomChoice(FIRST_NAMES, rng)} ${randomChoice(LAST_NAMES, rng)}`,
      age: truth.demographics.age,
      ssn_last4: truth.demographics.ssn_last4,
      zip_code: truth.demographics.zip_code,
      region: truth.demographics.region
    },
    application: {
      loan_type: "MORTGAGE",
      loan_amount: loanAmount,
      purpose: randomChoice(["PURCHASE", "REFINANCE"], rng),
      submitted
    },
    application_metadata: applicationMetadata,
    truth,
    presentation,
    evidence,
    alignment_findings: findings,
    ground_truth_findings: groundTruthFindings,
    label: {
      ...label,
      conditions: label.conditions || []
    },
    meta: { seed: rng.seeded ? seed : null }
  };
}

export function generateBlendedCase(id, config, seed, adversarial = false) {
  const mixRng = createRng(seed !== undefined ? `${seed}-mix-${id}` : undefined);
  const caseSeed = seed !== undefined ? `${seed}-${id}` : undefined;
  const advCfg = config.adversarial;
  const useAdversarial = adversarial || advCfg?.enabled;

  if (useAdversarial) {
    const truthRng = createRng(seed !== undefined ? `${seed}-truth-${id}` : undefined);
    const truth = generateLifeScript(`gen-${id}`, config, truthRng);
    const dti = truth.current_state.dti;
    const credit = truth.current_state.credit_score;

    const weights = advCfg.weights || { inflation: 1, concealment: 1, fabrication: 1 };
    let inflationScore = 0, concealmentScore = 0, fabricationScore = 0;
    if (dti >= advCfg.inflation_dti_min && dti <= advCfg.inflation_dti_max) inflationScore = weights.inflation || 1;
    if (dti > advCfg.concealment_dti_threshold) concealmentScore = weights.concealment || 1;
    if (credit < advCfg.fabrication_credit_threshold) fabricationScore = weights.fabrication || 1;
    const total = inflationScore + concealmentScore + fabricationScore;

    let type = "NONE", sev = "LOW";
    if (total > 0 && mixRng.random() < advCfg.adversarial_rate) {
      const pick = mixRng.random() * total;
      if (pick < inflationScore) { type = "INFLATION"; sev = "MEDIUM"; }
      else if (pick < inflationScore + concealmentScore) { type = "CONCEALMENT"; sev = mixRng.random() > 0.5 ? "MEDIUM" : "HIGH"; }
      else { type = "FABRICATION"; sev = "HIGH"; }
    }
    return generateCase(id, config, type, sev, caseSeed, truth);
  }

  const mix = config.corruption?.blend || { clean: 0.85, concealment: 0.07, inflation: 0.05, fabrication: 0.03, bust_out: 0.01 };
  const r = mixRng.random();
  let type = "NONE", sev = "LOW";
  if (r < mix.clean) { type = "NONE"; sev = "LOW"; }
  else if (r < mix.clean + mix.concealment) { type = "CONCEALMENT"; sev = mixRng.random() > 0.5 ? "MEDIUM" : "HIGH"; }
  else if (r < mix.clean + mix.concealment + mix.inflation) { type = "INFLATION"; sev = "MEDIUM"; }
  else if (r < mix.clean + mix.concealment + mix.inflation + mix.fabrication) { type = "FABRICATION"; sev = "HIGH"; }
  else { type = "BUST_OUT"; sev = "HIGH"; }
  return generateCase(id, config, type, sev, caseSeed);
}

export function calculateStatistics(cases) {
  const stats = { age: { values: [] }, salary: { values: [] }, dti: { values: [] }, credit_score: { values: [] } };
  cases.forEach(c => {
    if (c.truth.demographics) stats.age.values.push(c.truth.demographics.age);
    if (c.truth.current_state) {
      stats.salary.values.push(c.truth.current_state.salary);
      stats.dti.values.push(c.truth.current_state.dti);
      stats.credit_score.values.push(c.truth.current_state.credit_score);
    }
  });
  const calc = (arr) => arr.length
    ? { mean: arr.reduce((a, b) => a + b, 0) / arr.length, min: Math.min(...arr), max: Math.max(...arr) }
    : { mean: 0, min: 0, max: 0 };
  return {
    age: calc(stats.age.values),
    salary: calc(stats.salary.values),
    dti: calc(stats.dti.values),
    credit_score: calc(stats.credit_score.values)
  };
}

// ─── 7. ML FEATURE EXTRACTION ───────────────────────────────
const ALIGNMENT_LEVEL_ORDER = { A0: 0, A1: 1, A2: 2, A3: 3, A4: 4, A5: 5 };

function safeDiv(numer, denom) { return denom ? numer / denom : 0; }

export function extractMLFeatures(c) {
  const t = c.truth?.current_state || {};
  const p = c.presentation?.current_state || {};
  const label = c.label || {};
  const findings = c.alignment_findings || [];
  const evidence = c.evidence || [];

  const w2 = evidence.find(e => e.source === "W2_DOCUMENT")?.fields || {};
  const bank = evidence.find(e => e.source === "BANK_STATEMENT")?.fields || {};
  const bureau = evidence.find(e => e.source === "CREDIT_BUREAU")?.fields || {};
  const employerVerif = evidence.find(e => e.source === "EMPLOYER_VERIFICATION")?.fields || {};

  const salaryDiff = (p.salary ?? t.salary ?? 0) - (t.salary ?? 0);
  const checkingDiff = (p.checking_balance ?? t.checking_balance ?? 0) - (t.checking_balance ?? 0);
  const obligationsDiff = (t.monthly_obligations ?? 0) - (p.monthly_obligations ?? 0);

  const dimensionAligned = (dim) => {
    const f = findings.find(x => x.dimension === dim);
    return f ? (f.level === "A0" ? 1 : 0) : 1;
  };

  const outcome = label.expected_outcome || "DECLINE";
  const fraudRisk = label.fraud_risk_level || "NONE";

  return {
    // Identifiers & demographics
    case_id: c.id,
    name: c.applicant?.name,
    age: c.applicant?.age,
    zip_code: c.applicant?.zip_code,
    region: c.applicant?.region,
    cost_of_living_index: t.cost_of_living_index,
    loan_amount: c.application?.loan_amount,
    purpose: c.application?.purpose,
    regime: t.regime || "UNKNOWN",
    persona: t.persona || "UNKNOWN",
    tenure_stability: t.tenure_stability || "UNKNOWN",
    seed: c.meta?.seed,

    // Truth state
    truth_salary: t.salary,
    truth_dti: t.dti,
    truth_credit_score: t.credit_score,
    truth_checking: t.checking_balance,
    truth_tenure_months: t.tenure_months,
    truth_monthly_obligations: t.monthly_obligations,

    // Presentation state
    pres_salary: p.salary,
    pres_checking: p.checking_balance,
    pres_tenure_months: p.tenure_months,
    pres_monthly_obligations: p.monthly_obligations,
    pres_stated_dti: p.stated_dti ?? p.dti ?? t.dti,

    // Discrepancy numeric features
    salary_diff: salaryDiff,
    salary_diff_pct: safeDiv(salaryDiff, t.salary ?? 1),
    checking_diff: checkingDiff,
    checking_diff_pct: safeDiv(checkingDiff, t.checking_balance ?? 1),
    obligations_diff: obligationsDiff,
    obligations_diff_pct: safeDiv(obligationsDiff, Math.max(1, t.monthly_obligations ?? 1)),

    // Discrepancy binary flags
    salary_inflated: salaryDiff > 0 ? 1 : 0,
    checking_inflated: checkingDiff > 0 ? 1 : 0,
    employer_changed: p.employer !== t.employer ? 1 : 0,
    obligations_understated: obligationsDiff > 0 ? 1 : 0,

    // Evidence signals
    w2_salary: w2.w2_wages,
    w2_salary_diff: (w2.w2_wages ?? t.salary ?? 0) - (t.salary ?? 0),
    bank_checking: bank.checking_balance,
    bank_checking_diff: (bank.checking_balance ?? t.checking_balance ?? 0) - (t.checking_balance ?? 0),
    bureau_credit_score: bureau.credit_score,
    bureau_credit_score_diff: (bureau.credit_score ?? t.credit_score ?? 0) - (t.credit_score ?? 0),
    bureau_liabilities_count: bureau.open_accounts,
    employer_verified_name: employerVerif.employer,
    employer_name_mismatch: (employerVerif.employer && employerVerif.employer !== t.employer) ? 1 : 0,

    // Ledger-derived cash-flow features
    pay_frequency: t.income_stream?.pay_frequency,
    pretax_deduction_rate: t.income_stream?.pretax_deduction_rate,
    net_per_check: t.income_stream?.net_per_check,
    avg_monthly_deposit: bank.monthly_payroll_deposit ?? t.income_stream?.monthly_net_deposit,
    deposit_variance: t.monthly_ledger?.length
      ? Math.sqrt(t.monthly_ledger.reduce((sum, m) => sum + Math.pow(m.salary_deposits - (t.income_stream?.monthly_net_deposit || 0), 2), 0) / t.monthly_ledger.length)
      : null,
    rent_to_income_ratio: safeDiv(t.expense_obligations?.rent, (t.salary ?? 1) / 12),
    monthly_obligations_to_income: safeDiv(t.monthly_obligations, (t.salary ?? 1) / 12),
    discretionary_to_income: safeDiv(t.expense_obligations?.discretionary, (t.salary ?? 1) / 12),
    overdraft_count: t.overdraft_count ?? 0,
    w2_vs_gross_diff: (w2.w2_wages ?? t.salary ?? 0) - (t.salary ?? 0),

    // Alignment dimensions (binary aligned flags)
    identity_aligned: dimensionAligned("identity"),
    employment_aligned: dimensionAligned("employment"),
    income_aligned: dimensionAligned("income"),
    assets_aligned: dimensionAligned("assets"),
    liabilities_aligned: dimensionAligned("liabilities"),
    address_aligned: dimensionAligned("address"),
    timeline_aligned: dimensionAligned("timeline"),
    cash_flow_aligned: dimensionAligned("cash_flow"),
    affordability_aligned: dimensionAligned("affordability"),
    document_metadata_aligned: dimensionAligned("document_metadata"),
    network_aligned: dimensionAligned("network"),
    behavioral_aligned: dimensionAligned("behavioral"),

    // Application / device / behavioral metadata
    hour_of_day: c.application_metadata?.hour_of_day,
    day_of_week: c.application_metadata?.day_of_week,
    is_business_hours: c.application_metadata?.is_business_hours,
    ip_risk_score: c.application_metadata?.ip_risk_score,
    is_vpn: c.application_metadata?.is_vpn,
    is_tor: c.application_metadata?.is_tor,
    typing_speed_wpm: c.application_metadata?.typing_speed_wpm,
    fields_copy_pasted: c.application_metadata?.fields_copy_pasted,
    session_duration_seconds: c.application_metadata?.session_duration_seconds,
    used_autofill: c.application_metadata?.used_autofill,
    min_doc_age_days: c.application_metadata?.documents ? Math.min(...c.application_metadata.documents.map(d => d.days_before_submission)) : null,
    max_doc_age_days: c.application_metadata?.documents ? Math.max(...c.application_metadata.documents.map(d => d.days_before_submission)) : null,
    avg_doc_age_days: c.application_metadata?.documents
      ? c.application_metadata.documents.reduce((s, d) => s + d.days_before_submission, 0) / c.application_metadata.documents.length
      : null,
    docs_created_within_2_days: c.application_metadata?.documents
      ? c.application_metadata.documents.filter(d => d.days_before_submission <= 2).length
      : null,

    // Labels / targets
    alignment_level: label.alignment_level,
    alignment_level_numeric: ALIGNMENT_LEVEL_ORDER[label.alignment_level] ?? 0,
    fraud_risk_level: fraudRisk,
    coherence_status: label.coherence_status,
    case_coherence_status: label.case_coherence_status,
    expected_outcome: outcome,
    decision_reason: label.reason,
    difficulty: label.difficulty,
    is_fraud: ["LOW", "MODERATE", "HIGH", "CRITICAL"].includes(fraudRisk) ? 1 : 0,
    outcome_approve: outcome === "APPROVE" ? 1 : 0,
    outcome_decline: outcome === "DECLINE" ? 1 : 0,
    outcome_manual_review: outcome === "MANUAL_REVIEW" ? 1 : 0
  };
}

function escapeCsv(val) {
  const s = val === undefined || val === null ? "" : String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function casesToCsv(cases) {
  if (cases.length === 0) return "";
  const features = cases.map(extractMLFeatures);
  const headers = Object.keys(features[0]);
  const rows = features.map(f => headers.map(h => escapeCsv(f[h])).join(","));
  return headers.join(",") + "\n" + rows.join("\n");
}

// src/core/life.js — Life-script generation: demographics, employment, assets, liabilities, ledger.

import {
  randomNormal,
  randomLognormal,
  randomBeta,
  randomExponential,
  randomCategorical,
  clamp,
  roundToInt,
  randomInt,
  randomChoice,
  cholesky,
  sampleCorrelatedNormals,
  normalCDF,
  inverseNormalCDF,
  lognormalCDF,
  lognormalInverseCDF,
  inverseBetaCDF
} from "../utils/distributions.js";

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

// ─── INCOME / EXPENSE / LEDGER PRIMITIVES ───────────────────
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
  const applicationDate = config.generation?.as_of_date ? new Date(config.generation.as_of_date) : new Date();

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

function choosePersonaBySalaryRank(config, rng, salaryBase) {
  const personaCfg = config.personas;
  const categories = personaCfg.categories;
  const probabilities = personaCfg.probabilities;
  if (categories.length === 0) return "GENERIC";
  if (salaryBase === undefined || categories.length === 1) {
    return randomCategorical(categories, probabilities, rng);
  }

  const params = personaCfg.params || {};
  const medians = categories.map(p => params[p]?.salary_median ?? config.employment.salary_base.median);
  const minMedian = Math.min(...medians);
  const maxMedian = Math.max(...medians);
  const range = Math.max(1, maxMedian - minMedian);

  const empCfg = config.employment.salary_base;
  const salaryRank = clamp(lognormalCDF(salaryBase, empCfg.median, empCfg.gini), 0.001, 0.999);

  // Blend configured probabilities with a Gaussian affinity to the salary rank.
  // sigma controls how strongly persona is tied to salary rank; larger = more random.
  const sigma = 0.35;
  const weights = categories.map((p, i) => {
    const personaRank = (medians[i] - minMedian) / range;
    const affinity = Math.exp(-Math.pow(salaryRank - personaRank, 2) / (2 * sigma * sigma));
    return probabilities[i] * affinity;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const normalized = weights.map(w => w / total);
  return randomCategorical(categories, normalized, rng);
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
  const persona = choosePersonaBySalaryRank(config, rng, copulaPrimitives?.salary_base);
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

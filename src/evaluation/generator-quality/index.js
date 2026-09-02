// src/evaluation/generator-quality/index.js — Layer 1: is the generated data internally valid?
//
// Answers: Are the distributions correct? Are financial relationships coherent? Are evidence
// documents consistent? Are correlations realistic? Are seeds reproducible?
// This layer says NOTHING about whether fraud can be detected or decisions are right.

import { createRng } from "../../utils/prng.js";
import { randomNormal, randomLognormal, randomBeta, clamp, roundToInt } from "../../utils/distributions.js";
import { ksTest, chiSquareTest, categoricalChiSquare, normalCDF, lognormalCDF, betaCDF, pearson, round } from "../stats.js";

export const GENERATOR_QUALITY_VERSION = "1.0.0";

/** Fields every case must carry (schema contract). */
export const REQUIRED_CASE_PATHS = [
  "id", "schema_version", "applicant.age", "applicant.zip_code", "applicant.region",
  "application.loan_amount", "application.submitted",
  "application_metadata.ip_risk_score", "application_metadata.documents",
  "audit_attributes.age_band", "audit_attributes.income_band",
  "truth.current_state.salary", "truth.current_state.dti", "truth.current_state.credit_score",
  "truth.current_state.checking_balance", "truth.current_state.monthly_ledger", "truth.current_state.annual_w2_wages",
  "presentation.current_state.salary", "presentation.current_state.backend_dti",
  "evidence", "alignment_findings", "ground_truth_findings",
  "label.expected_outcome", "label.reason_codes", "label.alignment_level", "label.fraud_risk_level",
  "meta.generator_version", "meta.corruption_type"
];
const NON_EMPTY_ARRAYS = new Set(["evidence", "alignment_findings", "application_metadata.documents", "truth.current_state.monthly_ledger"]);
export const REQUIRED_EVIDENCE_SOURCES = ["W2_DOCUMENT", "EMPLOYER_VERIFICATION", "BANK_STATEMENT", "CREDIT_BUREAU", "RENT_VERIFICATION", "GEOGRAPHIC_VERIFICATION"];

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

// ── Distribution tests on sampled primitives ─────────────────────────────
export function primitiveDistributionTests(config, rng, n = 5000) {
  const ageCfg = config.demographics.age;
  const salCfg = config.employment.salary_base;
  const dtiCfg = config.liabilities.dti_ratio;
  const credCfg = config.credit.score_base;
  const chkCfg = config.assets.checking_balance;

  const ages = Array.from({ length: n }, () => roundToInt(clamp(randomNormal(ageCfg.mean, ageCfg.stddev, rng), ageCfg.min, ageCfg.max)));
  const salaries = Array.from({ length: n }, () => randomLognormal(salCfg.median, salCfg.gini, rng));
  const dtis = Array.from({ length: n }, () => randomBeta(dtiCfg.alpha, dtiCfg.beta, rng) * dtiCfg.scale_max);
  const credits = Array.from({ length: n }, () => roundToInt(clamp(randomNormal(credCfg.mean, credCfg.stddev, rng), credCfg.min, credCfg.max)));
  const checking = Array.from({ length: n }, () => randomLognormal(chkCfg.median, chkCfg.gini, rng));

  const ageBins = [
    { min: ageCfg.min, max: 30, lower: -Infinity, upper: 29.5 },
    { min: 30, max: 40, lower: 29.5, upper: 39.5 },
    { min: 40, max: 50, lower: 39.5, upper: 49.5 },
    { min: 50, max: 60, lower: 49.5, upper: 59.5 },
    { min: 60, max: ageCfg.max + 1, lower: 59.5, upper: Infinity }
  ];
  const ageChi = chiSquareTest(ages, ageBins, x => normalCDF(x, ageCfg.mean, ageCfg.stddev));

  const ks = (name, samples, cdf, family) => {
    const r = ksTest(samples, cdf);
    return { name, family, test: "KS", statistic: round(r.statistic), p_value: round(r.pValue), threshold: 0.05, n, grade: r.statistic < 0.05 ? "PASS" : r.statistic < 0.10 ? "WARN" : "FAIL" };
  };
  return [
    { name: "age", family: "truncated normal", test: "chi-square", statistic: round(ageChi.statistic, 3), p_value: round(ageChi.pValue), threshold: 15, n, grade: ageChi.statistic < 15 ? "PASS" : ageChi.statistic < 25 ? "WARN" : "FAIL" },
    ks("salary_base", salaries, x => lognormalCDF(x, salCfg.median, salCfg.gini), "lognormal"),
    ks("dti", dtis, x => betaCDF(x / dtiCfg.scale_max, dtiCfg.alpha, dtiCfg.beta), "scaled beta"),
    ks("credit_score_base", credits, x => normalCDF(x, credCfg.mean, credCfg.stddev), "truncated normal"),
    ks("checking_balance", checking, x => lognormalCDF(x, chkCfg.median, chkCfg.gini), "lognormal")
  ];
}

// ── Full-pipeline mixture and range tests ───────────────────────────────
export function pipelineMixtureTests(cases, config) {
  const tests = [];
  const mix = (name, cfg, getter) => {
    if (!cfg?.categories) return;
    const counts = cfg.categories.map(cat => cases.filter(c => getter(c) === cat).length);
    const r = categoricalChiSquare(counts, cfg.probabilities);
    tests.push({ name, family: "categorical mixture", test: "chi-square", statistic: round(r.statistic, 3), p_value: round(r.pValue), threshold: 0.001, n: cases.length, grade: r.pValue > 0.001 ? "PASS" : "FAIL", detail: cfg.categories.map((c, i) => `${c}:${counts[i]}`).join(" ") });
  };
  mix("regime_mixture", config.regimes, c => c.truth.current_state.regime);
  mix("region_mixture", config.geography, c => c.truth.current_state.region);

  // Persona salary bands (region-adjusted)
  const personaParams = config.personas?.params || {};
  const geoMults = Object.values(config.geography?.params || {}).map(p => p.salary_multiplier || 1);
  const minG = Math.min(...geoMults, 1), maxG = Math.max(...geoMults, 1);
  for (const [persona, params] of Object.entries(personaParams)) {
    const sub = cases.filter(c => c.truth.current_state.persona === persona);
    if (!sub.length) continue;
    const lo = (params.salary_min ?? 0) * minG, hi = (params.salary_max ?? Infinity) * maxG;
    const oob = sub.filter(c => c.truth.current_state.salary < lo || c.truth.current_state.salary > hi).length;
    tests.push({ name: `persona_salary_band:${persona}`, family: "range", test: "bounds", statistic: round(oob / sub.length), p_value: null, threshold: 0, n: sub.length, grade: oob === 0 ? "PASS" : "FAIL", detail: `[${Math.round(lo)}-${hi === Infinity ? "inf" : Math.round(hi)}]` });
  }
  // Global range sanity
  const ranges = [
    ["age", c => c.truth.demographics.age, config.demographics.age.min, config.demographics.age.max],
    ["credit_score", c => c.truth.current_state.credit_score, config.credit.score_base.min, config.credit.score_base.max],
    ["dti", c => c.truth.current_state.dti, 0, config.liabilities.dti_ratio.scale_max + (config.liabilities.dti_ratio.scale_min || 0)]
  ];
  // The INCOHERENT negative control deliberately breaks world-truth invariants; exclude it from range checks.
  const coherent = cases.filter(c => c.meta?.corruption_type !== "INCOHERENT");
  for (const [name, get, lo, hi] of ranges) {
    const oob = coherent.filter(c => get(c) < lo - 1e-9 || get(c) > hi + 1e-9).length;
    tests.push({ name: `range:${name}`, family: "range", test: "bounds", statistic: round(oob / Math.max(1, coherent.length)), p_value: null, threshold: 0, n: coherent.length, grade: oob === 0 ? "PASS" : "FAIL", detail: `[${lo}-${hi}] (coherent cases only)` });
  }
  return tests;
}

// ── Correlation structure ───────────────────────────────────────────────
export function correlationTests(cases, config, tolerance = 0.25) {
  const results = [];
  const vars = {
    age: c => c.truth.demographics.age,
    salary_base: c => c.truth.current_state.salary,
    dti: c => c.truth.current_state.dti,
    checking_balance: c => c.truth.current_state.checking_balance,
    credit_score: c => c.truth.current_state.credit_score
  };
  const cols = Object.fromEntries(Object.entries(vars).map(([k, f]) => [k, cases.map(f)]));
  if (config.copula?.enabled) {
    const names = config.copula.variables;
    const target = config.copula.correlation_matrix;
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const achieved = pearson(cols[names[i]], cols[names[j]]);
      results.push({ pair: `${names[i]} vs ${names[j]}`, source: "copula", target: round(target[i][j], 3), achieved: round(achieved, 3), diff: round(achieved - target[i][j], 3), tolerance, within_tolerance: Math.abs(achieved - target[i][j]) <= tolerance });
    }
  }
  // Sign expectations that hold regardless of copula configuration.
  const signs = [["salary_base", "dti", -1], ["salary_base", "credit_score", 1], ["dti", "credit_score", -1], ["salary_base", "checking_balance", 1]];
  for (const [a, b, sign] of signs) {
    const r = pearson(cols[a], cols[b]);
    results.push({ pair: `${a} vs ${b}`, source: "sign-expectation", target: sign > 0 ? "positive" : "negative", achieved: round(r, 3), diff: null, tolerance: null, within_tolerance: Math.sign(r) === sign });
  }
  return results;
}

// ── Ledger invariants & evidence consistency ─────────────────────────────
export function ledgerInvariantChecks(cases) {
  const checks = { accounting_identity: 0, obligations_equal_liability_sum: 0, loan_amount_rule: 0, backend_dti_identity: 0, evidence_sources_complete: 0 };
  const n = cases.length;
  const failures = [];
  for (const c of cases) {
    const s = c.truth.current_state;
    const p = c.presentation.current_state;
    let ok = true;
    for (const m of s.monthly_ledger || []) {
      if (Math.abs(m.starting_checking_balance + m.salary_deposits - m.total_outflows - m.ending_checking_balance) > 1) { ok = false; break; }
    }
    if (ok) checks.accounting_identity++; else failures.push({ case_id: c.id, check: "accounting_identity" });

    const liabSum = c.truth.events.filter(e => e.type === "LIABILITY_OPENED").reduce((a, e) => a + e.payment, 0);
    const liabOk = c.meta?.corruption_type === "INCOHERENT" ? true : Math.abs(liabSum - s.monthly_obligations) <= liabSum * 0.02 + 1 || s.monthly_obligations >= liabSum; // otherDebt not itemised as an event
    if (liabOk) checks.obligations_equal_liability_sum++; else failures.push({ case_id: c.id, check: "obligations_equal_liability_sum" });

    if (c.application.loan_amount === Math.floor(p.salary * 3.0)) checks.loan_amount_rule++; else failures.push({ case_id: c.id, check: "loan_amount_rule" });

    const expectedDti = p.salary > 0 ? ((p.monthly_obligations || 0) + p.monthly_mortgage_payment) / (p.salary / 12) : 0;
    if (Math.abs(expectedDti - p.backend_dti) < 1e-6) checks.backend_dti_identity++; else failures.push({ case_id: c.id, check: "backend_dti_identity" });

    const sources = new Set(c.evidence.map(e => e.source));
    if (REQUIRED_EVIDENCE_SOURCES.every(src => sources.has(src))) checks.evidence_sources_complete++; else failures.push({ case_id: c.id, check: "evidence_sources_complete" });
  }
  const rows = Object.entries(checks).map(([check, pass]) => ({ check, pass, n, pass_rate: n ? round(pass / n) : 1 }));
  const allPass = rows.every(r => r.pass === n);
  return { rows, all_pass_rate: n ? round(Math.min(...rows.map(r => r.pass_rate))) : 1, all_pass: allPass, failures: failures.slice(0, 50) };
}

/**
 * Evidence consistency: for clean, coherent cases every evidence value derived from the ledger
 * must reconcile with the ledger within the tolerance implied by the configured document
 * fidelity (3.5σ of the fidelity noise, so an honest generator passes ≥99.9% of the time).
 */
export function evidenceConsistencyChecks(cases, { w2Fidelity = 0.98, bankFidelity = 0.99, bureauFidelity = 0.99, sigmas = 3.5 } = {}) {
  const clean = cases.filter(c => (c.meta?.corruption_type ?? "NONE") === "NONE");
  let pass = 0;
  const failures = [];
  for (const c of clean) {
    const s = c.truth.current_state;
    const ledger = s.monthly_ledger || [];
    const last = ledger[ledger.length - 1];
    const bank = c.evidence.find(e => e.source === "BANK_STATEMENT")?.fields || {};
    const w2 = c.evidence.find(e => e.source === "W2_DOCUMENT")?.fields || {};
    const bureau = c.evidence.find(e => e.source === "CREDIT_BUREAU")?.fields || {};
    const emp = c.evidence.find(e => e.source === "EMPLOYER_VERIFICATION")?.fields || {};
    const problems = [];
    if (last && Math.abs(bank.checking_balance - last.ending_checking_balance) > Math.abs(last.ending_checking_balance) * (1 - bankFidelity) * sigmas + 2) problems.push("bank_vs_ledger_balance");
    if (Math.abs(w2.w2_wages - s.annual_w2_wages) > s.annual_w2_wages * (1 - w2Fidelity) * sigmas + 2) problems.push("w2_vs_annual_wages");
    if (Math.abs(bureau.credit_score - s.credit_score) > s.credit_score * (1 - bureauFidelity) * sigmas + 2) problems.push("bureau_vs_credit_score");
    if (emp.salary !== s.salary) problems.push("employer_verification_salary");
    if (emp.employer !== s.employer) problems.push("employer_verification_name");
    const avgDeposit = ledger.length ? ledger.reduce((a, m) => a + m.salary_deposits, 0) / ledger.length : s.income_stream?.monthly_net_deposit;
    if (Math.abs(bank.monthly_payroll_deposit - avgDeposit) > 1) problems.push("payroll_deposit_vs_ledger");
    if (problems.length === 0) pass++; else failures.push({ case_id: c.id, problems });
  }
  return { n: clean.length, pass, rate: clean.length ? round(pass / clean.length) : 1, failures: failures.slice(0, 50) };
}

export function missingFieldChecks(cases) {
  let missing = 0;
  const detail = {};
  for (const c of cases) {
    let caseMissing = false;
    for (const path of REQUIRED_CASE_PATHS) {
      const v = getPath(c, path);
      if (v === undefined || v === null || (Array.isArray(v) && NON_EMPTY_ARRAYS.has(path) && v.length === 0)) {
        caseMissing = true;
        detail[path] = (detail[path] || 0) + 1;
      }
    }
    if (caseMissing) missing++;
  }
  return { n: cases.length, missing, rate: cases.length ? round(missing / cases.length) : 0, by_path: detail };
}

export function reproducibilityCheck(generateFn, count = 25) {
  const a = JSON.stringify(Array.from({ length: count }, (_, i) => generateFn(i)));
  const b = JSON.stringify(Array.from({ length: count }, (_, i) => generateFn(i)));
  return { checked: count, identical: a === b, rate: a === b ? 1 : 0 };
}

export function evaluateGeneratorQuality(cases, config, { seed = "benchmark", regenerate } = {}) {
  const rng = createRng(`${seed}-primitives`);
  const distribution_tests = [...primitiveDistributionTests(config, rng), ...pipelineMixtureTests(cases, config)];
  const correlation_results = correlationTests(cases, config);
  const ledger = ledgerInvariantChecks(cases);
  const evidence = evidenceConsistencyChecks(cases);
  const missing = missingFieldChecks(cases);
  const reproducibility = regenerate ? reproducibilityCheck(regenerate) : { checked: 0, identical: null, rate: null };
  return {
    version: GENERATOR_QUALITY_VERSION,
    n: cases.length,
    distribution_tests,
    distribution_pass_rate: round(distribution_tests.filter(t => t.grade === "PASS").length / distribution_tests.length),
    correlation_results,
    correlation_within_tolerance_rate: round(correlation_results.filter(r => r.within_tolerance).length / correlation_results.length),
    ledger_invariants: ledger,
    evidence_consistency: evidence,
    missing_required_fields: missing,
    reproducibility
  };
}

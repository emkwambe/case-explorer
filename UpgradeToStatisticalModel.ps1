# Math Modeler Upgrade Script
# This safely overwrites the JSX file with the statistically-calibrated model + Data Table tab.

Write-Host "Upgrading to Statistical Model..." -ForegroundColor Cyan

$jsxContent = @'
import React, { useState } from "react";

// ─── 1. INITIAL CASES ──────────────────────────────────────
const INITIAL_CASES = [
  { id: "case-001", applicant: { name: "Sarah Chen", age: 31, ssn_last4: "4821" }, application: { loan_type: "MORTGAGE", loan_amount: 285000, purpose: "PURCHASE", submitted: "2026-07-28" }, truth: { events: [{ t: "2023-03-01", type: "EMPLOYMENT_START", entity: "Northwind Analytics", salary: 68000 }, { t: "2024-06-01", type: "SALARY_INCREASE", salary: 74000 }], current_state: { employment_status: "ACTIVE", employer: "Northwind Analytics", salary: 79500, tenure_months: 41, checking_balance: 18500, monthly_obligations: 310, dti: 0.32, credit_score: 742 } }, presentation: { events: "SAME_AS_TRUTH", current_state: { employment_status: "ACTIVE", employer: "Northwind Analytics", salary: 79500, tenure_months: 41, checking_balance: 18500, monthly_obligations: 310, stated_dti: 0.32 } }, evidence: [{ source: "W2_DOCUMENT", date: "2026-07-28", fields: { w2_wages: 78200 }, fidelity: 0.98 }], alignment_findings: [{ dimension: "income", level: "A0", status: "ALIGNED", details: "W-2 matches employer." }], label: { alignment_level: "A0", coherence_status: "COHERENT", expected_outcome: "APPROVE", fraud_risk_level: "NONE", difficulty: "BASIC", conditions: [] } },
  { id: "case-002", applicant: { name: "Marcus Johnson", age: 38, ssn_last4: "1197" }, application: { loan_type: "MORTGAGE", loan_amount: 340000, purpose: "REFINANCE", submitted: "2026-07-29" }, truth: { events: [{ t: "2020-08-15", type: "EMPLOYMENT_START", entity: "City Hospital", salary: 82000 }], current_state: { employment_status: "ACTIVE", employer: "City Hospital", salary: 102000, tenure_months: 72, checking_balance: 24200, monthly_obligations: 605, dti: 0.32, credit_score: 718 } }, presentation: { events: [], current_state: { employment_status: "ACTIVE", employer: "City Hospital", salary: 103000, tenure_months: 72, checking_balance: 24200, monthly_obligations: 605, stated_dti: 0.34 } }, evidence: [{ source: "W2_DOCUMENT", date: "2026-07-29", fields: { w2_wages: 100400 }, fidelity: 0.98 }], alignment_findings: [{ dimension: "income", level: "A1", status: "ROUNDING_VARIANCE", details: "Self-reported $103k vs employer $102k." }], label: { alignment_level: "A1", coherence_status: "MOSTLY_COHERENT", expected_outcome: "APPROVE", fraud_risk_level: "NONE", difficulty: "BASIC", conditions: ["Clarify overtime"] } },
  { id: "case-003", applicant: { name: "Jennifer Walsh", age: 29, ssn_last4: "7734" }, application: { loan_type: "MORTGAGE", loan_amount: 295000, purpose: "PURCHASE", submitted: "2026-07-30" }, truth: { events: [{ t: "2022-01-10", type: "EMPLOYMENT_START", entity: "Bright Media", salary: 58000 }, { t: "2025-11-01", type: "LIABILITY_OPENED", type_detail: "CREDIT_CARD", payment: 420 }], current_state: { employment_status: "ACTIVE", employer: "Bright Media", salary: 69500, tenure_months: 55, checking_balance: 16800, monthly_obligations: 1010, dti: 0.41, credit_score: 681 } }, presentation: { events: [], current_state: { employment_status: "ACTIVE", employer: "Bright Media", salary: 69500, tenure_months: 55, checking_balance: 16800, monthly_obligations: 275, stated_dti: 0.28 } }, evidence: [{ source: "BANK_STATEMENT", date: "2026-07-30", fields: { checking_balance: 16800, recurring_debits: [{ payee: "Capital One", amount: 420 }] }, fidelity: 0.99 }], alignment_findings: [{ dimension: "liabilities", level: "A3", status: "MATERIAL_MISMATCH", details: "Application discloses 1 liability. Bank shows 2." }], label: { alignment_level: "A3", coherence_status: "MATERIALLY_INCOHERENT", expected_outcome: "DECLINE", fraud_risk_level: "MODERATE", difficulty: "INTERMEDIATE", conditions: ["Explain undisclosed debts"] } },
  { id: "case-004", applicant: { name: "David Kim", age: 42, ssn_last4: "3356" }, application: { loan_type: "MORTGAGE", loan_amount: 485000, purpose: "PURCHASE", submitted: "2026-07-30" }, truth: { events: [{ t: "2025-07-01", type: "EMPLOYMENT_START", entity: "Temp Agency Inc", salary: 42000 }], current_state: { employment_status: "ACTIVE", employer: "Temp Agency Inc", salary: 42000, tenure_months: 13, checking_balance: 3200, monthly_obligations: 280, dti: 0.38, credit_score: 642 } }, presentation: { events: [], current_state: { employment_status: "ACTIVE", employer: "Apex Financial Group", salary: 148000, tenure_months: 65, checking_balance: 47000, monthly_obligations: 280, stated_dti: 0.18 } }, evidence: [{ source: "W2_DOCUMENT", date: "2026-07-30", fields: { w2_wages: 42000, employer: "Temp Agency Inc" }, fidelity: 0.98 }], alignment_findings: [{ dimension: "employment", level: "A4", status: "PROBABLE_MANIPULATION", details: "Claims Apex Financial. Verification NOT_FOUND." }], label: { alignment_level: "A4", coherence_status: "INTENTIONALLY_ADVERSARIAL", expected_outcome: "DECLINE", fraud_risk_level: "CRITICAL", difficulty: "ADVANCED", conditions: ["Escalate to fraud unit"] } }
];

// ─── 2. STATISTICAL SAMPLING FUNCTIONS (Math Models) ───────
function randomNormal(mean, stddev) {
  const u1 = Math.random(), u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2) * stddev + mean;
}
function randomLognormal(median, gini) {
  const sigma = Math.sqrt(2 * Math.log(1 + Math.pow(gini, 2)));
  const mu = Math.log(median) - (sigma * sigma) / 2;
  return Math.exp(randomNormal(0, 1) * sigma + mu);
}
function randomGamma(shape, scale) {
  if (shape < 1) return randomGamma(shape + 1, scale) * Math.pow(Math.random(), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = randomNormal(0, 1), v = Math.pow(1 + c * x, 3);
    if (v > 0) {
      const u = Math.random();
      if (u < 1 - 0.0331 * Math.pow(x, 4) || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
    }
  }
}
function randomBeta(alpha, beta) {
  const x = randomGamma(alpha, 1), y = randomGamma(beta, 1);
  return x / (x + y);
}
function randomExponential(rate) { return -Math.log(1 - Math.random()) / rate; }
function randomCategorical(categories, probabilities) {
  const rand = Math.random(); let cumulative = 0;
  for (let i = 0; i < probabilities.length; i++) {
    cumulative += probabilities[i];
    if (rand < cumulative) return categories[i];
  }
  return categories[categories.length - 1];
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function roundToInt(value) { return Math.round(value); }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── 3. DISTRIBUTION CONFIGURATION (Tune your parameters here) ─
const CONFIG = {
  demographics: { age: { mean: 38.5, stddev: 12.3, min: 22, max: 70 } },
  employment: {
    salary_base: { median: 58000, gini: 0.42 },
    salary_by_age: { coefficient: 1200, peak_age: 52, decline_rate: 0.02 },
    tenure_months: { rate: 0.035, min: 1, max: 480 },
    industry: {
      categories: ["Technology", "Healthcare", "Finance", "Retail", "Education", "Manufacturing", "Other"],
      probabilities: [0.18, 0.14, 0.12, 0.15, 0.10, 0.13, 0.18],
      multipliers: { "Technology": 1.35, "Healthcare": 1.15, "Finance": 1.42, "Retail": 0.78, "Education": 0.82, "Manufacturing": 0.95, "Other": 1.0 }
    }
  },
  liabilities: {
    dti_ratio: { alpha: 2.5, beta: 6.0, scale_max: 0.65 },
    student_loan: { prob: 0.42, median: 28000, gini: 0.55 },
    auto_loan: { prob: 0.58, mean: 485, stddev: 145, min: 200, max: 950 }
  },
  assets: {
    checking_balance: { median: 8500, gini: 0.68 },
    savings_rate: { alpha: 2.0, beta: 8.0 },
    down_payment_months: { mean: 18, stddev: 8, min: 3, max: 60 }
  },
  credit: { score_base: { mean: 692, stddev: 85, min: 300, max: 850 }, dti_penalty: -85 }
};

// ─── 4. GENERATION LOGIC ───────────────────────────────────
function generateDemographics() {
  return {
    age: roundToInt(clamp(randomNormal(CONFIG.demographics.age.mean, CONFIG.demographics.age.stddev), CONFIG.demographics.age.min, CONFIG.demographics.age.max)),
    ssn_last4: String(randomInt(1000, 9999))
  };
}
function generateEmployment(age) {
  const industry = randomCategorical(CONFIG.employment.industry.categories, CONFIG.employment.industry.probabilities);
  let salary = randomLognormal(CONFIG.employment.salary_base.median, CONFIG.employment.salary_base.gini);
  salary += age * CONFIG.employment.salary_by_age.coefficient;
  if (age > CONFIG.employment.salary_by_age.peak_age) salary *= Math.pow(1 - CONFIG.employment.salary_by_age.decline_rate, age - CONFIG.employment.salary_by_age.peak_age);
  salary *= (CONFIG.employment.industry.multipliers[industry] || 1.0);
  const tenureMonths = roundToInt(clamp(randomExponential(CONFIG.employment.tenure_months.rate), CONFIG.employment.tenure_months.min, CONFIG.employment.tenure_months.max));
  return { industry, salary: roundToInt(salary), tenureMonths, hasGap: Math.random() < 0.18 };
}
function generateLiabilities(salary) {
  const dti = randomBeta(CONFIG.liabilities.dti_ratio.alpha, CONFIG.liabilities.dti_ratio.beta) * CONFIG.liabilities.dti_ratio.scale_max;
  const totalMonthlyDebt = salary * dti / 12;
  const hasStudentLoan = Math.random() < CONFIG.liabilities.student_loan.prob;
  const studentLoanPayment = hasStudentLoan ? randomLognormal(CONFIG.liabilities.student_loan.median, CONFIG.liabilities.student_loan.gini) * 0.01 : 0;
  const hasAutoLoan = Math.random() < CONFIG.liabilities.auto_loan.prob;
  const autoPayment = hasAutoLoan ? clamp(randomNormal(CONFIG.liabilities.auto_loan.mean, CONFIG.liabilities.auto_loan.stddev), CONFIG.liabilities.auto_loan.min, CONFIG.liabilities.auto_loan.max) : 0;
  return { dti, studentLoanPayment: roundToInt(studentLoanPayment), autoPayment: roundToInt(autoPayment), otherDebt: roundToInt(Math.max(0, totalMonthlyDebt - studentLoanPayment - autoPayment)) };
}
function generateAssets(salary) {
  const rate = randomBeta(CONFIG.assets.savings_rate.alpha, CONFIG.assets.savings_rate.beta);
  const monthlySavings = (salary / 12) * rate;
  const downPaymentMonths = roundToInt(clamp(randomNormal(CONFIG.assets.down_payment_months.mean, CONFIG.assets.down_payment_months.stddev), CONFIG.assets.down_payment_months.min, CONFIG.assets.down_payment_months.max));
  return { checkingBalance: roundToInt(randomLognormal(CONFIG.assets.checking_balance.median, CONFIG.assets.checking_balance.gini)), downPaymentAmount: roundToInt(monthlySavings * downPaymentMonths) };
}
function generateCreditScore(dti) {
  let score = roundToInt(clamp(randomNormal(CONFIG.credit.score_base.mean, CONFIG.credit.score_base.stddev), CONFIG.credit.score_base.min, CONFIG.credit.score_base.max));
  score += (dti * 100) * (CONFIG.credit.dti_penalty / 10);
  if (Math.random() < 0.12) score -= randomInt(40, 120);
  return roundToInt(clamp(score, CONFIG.credit.score_base.min, CONFIG.credit.score_base.max));
}
function generateLifeScript(entityId) {
  const { age, ssn_last4 } = generateDemographics();
  const emp = generateEmployment(age);
  const liab = generateLiabilities(emp.salary);
  const assets = generateAssets(emp.salary);
  const creditScore = generateCreditScore(liab.dti);
  const startDate = new Date(2024, 0, 1);
  const events = [];
  const empStartDate = new Date(startDate);
  empStartDate.setMonth(empStartDate.getMonth() - emp.tenureMonths);
  events.push({ t: empStartDate.toISOString().split('T')[0], type: "EMPLOYMENT_START", entity: emp.industry + " Corp", salary: emp.salary });
  if (emp.tenureMonths > 18 && Math.random() > 0.4) {
    const raiseDate = new Date(empStartDate);
    raiseDate.setMonth(raiseDate.getMonth() + randomInt(12, emp.tenureMonths));
    if (raiseDate < startDate) events.push({ t: raiseDate.toISOString().split('T')[0], type: "SALARY_INCREASE", salary: roundToInt(emp.salary * (1 + randomBeta(2, 5) * 0.15)) });
  }
  if (liab.studentLoanPayment > 0) events.push({ t: empStartDate.toISOString().split('T')[0], type: "LIABILITY_OPENED", type_detail: "STUDENT_LOAN", payment: liab.studentLoanPayment });
  if (liab.autoPayment > 0) {
    const autoDate = new Date(empStartDate);
    autoDate.setMonth(autoDate.getMonth() + randomInt(3, Math.min(24, emp.tenureMonths)));
    if (autoDate < startDate) events.push({ t: autoDate.toISOString().split('T')[0], type: "LIABILITY_OPENED", type_detail: "AUTO_LOAN", payment: liab.autoPayment });
  }
  const currentSalary = events.filter(e => e.type === "SALARY_INCREASE").pop()?.salary || emp.salary;
  const obligations = liab.studentLoanPayment + liab.autoPayment + liab.otherDebt;
  return { entityId, demographics: { age, ssn_last4 }, events, current_state: { employment_status: "ACTIVE", employer: emp.industry + " Corp", industry: emp.industry, salary: currentSalary, tenure_months: emp.tenureMonths, checking_balance: assets.checkingBalance, monthly_obligations: obligations, dti: liab.dti, credit_score: creditScore, down_payment: assets.downPaymentAmount } };
}
function corruptPresentation(truth, corruptionType, severity) {
  const presentation = JSON.parse(JSON.stringify(truth));
  if (corruptionType === "NONE") return presentation;
  const mult = severity === "HIGH" ? 0.20 : severity === "MEDIUM" ? 0.10 : 0.05;
  if (corruptionType === "INFLATION") presentation.current_state.salary = Math.floor(presentation.current_state.salary * (1 + mult));
  else if (corruptionType === "CONCEALMENT") {
    const numToRemove = severity === "HIGH" ? 2 : 1; let removed = 0;
    presentation.events = presentation.events.filter(e => { if (e.type === "LIABILITY_OPENED" && removed < numToRemove) { removed++; return false; } return true; });
    presentation.current_state.monthly_obligations = presentation.events.filter(e => e.type === "LIABILITY_OPENED").reduce((sum, e) => sum + e.payment, 0);
  } else if (corruptionType === "FABRICATION") {
    presentation.current_state.employer = "Global " + randomChoice(CONFIG.employment.industry.categories);
    presentation.current_state.salary = randomInt(120000, 180000);
    presentation.current_state.checking_balance = randomInt(40000, 80000);
    presentation.events.unshift({ t: "2021-01-01", type: "EMPLOYMENT_START", entity: presentation.current_state.employer, salary: presentation.current_state.salary });
  }
  return presentation;
}
function generateCase(id, corruptionType = "NONE", severity = "LOW") {
  const truth = generateLifeScript(`gen-${id}`);
  const presentation = corruptPresentation(truth, corruptionType, severity);
  const loanAmount = Math.floor(presentation.current_state.salary * 3.5);
  const alignmentMap = { "NONE": "A0", "TIMING_DRIFT": "A1", "INFLATION": severity === "HIGH" ? "A4" : "A3", "CONCEALMENT": severity === "HIGH" ? "A4" : "A3", "FABRICATION": "A4" };
  const fraudMap = { "NONE": "NONE", "TIMING_DRIFT": "NONE", "INFLATION": severity === "HIGH" ? "CRITICAL" : "MODERATE", "CONCEALMENT": severity === "HIGH" ? "CRITICAL" : "MODERATE", "FABRICATION": "CRITICAL" };
  const outcomeMap = { "NONE": "APPROVE", "TIMING_DRIFT": "APPROVE", "INFLATION": "DECLINE", "CONCEALMENT": "DECLINE", "FABRICATION": "DECLINE" };
  return { id: `case-gen-${id}-${Date.now()}`, applicant: { name: `${randomChoice(["James","Maria","Robert","Linda","Michael","Patricia"])} ${randomChoice(["Smith","Johnson","Williams","Brown","Jones","Garcia"])}`, age: truth.demographics.age, ssn_last4: truth.demographics.ssn_last4 }, application: { loan_type: "MORTGAGE", loan_amount: loanAmount, purpose: randomChoice(["PURCHASE", "REFINANCE"]), submitted: new Date().toISOString().split('T')[0] }, truth, presentation, evidence: [], alignment_findings: [{ dimension: "income", level: alignmentMap[corruptionType], status: corruptionType === "NONE" ? "ALIGNED" : "MISMATCH", details: `Salary: Truth $${truth.current_state.salary.toLocaleString()} vs Presentation $${presentation.current_state.salary.toLocaleString()}` }], label: { alignment_level: alignmentMap[corruptionType], coherence_status: corruptionType === "NONE" ? "COHERENT" : "INCOHERENT", expected_outcome: outcomeMap[corruptionType], fraud_risk_level: fraudMap[corruptionType], difficulty: severity === "HIGH" ? "ADVANCED" : "INTERMEDIATE", conditions: [] } };
}

// ─── 5. DATA TABLE & VALIDATION ────────────────────────────
function calculateStatistics(cases) {
  const stats = { age: { values: [] }, salary: { values: [] }, dti: { values: [] }, credit_score: { values: [] } };
  cases.forEach(c => {
    if (c.truth.demographics) stats.age.values.push(c.truth.demographics.age);
    if (c.truth.current_state) { stats.salary.values.push(c.truth.current_state.salary); stats.dti.values.push(c.truth.current_state.dti); stats.credit_score.values.push(c.truth.current_state.credit_score); }
  });
  const calc = (arr) => ({ mean: arr.reduce((a,b)=>a+b,0)/arr.length, min: Math.min(...arr), max: Math.max(...arr) });
  return { age: calc(stats.age.values), salary: calc(stats.salary.values), dti: calc(stats.dti.values), credit_score: calc(stats.credit_score.values) };
}
function exportStatistics(stats) {
  const report = { timestamp: new Date().toISOString(), sample_size: stats.age.values.length, statistics: stats };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `validation_report.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
function DataTableTab({ cases }) {
  const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'desc' });
  const [filterText, setFilterText] = useState("");
  const sortedCases = React.useMemo(() => {
    let sortableItems = [...cases];
    if (filterText) sortableItems = sortableItems.filter(c => c.applicant.name.toLowerCase().includes(filterText.toLowerCase()) || c.application.purpose.toLowerCase().includes(filterText.toLowerCase()));
    sortableItems.sort((a, b) => {
      let aValue, bValue; const key = sortConfig.key;
      if (key === 'dti') { aValue = a.truth.current_state?.dti || 0; bValue = b.truth.current_state?.dti || 0; }
      else if (key === 'salary') { aValue = a.truth.current_state?.salary || 0; bValue = b.truth.current_state?.salary || 0; }
      else if (key === 'credit_score') { aValue = a.truth.current_state?.credit_score || 0; bValue = b.truth.current_state?.credit_score || 0; }
      else if (key.includes('.')) { const [p, c] = key.split('.'); aValue = a[p][c]; bValue = b[p][c]; }
      else { aValue = a[key]; bValue = b[key]; }
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sortableItems;
  }, [cases, sortConfig, filterText]);
  const requestSort = (key) => { let direction = 'asc'; if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc'; setSortConfig({ key, direction }); };
  const exportToCSV = () => {
    const headers = ["Name", "Age", "Loan Amount", "Purpose", "Salary", "DTI", "Credit Score", "Checking", "Align", "Outcome", "Fraud Risk"];
    const rows = sortedCases.map(c => [c.applicant.name, c.applicant.age, c.application.loan_amount, c.application.purpose, c.truth.current_state?.salary || 0, ((c.truth.current_state?.dti || 0) * 100).toFixed(1) + "%", c.truth.current_state?.credit_score || 0, c.truth.current_state?.checking_balance || 0, c.label.alignment_level, c.label.expected_outcome, c.label.fraud_risk_level]);
    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");
    const link = document.createElement("a"); link.setAttribute("href", encodeURI(csvContent)); link.setAttribute("download", `financial_profiles.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };
  return (
    <div>
      <div style={styles.tableToolbar}>
        <input type="text" placeholder="Filter by name or purpose..." value={filterText} onChange={(e) => setFilterText(e.target.value)} style={styles.filterInput} />
        <button onClick={exportToCSV} style={styles.btnCSV}>Export CSV</button>
      </div>
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead><tr>
            <Th label="Name" sortKey="applicant.name" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Age" sortKey="applicant.age" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Loan Amount" sortKey="application.loan_amount" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Purpose" sortKey="application.purpose" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Salary" sortKey="salary" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="DTI" sortKey="dti" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Credit Score" sortKey="credit_score" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Checking" sortKey="truth.current_state.checking_balance" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Align" sortKey="label.alignment_level" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Outcome" sortKey="label.expected_outcome" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Fraud Risk" sortKey="label.fraud_risk_level" sortConfig={sortConfig} onSort={requestSort} />
          </tr></thead>
          <tbody>{sortedCases.map((c) => (<tr key={c.id} style={styles.tableRow}>
            <td style={styles.td}><strong>{c.applicant.name}</strong></td>
            <td style={styles.td}>{c.applicant.age}</td>
            <td style={styles.td}>${c.application.loan_amount.toLocaleString()}</td>
            <td style={styles.td}>{c.application.purpose}</td>
            <td style={styles.td}>${c.truth.current_state?.salary?.toLocaleString() || 0}</td>
            <td style={styles.td}>{((c.truth.current_state?.dti || 0) * 100).toFixed(1)}%</td>
            <td style={styles.td}>{c.truth.current_state?.credit_score || 0}</td>
            <td style={styles.td}>${c.truth.current_state?.checking_balance?.toLocaleString() || 0}</td>
            <td style={styles.td}><span style={{ ...styles.badge, background: ALIGNMENT_COLORS[c.label.alignment_level] }}>{c.label.alignment_level}</span></td>
            <td style={styles.td}><span style={{ color: c.label.expected_outcome === "APPROVE" ? "#10b981" : "#ef4444", fontWeight: 600 }}>{c.label.expected_outcome}</span></td>
            <td style={styles.td}><span style={{ color: FRAUD_COLORS[c.label.fraud_risk_level] }}>{c.label.fraud_risk_level}</span></td>
          </tr>))}</tbody>
        </table>
      </div>
      <div style={styles.tableFooter}>Showing {sortedCases.length} of {cases.length} cases</div>
    </div>
  );
}
function Th({ label, sortKey, sortConfig, onSort }) {
  const isActive = sortConfig.key === sortKey;
  return (<th onClick={() => onSort(sortKey)} style={{ ...styles.th, cursor: 'pointer', background: isActive ? '#f1f5f9' : 'white' }}>{label}{isActive && <span style={{ marginLeft: 4 }}>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}</th>);
}

// ─── 6. STYLES ─────────────────────────────────────────────
const ALIGNMENT_COLORS = { A0: "#10b981", A1: "#3b82f6", A2: "#f59e0b", A3: "#f97316", A4: "#ef4444", A5: "#7c2d12" };
const FRAUD_COLORS = { NONE: "#10b981", LOW: "#3b82f6", MODERATE: "#f59e0b", HIGH: "#f97316", CRITICAL: "#ef4444" };
const OUTCOME_ICONS = { APPROVE: "✓", DECLINE: "✗", MANUAL_REVIEW: "?" };
const styles = {
  app: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#f8fafc", minHeight: "100vh" },
  header: { padding: "24px 32px", background: "white", borderBottom: "1px solid #e2e8f0" },
  title: { margin: 0, fontSize: 24, color: "#0f172a" },
  subtitle: { margin: "4px 0 0", color: "#64748b", fontSize: 14 },
  layout: { display: "flex", minHeight: "calc(100vh - 80px)" },
  sidebar: { width: 320, padding: 16, background: "white", borderRight: "1px solid #e2e8f0", overflowY: "auto", display: "flex", flexDirection: "column" },
  main: { flex: 1, padding: 24, overflowY: "auto" },
  caseCard: { padding: 12, marginBottom: 8, borderRadius: 6, cursor: "pointer", transition: "all 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardMeta: { fontSize: 12, color: "#64748b", marginBottom: 4 },
  cardOutcome: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 },
  cardDifficulty: { color: "#94a3b8", fontSize: 11, textTransform: "uppercase" },
  generatorPanel: { marginTop: "auto", padding: 16, background: "#f1f5f9", borderRadius: 6, border: "1px solid #e2e8f0" },
  detail: { background: "white", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" },
  tabs: { display: "flex", borderBottom: "1px solid #e2e8f0", padding: "0 16px", overflowX: "auto" },
  tab: { padding: "12px 20px", background: "none", border: "none", cursor: "pointer", fontSize: 14, whiteSpace: "nowrap" },
  tabContent: { padding: 24 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 },
  panel: { padding: 16, background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0" },
  panelTitle: { margin: "0 0 12px", fontSize: 14, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5 },
  kvRow: { display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #e2e8f0", fontSize: 14 },
  metricCard: { padding: 16, background: "white", borderRadius: 6, border: "1px solid #e2e8f0" },
  badge: { padding: "2px 8px", borderRadius: 10, color: "white", fontSize: 11, fontWeight: 700 },
  timelineHeader: { display: "flex", alignItems: "center", marginBottom: 16, fontSize: 13 },
  legendDot: { width: 12, height: 12, borderRadius: "50%", background: "#10b981", marginRight: 6 },
  timeline: { position: "relative" },
  timelineRow: { display: "flex", marginBottom: 16, alignItems: "flex-start" },
  timelineDate: { width: 100, fontSize: 13, color: "#64748b", paddingTop: 4 },
  timelineDot: { width: 24, display: "flex", justifyContent: "center" },
  dot: { width: 12, height: 12, borderRadius: "50%", marginTop: 6 },
  timelineContent: { flex: 1, paddingLeft: 12 },
  eventType: { fontWeight: 600, fontSize: 14, marginBottom: 2 },
  eventDetails: { fontSize: 13, color: "#475569" },
  alignmentSummary: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  alignmentChip: { padding: "6px 12px", borderRadius: 16, fontSize: 13, display: "flex", alignItems: "center" },
  findingsList: { display: "flex", flexDirection: "column", gap: 12 },
  finding: { padding: 16, background: "#f8fafc", borderRadius: 6 },
  findingHeader: { display: "flex", alignItems: "center", marginBottom: 8 },
  findingDetails: { margin: 0, fontSize: 14, color: "#334155", lineHeight: 1.5 },
  evidenceCard: { marginBottom: 16, border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" },
  evidenceHeader: { display: "flex", alignItems: "center", padding: "10px 16px", background: "#f1f5f9", gap: 12, fontSize: 14 },
  evidenceDate: { color: "#64748b", fontSize: 12 },
  fidelityBadge: { marginLeft: "auto", padding: "2px 8px", background: "#dbeafe", borderRadius: 10, fontSize: 11, color: "#1e40af" },
  evidenceFields: { padding: 16 },
  evidenceRow: { display: "flex", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 },
  evidenceKey: { width: 200, color: "#64748b" },
  evidenceValue: { flex: 1, color: "#0f172a", fontFamily: "monospace", whiteSpace: "pre-wrap" },
  decisionBanner: { display: "flex", alignItems: "center", padding: 20, borderRadius: 6, marginBottom: 20 },
  comparisonRow: { display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #e2e8f0", fontSize: 14 },
  comparisonLabel: { width: 140, color: "#64748b" },
  comparisonValue: { minWidth: 80 },
  select: { width: "100%", padding: "8px", marginBottom: "8px", borderRadius: "4px", border: "1px solid #cbd5e1" },
  btnPrimary: { width: "100%", padding: "10px", background: "#2563eb", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: 600, marginBottom: "8px" },
  btnSecondary: { width: "100%", padding: "8px", background: "white", color: "#475569", border: "1px solid #cbd5e1", borderRadius: "4px", cursor: "pointer", fontSize: "12px", marginBottom: "8px" },
  tableToolbar: { display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap: 12 },
  filterInput: { flex: 1, padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: 14 },
  btnCSV: { padding: '8px 16px', background: '#059669', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 },
  tableContainer: { overflowX: 'auto', background: 'white', borderRadius: '6px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '12px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: 600, color: '#475569', background: '#f8fafc' },
  td: { padding: '10px 12px', borderBottom: '1px solid #f1f5f9' },
  tableRow: { transition: 'background 0.15s' },
  tableFooter: { marginTop: 12, color: '#64748b', fontSize: 13, textAlign: 'right' }
};

// ─── 7. MAIN COMPONENT ─────────────────────────────────────
export default function FraudCaseExplorer() {
  const [cases, setCases] = useState(INITIAL_CASES);
  const [selectedId, setSelectedId] = useState(INITIAL_CASES[0].id);
  const [activeTab, setActiveTab] = useState("overview");
  const [genConfig, setGenConfig] = useState({ corruptionType: "NONE", severity: "LOW", count: 1 });
  const selectedCase = cases.find((c) => c.id === selectedId) || cases[0];
  const handleGenerate = () => {
    const newCases = [];
    for (let i = 0; i < genConfig.count; i++) newCases.push(generateCase(i, genConfig.corruptionType, genConfig.severity));
    setCases([...cases, ...newCases]);
    setSelectedId(newCases[0].id);
    setActiveTab("data_table"); // Auto-switch to table view on generation
  };
  const handleValidate = () => {
    const stats = calculateStatistics(cases);
    exportStatistics(stats);
    alert("Validation report downloaded! Check your downloads folder.");
  };
  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.title}>Synthetic Case Explorer</h1>
        <p style={styles.subtitle}>Alignment-driven underwriting visualization · {cases.length} cases</p>
      </header>
      <div style={styles.layout}>
        <aside style={styles.sidebar}>
          {cases.slice().reverse().map((c) => (<CaseCard key={c.id} caseData={c} selected={c.id === selectedId} onClick={() => { setSelectedId(c.id); setActiveTab("overview"); }} />))}
          <div style={styles.generatorPanel}>
            <h3 style={styles.panelTitle}>Generate New Cases</h3>
            <select style={styles.select} value={genConfig.corruptionType} onChange={e => setGenConfig({...genConfig, corruptionType: e.target.value})}>
              <option value="NONE">Clean (A0)</option>
              <option value="TIMING_DRIFT">Timing Drift (A1)</option>
              <option value="INFLATION">Income Inflation (A3/A4)</option>
              <option value="CONCEALMENT">Debt Concealment (A3/A4)</option>
              <option value="FABRICATION">Fabrication (A4)</option>
            </select>
            <select style={styles.select} value={genConfig.severity} onChange={e => setGenConfig({...genConfig, severity: e.target.value})}>
              <option value="LOW">Low Severity</option>
              <option value="MEDIUM">Medium Severity</option>
              <option value="HIGH">High Severity</option>
            </select>
            <select style={styles.select} value={genConfig.count} onChange={e => setGenConfig({...genConfig, count: parseInt(e.target.value)})}>
              <option value="1">Generate 1</option>
              <option value="10">Generate 10</option>
              <option value="50">Generate 50</option>
              <option value="100">Generate 100</option>
            </select>
            <button style={styles.btnPrimary} onClick={handleGenerate}>Generate Cases</button>
            <button style={styles.btnSecondary} onClick={handleValidate}>Export Validation Stats</button>
          </div>
        </aside>
        <main style={styles.main}>
          <CaseDetail caseData={selectedCase} activeTab={activeTab} setActiveTab={setActiveTab} cases={cases} />
        </main>
      </div>
    </div>
  );
}
function CaseCard({ caseData, selected, onClick }) {
  const { applicant, label } = caseData;
  return (<div onClick={onClick} style={{ ...styles.caseCard, borderLeft: `4px solid ${ALIGNMENT_COLORS[label.alignment_level]}`, background: selected ? "#f0f9ff" : "white" }}>
    <div style={styles.cardHeader}><strong>{applicant.name}</strong><span style={{ ...styles.badge, background: ALIGNMENT_COLORS[label.alignment_level] }}>{label.alignment_level}</span></div>
    <div style={styles.cardMeta}>Age {applicant.age} · ${caseData.application.loan_amount.toLocaleString()}</div>
    <div style={styles.cardOutcome}><span style={{ color: FRAUD_COLORS[label.fraud_risk_level], fontWeight: 600 }}>{label.expected_outcome}</span><span style={styles.cardDifficulty}>{label.difficulty}</span></div>
  </div>);
}
function CaseDetail({ caseData, activeTab, setActiveTab, cases }) {
  const tabs = ["overview", "timeline", "alignment", "evidence", "decision", "data_table"];
  return (
    <div style={styles.detail}>
      <div style={styles.tabs}>{tabs.map((tab) => (<button key={tab} onClick={() => setActiveTab(tab)} style={{ ...styles.tab, borderBottom: activeTab === tab ? "3px solid #2563eb" : "3px solid transparent", color: activeTab === tab ? "#2563eb" : "#64748b", fontWeight: activeTab === tab ? 600 : 400 }}>{tab.replace('_', ' ').charAt(0).toUpperCase() + tab.replace('_', ' ').slice(1)}</button>))}</div>
      <div style={styles.tabContent}>
        {activeTab === "overview" && <OverviewTab caseData={caseData} />}
        {activeTab === "timeline" && <TimelineTab caseData={caseData} />}
        {activeTab === "alignment" && <AlignmentTab caseData={caseData} />}
        {activeTab === "evidence" && <EvidenceTab caseData={caseData} />}
        {activeTab === "decision" && <DecisionTab caseData={caseData} />}
        {activeTab === "data_table" && <DataTableTab cases={cases} />}
      </div>
    </div>
  );
}
function OverviewTab({ caseData }) {
  const { applicant, application, truth, presentation, label } = caseData;
  const truthState = truth.current_state;
  const presState = presentation.current_state;
  return (
    <div>
      <div style={styles.grid2}>
        <MetricCard title="Alignment Level" value={label.alignment_level} color={ALIGNMENT_COLORS[label.alignment_level]} subtitle={label.alignment_level === "A0" ? "Aligned" : label.alignment_level === "A1" ? "Benign Variance" : "Inconsistency"} />
        <MetricCard title="Fraud Risk" value={label.fraud_risk_level} color={FRAUD_COLORS[label.fraud_risk_level]} />
        <MetricCard title="Expected Outcome" value={label.expected_outcome} color={label.expected_outcome === "APPROVE" ? "#10b981" : "#ef4444"} icon={OUTCOME_ICONS[label.expected_outcome]} />
        <MetricCard title="Difficulty" value={label.difficulty} color="#64748b" />
      </div>
      <div style={styles.grid2}>
        <div style={styles.panel}><h3 style={styles.panelTitle}>Applicant</h3><div style={styles.kvRow}><span>Name:</span><strong>{applicant.name}</strong></div><div style={styles.kvRow}><span>Age:</span><strong>{applicant.age}</strong></div><div style={styles.kvRow}><span>SSN (last 4):</span><strong>***-**-{applicant.ssn_last4}</strong></div><div style={styles.kvRow}><span>Loan:</span><strong>${application.loan_amount.toLocaleString()}</strong></div><div style={styles.kvRow}><span>Purpose:</span><strong>{application.purpose}</strong></div></div>
        <div style={styles.panel}><h3 style={styles.panelTitle}>Truth vs Presentation</h3><ComparisonRow label="Employer" truth={truthState.employer} pres={presState.employer} /><ComparisonRow label="Salary" truth={`$${truthState.salary?.toLocaleString()}`} pres={`$${presState.salary?.toLocaleString()}`} /><ComparisonRow label="Checking" truth={`$${truthState.checking_balance?.toLocaleString()}`} pres={`$${presState.checking_balance?.toLocaleString()}`} /><ComparisonRow label="Obligations" truth={`$${truthState.monthly_obligations}`} pres={`$${presState.monthly_obligations}`} /><ComparisonRow label="Stated DTI" truth="—" pres={presState.stated_dti ? `${(presState.stated_dti * 100).toFixed(0)}%` : "—"} /></div>
      </div>
    </div>
  );
}
function TimelineTab({ caseData }) {
  const truthEvents = caseData.truth.events;
  return (
    <div>
      <div style={styles.timelineHeader}><div style={styles.legendDot} /><span style={{ marginRight: 20 }}>Truth Events</span></div>
      <div style={styles.timeline}>
        {truthEvents.map((ev, i) => (
          <div key={i} style={styles.timelineRow}>
            <div style={styles.timelineDate}>{ev.t}</div>
            <div style={styles.timelineDot}><div style={{ ...styles.dot, background: "#10b981" }} /></div>
            <div style={styles.timelineContent}>
              <div style={styles.eventType}>{ev.type.replace(/_/g, " ")}</div>
              <div style={styles.eventDetails}>{ev.entity && <span>{ev.entity} · </span>}{ev.salary && <span>${ev.salary.toLocaleString()}/yr</span>}{ev.payment && <span>${ev.payment}/mo</span>}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function AlignmentTab({ caseData }) {
  return (
    <div>
      <div style={styles.alignmentSummary}>{caseData.alignment_findings.map((f, i) => (<div key={i} style={{ ...styles.alignmentChip, background: ALIGNMENT_COLORS[f.level] + "20", border: `1px solid ${ALIGNMENT_COLORS[f.level]}` }}><span style={{ fontWeight: 700, color: ALIGNMENT_COLORS[f.level] }}>{f.level}</span><span style={{ marginLeft: 8 }}>{f.dimension}</span></div>))}</div>
      <div style={styles.findingsList}>{caseData.alignment_findings.map((f, i) => (<div key={i} style={{ ...styles.finding, borderLeft: `4px solid ${ALIGNMENT_COLORS[f.level]}` }}><div style={styles.findingHeader}><span style={{ ...styles.badge, background: ALIGNMENT_COLORS[f.level] }}>{f.level}</span><strong style={{ marginLeft: 12, textTransform: "capitalize" }}>{f.dimension.replace(/_/g, " ")}</strong><span style={{ marginLeft: "auto", color: "#64748b", fontStyle: "italic" }}>{f.status.replace(/_/g, " ")}</span></div><p style={styles.findingDetails}>{f.details}</p></div>))}</div>
    </div>
  );
}
function EvidenceTab({ caseData }) {
  return (
    <div>{caseData.evidence.map((ev, i) => (<div key={i} style={styles.evidenceCard}><div style={styles.evidenceHeader}><strong>{ev.source.replace(/_/g, " ")}</strong><span style={styles.evidenceDate}>{ev.date}</span><span style={styles.fidelityBadge}>Fidelity: {(ev.fidelity * 100).toFixed(0)}%</span></div><div style={styles.evidenceFields}>{Object.entries(ev.fields).map(([key, val]) => (<div key={key} style={styles.evidenceRow}><span style={styles.evidenceKey}>{key.replace(/_/g, " ")}</span><span style={styles.evidenceValue}>{typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)}</span></div>))}</div></div>))}</div>
  );
}
function DecisionTab({ caseData }) {
  const { label } = caseData;
  return (
    <div>
      <div style={{ ...styles.decisionBanner, background: label.expected_outcome === "APPROVE" ? "#ecfdf5" : "#fef2f2", borderLeft: `6px solid ${label.expected_outcome === "APPROVE" ? "#10b981" : "#ef4444"}` }}>
        <div style={{ fontSize: 32, marginRight: 16 }}>{OUTCOME_ICONS[label.expected_outcome]}</div>
        <div><div style={{ fontSize: 20, fontWeight: 700 }}>{label.expected_outcome}</div><div style={{ color: "#64748b" }}>{label.coherence_status.replace(/_/g, " ")}</div></div>
      </div>
      <div style={styles.grid2}>
        <div style={styles.panel}><h3 style={styles.panelTitle}>Risk Assessment</h3><div style={styles.kvRow}><span>Alignment Level:</span><strong>{label.alignment_level}</strong></div><div style={styles.kvRow}><span>Fraud Risk:</span><strong style={{ color: FRAUD_COLORS[label.fraud_risk_level] }}>{label.fraud_risk_level}</strong></div><div style={styles.kvRow}><span>Coherence:</span><strong>{label.coherence_status.replace(/_/g, " ")}</strong></div><div style={styles.kvRow}><span>Difficulty:</span><strong>{label.difficulty}</strong></div></div>
        <div style={styles.panel}><h3 style={styles.panelTitle}>Conditions</h3>{label.conditions.length === 0 ? (<div style={{ color: "#10b981", fontStyle: "italic" }}>None — clean case</div>) : (<ul style={{ margin: 0, paddingLeft: 20 }}>{label.conditions.map((c, i) => <li key={i} style={{ marginBottom: 8 }}>{c}</li>)}</ul>)}</div>
      </div>
    </div>
  );
}
function MetricCard({ title, value, color, subtitle, icon }) {
  return (<div style={{ ...styles.metricCard, borderTop: `4px solid ${color}` }}><div style={{ color: "#64748b", fontSize: 13, marginBottom: 4 }}>{title}</div><div style={{ fontSize: 24, fontWeight: 700, color }}>{icon && <span style={{ marginRight: 8 }}>{icon}</span>}{value}</div>{subtitle && <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>{subtitle}</div>}</div>);
}
function ComparisonRow({ label, truth, pres }) {
  const matches = truth === pres || truth === "—";
  return (<div style={styles.comparisonRow}><span style={styles.comparisonLabel}>{label}</span><span style={{ ...styles.comparisonValue, color: "#10b981" }}>{truth}</span><span style={{ color: "#94a3b8" }}>→</span><span style={{ ...styles.comparisonValue, color: matches ? "#10b981" : "#ef4444", fontWeight: matches ? 400 : 600 }}>{pres}</span><span style={{ marginLeft: "auto", fontSize: 12, color: matches ? "#10b981" : "#ef4444" }}>{matches ? "✓" : "⚠"}</span></div>);
}
'@

# Write the file atomically (no regex, no partial failures)
$jsxContent | Out-File -FilePath "src\FraudCaseExplorer.jsx" -Encoding UTF8

Write-Host "✓ Successfully upgraded to Statistical Model + Data Table!" -ForegroundColor Green
Write-Host "  Refresh your browser (F5) to see the changes." -ForegroundColor Cyan
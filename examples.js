// examples.js — Generate narrative examples for each coherence/decision family.
// Usage: node examples.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCase } from './src/generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'distribution_config.json'), 'utf8'));

const TYPES = [
  { type: 'NONE', severity: 'LOW', label: 'A0 — Ideal Borrower' },
  { type: 'TIMING_DRIFT', severity: 'LOW', label: 'A1 — Explainable Variance' },
  { type: 'INFLATION', severity: 'LOW', label: 'A1/A2 — Minor Inflation (explainable-ish)' },
  { type: 'CONCEALMENT', severity: 'LOW', label: 'A3 — Hidden Debt (incoherent)' },
  { type: 'FABRICATION', severity: 'HIGH', label: 'A4 — Fabricated Employment (fraudulent)' },
  { type: 'BUST_OUT', severity: 'HIGH', label: 'A5 — Synthetic Identity / Bust-Out (fraudulent)' }
];

function formatMoney(n) {
  return `$${Math.round(n).toLocaleString()}`;
}

function summarizeCase(c, header) {
  const t = c.truth.current_state;
  const p = c.presentation.current_state;
  const label = c.label;
  const findings = c.alignment_findings;
  const meta = c.application_metadata;

  const lines = [];
  lines.push(`\n${'='.repeat(70)}`);
  lines.push(header);
  lines.push(`${'='.repeat(70)}`);
  lines.push(`Applicant: ${c.applicant.name}, age ${c.applicant.age}`);
  lines.push(`Persona:    ${t.persona || 'N/A'} | Regime: ${t.regime}`);
  lines.push(`Loan:       ${formatMoney(c.application.loan_amount)} ${c.application.purpose}`);
  lines.push(`\n--- Life Story (Truth) ---`);
  lines.push(`Employer:   ${t.employer}`);
  lines.push(`Salary:     ${formatMoney(t.salary)} | Tenure: ${t.tenure_months} months (${t.tenure_stability})`);
  lines.push(`Credit:     ${t.credit_score} | DTI: ${(t.dti * 100).toFixed(1)}%`);
  lines.push(`Checking:   ${formatMoney(t.checking_balance)} | Monthly obligations: ${formatMoney(t.monthly_obligations)}`);
  lines.push(`Housing:    ${t.housing_history?.map(h => `${h.address} @ ${formatMoney(h.monthly_payment)}/mo from ${h.t}`).join(' → ') || 'None'}`);

  if (label.case_coherence_status !== 'COHERENT') {
    lines.push(`\n--- Presentation (what applicant claimed) ---`);
    lines.push(`Employer:   ${p.employer}`);
    lines.push(`Salary:     ${formatMoney(p.salary)} | Checking: ${formatMoney(p.checking_balance)}`);
    lines.push(`Obligations:${formatMoney(p.monthly_obligations)} | Stated DTI: ${((p.stated_dti ?? p.dti ?? t.dti) * 100).toFixed(1)}%`);
  }

  lines.push(`\n--- Alignment Findings ---`);
  findings.forEach(f => {
    lines.push(`  [${f.level}] ${f.dimension}: ${f.status} — ${f.details}`);
  });

  lines.push(`\n--- Decision ---`);
  lines.push(`Coherence:  ${label.case_coherence_status}`);
  lines.push(`Outcome:    ${label.expected_outcome}`);
  lines.push(`Fraud risk: ${label.fraud_risk_level}`);
  lines.push(`Reason:     ${label.reason}`);
  lines.push(`Difficulty: ${label.difficulty}`);

  if (meta) {
    lines.push(`\n--- Application Metadata ---`);
    lines.push(`Submitted:  ${meta.submitted} (business hours: ${meta.is_business_hours ? 'yes' : 'no'})`);
    lines.push(`IP risk:    ${meta.ip_risk_score} | VPN: ${meta.is_vpn ? 'yes' : 'no'} | TOR: ${meta.is_tor ? 'yes' : 'no'}`);
    lines.push(`Typing:     ${meta.typing_speed_wpm} WPM | Copy-paste fields: ${meta.fields_copy_pasted} | Session: ${meta.session_duration_seconds}s`);
    lines.push(`Documents:  ${meta.documents.map(d => `${d.source} (${d.days_before_submission}d old)`).join(', ')}`);
  }

  return lines.join('\n');
}

console.log('RealityDB-style Synthetic Underwriting Examples');
console.log('Each case is a generated financial life, not a document template.');

TYPES.forEach(({ type, severity, label }, idx) => {
  // Use a distinct seed per example so cases vary; for clean case try a few seeds to get an approval.
  let c;
  if (type === 'NONE') {
    let attempts = 0;
    do {
      c = generateCase(idx, CONFIG, type, severity, `2026-clean-${attempts}`);
      attempts++;
    } while (c.label.expected_outcome !== 'APPROVE' && attempts < 20);
  } else {
    c = generateCase(idx, CONFIG, type, severity, `2026-${type}`);
  }
  console.log(summarizeCase(c, label));
});

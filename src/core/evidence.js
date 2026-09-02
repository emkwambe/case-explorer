// src/core/evidence.js — Evidence synthesis from a generated life-script truth.

import {
  clamp,
  randomNormal,
  randomInt,
  fidelityNoise,
  roundToInt
} from "../utils/distributions.js";

export function synthesizeEvidence(truth, rng = { random: () => Math.random() }, asOf) {
  const state = truth.current_state;
  const docDate = (asOf ? new Date(asOf) : new Date()).toISOString().split('T')[0];
  const fidelity = () => clamp(randomNormal(0.97, 0.02, rng), 0.90, 0.999);
  const liabilities = truth.events
    .filter(e => e.type === "LIABILITY_OPENED")
    .map(e => ({ type: e.type_detail, payment: e.payment }));
  // The bureau records every tradeline, including revolving/other debt that is not modelled as a
  // discrete life event. Without this the bureau under-reports obligations and hidden debt is invisible.
  const itemised = liabilities.reduce((s, l) => s + l.payment, 0);
  const otherDebt = Math.max(0, roundToInt((state.monthly_obligations ?? 0) - itemised));
  if (otherDebt > 0) liabilities.push({ type: "REVOLVING_OTHER", payment: otherDebt });
  const recurringDebits = liabilities.map(l => {
    const payeeMap = { STUDENT_LOAN: "Student Loan Servicer", AUTO_LOAN: "Auto Finance", CREDIT_CARD: "Credit Card Servicer", PERSONAL_LOAN: "Personal Loan Servicer", REVOLVING_OTHER: "Revolving Credit" };
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
      date: docDate,
      fields: { w2_wages: fidelityNoise(state.annual_w2_wages ?? state.salary, 0.98, rng), employer: state.employer, tax_year: 2024 },
      fidelity: fidelity()
    },
    {
      source: "EMPLOYER_VERIFICATION",
      date: docDate,
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
      date: docDate,
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
      date: docDate,
      fields: { credit_score: fidelityNoise(state.credit_score, 0.99, rng), open_accounts: liabilities.length + randomInt(1, 4, rng), liabilities, persona: state.persona },
      fidelity: fidelity()
    },
    {
      source: "RENT_VERIFICATION",
      date: docDate,
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
      date: docDate,
      fields: {
        zip_code: state.zip_code,
        region: state.region,
        cost_of_living_index: state.cost_of_living_index
      },
      fidelity: fidelity()
    }
  ];
}

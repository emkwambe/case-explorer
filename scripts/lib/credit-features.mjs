// scripts/lib/credit-features.mjs — Decision-time features for the credit PD model, and the answer-key
// columns used only to evaluate it.
//
// One source of truth: the feature list below (name, group, monotonic direction, reason statement) is
// exported to data/credit-model/feature-spec.json, and the Python model reads it from there.
//
// Every feature is something an underwriter has when deciding: the application's stated figures, the
// documents (employer verification, bank statement, credit bureau) and the loan. Discrepancies are
// one-sided (the positive part of verified minus stated, or stated minus verified), so each monotonic
// constraint has one meaning. Excluded: sensitive and geographic attributes (age, region, zip, cost
// of living, persona, regime, audit attributes, the bureau's persona field), dealer ID, device and
// session metadata, fraud-rule outputs, W-2 wages (partial-year artefact) and every world-truth field.

import { extractDecisionView } from "../../src/ml/decision_features.js";
import { caseDti } from "../../src/creditRisk.js";
import { monthlyHazard } from "../../src/dealers.js";

const STATEMENTS = Object.freeze({
  CREDIT_SCORE: "Credit score below program standards",
  DEBT_BURDEN: "Debt obligations too high relative to income",
  INCOME_LEVEL: "Income insufficient for the amount of credit requested",
  INCOME_DISCREPANCY: "Income could not be verified at the amount stated",
  UNDISCLOSED_DEBT: "Credit report shows obligations not disclosed on the application",
  ASSET_DISCREPANCY: "Stated account balance does not match the bank statement",
  LIQUIDITY: "Limited cash reserves",
  UNSOURCED_DEPOSITS: "Recent large deposits are not sourced",
  EMPLOYMENT: "Length of employment"
});

/** The model's features, in column order. monotone: +1 risk can only rise with it, −1 only fall. */
export const FEATURES = Object.freeze([
  { name: "fico_bureau", group: "CREDIT_SCORE", monotone: -1, why: "A higher credit score never means higher risk." },
  { name: "dti_stated", group: "DEBT_BURDEN", monotone: 1, why: "More debt burden never means lower risk (the simulated hazard is flat below 36%, which the constraint allows)." },
  { name: "stated_monthly_debts", group: "DEBT_BURDEN", monotone: 1, why: "More stated debt never means lower risk." },
  { name: "income_stated", group: "INCOME_LEVEL", monotone: -1, why: "More income never means higher risk at the same obligations." },
  { name: "income_overstatement_pct", group: "INCOME_DISCREPANCY", monotone: 1, why: "Stating more income than the employer verifies is misrepresentation." },
  { name: "undisclosed_debt", group: "UNDISCLOSED_DEBT", monotone: 1, why: "Bureau debt the application leaves out is concealment." },
  { name: "undisclosed_accounts", group: "UNDISCLOSED_DEBT", monotone: 1, why: "Bureau accounts the application leaves out are concealment." },
  { name: "checking_overstatement_pct", group: "ASSET_DISCREPANCY", monotone: 1, why: "Stating more cash than the statement shows is fabrication." },
  { name: "statement_excess_pct", group: "ASSET_DISCREPANCY", monotone: 1, why: "A statement showing more cash than stated points to an altered document." },
  { name: "checking_stated", group: "LIQUIDITY", monotone: -1, why: "More stated reserves never mean higher risk." },
  { name: "checking_statement", group: "LIQUIDITY", monotone: -1, why: "More verified reserves never mean higher risk." },
  { name: "overdraft_count", group: "LIQUIDITY", monotone: 1, why: "More overdrafts never mean lower risk." },
  { name: "large_deposits_total", group: "UNSOURCED_DEPOSITS", monotone: 1, why: "Unseasoned deposits inflate apparent reserves." },
  { name: "tenure_months", group: "EMPLOYMENT", monotone: -1, why: "Longer employment never means higher risk." }
]);

export const FEATURE_NAMES = Object.freeze(FEATURES.map((f) => f.name));

/** The spec file Python reads: features, groups and their reason statements. */
export function featureSpec() {
  return {
    spec_version: "1.0.0",
    target: "dpd30: 30+ days past due within 18 months (simulated), the Solar book's default flag",
    features: FEATURES.map((f) => ({ ...f })),
    groups: Object.fromEntries(Object.entries(STATEMENTS).map(([g, statement]) => [g, { statement, features: FEATURES.filter((f) => f.group === g).map((f) => f.name) }])),
    excluded: [
      "age, region, zip_code, cost_of_living_index, persona, regime and every audit attribute (sensitive or geographic)",
      "the credit bureau's persona field (a generator type, not a lender field)",
      "dealer_id (dealer risk belongs to the Dealer View)",
      "device and session metadata (fraud signals, not creditworthiness)",
      "fraud-rule outputs (reasons come from the raw fields)",
      "W-2 wages (a partial-year artefact for short tenures)",
      "world truth, the corruption label, dealer quality and PD (answer key only)"
    ]
  };
}

const round6 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);
const pos = (x) => (x === null ? null : Math.max(0, x));

/** The feature values for one case, from what the lender has at decision time. */
export function featureRow(caseObj, profile) {
  const v = extractDecisionView(caseObj);
  const has = (src) => v.evidence.sources_present.includes(src);
  const cl = v.claims, ev = v.evidence;
  const emp = has("EMPLOYER_VERIFICATION") ? ev.employer_salary : null;
  const bank = has("BANK_STATEMENT") ? ev.checking_balance : null;
  const bureau = has("CREDIT_BUREAU");
  const row = {
    fico_bureau: bureau ? ev.credit_score : null,
    dti_stated: caseDti(caseObj, profile, "presentation").dti,
    stated_monthly_debts: cl.monthly_obligations ?? 0,
    income_stated: cl.salary,
    income_overstatement_pct: emp ? pos((cl.salary - emp) / emp) : null,
    undisclosed_debt: bureau ? pos((ev.bureau_monthly_obligations ?? 0) - (cl.monthly_obligations ?? 0)) : null,
    undisclosed_accounts: bureau ? pos((ev.bureau_liability_count ?? 0) - (cl.liability_count ?? 0)) : null,
    checking_overstatement_pct: bank ? pos((cl.checking_balance - bank) / bank) : null,
    statement_excess_pct: bank !== null && cl.checking_balance > 0 ? pos((bank - cl.checking_balance) / cl.checking_balance) : null,
    checking_stated: cl.checking_balance,
    checking_statement: bank,
    overdraft_count: has("BANK_STATEMENT") ? ev.overdraft_count : null,
    large_deposits_total: has("BANK_STATEMENT") ? (ev.recent_large_deposits ?? []).reduce((s, d) => s + (d.amount || 0), 0) : null,
    tenure_months: cl.tenure_months
  };
  return Object.fromEntries(FEATURE_NAMES.map((k) => [k, round6(row[k])]));
}

/**
 * Answer-key columns for one simulated loan (never model inputs): the true probability of a 30+ DPD
 * event, the same with the dealer term removed (the fair ceiling for a dealer-blind model), and the
 * generator's corruption label. P(30+ DPD) = 1 − (1 − h)^months; the simulation's pd is that times
 * chargeOffGivenDpd30, which is checked here.
 */
export function oracleRow(loan, dealer, settings, corruptionType) {
  const perf = settings.performance, months = perf.monthsOnBook;
  const p = (h) => 1 - Math.pow(1 - h, months);
  const pTrue = p(monthlyHazard(loan, dealer, perf, settings.dealerEffect.strength));
  if (Math.abs(pTrue * perf.chargeOffGivenDpd30 - loan.pd) > 1e-12) throw new Error(`oracle: P(30+ DPD) × ${perf.chargeOffGivenDpd30} differs from pd for ${loan.id}`);
  return {
    p_dpd30_true: round6(pTrue),
    p_dpd30_no_dealer: round6(p(monthlyHazard(loan, dealer, perf, 0))),
    pd_chargeoff: round6(loan.pd),
    fraud_true: loan.fraud ? 1 : 0,
    corruption_type: corruptionType
  };
}

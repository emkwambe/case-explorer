// src/challenge/reasonCodes.js — The reason codes a learner can choose in challenge mode: every code
// the teaching set uses, each with one plain-English line. MISSING_DOCUMENT is a teaching code only;
// no engine emits it.

export const REASON_CODE_TEXT = Object.freeze({
  LOW_FICO: "The credit score is below the program minimum of 660.",
  ELEVATED_DTI: "Debt-to-income is in the watch band (36% to 45%): approvable only after review.",
  HIGH_DTI: "Debt-to-income is above the 45% cap: obligations are too high for the income.",
  LIQUIDITY_RISK: "Checking under $1,000 with debt-to-income above 40%: little cushion for a missed paycheck.",
  FRAUD_REVIEW: "Something on the application cannot be verified against the documents: refer it for verification.",
  UNDISCLOSED_LIABILITIES: "The credit report shows debts the application does not list.",
  INCOME_VARIANCE_REVIEW: "Stated income is somewhat above verified income: re-underwrite on the verified figure.",
  LIABILITY_VARIANCE_REVIEW: "Bureau debts are somewhat above stated debts: re-underwrite on the bureau figure.",
  MISSING_DOCUMENT: "A document the decision depends on is missing: obtain it before deciding."
});

/** The codes in display order. */
export const REASON_CODES = Object.freeze(Object.keys(REASON_CODE_TEXT));

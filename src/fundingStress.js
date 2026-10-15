// src/fundingStress.js — Lender-agnostic funding and rate-stress engine.
//
// Pure module, no React. Models the pricing-lag channel of a point-of-sale lending platform: a
// fixed-rate loan is priced when credit is approved and sold to investors later, so a rate rise
// during the hold period cuts the sale price and can turn the platform fee negative. On top of
// that sit an unsold backbook, a corporate liquidity path with a minimum-liquidity covenant, a
// funding partner's loan cap, and credit expected loss from the dealer portfolio.
//
// Every amount is per $100 of principal unless it says dollars. Lender-specific inputs, sources
// and history live in the lender profiles (`defaults.fundingRates`), never here.

/** Monthly single-mortality rate from an annual constant prepayment rate. */
const smmFromCpr = (cpr) => 1 - Math.pow(1 - cpr, 1 / 12);

/**
 * Level monthly payment that amortises `principal` over `months` at an annual `coupon`. The one
 * amortisation formula in the app: the loan pricers below and the solar DTI both use it.
 */
export function levelPayment(principal, coupon, months) {
  const rc = coupon / 12;
  return rc === 0 ? principal / months : (principal * rc) / (1 - Math.pow(1 + rc, -months));
}

/**
 * Prices a level-payment, monthly-amortising loan of $100 principal at an annual investor yield,
 * with an optional constant prepayment rate (CPR). Returns the price, the weighted-average life
 * in years, and the modified duration in years.
 */
export function loanPrice({ coupon, termYears, yieldRate, cpr = 0 }) {
  const n = Math.round(termYears * 12);
  const rc = coupon / 12, ry = yieldRate / 12;
  const smm = smmFromCpr(cpr);
  let balance = 100, pv = 0, pvTime = 0, principalTime = 0;
  for (let t = 1; t <= n && balance > 1e-12; t++) {
    const remaining = n - t + 1;
    const payment = levelPayment(balance, coupon, remaining);
    const interest = balance * rc;
    const scheduled = payment - interest;
    const prepaid = (balance - scheduled) * smm;
    const principal = scheduled + prepaid;
    const cashflow = interest + principal;
    const df = Math.pow(1 + ry, -t);
    pv += cashflow * df;
    pvTime += (t / 12) * cashflow * df;
    principalTime += (t / 12) * principal;
    balance -= principal;
  }
  const macaulay = pvTime / pv;
  return { price: pv, wal: principalTime / 100, modDuration: macaulay / (1 + ry) };
}

/** Closed-form price of a level-payment loan with no prepayment, for $100 principal. */
export function annuityPrice({ coupon, termYears, yieldRate }) {
  const n = Math.round(termYears * 12);
  const ry = yieldRate / 12;
  const payment = levelPayment(100, coupon, n);
  return ry === 0 ? payment * n : (payment * (1 - Math.pow(1 + ry, -n))) / ry;
}

/**
 * Platform fee per $100: the dealer fee less the discount at which the loan is sold.
 * feeAtApproval uses the investor yield at approval; feeAtSale the same yield plus the rate shock.
 */
export function platformFee({ dealerFeePct, coupon, termYears, yieldAtApproval, rateShockBps = 0, cpr = 0 }) {
  const atApproval = loanPrice({ coupon, termYears, yieldRate: yieldAtApproval, cpr });
  const atSale = loanPrice({ coupon, termYears, yieldRate: yieldAtApproval + rateShockBps / 10000, cpr });
  const feeAtApproval = dealerFeePct - (100 - atApproval.price);
  const feeAtSale = dealerFeePct - (100 - atSale.price);
  return {
    priceAtApproval: atApproval.price,
    priceAtSale: atSale.price,
    feeAtApproval,
    feeAtSale,
    feeChange: feeAtSale - feeAtApproval,
    modDuration: atApproval.modDuration,
    wal: atApproval.wal
  };
}

/**
 * The rate shock (0–1,000 bps) at which the fee at sale reaches zero, by bisection. Returns 0 when
 * the fee is already zero or negative at approval, and null when it stays positive up to 1,000 bps.
 */
export function breakEvenShockBps(params, { lo = 0, hi = 1000, tolerance = 1e-6 } = {}) {
  const fee = (bps) => platformFee({ ...params, rateShockBps: bps }).feeAtSale;
  if (fee(lo) <= 0) return lo;
  if (fee(hi) > 0) return null;
  let a = lo, b = hi;
  while (b - a > tolerance) {
    const mid = (a + b) / 2;
    if (fee(mid) > 0) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

/** Total platform fee in dollars when the unsold backbook is sold: unsoldBalance × feeAtSale / 100. */
export function backbookImpact({ unsoldBalance, ...feeParams }) {
  return (unsoldBalance * platformFee(feeParams).feeAtSale) / 100;
}

/**
 * Month-by-month cash. Each month cash changes by new fees less opex, and a backbook loss is
 * spread evenly over the recognition months. Returns the path (cash at the end of each month),
 * the first month cash is below the minimum (or null), and the runway: the first month cash
 * would fall below zero (or null within the horizon).
 */
export function liquidityPath({ cash, monthlyOpex, monthlyNewFees = 0, backbookLoss = 0, lossRecognitionMonths = 1, minLiquidity = 0, months = 18 }) {
  const lossPerMonth = lossRecognitionMonths > 0 ? backbookLoss / lossRecognitionMonths : 0;
  const path = [];
  let balance = cash, breachMonth = null, runwayMonths = null;
  for (let m = 1; m <= months; m++) {
    balance += monthlyNewFees - monthlyOpex - (m <= lossRecognitionMonths ? lossPerMonth : 0);
    path.push({ month: m, cash: balance });
    if (breachMonth === null && balance < minLiquidity) breachMonth = m;
    if (runwayMonths === null && balance < 0) runwayMonths = m;
  }
  return { path, breachMonth, runwayMonths };
}

/** Funding partner loan-cap utilisation. */
export function loanCapStatus({ unsoldBalance, loanCap }) {
  const utilisation = loanCap > 0 ? unsoldBalance / loanCap : Infinity;
  return { utilisation, breached: unsoldBalance > loanCap };
}

/**
 * Expected loss = Σ PD × LGD × EAD over portfolio loans ({ id, pd, ead }). `pdOverride` replaces
 * every PD; `scenario` applies a dealer-failure result ({ affectedIds, assumptions }): affected
 * loans get PD × multiplier (capped at 1) and LGD 1.
 */
export function expectedLoss(portfolio, { pdOverride = null, lgd, scenario = null } = {}) {
  const loans = Array.isArray(portfolio) ? portfolio : portfolio.loans;
  const affected = new Set(scenario?.affectedIds ?? []);
  const multiplier = scenario?.assumptions?.pdMultiplier?.value ?? 1;
  let total = 0;
  for (const l of loans) {
    const basePd = pdOverride ?? l.pd;
    const hit = affected.has(l.id);
    total += (hit ? Math.min(1, basePd * multiplier) : basePd) * (hit ? 1 : lgd) * l.ead;
  }
  return total;
}

// src/core/corruption.js — Corruption / tampering mutation operators on truth & evidence.

import {
  randomChoice,
  randomInt,
  randomBeta,
  roundToInt
} from "../utils/distributions.js";

// Date arithmetic here is in UTC throughout, so a case is identical in every process time zone.
function monthsBefore(asOf, months) {
  const d = asOf ? new Date(asOf) : new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

export function corruptPresentation(truth, corruptionType, severity, config, rng = { random: () => Math.random() }) {
  const asOf = config?.generation?.as_of_date ?? null;
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
      t: monthsBefore(asOf, 36).toISOString().split('T')[0],
      type: "EMPLOYMENT_START",
      entity: presentation.current_state.employer,
      salary: presentation.current_state.salary
    });
  } else if (corruptionType === "OCCUPANCY_MISREPRESENTATION") {
    // Applicant declares the subject property as a primary residence while it is an investment
    // property far from their current (retained) lease.
    const distance = randomInt(120, 1500, rng);
    presentation.events.push({
      t: "APPLICATION",
      type: "OCCUPANCY_DECLARATION",
      stated: "PRIMARY_RESIDENCE",
      subject_property_distance_miles: distance,
      retains_current_lease: true
    });
    presentation.current_state.stated_occupancy = "PRIMARY_RESIDENCE";
    truth.events.push({ t: "APPLICATION", type: "OCCUPANCY_DECLARATION", stated: "INVESTMENT", subject_property_distance_miles: distance, retains_current_lease: true });
    truth.current_state.true_occupancy = "INVESTMENT";
  } else if (corruptionType === "GIFT_FUND_MISREPRESENTATION") {
    // Down-payment "gift" that is really an undisclosed loan / interested-party contribution.
    const gift = roundToInt(presentation.current_state.salary * (severity === "HIGH" ? 0.6 : 0.35));
    presentation.current_state.checking_balance = presentation.current_state.checking_balance + gift;
    presentation.current_state.gift_funds_claimed = gift;
    truth.current_state.checking_balance = truth.current_state.checking_balance + gift; // the money is really there
    truth.current_state.undisclosed_loan_disguised_as_gift = gift;
  } else if (corruptionType === "ASSET_SEASONING") {
    // Reserves were assembled in the statement window; the applicant states the padded balance.
    const padding = roundToInt(presentation.current_state.salary * (severity === "HIGH" ? 0.5 : 0.3));
    presentation.current_state.checking_balance = presentation.current_state.checking_balance + padding;
    presentation.current_state.recently_transferred_funds = padding;
    truth.current_state.checking_balance = truth.current_state.checking_balance + padding;
    truth.current_state.unseasoned_funds = padding;
  } else if (corruptionType === "STRAW_BUYER") {
    // A third party funds the purchase and will occupy; applicant is a nominee.
    const contribution = roundToInt(presentation.current_state.salary * 0.5);
    presentation.current_state.checking_balance = presentation.current_state.checking_balance + contribution;
    truth.current_state.checking_balance = truth.current_state.checking_balance + contribution;
    truth.current_state.third_party_contribution = contribution;
    presentation.events.push({
      t: "APPLICATION",
      type: "OCCUPANCY_DECLARATION",
      stated: "PRIMARY_RESIDENCE",
      third_party_will_occupy: true,
      third_party_funded_down_payment: contribution
    });
    truth.current_state.nominee_for_third_party = true;
  } else if (corruptionType === "BUST_OUT") {
    // Synthetic identity: build a 24-month fake prime profile over a thin-file truth.
    const industries = config.employment.industry.categories;
    const syntheticStart = monthsBefore(asOf, 24);
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
        t: new Date(Date.UTC(syntheticStart.getUTCFullYear(), syntheticStart.getUTCMonth() + 3, 1)).toISOString().split('T')[0],
        type: "LIABILITY_OPENED",
        type_detail: "AUTO_LOAN",
        payment: Math.round(fakeSalary * 0.015)
      }
    ];

    // Add synthetic payment-history events at regular intervals to simulate seasoning.
    for (let m = 6; m < 24; m += 3) {
      const paymentDate = new Date(Date.UTC(syntheticStart.getUTCFullYear(), syntheticStart.getUTCMonth() + m, 1));
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

// ─── EVIDENCE-TAMPERING MUTATION OPERATOR ───────────────────
// FCGS layer-targeted mutation: modifies the Evidence (E) layer while
// the Claimed Truth (C) and World Truth (S_t) remain internally consistent.
export function tamperEvidence(truth, evidence, severity, rng = { random: () => Math.random() }, asOf) {
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
      date: (asOf ? new Date(asOf) : new Date()).toISOString().split('T')[0],
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

// ─── TYPOLOGY-SPECIFIC EVIDENCE EFFECTS ─────────────────────
// The new mortgage typologies leave traces in the evidence layer (bank statements) in
// addition to the claim layer. Applied after synthesizeEvidence so the ledger stays intact.
export function applyTypologyEvidence(truth, presentation, evidence, corruptionType, severity, rng = { random: () => Math.random() }, asOf) {
  const bank = evidence.find(e => e.source === "BANK_STATEMENT");
  if (!bank) return evidence;
  const p = presentation.current_state;
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const dateDaysAgo = (d) => { const x = new Date(asOfDate); x.setUTCDate(x.getUTCDate() - d); return x.toISOString().split('T')[0]; };

  if (corruptionType === "GIFT_FUND_MISREPRESENTATION") {
    const gift = p.gift_funds_claimed;
    const days = randomInt(3, 25, rng);
    bank.fields.checking_balance = roundToInt(bank.fields.checking_balance + gift);
    bank.fields.recent_large_deposits = [{
      date: dateDaysAgo(days), amount: gift, description: "Gift", source: "Gift",
      donor_letter: rng.random() < 0.5, donor_is_interested_party: true, days_before_submission: days
    }];
  } else if (corruptionType === "ASSET_SEASONING") {
    const padding = p.recently_transferred_funds;
    const n = randomInt(2, 4, rng);
    const deposits = [];
    let remaining = padding;
    for (let i = 0; i < n; i++) {
      const amt = i === n - 1 ? remaining : roundToInt(remaining * (0.3 + rng.random() * 0.4));
      remaining -= amt;
      const days = randomInt(2, 55, rng);
      deposits.push({ date: dateDaysAgo(days), amount: amt, description: "Transfer", source: "Unverified", days_before_submission: days });
    }
    bank.fields.checking_balance = roundToInt(bank.fields.checking_balance + padding);
    bank.fields.recent_large_deposits = deposits;
  } else if (corruptionType === "STRAW_BUYER") {
    const occ = presentation.events.find(e => e.type === "OCCUPANCY_DECLARATION");
    const amt = occ?.third_party_funded_down_payment ?? roundToInt(p.salary * 0.5);
    const days = randomInt(5, 40, rng);
    bank.fields.checking_balance = roundToInt(bank.fields.checking_balance + amt);
    bank.fields.recent_large_deposits = [{ date: dateDaysAgo(days), amount: amt, description: "Transfer", source: "Third party", third_party_funded: true, days_before_submission: days }];
  }
  return evidence;
}

// ─── INCOHERENT WORLD MUTATION (A3 NEGATIVE CONTROL) ────────
// Intentionally violates accounting or timeline invariants in the World Truth (S_t).
// The applicant honestly reports this broken world, so the case should be declined
// for physical impossibility rather than fraud.
export function corruptWorldTruth(truth, rng = { random: () => Math.random() }, asOf) {
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
        t: monthsBefore(asOf, 48).toISOString().split('T')[0],
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
      leaseStart.setUTCMonth(leaseStart.getUTCMonth() - 3); // rent paid BEFORE the lease existed
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
      depositDate.setUTCMonth(depositDate.getUTCMonth() - 2); // salary deposited BEFORE employment began
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

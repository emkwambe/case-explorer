// Credit policy overlay: vitest port of the fast checks in scripts/credit-risk.test.mjs, plus
// boundary tests for every threshold and each flag alone and in combination. The 2,000-case
// calibration checks stay in `npm run test:credit`.

import { describe, it, expect } from "vitest";
import { generateBlendedCase, generateCase } from "./generator.js";
import CONFIG_BASE from "./distribution_config.json";
import {
  CREDIT_POLICY, ADVERSE_ACTION, DISAGREEMENT, DTI_BASIS, assessCredit, caseDti, proposedSolarLoan, riskSummary, ficoComparison
} from "./creditRisk.js";
import { applyProfile, getProfile } from "./profiles/index.js";
import { levelPayment } from "./fundingStress.js";
import { loanAmount } from "./dealers.js";

const CONFIG = { ...CONFIG_BASE, generation: { ...CONFIG_BASE.generation, as_of_date: "2026-01-15" } };
const SOLAR = applyProfile(CONFIG, "SOLAR_PRIME");

// Salary 120,000 gives a monthly income of exactly 10,000, so DTI = (obligations + proposed PITI) / 10,000.
// The current rent in housing_history differs from the proposed payment so tests catch the wrong one.
function handBuilt({ fico = 720, obligations = 1000, housing = 1000, checking = 5000, studentPayments = [320], expected = "APPROVE", reasonCodes = [], history } = {}) {
  return {
    id: "case-hand-built",
    applicant: { age: 35, zip_code: "75708", region: "MEDIUM_COST" },
    presentation: {
      events: studentPayments.map((payment, i) => ({ t: `2021-0${i + 1}-01`, type: "LIABILITY_OPENED", type_detail: "STUDENT_LOAN", payment })),
      current_state: {
        credit_score: fico, salary: 120000, monthly_obligations: obligations, checking_balance: checking,
        ...(housing === null ? {} : { monthly_mortgage_payment: housing }),
        housing_history: history ?? [
          { t: "2019-02-01", type: "ADDRESS_CHANGE", monthly_payment: 900 },
          { t: "2023-04-14", type: "ADDRESS_CHANGE", monthly_payment: 1500 }
        ],
        region: "MEDIUM_COST", zip_code: "75708", persona: "STABLE_PROFESSIONAL", regime: "PRIME"
      }
    },
    evidence: [],
    application_metadata: {},
    label: { expected_outcome: expected, fraud_risk_level: "NONE", reason_codes: reasonCodes },
    meta: { corruption_type: "NONE" }
  };
}
const codes = (a) => a.flags.map((f) => f.code);

// A real generated case that trips a HIGH visible fraud rule (stated income 20% above employer-verified).
function fraudCase(overrides) {
  const c = structuredClone(generateCase(0, CONFIG, "INFLATION", "HIGH", "credit-fraud-boundary"));
  const s = c.presentation.current_state;
  const monthly = s.salary / 12;
  Object.assign(s, { credit_score: 720, checking_balance: 5000, monthly_obligations: Math.round(monthly * 0.05) });
  s.monthly_mortgage_payment = Math.round(monthly * 0.1);
  if (overrides) overrides(s, monthly);
  return c;
}

const MORTGAGE = getProfile("MORTGAGE");
const SOLAR_PROFILE = getProfile("SOLAR_PRIME");
const onlyState = (state) => ({ id: "case-state-only", presentation: { current_state: state } });

describe("caseDti under the Mortgage profile (proposed PITI)", () => {
  it("adds the proposed PITI to non-housing obligations over monthly gross income", () => {
    const r = caseDti(handBuilt({ obligations: 1000, housing: 3300 }), MORTGAGE);
    expect(r).toMatchObject({ dti: 0.43, partial: false, basis: DTI_BASIS.PROPOSED_PITI, label: "Back-end DTI (incl. proposed PITI)", nonHousing: 1000, currentHousing: null, proposedPayment: 3300, proposedLoan: null, monthlyIncome: 10000 });
    // Mortgage is the default profile.
    expect(caseDti(handBuilt({ obligations: 1000, housing: 3300 }))).toEqual(r);
  });

  it("ignores the current rent or mortgage in housing_history", () => {
    const history = [{ t: "2023-04-14", monthly_payment: 9000 }];
    expect(caseDti(handBuilt({ obligations: 0, housing: 2000, history }), MORTGAGE)).toMatchObject({ dti: 0.2, proposedPayment: 2000 });
    expect(caseDti(handBuilt({ obligations: 0, housing: null, history }), MORTGAGE)).toMatchObject({ dti: 0, proposedPayment: null, partial: true });
  });

  it("matches the generator's backend_dti on generated cases, claimed and true", () => {
    for (let i = 0; i < 50; i++) {
      const c = generateBlendedCase(i, CONFIG, "dti-identity");
      for (const layer of ["presentation", "truth"]) {
        expect(caseDti(c, MORTGAGE, layer).dti).toBeCloseTo(c[layer].current_state.backend_dti, 12);
      }
    }
  });

  it("marks the ratio partial without a proposed payment and returns null without income", () => {
    expect(caseDti(handBuilt({ obligations: 1000, housing: null }), MORTGAGE)).toMatchObject({ dti: 0.1, partial: true, proposedPayment: null });
    expect(caseDti(onlyState({ salary: 0, monthly_obligations: 500 })).dti).toBeNull();
    expect(caseDti(onlyState({ salary: 120000 }))).toMatchObject({ dti: 0, nonHousing: 0, partial: true });
    expect(caseDti(undefined)).toMatchObject({ dti: null, partial: true, monthlyIncome: 0 });
  });
});

describe("caseDti under the Solar prime profile (current housing + proposed solar payment)", () => {
  const sizing = SOLAR_PROFILE.defaults.dealerView.loanAmount;
  const { coupon, termYears } = SOLAR_PROFILE.defaults.fundingRates;

  it("prices the proposed solar loan from the case's seeded loan amount, default coupon and term", () => {
    const c = handBuilt({ obligations: 1000, housing: 3300 });
    const loan = proposedSolarLoan(c, SOLAR_PROFILE);
    expect(loan.amount).toBe(loanAmount(c, sizing));
    expect(loan).toMatchObject({ coupon: coupon.value, termYears: termYears.value });
    expect(loan.monthlyPayment).toBe(levelPayment(loan.amount, coupon.value, termYears.value * 12));
    // Hand check: a $10,000 loan at 2.99% over 300 months pays $47.37 a month.
    expect(levelPayment(10_000, 0.0299, 300)).toBeCloseTo(47.37, 2);
  });

  it("adds non-housing obligations, the current housing payment and the solar payment, ignoring the proposed PITI", () => {
    const c = handBuilt({ obligations: 1000, housing: 3300 });
    const r = caseDti(c, SOLAR_PROFILE);
    const solar = proposedSolarLoan(c, SOLAR_PROFILE).monthlyPayment;
    expect(r).toMatchObject({ basis: DTI_BASIS.CURRENT_HOUSING_PLUS_SOLAR_LOAN, label: "Back-end DTI (incl. proposed solar payment)", nonHousing: 1000, currentHousing: 1500, proposedPayment: solar, partial: false });
    expect(r.dti).toBeCloseTo((1000 + 1500 + solar) / 10000, 12);
  });

  it("uses the latest housing payment by date and is partial without one", () => {
    const history = [{ t: "2023-04-14", monthly_payment: 2000 }, { t: "2019-02-01", monthly_payment: 500 }, { t: "2024-01-01" }];
    expect(caseDti(handBuilt({ obligations: 0, history }), SOLAR_PROFILE).currentHousing).toBe(2000);
    const none = caseDti(handBuilt({ obligations: 0, history: [] }), SOLAR_PROFILE);
    expect(none).toMatchObject({ currentHousing: null, partial: true });
    expect(none.dti).toBeCloseTo(none.proposedPayment / 10000, 12);
  });

  it("uses the same loan amount for claimed and true values, and the assessment uses the profile's DTI", () => {
    for (let i = 0; i < 30; i++) {
      const c = generateBlendedCase(i, SOLAR, "dti-solar");
      expect(caseDti(c, SOLAR_PROFILE, "truth").proposedPayment).toBe(caseDti(c, SOLAR_PROFILE, "presentation").proposedPayment);
      expect(assessCredit(c, SOLAR_PROFILE).dti).toBe(caseDti(c, SOLAR_PROFILE).dti);
    }
  });
});

describe("credit policy boundaries", () => {
  it("FICO 659 declines; 660 and 661 do not", () => {
    expect(codes(assessCredit(handBuilt({ fico: 659 })))).toEqual(["LOW_FICO"]);
    expect(assessCredit(handBuilt({ fico: 659 })).policyDecision).toBe("DECLINE");
    for (const fico of [660, 661]) {
      const a = assessCredit(handBuilt({ fico }));
      expect(codes(a)).toEqual([]);
      expect(a.policyDecision).toBe("APPROVE");
    }
  });

  it("DTI 0.3599 is clean, exactly 0.36 is elevated, exactly 0.45 is still elevated, above 0.45 declines", () => {
    expect(codes(assessCredit(handBuilt({ obligations: 1000, housing: 2599 })))).toEqual([]);
    expect(codes(assessCredit(handBuilt({ obligations: 1000, housing: 2600 })))).toEqual(["ELEVATED_DTI"]);
    const at45 = assessCredit(handBuilt({ obligations: 1000, housing: 3500 }));
    expect(at45.dti).toBe(0.45);
    expect(codes(at45)).toEqual(["ELEVATED_DTI"]);
    expect(at45.policyDecision).toBe("REVIEW");
    const above = assessCredit(handBuilt({ obligations: 1000, housing: 3501 }));
    expect(codes(above)).toEqual(["HIGH_DTI"]);
    expect(above.reasons).toEqual([ADVERSE_ACTION.HIGH_DTI]);
  });

  it("liquidity risk needs checking strictly below 1,000 and DTI strictly above 0.40", () => {
    expect(codes(assessCredit(handBuilt({ checking: 999, obligations: 1000, housing: 3001 })))).toEqual(["ELEVATED_DTI", "LIQUIDITY_RISK"]);
    expect(codes(assessCredit(handBuilt({ checking: 1000, obligations: 1000, housing: 3001 })))).toEqual(["ELEVATED_DTI"]);
    expect(codes(assessCredit(handBuilt({ checking: 999, obligations: 1000, housing: 3000 })))).toEqual(["ELEVATED_DTI"]);
    const alone = assessCredit({ ...handBuilt({ checking: 0, obligations: 4001, housing: null }) });
    expect(codes(alone)).toEqual(["ELEVATED_DTI", "LIQUIDITY_RISK"]);
    expect(alone.policyDecision).toBe("REVIEW");
    expect(alone.flags.find((f) => f.code === "LIQUIDITY_RISK")).toMatchObject({ severity: "high", adverseActionReason: null, label: "Liquidity risk" });
    expect(alone.reasons).toEqual(["Elevated DTI", "Liquidity risk"]);
  });

  it("missing FICO, checking or income never raises the flag that needs it", () => {
    const c = handBuilt({ checking: 0, obligations: 5000 });
    c.presentation.current_state.credit_score = undefined;
    c.presentation.current_state.salary = 0;
    const a = assessCredit(c);
    expect(a).toMatchObject({ fico: null, dti: null, flags: [], policyDecision: "APPROVE" });
    const noChecking = handBuilt({ obligations: 1000, housing: 3501 });
    noChecking.presentation.current_state.checking_balance = "n/a";
    expect(assessCredit(noChecking)).toMatchObject({ checking: null });
    expect(codes(assessCredit(noChecking))).toEqual(["HIGH_DTI"]);
  });
});

describe("credit policy flags alone and in combination", () => {
  it("records each flag with its severity, label and adverse-action wording", () => {
    const low = assessCredit(handBuilt({ fico: 640 })).flags[0];
    expect(low).toEqual({ code: "LOW_FICO", label: "FICO 640 below 660", severity: "high", adverseActionReason: ADVERSE_ACTION.LOW_FICO });
    const high = assessCredit(handBuilt({ obligations: 1000, housing: 3700 })).flags[0];
    expect(high).toEqual({ code: "HIGH_DTI", label: "Back-end DTI 47%", severity: "high", adverseActionReason: ADVERSE_ACTION.HIGH_DTI });
    const watch = assessCredit(handBuilt({ obligations: 1000, housing: 3000 })).flags[0];
    expect(watch).toEqual({ code: "ELEVATED_DTI", label: "Elevated DTI", severity: "watch", adverseActionReason: null });
  });

  it("FRAUD_REVIEW alone routes to review with the verification wording", () => {
    const a = assessCredit(fraudCase());
    expect(codes(a)).toEqual(["FRAUD_REVIEW"]);
    expect(a.flags[0]).toMatchObject({ severity: "high", adverseActionReason: ADVERSE_ACTION.FRAUD_REVIEW });
    expect(a.flags[0].label).toMatch(/^Fraud review \(.+\)$/);
    expect(a.policyDecision).toBe("REVIEW");
    expect(a.fraudFlag).toBe("REVIEW");
    expect(a.reasons).toEqual([a.flags[0].label]);
  });

  it("decline flags take precedence and only decline reasons are given as adverse-action reasons", () => {
    const both = assessCredit(handBuilt({ fico: 640, obligations: 1000, housing: 3700 }));
    expect(codes(both)).toEqual(["LOW_FICO", "HIGH_DTI"]);
    expect(both.policyDecision).toBe("DECLINE");
    expect(both.reasons).toEqual([ADVERSE_ACTION.LOW_FICO, ADVERSE_ACTION.HIGH_DTI]);

    const fraudAndFico = assessCredit(fraudCase((s) => { s.credit_score = 640; }));
    expect(codes(fraudAndFico)).toEqual(["LOW_FICO", "FRAUD_REVIEW"]);
    expect(fraudAndFico.policyDecision).toBe("DECLINE");
    expect(fraudAndFico.reasons).toEqual([ADVERSE_ACTION.LOW_FICO]);

    const fraudAndWatch = assessCredit(fraudCase((s, monthly) => {
      s.monthly_obligations = Math.round(monthly * 0.21);
      s.monthly_mortgage_payment = Math.round(monthly * 0.21);
      s.checking_balance = 500;
    }));
    expect(codes(fraudAndWatch)).toEqual(["ELEVATED_DTI", "LIQUIDITY_RISK", "FRAUD_REVIEW"]);
    expect(fraudAndWatch.policyDecision).toBe("REVIEW");
    expect(fraudAndWatch.reasons).toHaveLength(3);
  });

  it("uses only HIGH-severity visible fraud alerts", () => {
    // Stated income 10% above employer-verified is a MEDIUM re-underwriting alert, not a fraud flag.
    const medium = structuredClone(generateCase(0, CONFIG, "INFLATION", "HIGH", "credit-fraud-boundary"));
    const s = medium.presentation.current_state;
    s.salary = Math.round((s.salary / 1.2) * 1.1);
    expect(assessCredit(medium).fraudFlag).toBe("NONE");
    s.salary = Math.round((s.salary / 1.1) * 1.2);
    expect(assessCredit(medium).fraudFlag).toBe("REVIEW");
  });

  it("accepts a custom policy", () => {
    const strict = { ...CREDIT_POLICY, ficoDecline: 700 };
    expect(assessCredit(handBuilt({ fico: 690 }), MORTGAGE, strict).policyDecision).toBe("DECLINE");
    expect(assessCredit(handBuilt({ fico: 690 })).policyDecision).toBe("APPROVE");
  });
});

describe("credit assessment outputs", () => {
  it("sums claimed student loan payments and ignores other liabilities", () => {
    const c = handBuilt({ studentPayments: [320, 180] });
    c.presentation.events.push({ type: "LIABILITY_OPENED", type_detail: "AUTO_LOAN", payment: 400 });
    c.presentation.events.push({ type: "ADDRESS_CHANGE", type_detail: "STUDENT_LOAN", payment: 999 });
    c.presentation.events.push({ type: "LIABILITY_OPENED", type_detail: "STUDENT_LOAN", payment: "x" });
    expect(assessCredit(c).studentPayment).toBe(500);
    const none = handBuilt({ studentPayments: [] });
    delete none.presentation.events;
    expect(assessCredit(none).studentPayment).toBe(0);
  });

  it("maps the generator's MANUAL_REVIEW to REVIEW and leaves other decisions as they are", () => {
    expect(assessCredit(handBuilt({ expected: "MANUAL_REVIEW" })).generatorDecision).toBe("REVIEW");
    expect(assessCredit(handBuilt({ expected: "DECLINE" })).generatorDecision).toBe("DECLINE");
    const none = handBuilt();
    delete none.label;
    expect(assessCredit(none)).toMatchObject({ generatorDecision: null, disagreement: null });
  });

  it("calls out integrity APPROVE with credit DECLINE, naming the driver", () => {
    expect(assessCredit(handBuilt({ fico: 640 })).disagreement).toEqual({
      kind: DISAGREEMENT.INTEGRITY_APPROVE_CREDIT_DECLINE, generator: "APPROVE", policy: "DECLINE",
      text: "Integrity check: APPROVE · Credit policy: DECLINE (FICO 640)"
    });
    expect(assessCredit(handBuilt({ obligations: 1000, housing: 3700 })).disagreement.text).toBe("Integrity check: APPROVE · Credit policy: DECLINE (back-end DTI 47%)");
  });

  it("calls out integrity DECLINE or fraud REVIEW with credit APPROVE, and nothing else", () => {
    expect(assessCredit(handBuilt({ expected: "DECLINE" })).disagreement).toEqual({
      kind: DISAGREEMENT.INTEGRITY_FLAG_CREDIT_APPROVE, generator: "DECLINE", policy: "APPROVE",
      text: "Integrity check: DECLINE · Credit policy: APPROVE"
    });
    expect(assessCredit(handBuilt({ expected: "DECLINE", reasonCodes: ["UNVERIFIABLE_INCOME", "ELEVATED_DTI"] })).disagreement.text)
      .toBe("Integrity check: DECLINE · Credit policy: APPROVE (UNVERIFIABLE_INCOME)");
    expect(assessCredit(handBuilt({ expected: "MANUAL_REVIEW", reasonCodes: ["UNSOURCED_LARGE_DEPOSIT"] })).disagreement.text)
      .toBe("Integrity check: REVIEW for fraud · Credit policy: APPROVE (UNSOURCED_LARGE_DEPOSIT)");
    expect(assessCredit(handBuilt({ expected: "MANUAL_REVIEW", reasonCodes: ["ELEVATED_DTI", "NOT_A_CODE"] })).disagreement).toBeNull();
    expect(assessCredit(handBuilt({ expected: "MANUAL_REVIEW" })).disagreement).toBeNull();
    expect(assessCredit(handBuilt({ fico: 640, expected: "DECLINE" })).disagreement).toBeNull();
    expect(assessCredit(handBuilt({ fico: 682, obligations: 1000, housing: 3300 })).disagreement).toBeNull();
    expect(assessCredit(handBuilt({ fico: 640, expected: "MANUAL_REVIEW", reasonCodes: ["UNSOURCED_LARGE_DEPOSIT"] })).disagreement).toBeNull();
  });

  it("formats the one-line risk summary", () => {
    expect(riskSummary(assessCredit(handBuilt({ fico: 682, obligations: 1000, housing: 3300 }))))
      .toBe("Borrower: FICO 682, DTI 43%, Student $320/mo, Fraud: None, Policy: REVIEW - Elevated DTI | Integrity: APPROVE");
    expect(riskSummary(assessCredit(handBuilt({ fico: 640, obligations: 1000, housing: 3700, studentPayments: [1234.6] }))))
      .toBe("Borrower: FICO 640, DTI 47%, Student $1,235/mo, Fraud: None, Policy: DECLINE - Credit score below program minimum; Excessive obligations in relation to income | Integrity: APPROVE");
    expect(riskSummary(assessCredit(handBuilt({ housing: null, obligations: 500 }))))
      .toBe("Borrower: FICO 720, DTI 5% (partial), Student $320/mo, Fraud: None, Policy: APPROVE | Integrity: APPROVE");
    expect(riskSummary({ fico: null, dti: null, dtiPartial: true, studentPayment: 0, fraudFlag: "REVIEW", reasons: [], policyDecision: "APPROVE", generatorDecision: null }))
      .toBe("Borrower: FICO n/a, DTI n/a, Student $0/mo, Fraud: Review, Policy: APPROVE | Integrity: n/a");
  });
});

describe("credit policy over generated cases", () => {
  it("never throws, and every DECLINE carries adverse-action wording", () => {
    const wording = new Set(Object.values(ADVERSE_ACTION));
    for (const [cfg, profile] of [[CONFIG, MORTGAGE], [SOLAR, SOLAR_PROFILE]]) {
      for (let i = 0; i < 150; i++) {
        const a = assessCredit(generateBlendedCase(i, cfg, "credit-vitest"), profile);
        expect(() => riskSummary(a)).not.toThrow();
        if (a.policyDecision === "DECLINE") expect(a.reasons.every((r) => wording.has(r))).toBe(true);
      }
    }
  });

  it("ignores region, zip code, persona, age and regime", () => {
    const swap = (o) => {
      if (!o) return;
      if ("region" in o) o.region = o.region === "HIGH_COST" ? "LOW_COST" : "HIGH_COST";
      if ("zip_code" in o) o.zip_code = o.zip_code === "10001" ? "59801" : "10001";
      if ("persona" in o) o.persona = o.persona === "GIG_WORKER" ? "STABLE_PROFESSIONAL" : "GIG_WORKER";
      if ("regime" in o) o.regime = o.regime === "SUBPRIME" ? "PRIME" : "SUBPRIME";
      if ("age" in o) o.age = o.age >= 60 ? 25 : 70;
    };
    for (let i = 0; i < 60; i++) {
      const c = generateBlendedCase(i, SOLAR, "credit-geo");
      const k = structuredClone(c);
      for (const o of [k.applicant, k.truth?.demographics, k.truth?.current_state, k.presentation?.current_state]) swap(o);
      expect(assessCredit(k, SOLAR_PROFILE)).toEqual(assessCredit(c, SOLAR_PROFILE));
    }
  });

  it("compares FICO on all applications and on approved applications", () => {
    const cases = [handBuilt({ fico: 700 }), handBuilt({ fico: 640 }), handBuilt({ fico: 800 }), { presentation: { current_state: {} } }];
    expect(ficoComparison(cases)).toEqual({ n: 3, allMean: (700 + 640 + 800) / 3, approvedN: 2, approvedMean: 750 });
    expect(ficoComparison(cases, MORTGAGE, { ...CREDIT_POLICY, ficoDecline: 750 })).toMatchObject({ approvedN: 1, approvedMean: 800 });
    expect(ficoComparison([])).toEqual({ n: 0, allMean: null, approvedN: 0, approvedMean: null });
  });
});

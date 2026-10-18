// The integrity badge rule: a case card carries the badge only when the generator's integrity check
// reviews or declines the case and cites a fraud indicator or a verification failure.

import { describe, it, expect } from "vitest";
import { integrityBadge } from "./useCreditAssessments.js";
import { assessCredit } from "../../creditRisk.js";
import { REASON_CODES, REASON_CATEGORIES } from "../../decisioning/reason-codes/catalog.js";
import { PROFILES, getProfile, applyProfile } from "../../profiles/index.js";
import { buildInitialCases, demoConfig } from "../hooks/useCaseLibrary.js";

const codeOf = (category) => Object.values(REASON_CODES).find((r) => r.category === category).code;
const otherCode = Object.values(REASON_CODES).find((r) => r.category !== REASON_CATEGORIES.FRAUD_INDICATOR && r.category !== REASON_CATEGORIES.VERIFICATION_FAILURE).code;
const label = (...codes) => ({ reason_codes: codes });

describe("integrityBadge", () => {
  it("shows for a review or decline that cites a fraud indicator or a verification failure", () => {
    for (const decision of ["REVIEW", "DECLINE"]) {
      for (const category of [REASON_CATEGORIES.FRAUD_INDICATOR, REASON_CATEGORIES.VERIFICATION_FAILURE]) {
        const code = codeOf(category);
        expect(integrityBadge({ generatorDecision: decision }, label(otherCode, code))).toEqual({ text: `Integrity: ${decision.toLowerCase()}`, codes: [code] });
      }
    }
  });

  it("never shows for an approval, for other reason codes only, or without an integrity decision", () => {
    expect(integrityBadge({ generatorDecision: "APPROVE" }, label(codeOf(REASON_CATEGORIES.FRAUD_INDICATOR)))).toBeNull();
    expect(integrityBadge({ generatorDecision: "DECLINE" }, label(otherCode))).toBeNull();
    expect(integrityBadge({ generatorDecision: "REVIEW" }, label())).toBeNull();
    expect(integrityBadge({}, label(codeOf(REASON_CATEGORIES.FRAUD_INDICATOR)))).toBeNull();
    expect(integrityBadge(undefined, undefined)).toBeNull();
  });

  // Of the 12 opening cases: Solar prime's credit-lens cards show the badge on 4 of the 8 the
  // integrity check flags. Mortgage cards have no badge; the rule would select 10 of its 12 flagged
  // cases (its two clean cases carry no fraud or verification code).
  it("selects 4 of 12 opening cases under Solar prime and 10 of 12 under Mortgage", () => {
    const count = (id) => {
      const p = getProfile(id);
      const cases = buildInitialCases(applyProfile(demoConfig, p), p.openingLibrary);
      expect(cases).toHaveLength(12);
      return cases.filter((c) => integrityBadge(assessCredit(c, p), c.label)).length;
    };
    expect(PROFILES.map((p) => [p.id, count(p.id)])).toEqual([["MORTGAGE", 10], ["SOLAR_PRIME", 4]]);
  });
});

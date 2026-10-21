// Locked Findings numbers that need no generated book: break-even, runway and the take-rate
// correlation, as fixed values. Event wording stays in src/profiles/ (test:public-record checks this file too). The book-based numbers (funded book, NC-19, dealer ratings, sandbox
// pool, credit mix) are locked in scripts/locked-numbers.test.mjs, which CI runs via npm run test:all.
// A change here is a change to a published figure: update the Findings brief and the handoff with it.

import { describe, it, expect } from "vitest";
import { getProfile } from "./profiles/index.js";
import { breakEvenShockBps } from "./fundingStress.js";

const solar = getProfile("SOLAR_PRIME");

describe("locked Findings numbers (no book)", () => {
  it("break-even shock at the Solar prime funding defaults is 112.8 bps", () => {
    const d = solar.defaults.fundingRates;
    const bps = breakEvenShockBps({ dealerFeePct: d.dealerFeePct.value, coupon: d.coupon.value, termYears: d.termYears.value, yieldAtApproval: d.investorYieldAtApproval.value, cpr: d.cpr.value });
    expect(bps.toFixed(1)).toBe("112.8");
  });

  it("runway is 22.2 months at the last computable quarter (Q4 2022); the bankruptcy event is dated 2023-10-30", async () => {
    const record = await solar.publicRecord.load();
    const last = record.analyses.liquidityRunway(record.quarterly.quarters).filter((r) => r.status === "ok").at(-1);
    expect(last.quarter).toBe("2022Q4");
    expect(last.runwayMonths.toFixed(1)).toBe("22.2");
    expect(record.events.find((e) => e.id === "chapter-11").date).toBe("2023-10-30");
  });

  it("take-rate correlation with fed funds is -0.75 over n = 9 quarters", async () => {
    const record = await solar.publicRecord.load();
    const { correlation } = record.analyses.unitEconomics(record.quarterly.quarters);
    expect(correlation.value.toFixed(2)).toBe("-0.75");
    expect(correlation.n).toBe(9);
  });
});

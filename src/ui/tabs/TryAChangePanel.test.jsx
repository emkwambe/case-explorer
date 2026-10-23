// @vitest-environment jsdom
// "Try a change" panel: shows the decision before and after one mutation, and which rows of the
// expected-change table held; the selected case itself is never changed.

import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TryAChangePanel } from "./TryAChangePanel.jsx";
import { demoConfig } from "../hooks/useCaseLibrary.js";
import { applyProfile, getProfile } from "../../profiles/index.js";
import { generateBlendedCase } from "../../generator.js";
import { observeCase } from "../../mutations.js";
import { isEligibleBase } from "../../mutationTable.js";

const profile = getProfile("SOLAR_PRIME");
const config = applyProfile(demoConfig, profile);
const ctx = { profile, config };
let base = null;
for (let i = 0; !base && i < 100; i++) {
  const c = generateBlendedCase(i, config, "42");
  if (isEligibleBase(c, observeCase(c, ctx))) base = c;
}

beforeEach(() => cleanup());

describe("Try a change panel", () => {
  it("hides a debt: credit policy APPROVE becomes REVIEW, the row holds, and the case is not changed", async () => {
    const before = JSON.stringify(base);
    render(<TryAChangePanel caseData={base} profile={profile} config={config} />);
    const table = screen.getByTestId("try-change-table");
    const decisionRow = within(table).getByText("Credit policy decision").closest("tr");
    expect(within(decisionRow).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Credit policy decision", "APPROVE", "REVIEW"]);
    expect(screen.getByTestId("try-change-rows").textContent).toMatch(/^Held/);
    expect(JSON.stringify(base)).toBe(before);
  });

  it("changing a sensitive attribute leaves every decision output the same", async () => {
    render(<TryAChangePanel caseData={base} profile={profile} config={config} />);
    await userEvent.selectOptions(screen.getByTestId("try-change-select"), "flip-age-band");
    const rows = within(screen.getByTestId("try-change-table")).getAllByRole("row").slice(1);
    for (const r of rows) {
      const [, b, a] = within(r).getAllByRole("cell").map((c) => c.textContent);
      expect(a).toBe(b);
    }
    expect(screen.getByTestId("try-change-rows").textContent).toMatch(/^Held/);
  });

  it("does not assert the table on a case that is not a table base", () => {
    const fraudCase = { ...base, meta: { ...base.meta, corruption_type: "INFLATION" } };
    render(<TryAChangePanel caseData={fraudCase} profile={profile} config={config} />);
    expect(screen.getByTestId("try-change-not-base")).toBeTruthy();
    expect(screen.queryByTestId("try-change-rows")).toBeNull();
  });

  it("explains when a change cannot apply to the case (the DTI is already above the target)", async () => {
    let high = null;
    for (let i = 0; !high && i < 200; i++) {
      const c = generateBlendedCase(i, config, "42");
      if ((observeCase(c, ctx).claimed_dti ?? 0) > 0.36) high = c;
    }
    render(<TryAChangePanel caseData={high} profile={profile} config={config} />);
    await userEvent.selectOptions(screen.getByTestId("try-change-select"), "dti-below-watch");
    expect(screen.getByTestId("try-change-error").textContent).toMatch(/only raises it/);
    expect(screen.queryByTestId("try-change-table")).toBeNull();
  });
});

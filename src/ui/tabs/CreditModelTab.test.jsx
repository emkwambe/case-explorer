// @vitest-environment jsdom
// The Credit model tab: reads the committed snapshot, shows this case's PD and reasons and the
// portfolio results, labels itself a second opinion, and renders nothing while a challenge case is blind.

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SUMMARY from "../../../artifacts/credit-model-snapshot/credit-model-summary.json";
import CASES from "../../../artifacts/credit-model-snapshot/credit-model-cases.json";
import { CreditModelTab, CREDIT_MODEL_LABEL } from "./CreditModelTab.jsx";
import { ChallengeGateContext } from "../challenge/challengeGate.js";
import CaseExplorer from "../CaseExplorer.jsx";
import { openingTwin } from "../hooks/useCaseLibrary.js";
import { getProfile } from "../../profiles/index.js";

const serve = () =>
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (String(url).endsWith("credit-model-summary.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(SUMMARY) });
    if (String(url).endsWith("credit-model-cases.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(CASES) });
    return Promise.resolve({ ok: false, status: 404 });
  }));

beforeEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/?profile=solar-prime");
  serve();
});

describe("Credit model tab", () => {
  it("shows the opening case's PD and reasons, labelled a second opinion, and the portfolio results", async () => {
    const clean = openingTwin(getProfile("SOLAR_PRIME"), "clean");
    render(<CreditModelTab caseData={clean} />);
    expect(screen.getAllByText(CREDIT_MODEL_LABEL).length).toBeGreaterThan(0);
    const pd = await screen.findByTestId("credit-model-pd");
    expect(pd.textContent).toContain(`${(100 * CASES.opening_library[clean.id].pd).toFixed(2)}%`);
    const about = await screen.findByTestId("credit-model-about");
    const auc = SUMMARY.models.credit_pd_xgb.test.metrics.auc.toFixed(3);
    expect(within(screen.getByTestId("credit-model-metrics")).getByText(new RegExp(`^${auc} \\(`))).toBeInTheDocument();
    expect(within(about).getByTestId("credit-model-shap").querySelectorAll("[role=listitem]").length).toBe(Object.keys(SUMMARY.reasons.global.groups).length);
    expect(within(about).getByTestId("credit-model-deciles").querySelectorAll("tbody tr").length).toBe(10);
    expect(within(about).getByRole("link", { name: "Model card" })).toHaveAttribute("href", expect.stringContaining("MODEL-CARD-credit-pd.md"));
    expect(about.textContent).toContain("does not transfer to real data");
  });

  it("says so for a case the snapshot does not score", async () => {
    render(<CreditModelTab caseData={{ id: "case-not-in-the-snapshot" }} />);
    expect(await screen.findByText(/No precomputed score for this case/)).toBeInTheDocument();
  });

  it("renders nothing while a challenge case is blind", () => {
    const { container } = render(
      <ChallengeGateContext.Provider value={{ active: true, blind: true }}>
        <CreditModelTab caseData={{ id: "x" }} />
      </ChallengeGateContext.Provider>
    );
    expect(container.textContent).toBe("");
  });

  it("is a Case-section tab under Solar prime and absent under Mortgage", async () => {
    render(<CaseExplorer />);
    await userEvent.click(screen.getByTestId("section-case"));
    await userEvent.click(screen.getByRole("tab", { name: "Credit model" }));
    await waitFor(() => expect(screen.getByTestId("credit-model-tab")).toBeInTheDocument());
    cleanup();
    window.history.replaceState(null, "", "/?profile=mortgage");
    render(<CaseExplorer />);
    await userEvent.click(screen.getByTestId("section-case"));
    expect(screen.queryByRole("tab", { name: "Credit model" })).toBeNull();
  });
});

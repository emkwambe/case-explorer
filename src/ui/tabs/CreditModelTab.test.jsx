// @vitest-environment jsdom
// The Credit model tab: reads the committed snapshot, shows this case's PD and reasons and the
// portfolio results, labels itself a second opinion, and renders nothing while a challenge case is blind.

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SUMMARY from "../../../artifacts/credit-model-snapshot/credit-model-summary.json";
import CASES from "../../../artifacts/credit-model-snapshot/credit-model-cases.json";
import PROPS from "../../../artifacts/credit-model-snapshot/credit-model-properties.json";
import CARD from "../../../docs/MODEL-CARD-credit-pd.md?raw";
import { LEGAL_STATUS, ATTRIBUTE_NAMES } from "./creditModelFormat.js";
import { CreditModelTab, CREDIT_MODEL_LABEL } from "./CreditModelTab.jsx";
import { ChallengeGateContext } from "../challenge/challengeGate.js";
import CaseExplorer from "../CaseExplorer.jsx";
import { openingTwin } from "../hooks/useCaseLibrary.js";
import { getProfile } from "../../profiles/index.js";

const serve = () =>
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (String(url).endsWith("credit-model-summary.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(SUMMARY) });
    if (String(url).endsWith("credit-model-cases.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(CASES) });
    if (String(url).endsWith("credit-model-properties.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(PROPS) });
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

  it("shows the tested properties: fairness, champion/challenger, reject inference and drift, from the snapshot", async () => {
    render(<CreditModelTab caseData={{ id: "x" }} />);
    const props = await screen.findByTestId("credit-model-properties");
    expect(props).toHaveTextContent("Developer testing, not independent validation");

    // Fairness: flips, a group table per attribute, the legal status (the card's words) and the proxy check.
    expect(screen.getByTestId("fairness-flips")).toHaveTextContent("No engine reads a sensitive attribute.");
    const groups = () => screen.getByTestId("fairness-groups").querySelectorAll("tbody tr");
    expect(groups().length).toBe(PROPS.fairness.groups.age_band.policies.bureau_score_policy.groups.length);
    expect(screen.getByTestId("fairness-note")).toHaveTextContent("AIR reference line: 0.80.");
    await userEvent.selectOptions(screen.getByTestId("fairness-attribute"), "income_band");
    expect(groups().length).toBe(PROPS.fairness.groups.income_band.policies.bureau_score_policy.groups.length);
    expect(screen.getByTestId("fairness-note")).toHaveTextContent("Income band is a legitimate credit factor");
    expect(screen.getByTestId("fairness-note")).not.toHaveTextContent("0.80");
    expect(CARD.replace(/\*/g, "")).toContain(LEGAL_STATUS);
    expect(screen.getByTestId("fairness-legal")).toHaveTextContent(LEGAL_STATUS);
    expect(screen.getByTestId("fairness-proxy").querySelectorAll("tbody tr").length).toBe(Object.keys(ATTRIBUTE_NAMES).length);

    // Champion/challenger against the bureau-score policy, with the overlay's source.
    const cc = PROPS.champion_challenger.policies;
    const table = screen.getByTestId("champion-table");
    expect(table.querySelectorAll("tbody tr").length).toBe(4);
    expect(table.querySelector("tbody tr")).toHaveTextContent(/^Champion: bureau-score policy/);
    expect(table).toHaveTextContent(`$${Math.round(cc.bureau_score_policy.expected_loss).toLocaleString("en-US")}`);
    expect(table).toHaveTextContent(`${cc.challenger_b_overlay.swap_in} / ${cc.challenger_b_overlay.swap_out}`);
    expect(screen.getByTestId("champion-source")).toHaveTextContent("mostly income-inflation fraud");
    expect(screen.getByTestId("champion-source")).toHaveTextContent("does not transfer to real data");

    // Reject inference: four methods for each family; drift: four books, the control not decayed.
    expect(screen.getByTestId("reject-table").querySelectorAll("tbody tr").length).toBe(8);
    const drift = screen.getByTestId("drift-table").querySelectorAll("tbody tr");
    expect(drift.length).toBe(Object.keys(PROPS.drift.books).length);
    expect(drift[0]).toHaveTextContent(/^Control \(unchanged\) \(1011\).*no$/);
    expect(screen.getByTestId("drift-notes")).toHaveTextContent("The control book stays under the watch line");
    expect(screen.getByTestId("drift-notes")).toHaveTextContent("AUC can't reliably detect drops of about 0.05");
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

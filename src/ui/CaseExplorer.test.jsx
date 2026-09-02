// @vitest-environment jsdom
// UI tests: the explorer renders real generated cases, the tabs show real analysis, and the
// guided walkthrough carries a reviewer through one complete case including a four-eyes disposition.

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CaseExplorer from "./CaseExplorer.jsx";
import { buildInitialCases, demoConfig } from "./hooks/useCaseLibrary.js";
import { TOUR_STEPS } from "./demo/tour.js";
import { scoreCase } from "../decisioning/index.js";

// The artifact hook fetches published JSON; in tests there is no server.
beforeEach(() => {
  cleanup();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
  window.URL.createObjectURL = vi.fn(() => "blob:test");
  window.URL.revokeObjectURL = vi.fn();
});

const openTab = async (name) => {
  await userEvent.click(screen.getByRole("tab", { name }));
};

describe("case library", () => {
  it("opens on deterministic seeded cases covering every headline typology", () => {
    const a = buildInitialCases();
    const b = buildInitialCases();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const types = new Set(a.map((c) => c.meta.corruption_type));
    for (const t of ["NONE", "INFLATION", "CONCEALMENT", "FABRICATION", "BUST_OUT", "EVIDENCE_TAMPERING", "STRAW_BUYER", "INCOHERENT"]) {
      expect(types.has(t)).toBe(true);
    }
    expect(demoConfig.generation.as_of_date).toBe("2026-01-15");
  });
});

describe("CaseExplorer", () => {
  it("renders the library and case detail without a network call", () => {
    render(<CaseExplorer />);
    expect(screen.getByRole("heading", { name: /Case Explorer/ })).toBeInTheDocument();
    expect(screen.getAllByTestId("case-card").length).toBeGreaterThanOrEqual(12);
    expect(screen.getByText(/World truth is never visible/)).toBeInTheDocument();
  });

  it("shows the decision with rule alerts, governed reason codes and cited evidence", async () => {
    render(<CaseExplorer />);
    const tampering = buildInitialCases().find((c) => c.meta.corruption_type === "EVIDENCE_TAMPERING");
    await userEvent.click(screen.getByText(tampering.applicant.name));
    await openTab("Decision");
    expect(await screen.findByText(/Rule alerts/)).toBeInTheDocument();
    const expected = scoreCase(tampering, demoConfig, { now: "static" });
    expect(expected.alerts.length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(expected.alerts[0].rule_id)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Supporting evidence/).length).toBe(expected.alerts.length);
    expect(screen.getByText(/Underwritten on employer-verified income/)).toBeInTheDocument();
  });

  it("proves counterfactual fairness invariance on the selected case", async () => {
    render(<CaseExplorer />);
    await openTab("Fairness");
    expect(await screen.findByText(/does not establish legal compliance/i)).toBeInTheDocument();
    expect(screen.getByText("Decisions changed")).toBeInTheDocument();
    // Every counterfactual row must read "unchanged"; a CHANGED row is a critical finding.
    expect(screen.queryByText("CHANGED")).toBeNull();
    expect(screen.getAllByText("unchanged").length).toBeGreaterThan(5);
  });

  it("enforces four-eyes approval in the investigation workflow", async () => {
    render(<CaseExplorer />);
    const fabrication = buildInitialCases().find((c) => c.meta.corruption_type === "FABRICATION");
    await userEvent.click(screen.getByText(fabrication.applicant.name));
    await openTab("Investigation");
    await userEvent.click(screen.getByTestId("open-investigation"));
    await userEvent.click(await screen.findByTestId("action-TRIAGE"));
    await userEvent.click(await screen.findByTestId("action-START_REVIEW"));
    await userEvent.click(await screen.findByTestId("action-CONFIRM"));
    expect(await screen.findByText(/Confirmed Misrepresentation · Proposed/i)).toBeInTheDocument();

    // The proposer cannot approve their own disposition.
    await userEvent.selectOptions(screen.getByLabelText("Role"), "REVIEWER");
    await userEvent.click(await screen.findByTestId("action-APPROVE_DISPOSITION"));
    expect(await screen.findByText(/Four-eyes control: the proposer cannot approve/)).toBeInTheDocument();

    // A different reviewer can.
    fireEvent.change(screen.getByLabelText("Actor"), { target: { value: "r.singh" } });
    await userEvent.click(screen.getByTestId("action-APPROVE_DISPOSITION"));
    expect(await screen.findByText(/Confirmed Misrepresentation · Approved/i)).toBeInTheDocument();
    expect(screen.getByText(/Immutable audit events/)).toBeInTheDocument();
    expect(screen.getByText(/Not a SAR determination/)).toBeInTheDocument();
  });

  it("simulates decision economics and moves the optimal threshold with the assumptions", async () => {
    render(<CaseExplorer />);
    await openTab("Economics");
    expect(await screen.findByText("Optimal threshold")).toBeInTheDocument();
    const before = screen.getByText("Net expected benefit").parentElement.textContent;
    fireEvent.change(screen.getByLabelText("Manual review cost"), { target: { value: "5000" } });
    expect(screen.getByText("Net expected benefit").parentElement.textContent).not.toBe(before);
  });

  it("says so plainly when benchmark artifacts are not published", async () => {
    render(<CaseExplorer />);
    await openTab("Validation");
    expect(await screen.findByText(/Benchmark artifacts are not published/)).toBeInTheDocument();
  });

  it("walks the full guided tour from generation to the validation package", async () => {
    render(<CaseExplorer />);
    await userEvent.click(screen.getByTestId("start-tour"));
    for (let i = 0; i < TOUR_STEPS.length; i++) {
      const banner = await screen.findByTestId("tour-banner");
      expect(within(banner).getByText(TOUR_STEPS[i].title)).toBeInTheDocument();
      expect(within(banner).getByText(`${i + 1} of ${TOUR_STEPS.length}`)).toBeInTheDocument();
      await userEvent.click(screen.getByTestId("tour-next"));
    }
    expect(screen.queryByTestId("tour-banner")).toBeNull();
  });

  it("generates new cases into the portfolio table", async () => {
    render(<CaseExplorer />);
    const before = screen.getAllByTestId("case-card").length;
    await userEvent.selectOptions(screen.getByLabelText("Scenario"), "NONE");
    await userEvent.selectOptions(screen.getByLabelText("Count"), "10");
    fireEvent.change(screen.getByLabelText("Seed"), { target: { value: "ui-test" } });
    await userEvent.click(screen.getByTestId("generate"));
    expect(screen.getAllByTestId("case-card").length).toBe(before + 10);
    expect(await screen.findByText(/Showing \d+ of \d+ cases/)).toBeInTheDocument();
    expect(screen.getByText(/feature policy/i)).toBeInTheDocument();
  });
});

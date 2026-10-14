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
import { PROFILES } from "../profiles/index.js";

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

  it("shows the observed outcome and names it as unavailable at decision time", async () => {
    render(<CaseExplorer />);
    const bustOut = buildInitialCases().find((c) => c.meta.corruption_type === "BUST_OUT");
    await userEvent.click(screen.getByText(bustOut.applicant.name));
    await openTab("Outcome");
    expect(await screen.findByText(/never has this at decision time/)).toBeInTheDocument();
    expect(screen.getByText("Realised loss")).toBeInTheDocument();
    // The rendered status must be the simulated one, not anything the policy produced.
    // "Outcome" also names the tab, so anchor on the metric card's own subtitle instead.
    const card = screen.getByText(/of \d+ payments made/).closest("div").parentElement;
    expect(card.textContent).toMatch(new RegExp(bustOut.performance.status, "i"));
    // A declined loan that would have defaulted is a loss avoided, not a false decline.
    if (bustOut.performance.status === "DEFAULT") {
      expect(screen.getByText(/Loss avoided|realised loss/i)).toBeInTheDocument();
    }
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

describe("Credit Risk Mode", () => {
  const FOOTER = "Demo only · Synthetic data · Not a consumer report · Not for credit decisions · Educational portfolio project";

  it("shows the compliance footer on every tab with the mode off and on", async () => {
    render(<CaseExplorer />);
    for (const mode of [false, true]) {
      if (mode) await userEvent.click(screen.getByTestId("credit-risk-mode"));
      for (const tab of screen.getAllByRole("tab")) {
        await userEvent.click(tab);
        expect(screen.getByTestId("compliance-footer")).toHaveTextContent(FOOTER);
      }
    }
  }, 30000);

  it("shows the underwriting sidebar, portfolio strip and copyable risk summary", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CaseExplorer />);
    expect(screen.queryByTestId("underwriting-sidebar")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("credit-risk-mode"));
    expect(screen.getByRole("heading", { name: "Underwriting Decision" })).toBeInTheDocument();
    expect(screen.getByTestId("portfolio-strip")).toHaveTextContent(/APPROVE \d+%/);
    const summary = screen.getByTestId("risk-summary").textContent;
    expect(summary).toMatch(/^Borrower: FICO \d+, DTI \d+%, Student \$[\d,]+\/mo, Fraud: (None|Review), Policy: /);
    await userEvent.click(screen.getByTestId("copy-risk-summary"));
    expect(writeText).toHaveBeenCalledWith(summary);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("show-ground-truth"));
    expect(screen.getByTestId("ground-truth-comparison")).toBeInTheDocument();
  });

  it("compares all-application and approved-only FICO with the 10-K benchmark for both profiles", async () => {
    render(<CaseExplorer />);
    await userEvent.click(screen.getByTestId("credit-risk-mode"));
    expect(screen.getByTestId("conflict-approve-decline")).toHaveTextContent(/Integrity APPROVE · Credit DECLINE: \d+/);
    expect(screen.getByTestId("conflict-flag-approve")).toHaveTextContent(/Integrity DECLINE or fraud REVIEW · Credit APPROVE: \d+/);
    const panel = screen.getByTestId("benchmark-panel");
    panel.open = true;
    fireEvent(panel, new Event("toggle"));
    for (const id of ["MORTGAGE", "SOLAR_PRIME"]) {
      expect(await within(panel).findByTestId(`delta-approved-${id}`, {}, { timeout: 60000 })).toBeInTheDocument();
      expect(within(panel).getByTestId(`delta-all-${id}`)).toBeInTheDocument();
    }
    expect(within(panel).getAllByText("2,000").length).toBe(2);
    expect(within(panel).getByRole("link", { name: /FY2022 Form 10-K/ })).toHaveAttribute("href", expect.stringContaining("sec.gov"));
  }, 90000);
});

describe("lender profiles", () => {
  const BARE = Object.freeze({
    id: "BARE", label: "Bare test profile", preset: null, benchmarks: [], caseStudies: [],
    defaults: { dealerView: null, fundingRates: null }
  });

  it("renders every tab without errors for a profile with no case studies and no benchmarks", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<CaseExplorer profileRegistry={[BARE]} />);
      expect(screen.getByTestId("portfolio-profile")).toHaveValue("BARE");
      for (const mode of [false, true]) {
        if (mode) await userEvent.click(screen.getByTestId("credit-risk-mode"));
        for (const tab of screen.getAllByRole("tab")) {
          await userEvent.click(tab);
          expect(screen.getByTestId("compliance-footer")).toBeInTheDocument();
        }
      }
      const panel = screen.getByTestId("benchmark-panel");
      panel.open = true;
      fireEvent(panel, new Event("toggle"));
      expect(within(panel).getByTestId("no-benchmarks")).toBeInTheDocument();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  }, 30000);

  it("rebuilds the library under the selected profile from the registry", async () => {
    render(<CaseExplorer />);
    const before = screen.getAllByTestId("case-card").map((c) => c.textContent).join("|");
    await userEvent.selectOptions(screen.getByTestId("portfolio-profile"), "SOLAR_PRIME");
    expect(screen.getByTestId("portfolio-profile")).toHaveValue("SOLAR_PRIME");
    const after = screen.getAllByTestId("case-card").map((c) => c.textContent).join("|");
    expect(after).not.toBe(before);
  });
});

describe("Dealer View", () => {
  const solar = PROFILES.find((p) => p.id === "SOLAR_PRIME");
  const SMALL_SOLAR = Object.freeze({
    ...solar,
    defaults: { ...solar.defaults, dealerView: { ...solar.defaults.dealerView, portfolio: { count: 300, seed: 42 } } }
  });
  // Small portfolios keep the UI tests fast; MORTGAGE still has no case studies.
  const mortgage = PROFILES.find((p) => p.id === "MORTGAGE");
  const SMALL_MORTGAGE = Object.freeze({ ...mortgage, defaults: { ...mortgage.defaults, dealerView: { portfolio: { count: 300, seed: 42 } } } });
  const REGISTRY = [SMALL_MORTGAGE, SMALL_SOLAR];

  it("generates the portfolio, shows computed alerts and a labelled dealer-failure scenario", async () => {
    render(<CaseExplorer profileRegistry={REGISTRY} />);
    await userEvent.selectOptions(screen.getByTestId("portfolio-profile"), "SOLAR_PRIME");
    await openTab("Dealer View");
    expect(screen.getByTestId("synthetic-label")).toHaveTextContent("Synthetic data");
    expect(screen.getByTestId("dealer-model-note")).toHaveTextContent(/simulated public-record signal/);
    expect(screen.getByTestId("dealer-profile")).toHaveTextContent("Solar prime (calibrated)");
    expect(screen.queryByTestId("case-study-hint")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("generate-10k"));
    const table = await screen.findByTestId("dealer-table", {}, { timeout: 30000 });
    expect(within(table).getAllByRole("row").length).toBe(51);
    expect(screen.getByText(/300 loans/)).toBeInTheDocument();
    await userEvent.click(within(table).getAllByRole("button", { name: "Fail this dealer" })[0]);
    const result = screen.getByTestId("dealer-failure-result");
    expect(result).toHaveTextContent(/Advance write-off/);
    expect(result).toHaveTextContent(/Change in expected loss/);
    expect(result).toHaveTextContent(/New portfolio expected loss/);
    expect(within(result).getAllByText("assumption").length).toBe(3);
    expect(screen.getByTestId("dealer-simulated-label")).toHaveTextContent("simulated — dealer effect is a set assumption");
    expect(table).toHaveTextContent("simulated — dealer effect is a set assumption");
    expect(screen.getByTestId("advance-source")).toHaveTextContent("$30,000,000, $10,000,000, $7,000,000, $5,000,000");
    expect(screen.getByTestId("loan-amount-source")).toHaveTextContent(/\$10,000 to \$150,000 \(disclosed/);
    expect(screen.getByTestId("exposure-note")).toHaveTextContent("Simulated 10,000-loan sample; advance-to-loan ratios are not comparable to");
    expect(screen.getByTestId("loan-amount-source")).toHaveTextContent(/Calibration target: mean loan amount \$46,000 \(disclosed; Item 7/);
    expect(screen.getByTestId("rating-method")).toHaveTextContent(/one-sided binomial test/);
    expect(screen.getByTestId("rating-method")).toHaveTextContent(/Bonferroni/);
    expect(within(table).getByText("p-value")).toBeInTheDocument();
    const noise = screen.getByTestId("signal-vs-noise");
    noise.open = true;
    fireEvent(noise, new Event("toggle"));
    expect(within(noise).getByTestId("false-flags")).toHaveTextContent(/\d+ RED, \d+ YELLOW of \d+ rated/);
    expect(within(noise).getByTestId("false-flags-no-min")).toHaveTextContent(/of 50 rated/);
    await userEvent.selectOptions(screen.getByLabelText("Dealer effect strength"), "0");
    expect(screen.getByTestId("dealer-simulated-label")).toHaveTextContent("strength 0");
    expect(screen.queryByTestId("dealer-failure-result")).not.toBeInTheDocument();
    expect(screen.getByTestId("compliance-footer")).toBeInTheDocument();
  }, 60000);

  it("follows the header profile: Mortgage shows a hint and no case study, and a portfolio from another profile is stale", async () => {
    render(<CaseExplorer profileRegistry={REGISTRY} />);
    await openTab("Dealer View");
    expect(screen.getByTestId("dealer-profile")).toHaveTextContent("Mortgage (default)");
    expect(screen.queryByTestId("dealer-case-study")).not.toBeInTheDocument();
    expect(screen.getByTestId("case-study-hint")).toHaveTextContent("Switch to Solar prime to see the sourced");
    await userEvent.click(screen.getByTestId("generate-10k"));
    await screen.findByTestId("dealer-table", {}, { timeout: 30000 });
    expect(screen.getByText(/Mortgage \(default\) · seed 42/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId("portfolio-profile"), "SOLAR_PRIME");
    expect(screen.getByTestId("dealer-stale")).toHaveTextContent("generated under Mortgage (default)");
    expect(screen.queryByTestId("dealer-table")).not.toBeInTheDocument();
  }, 60000);

  it("shows the case-study panel only for an active profile with entries, with exactly two linked facts", async () => {
    render(<CaseExplorer profileRegistry={REGISTRY} />);
    await userEvent.selectOptions(screen.getByTestId("portfolio-profile"), "SOLAR_PRIME");
    await openTab("Dealer View");
    const panel = screen.getByTestId("dealer-case-study");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(2);
    expect(within(panel).getAllByRole("link")).toHaveLength(2);
  });
});

describe("Funding & Rates", () => {
  const solar = PROFILES.find((p) => p.id === "SOLAR_PRIME");
  const SMALL_SOLAR = Object.freeze({
    ...solar,
    defaults: { ...solar.defaults, dealerView: { ...solar.defaults.dealerView, portfolio: { count: 300, seed: 42 } } }
  });
  const REGISTRY = [PROFILES.find((p) => p.id === "MORTGAGE"), SMALL_SOLAR];

  it("computes the pricing lag, liquidity path and sourced history from the active profile", async () => {
    render(<CaseExplorer profileRegistry={REGISTRY} />);
    await userEvent.selectOptions(screen.getByTestId("portfolio-profile"), "SOLAR_PRIME");
    await openTab("Funding & Rates");
    const tile = screen.getByTestId("tile-break-even");
    const chart = screen.getByTestId("chart-fee-vs-shock");
    const tileValue = tile.textContent.match(/([\d.]+) bps/)[1];
    expect(within(chart).getByText(`Break-even ${tileValue} bps`)).toBeInTheDocument();
    expect(tileValue).toBe("112.8");
    expect(screen.getByTestId("input-loan-size")).toHaveValue(46000);
    expect(screen.getByTestId("loan-size-citation")).toHaveTextContent(/Item 7/);
    expect(within(screen.getByTestId("panel-pricing-lag")).getAllByText("assumption").length).toBeGreaterThanOrEqual(3);
    expect(within(screen.getByTestId("panel-pricing-lag")).getAllByText("disclosed range")).toHaveLength(2);
    fireEvent.change(screen.getByTestId("input-shock"), { target: { value: "250" } });
    expect(screen.getByTestId("liquidity-sentence")).toHaveTextContent(/^A \+250 bps move between approval and sale turns a \$6\.34 fee into −\$6\.69 per \$100; on a \$500,000,000 unsold backbook that is −\$33,468,306, which breaches the \$20,000,000 liquidity minimum in month \d+\.$/);
    const history = screen.getByTestId("panel-history");
    expect(within(history).getAllByRole("listitem")).toHaveLength(9);
    expect(within(screen.getByTestId("history-sources")).getAllByRole("link")).toHaveLength(4);
    expect(screen.getByTestId("analysis-line")).toHaveTextContent(/^Analysis, not fact:/);
    expect(screen.getByTestId("compliance-footer")).toBeInTheDocument();
  }, 30000);

  it("applies the dealer portfolio and the last dealer-failure scenario to expected loss", async () => {
    render(<CaseExplorer profileRegistry={REGISTRY} />);
    await userEvent.selectOptions(screen.getByTestId("portfolio-profile"), "SOLAR_PRIME");
    await openTab("Funding & Rates");
    expect(within(screen.getByTestId("panel-credit-loss")).getByText(/Generate the 10k portfolio/)).toBeInTheDocument();
    await openTab("Dealer View");
    await userEvent.click(screen.getByTestId("generate-10k"));
    const table = await screen.findByTestId("dealer-table", {}, { timeout: 30000 });
    await userEvent.click(within(table).getAllByRole("button", { name: "Fail this dealer" })[0]);
    await openTab("Funding & Rates");
    const panel = screen.getByTestId("panel-credit-loss");
    expect(within(panel).getByText("Portfolio expected loss")).toBeInTheDocument();
    await userEvent.click(within(panel).getByTestId("apply-failure"));
    expect(within(panel).getByText("With last dealer failure")).toBeInTheDocument();
  }, 60000);

  it("says Mortgage has no funding defaults and points to the profile that does", async () => {
    render(<CaseExplorer profileRegistry={REGISTRY} />);
    await openTab("Funding & Rates");
    expect(screen.getByTestId("funding-not-configured")).toHaveTextContent("not configured for Mortgage (default). Profiles with defaults: Solar prime (calibrated).");
    expect(screen.getByTestId("funding-hint")).toHaveTextContent("Switch to Solar prime to see the sourced");
    expect(screen.queryByTestId("panel-pricing-lag")).not.toBeInTheDocument();
  });
});

describe("Public record", () => {
  it("is shown only when the active profile has public-record data", async () => {
    render(<CaseExplorer />);
    expect(screen.queryByRole("tab", { name: "Public record" })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId("portfolio-profile"), "SOLAR_PRIME");
    expect(screen.getByRole("tab", { name: "Public record" })).toBeInTheDocument();
  });

  it("renders the analyses from the snapshot, with lineage on values and no request to SEC or FRED", async () => {
    render(<CaseExplorer />);
    await userEvent.selectOptions(screen.getByTestId("portfolio-profile"), "SOLAR_PRIME");
    await openTab("Public record");
    await screen.findByTestId("public-record-view", {}, { timeout: 10000 });

    // Lineage: a manual figure shows its filing, page and quoted label.
    const table = screen.getByTestId("unit-economics-table");
    await userEvent.click(within(table).getByRole("button", { name: "$716.4M" }));
    const lineage = screen.getByTestId("lineage");
    expect(lineage).toHaveTextContent("Form 10-Q for the quarter ended June 30, 2022");
    expect(lineage).toHaveTextContent("p. 48, MD&A, Key Performance Measures table");
    expect(lineage).toHaveTextContent("Funded Loans(b) [Successor(a); For the Three Months Ended June 30, 2022]");
    // A FRED value and a computed value.
    await userEvent.click(within(table).getAllByRole("button", { name: /%$/ })[0]);
    expect(screen.getByTestId("lineage")).toHaveTextContent(/Computed: platform fees ÷ funded loans|FRED series/);

    expect(screen.getByTestId("break-badge")).toHaveTextContent("presentation break");
    expect(screen.getByTestId("break-note")).toHaveTextContent(/Platform fees from affiliate/);
    expect(screen.getByTestId("correlation")).toHaveTextContent(/n = 9 quarters/);
    expect(screen.getByTestId("correlation")).toHaveTextContent(/not causal/);
    expect(screen.getByTestId("backtest-sentence")).toHaveTextContent("Z″ could not be computed for any quarter from the public data");
    expect(screen.getByTestId("runway-status-2022Q1")).toHaveTextContent("insufficient data");
    expect(within(screen.getByTestId("manifest-table")).getAllByRole("row")).toHaveLength(12);
    expect(screen.getByTestId("gaps-list")).toHaveTextContent("contractor_advances");
    expect(screen.getByTestId("eda-raw")).toHaveTextContent(/pre-merger reports/);
    expect(screen.getByTestId("compliance-footer")).toBeInTheDocument();

    const urls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => /sec\.gov|stlouisfed\.org/.test(u))).toEqual([]);
  }, 30000);
});

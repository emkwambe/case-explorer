// @vitest-environment jsdom
// Policy Sandbox tab: shown only for profiles that turn it on, built from the portfolio pass, and
// every swap-set figure on it equals what src/policySandbox.js computes on an independently built pool.

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CaseExplorer from "../CaseExplorer.jsx";
import { demoConfig } from "../hooks/useCaseLibrary.js";
import { PROFILES, applyProfile } from "../../profiles/index.js";
import { TAB_GROUPS, visibleTabs } from "../navigation.js";
import { money } from "../theme.js";
import { generateBlendedCase } from "../../generator.js";
import { CREDIT_POLICY } from "../../creditRisk.js";
import { buildDealerNetwork, dealerSettings, isFundedLoan } from "../../dealers.js";
import { poolRecord, simulatePool, swapSet, applyPreset, POLICY_PRESETS } from "../../policySandbox.js";

beforeEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/?profile=solar-prime");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
});

const solar = PROFILES.find((p) => p.id === "SOLAR_PRIME");
const mortgage = PROFILES.find((p) => p.id === "MORTGAGE");
// A small funded book keeps the test fast; everything else is the real profile.
const SMALL_SOLAR = Object.freeze({
  ...solar,
  defaults: { ...solar.defaults, dealerView: { ...solar.defaults.dealerView, portfolio: { count: 300, seed: 42 } } }
});
const REGISTRY = [mortgage, SMALL_SOLAR];

/** The pool exactly as the portfolio pass builds it, independently of the hook. */
function buildPool(profile) {
  const settings = dealerSettings(profile.defaults.dealerView);
  const dealers = buildDealerNetwork(settings.network);
  const config = applyProfile(demoConfig, profile);
  const pool = [];
  let funded = 0;
  for (let i = 0; funded < settings.portfolio.count; i++) {
    const c = generateBlendedCase(i, config, settings.portfolio.seed);
    if (isFundedLoan(c, profile)) funded++;
    pool.push(poolRecord(c, profile, settings.loanAmount));
  }
  const loans = simulatePool(pool, dealers, settings);
  const lgd = 1 - settings.dealerFailure.baseRecovery.value;
  return { pool, run: (policy, opts = {}) => swapSet(pool, CREDIT_POLICY, policy, { loans, lgd, dealers, ...opts }) };
}

const preset = (id) => POLICY_PRESETS.find((p) => p.id === id);
const fmt = (n) => n.toLocaleString("en-US");

async function openSandbox() {
  await userEvent.click(screen.getByTestId("section-credit"));
  await userEvent.click(screen.getByRole("tab", { name: "Policy Sandbox" }));
  return screen.getByTestId("policy-sandbox");
}

describe("Policy Sandbox tab", () => {
  it("is shown only for profiles with policySandbox on: Solar prime, not Mortgage", async () => {
    const credit = TAB_GROUPS.find((g) => g.id === "credit");
    for (const p of PROFILES) expect(visibleTabs(credit, p).some((t) => t.id === "policy_sandbox")).toBe(p.policySandbox === true);
    expect(solar.policySandbox).toBe(true);
    expect(mortgage.policySandbox).toBe(false);
    render(<CaseExplorer />);
    await userEvent.click(screen.getByTestId("section-credit"));
    expect(screen.getByRole("tab", { name: "Policy Sandbox" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId("portfolio-profile"), "MORTGAGE");
    expect(screen.queryByRole("tab", { name: "Policy Sandbox" })).not.toBeInTheDocument();
  });

  it("builds the pool in the portfolio pass and shows the swap set, KPIs and dealer mix as the engine computes them", async () => {
    const expected = buildPool(SMALL_SOLAR);
    render(<CaseExplorer profileRegistry={REGISTRY} />);
    const view = await openSandbox();
    expect(within(view).queryByTestId("swap-table")).not.toBeInTheDocument();
    await userEvent.click(within(view).getByTestId("sandbox-generate"));
    await screen.findByTestId("swap-table", {}, { timeout: 30000 });

    // The pool is every generated application; the review assumption is stated.
    expect(screen.getByTestId("sandbox-pool")).toHaveTextContent(`Pool: the ${fmt(expected.pool.length)} synthetic applications the baseline needed to fund 300 loans (${fmt(expected.pool.length)} generated, seed 42)`);
    expect(screen.getByTestId("sandbox-review-note")).toHaveTextContent("Review treated as not funded, matching the baseline book.");
    expect(screen.getByTestId("sandbox-strength")).toHaveTextContent(`Loan outcomes are simulated at the profile's default dealer-effect strength, ${dealerSettings(SMALL_SOLAR.defaults.dealerView).dealerEffect.strength}`);
    expect(screen.getByTestId("sandbox-strength")).toHaveTextContent("a strength chosen in the Dealer View does not apply here");
    expect(screen.getByTestId("kpi-approval")).toHaveTextContent(`Approval rate (of the ${fmt(expected.pool.length)}-application pool)`);

    // Candidate starts at the baseline: no swaps, KPIs equal.
    const self = expected.run(CREDIT_POLICY);
    expect(screen.getByTestId("swap-count-swapIn")).toHaveTextContent("0");
    expect(screen.getByTestId("swap-count-swapOut")).toHaveTextContent("0");
    expect(screen.getByTestId("swap-count-keep")).toHaveTextContent(fmt(self.cells.keep.count));
    expect(screen.getByTestId("kpi-el-a")).toHaveTextContent(money(self.totals.A.expectedLoss));
    expect(screen.getByTestId("kpi-el-b")).toHaveTextContent(money(self.totals.A.expectedLoss));

    // Tighten FICO to 680: swap-outs only, matching the engine.
    await userEvent.click(screen.getByTestId("preset-fico680"));
    const fico = expected.run(applyPreset(preset("fico680")));
    await waitFor(() => expect(screen.getByTestId("swap-count-swapOut")).toHaveTextContent(fmt(fico.cells.swapOut.count)));
    expect(fico.cells.swapOut.count).toBeGreaterThan(0);
    expect(screen.getByTestId("swap-count-swapIn")).toHaveTextContent("0");
    expect(screen.getByTestId("kpi-funded-b")).toHaveTextContent(fmt(fico.totals.B.funded));
    expect(screen.getByTestId("kpi-el-b")).toHaveTextContent(money(fico.totals.B.expectedLoss));
    expect(screen.getByTestId("candidate-ficoDecline-value")).toHaveTextContent("680");

    // Tighten the DTI cap to 40%: zero swaps, with the watch-band note.
    await userEvent.click(screen.getByTestId("preset-dti40"));
    await screen.findByTestId("sandbox-watch-note");
    expect(screen.getByTestId("sandbox-watch-note")).toHaveTextContent("the 36% watch threshold, not the decline cap, is what limits volume");
    expect(screen.getByTestId("swap-count-swapIn")).toHaveTextContent("0");
    expect(screen.getByTestId("swap-count-swapOut")).toHaveTextContent("0");
    expect(screen.getByTestId("sandbox-no-swaps")).toHaveTextContent(/No swaps: \d+ applications move between review and decline/);

    // Loosen cap and watch to 50%: swap-ins, then the conservative inferred view raises their expected loss.
    await userEvent.click(screen.getByTestId("preset-dti50"));
    const loose = expected.run(applyPreset(preset("dti50")));
    await waitFor(() => expect(screen.getByTestId("swap-count-swapIn")).toHaveTextContent(fmt(loose.cells.swapIn.count)));
    expect(loose.cells.swapIn.count).toBeGreaterThan(0);
    expect(screen.getByTestId("swap-review-swapIn")).toHaveTextContent(`${fmt(loose.cells.swapIn.reviewA)} came from review`);
    expect(screen.getByTestId("kpi-el-b")).toHaveTextContent(money(loose.totals.B.expectedLoss));
    await userEvent.click(screen.getByTestId("view-inferred"));
    expect(screen.getByTestId("kpi-el-b")).toHaveTextContent(money(loose.totals.B.expectedLossInferred));
    expect(loose.totals.B.expectedLossInferred).toBeGreaterThan(loose.totals.B.expectedLoss);
    expect(screen.getByTestId("swap-el-swapIn")).toHaveTextContent(money(loose.cells.swapIn.expectedLossInferred));

    // Lineage on a figure.
    await userEvent.click(screen.getByTestId("kpi-el-b"));
    expect(screen.getByTestId("lineage")).toHaveTextContent(/Computed: Σ PD × LGD 85% × EAD over funded applications/);
    expect(screen.getByTestId("lineage")).toHaveTextContent("swap-in PD × 1.5, assumption");

    // Dealer mix: ten dealers plus the rest; funded counts add up to the candidate's total.
    const mix = screen.getByTestId("dealer-mix-table");
    const rows = within(mix).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(11);
    expect(rows.at(-1)).toHaveTextContent(/^All other dealers/);
    const fundedB = loose.dealerMix.top.reduce((s, d) => s + d.B.funded, loose.dealerMix.rest.B.funded);
    expect(fundedB).toBe(loose.totals.B.funded);
    expect(screen.getByTestId("panel-dealer-mix")).toHaveTextContent("Dealer ratings depend on who is in the book and are not recomputed under the candidate");

    // Reset returns to the baseline.
    await userEvent.click(screen.getByTestId("preset-reset"));
    await waitFor(() => expect(screen.getByTestId("swap-count-swapIn")).toHaveTextContent("0"));
  }, 60000);

  it("prints a one-page impact summary with every required part", async () => {
    render(<CaseExplorer profileRegistry={REGISTRY} />);
    await openSandbox();
    await userEvent.click(screen.getByTestId("sandbox-generate"));
    await screen.findByTestId("swap-table", {}, { timeout: 30000 });
    await userEvent.click(screen.getByTestId("preset-fico680"));
    await waitFor(() => expect(screen.getByTestId("summary-change")).toHaveTextContent("FICO floor (decline below): 660 → 680"));
    fireEvent.change(screen.getByTestId("summary-why"), { target: { value: "Reduce expected loss rate." } });
    expect(screen.getByTestId("summary-why-text")).toHaveTextContent("Reduce expected loss rate.");
    const summary = screen.getByTestId("sandbox-summary");
    expect(summary).toHaveClass("ce-sandbox-summary");
    expect(within(summary).getByTestId("summary-numbers")).toHaveTextContent(/Approval rate .+ → .+; Funded loans/);
    expect(within(summary).getByTestId("summary-swaps")).toHaveTextContent(/swap-outs .*Review treated as not funded, matching the baseline book\. Swap-in risk shown as synthetic truth/);
    expect(within(summary).getByTestId("summary-mix")).toHaveTextContent(/Mix shifts \(share of funded volume\)/);
    expect(within(summary).getByTestId("summary-fair-lending")).toHaveTextContent("Fair-lending review: out of scope for synthetic data.");
    const pilot = within(summary).getByTestId("summary-pilot");
    expect(pilot).toHaveTextContent("Pilot on 10% of applications; stop if 30+ DPD on swap-ins exceeds [bound] at 6 months on book.");
    expect(pilot).toHaveTextContent("The bound is a placeholder to set before the pilot.");
    fireEvent.change(screen.getByTestId("summary-bound"), { target: { value: "4" } });
    expect(pilot).toHaveTextContent("exceeds 4%");
    expect(within(summary).getByTestId("summary-signoff")).toHaveTextContent(/Prepared by .+ Reviewed by .+ Date/);
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await userEvent.click(screen.getByTestId("sandbox-print"));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("compliance-footer")).toBeInTheDocument();
  }, 60000);
});

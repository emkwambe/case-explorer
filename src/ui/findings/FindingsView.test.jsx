// @vitest-environment jsdom
// Findings tab: shown only for profiles with public-record data, and every figure on it equals the
// value its source module returns, computed here independently of the tab's own model.

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CaseExplorer from "../CaseExplorer.jsx";
import { demoConfig } from "../hooks/useCaseLibrary.js";
import { PROFILES, applyProfile } from "../../profiles/index.js";
import { TAB_GROUPS, visibleTabs } from "../navigation.js";
import { money, pct } from "../theme.js";
import { generateBlendedCase } from "../../generator.js";
import { breakEvenShockBps } from "../../fundingStress.js";
import { buildDealerNetwork, dealerSettings, isFundedLoan, loanInputs, simulateLoans, withDealerEffect, aggregateDealers, simulateDealerFailure } from "../../dealers.js";

// Each test opens on Mortgage and switches profiles itself, as it did when Mortgage was the default.
beforeEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/?profile=mortgage");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
});

const openFindings = async () => {
  await userEvent.click(screen.getByTestId("section-credit"));
  await userEvent.click(screen.getByRole("tab", { name: "Findings" }));
  return screen.findByTestId("findings-view", {}, { timeout: 10000 });
};

const solar = PROFILES.find((p) => p.id === "SOLAR_PRIME");
// A small funded book keeps the test fast; everything else is the real profile.
const SMALL_SOLAR = Object.freeze({
  ...solar,
  defaults: { ...solar.defaults, dealerView: { ...solar.defaults.dealerView, portfolio: { count: 300, seed: 42 } } }
});

/** The funded book exactly as the Dealer View builds it: seed-ordered applications the policy approves. */
function fundedBook(profile) {
  const settings = dealerSettings(profile.defaults.dealerView);
  const dealers = buildDealerNetwork(settings.network);
  const config = applyProfile(demoConfig, profile);
  const inputs = [];
  for (let i = 0; inputs.length < settings.portfolio.count; i++) {
    const c = generateBlendedCase(i, config, settings.portfolio.seed);
    if (isFundedLoan(c, profile)) inputs.push(loanInputs(c, settings.loanAmount, profile));
  }
  return { inputs, dealers, settings };
}

describe("Findings tab", () => {
  it("is shown only for profiles with public-record data, never under Mortgage", async () => {
    const credit = TAB_GROUPS.find((g) => g.id === "credit");
    for (const p of PROFILES) expect(visibleTabs(credit, p).some((t) => t.id === "findings")).toBe(Boolean(p.publicRecord));
    expect(visibleTabs(credit, PROFILES.find((p) => p.id === "MORTGAGE")).map((t) => t.id)).not.toContain("findings");

    render(<CaseExplorer />);
    await userEvent.click(screen.getByTestId("section-credit"));
    expect(screen.queryByRole("tab", { name: "Findings" })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId("portfolio-profile"), "SOLAR_PRIME");
    expect(screen.getByRole("tab", { name: "Findings" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId("portfolio-profile"), "MORTGAGE");
    expect(screen.queryByRole("tab", { name: "Findings" })).not.toBeInTheDocument();
  });

  it("shows every figure exactly as its source module computes it", async () => {
    const record = await solar.publicRecord.load();
    const { unitEconomics, liquidityRunway } = record.analyses;
    render(<CaseExplorer profileRegistry={[PROFILES.find((p) => p.id === "MORTGAGE"), SMALL_SOLAR]} />);
    await userEvent.selectOptions(screen.getByTestId("portfolio-profile"), "SOLAR_PRIME");
    const view = await openFindings();
    for (const id of ["findings-question", "findings-data", "findings-method", "findings-findings", "findings-limits", "findings-f1", "findings-f2", "findings-f3"]) {
      expect(within(view).getByTestId(id)).toBeInTheDocument();
    }

    // Question: the profile's FICO benchmark.
    const fico = solar.benchmarks.find((b) => b.id === "avg_fico_financed").value;
    expect(screen.getByTestId("findings-question-text")).toHaveTextContent(`averaged a ${fico} FICO`);

    // Data: counts from the snapshot.
    const data = screen.getByTestId("findings-data");
    expect(data).toHaveTextContent(`${record.quarterly.eda.manual.rows} manual extractions`);
    expect(data).toHaveTextContent(`${record.quarterly.gaps.length + record.declaredGaps.length} gaps`);

    // Finding 1: take rate, correlation with n, and the break-even shock at the profile defaults.
    const ue = unitEconomics(record.quarterly.quarters);
    const rated = ue.quarters.filter((q) => q.takeRate);
    expect(screen.getByTestId("findings-take-rate-first")).toHaveTextContent(`${(rated[0].takeRate.value * 100).toFixed(2)}%`);
    expect(screen.getByTestId("findings-take-rate-last")).toHaveTextContent(`${(rated.at(-1).takeRate.value * 100).toFixed(2)}%`);
    expect(screen.getByTestId("findings-correlation-value")).toHaveTextContent(ue.correlation.value.toFixed(2));
    expect(screen.getByTestId("findings-correlation-n")).toHaveTextContent(String(ue.correlation.n));
    expect(screen.getByTestId("findings-correlation")).toHaveTextContent(/not causal/);
    const d = solar.defaults.fundingRates;
    const breakEven = breakEvenShockBps({ dealerFeePct: d.dealerFeePct.value, coupon: d.coupon.value, termYears: d.termYears.value, yieldAtApproval: d.investorYieldAtApproval.value, cpr: d.cpr.value });
    expect(screen.getByTestId("findings-break-even")).toHaveTextContent(`${breakEven.toFixed(1)} bps`);
    // Two stacked panels on one quarter axis: a clickable point per quarter with a value.
    expect(screen.getAllByTestId("findings-chart-take-rate-point")).toHaveLength(rated.length);
    expect(screen.getAllByTestId("findings-chart-fed-funds-point")).toHaveLength(ue.quarters.filter((q) => q.fedFunds).length);

    // Lineage on a figure, and no request to SEC or FRED.
    await userEvent.click(screen.getByTestId("findings-break-even"));
    expect(screen.getByTestId("lineage")).toHaveTextContent(/breakEvenShockBps at the profile's Funding & Rates defaults/);
    const urls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => /sec\.gov|stlouisfed\.org/.test(u))).toEqual([]);

    // Finding 3: the last computable runway and the months to the Chapter 11 filing.
    const runway = liquidityRunway(record.quarterly.quarters);
    const last = runway.filter((r) => r.status === "ok").at(-1);
    expect(screen.getByTestId("findings-runway-months")).toHaveTextContent(`${last.runwayMonths.toFixed(1)} months`);
    const event = record.events.find((e) => e.id === "chapter-11");
    expect(screen.getByTestId("findings-event-date")).toHaveTextContent(event.dateLabel);
    const [y, q] = [Number(last.quarter.slice(0, 4)), Number(last.quarter.slice(5))];
    const months = (Date.parse(event.date) - Date.UTC(y, q * 3, 0)) / ((365.25 / 12) * 86_400_000);
    expect(screen.getByTestId("findings-months-to-event")).toHaveTextContent(months.toFixed(1));

    // Finding 2: no numbers until the shared portfolio exists; then the Dealer View's own figures.
    expect(screen.queryByTestId("findings-dealer-table")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Generate portfolio (seed 42)" }));
    const table = await screen.findByTestId("findings-dealer-table", {}, { timeout: 30000 });

    const book = fundedBook(SMALL_SOLAR);
    const s = withDealerEffect(book.settings, book.settings.dealerEffect.strength);
    const loans = simulateLoans(book.inputs, book.dealers, s);
    const rows = aggregateDealers(loans, book.dealers, s);
    const largest = rows.reduce((a, b) => (b.advanceBalance > a.advanceBalance ? b : a));
    const totalAdvances = rows.reduce((t, r) => t + r.advanceBalance, 0);
    const red = rows.filter((r) => r.rating === "RED");
    const failure = simulateDealerFailure({ loans, dealers: book.dealers }, largest.dealerId, s.dealerFailure);
    expect(screen.getByTestId("findings-f2")).toHaveAttribute("data-largest-advance-dealer", largest.dealerId);
    expect(screen.getByTestId("findings-largest-dealer")).toHaveTextContent(largest.dealer);
    expect(screen.getByTestId("findings-largest-advance")).toHaveTextContent(money(largest.advanceBalance));
    expect(screen.getByTestId("findings-largest-advance-share")).toHaveTextContent(pct(largest.advanceBalance / totalAdvances));
    expect(screen.getByTestId("findings-largest-dpd")).toHaveTextContent(pct(largest.dpd30Rate, 2));
    expect(screen.getByTestId("findings-portfolio-rate")).toHaveTextContent(pct(largest.portfolioDpd30Rate, 2));
    expect(screen.getByTestId("findings-failure-delta")).toHaveTextContent(money(failure.deltaExpectedLoss));
    expect(screen.getByTestId("findings-failure-writeoff")).toHaveTextContent(money(failure.advanceWriteOff));
    expect(screen.getByTestId("findings-baseline-el")).toHaveTextContent(money(failure.baselineExpectedLoss));
    expect(screen.getByTestId("findings-red-count")).toHaveTextContent(String(red.length));
    const expectedRows = new Set([largest.dealerId, ...red.map((r) => r.dealerId)]);
    expect(within(table).getAllByRole("row")).toHaveLength(1 + expectedRows.size);
    for (const id of expectedRows) {
      const r = rows.find((x) => x.dealerId === id);
      expect(within(screen.getByTestId(`findings-row-${id}`)).getByText(pct(r.dpd30Rate, 2))).toBeInTheDocument();
    }
    expect(screen.getByTestId("compliance-footer")).toBeInTheDocument();
  }, 60000);

  it("opens the evidence tab from a finding", async () => {
    render(<CaseExplorer />);
    await userEvent.selectOptions(screen.getByTestId("portfolio-profile"), "SOLAR_PRIME");
    await openFindings();
    await userEvent.click(within(screen.getByTestId("findings-f2")).getByTestId("findings-open-dealers"));
    expect(screen.getByRole("tab", { name: "Dealer View" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("dealer-view")).toBeInTheDocument();
  });
});

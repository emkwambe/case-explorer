// @vitest-environment jsdom
// The Explanation tab's model panel: the mortgage suite's fraud model, labelled as such, with
// non-zero feature importances read from the committed model snapshot; and the library's card labels.

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import SUMMARY from "../../../artifacts/model-snapshot/model-summary.json";
import { ExplanationTab } from "./decisionTabs.jsx";
import { importanceRows } from "./importance.js";
import { cardLabels } from "../components/cardLabels.js";
import { buildInitialCases, demoConfig, openingTwin } from "../hooks/useCaseLibrary.js";
import { applyProfile, getProfile } from "../../profiles/index.js";
import { scoreCase } from "../../decisioning/index.js";

beforeEach(() => {
  cleanup();
  vi.stubGlobal("fetch", vi.fn((url) => (String(url).endsWith("model-summary.json") ? Promise.resolve({ ok: true, json: () => Promise.resolve(SUMMARY) }) : Promise.resolve({ ok: false, status: 404 }))));
});

describe("Explanation tab: the fraud model's importances", () => {
  it("reads permutation and native importance from the snapshot's rows, all non-zero for the top features", () => {
    const rows = importanceRows(SUMMARY.explainability.global_importance);
    expect(rows.length).toBe(SUMMARY.explainability.global_importance.length);
    for (const r of rows.slice(0, 12)) {
      expect(r.permutation).not.toBeNull();
      expect(r.native).not.toBeNull();
    }
    expect(rows.slice(0, 12).some((r) => r.permutation > 0)).toBe(true);
    expect(rows.slice(0, 12).every((r) => r.native > 0)).toBe(true);
  });

  it("renders non-zero importances and labels the panel as the mortgage fraud model, not the credit PD model", async () => {
    const solar = getProfile("SOLAR_PRIME");
    const c = buildInitialCases(applyProfile(demoConfig, solar), solar.openingLibrary)[0];
    render(<ExplanationTab scored={scoreCase(c, applyProfile(demoConfig, solar), { now: "static" })} />);
    const rows = await screen.findAllByTestId("importance-row");
    expect(rows.length).toBe(12);
    const values = rows.map((r) => Number(r.children[2].textContent));
    expect(values.every((v) => v > 0)).toBe(true);
    expect(screen.getByText(/Fraud model from the original mortgage suite/)).toBeInTheDocument();
    expect(screen.getByTestId("fraud-model-note").textContent).toContain("Near-perfect scores are by construction: in this simulation, discrepancies occur only on fraud cases.");
    expect(screen.getByTestId("fraud-model-note").textContent).toContain("not the Solar credit PD model");
  });
});

describe("library card labels", () => {
  it("tell repeated names apart with a short case number, and leave unique names alone", () => {
    const solar = getProfile("SOLAR_PRIME");
    const cases = [...buildInitialCases(applyProfile(demoConfig, solar), solar.openingLibrary), openingTwin(solar, "clean")];
    const labels = cardLabels(cases);
    expect(new Set(cases.map((c) => labels.get(c.id))).size).toBe(cases.length);
    const counts = cases.reduce((m, c) => m.set(c.applicant.name, (m.get(c.applicant.name) ?? 0) + 1), new Map());
    for (const c of cases) {
      if (counts.get(c.applicant.name) === 1) expect(labels.get(c.id)).toBe(c.applicant.name);
      else expect(labels.get(c.id)).toMatch(new RegExp(`^${c.applicant.name} · #\\d+`));
    }
  });
});

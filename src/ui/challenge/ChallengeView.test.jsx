// @vitest-environment jsdom
// Challenge mode: blindness on every teaching case, the reveal, browser progress (including without
// storage), focus and an automated accessibility check.

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import DATA from "../../challenge/challenge-data.json";
import CONFIG from "../../distribution_config.json";
import ChallengeView, { BlindCase, AttemptForm, Reveal, TwinCompare } from "./ChallengeView.jsx";
import { teachingContext, buildTeachingCase } from "../../challenge/teachingCases.js";
import { scoreAttempt } from "../../challenge/score.js";
import { keyEvidence } from "../../challenge/evidence.js";
import { REASON_CODES } from "../../challenge/reasonCodes.js";
import { GAP_KIND_TEXT } from "../../challenge/gaps.js";
import { createProgressStore, summarize, STORAGE_KEY } from "../../challenge/progress.js";
import { ActiveProfileProvider } from "../../profiles/activeProfile.js";
import { REFERENCE_LABEL } from "../theme.js";
import CaseExplorer from "../CaseExplorer.jsx";

const ctx = teachingContext(DATA, CONFIG);
const built = new Map(DATA.cases.map((e) => [e.id, buildTeachingCase(e, DATA, ctx)]));
const solar = (ui) => <ActiveProfileProvider initialProfileId="SOLAR_PRIME">{ui}</ActiveProfileProvider>;

function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] };
}
const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };

beforeEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/?profile=solar-prime");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
});

const TYPOLOGY_WORDS = ["CONCEALMENT", "INFLATION", "EVIDENCE_TAMPERING", "FABRICATION", "Concealment", "Inflation", "Evidence Tampering", "Fabrication"];

describe("the blind view", () => {
  it("shows none of the answer on any of the 79 teaching cases", () => {
    for (const e of DATA.cases) {
      const { container, unmount } = render(solar(<BlindCase caseObj={built.get(e.id)} />));
      const text = container.textContent;
      const forbidden = [
        REFERENCE_LABEL, e.id, e.base.case_id, "/clean", "/fraud", e.key_fact.field, DATA.rubric[e.expected.rubric], "Fidelity", "Holds the deciding value",
        ...TYPOLOGY_WORDS, ...REASON_CODES, ...e.system.fraud_rules.map((r) => r.split(":")[0]), "APPROVE", "DECLINE", "MANUAL_REVIEW",
        ...(e.gap ? [e.gap.reason] : [])
      ];
      for (const f of forbidden) expect(text.includes(f), `${e.id}: blind view contains "${f}"`).toBe(false);
      expect(text).toMatch(/Application as submitted/);
      unmount();
    }
  }, 120_000);

  it("offers the same attempt form on every case, apart from the documents the case has", () => {
    const strip = (html) => html.replace(/<fieldset[^>]*>\s*<legend[^>]*>3\. Strongest evidence[\s\S]*?<\/fieldset>/, "");
    const forms = new Set();
    for (const e of DATA.cases) {
      const { container, unmount } = render(solar(<AttemptForm caseObj={built.get(e.id)} onCommit={() => {}} />));
      forms.add(strip(container.innerHTML));
      unmount();
    }
    expect(forms.size).toBe(1);
  }, 120_000);

  it("the worksheet starts from the stated figures and recomputes when the debts change", async () => {
    const c = built.get("concealment-1/fraud");
    render(solar(<BlindCase caseObj={c} />));
    const before = screen.getByTestId("worksheet-result").textContent;
    const debts = screen.getByTestId("worksheet-debts");
    await userEvent.clear(debts);
    await userEvent.type(debts, "5000");
    expect(screen.getByTestId("worksheet-result").textContent).not.toBe(before);
  });
});

describe("the reveal", () => {
  it("shows the teaching answer, rationale and key fact on every case, and the engine's answer on gap cases", () => {
    for (const e of DATA.cases) {
      const attempt = { decision: "REVIEW", reasonCodes: [], evidence: "supports" };
      const { container, unmount } = render(solar(<Reveal entry={e} caseObj={built.get(e.id)} attempt={attempt} score={scoreAttempt(e, attempt)} headingRef={{ current: null }} twin={null} />));
      const text = container.textContent;
      expect(text).toContain(DATA.rubric[e.expected.rubric]);
      expect(text).toContain(e.key_fact.field);
      for (const code of e.expected.reason_codes) expect(text).toContain(code);
      if (e.gap) {
        const box = within(container).getByTestId("challenge-gap");
        expect(box.textContent).toContain(e.gap.reason);
        expect(within(box).getByTestId("challenge-gap-kind").textContent).toBe(GAP_KIND_TEXT[e.gap.gap_kind]);
      }
      else expect(within(container).queryByTestId("challenge-gap")).toBeNull();
      unmount();
    }
  }, 120_000);

  it("opens the normal case views for exploring after the reveal (one case from each group)", () => {
    for (const id of ["concealment-1/fraud", "near/fico-659-b1", "conflict/material-b1", "thin/credit-bureau-b1"]) {
      const e = DATA.cases.find((x) => x.id === id);
      const attempt = { decision: "REVIEW", reasonCodes: [], evidence: "supports" };
      const { container, unmount } = render(solar(<Reveal entry={e} caseObj={built.get(id)} attempt={attempt} score={scoreAttempt(e, attempt)} headingRef={{ current: null }} twin={null} exploreOpen />));
      const explore = within(container).getByTestId("challenge-explore");
      expect(explore.textContent).toContain(REFERENCE_LABEL);
      expect(within(explore).getByTestId("panel-try-a-change")).toBeInTheDocument();
      unmount();
    }
  }, 60_000);

  it("puts the twins side by side with only the changed fields", () => {
    render(solar(<TwinCompare clean={built.get("concealment-1/clean")} fraud={built.get("concealment-1/fraud")} />));
    const rows = within(screen.getByTestId("challenge-twins")).getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => /Credit Bureau/.test(r.textContent))).toBe(true);
    expect(rows.some((r) => /Stated annual income/.test(r.textContent))).toBe(false);
  });
});

async function answerCurrentCase(store, choose) {
  const session = store.load().sessions.at(-1);
  const id = session.order[session.position];
  const e = DATA.cases.find((x) => x.id === id);
  const a = choose(e);
  const form = screen.getByTestId("challenge-attempt");
  await userEvent.click(within(form).getByLabelText({ APPROVE: "Approve", REVIEW: "Review", DECLINE: "Decline" }[a.decision]));
  for (const c of a.reasonCodes) await userEvent.click(within(form).getByRole("checkbox", { name: new RegExp(`^${c}:`) }));
  await userEvent.click(within(form).getAllByRole("radio").find((r) => r.value === a.evidence));
  await userEvent.click(screen.getByTestId("challenge-commit"));
  return e;
}

describe("a session", () => {
  it("commits blind, reveals the score, moves focus, and stores the attempt with the teaching SHA", async () => {
    const storage = memoryStorage();
    const store = createProgressStore(storage);
    render(<ChallengeView store={store} />);
    await userEvent.click(screen.getByTestId("start-first-week"));
    expect(screen.getByTestId("challenge-case-label").textContent).toMatch(/^Case 1 of 18 · [A-Z2-9]{4}$/);
    expect(screen.queryByTestId("challenge-reveal")).toBeNull();
    const e = await answerCurrentCase(store, (x) => ({ decision: x.expected.decision, reasonCodes: x.expected.reason_codes, evidence: keyEvidence(x)[0] }));
    const reveal = await screen.findByTestId("challenge-reveal");
    expect(within(reveal).getByRole("heading", { level: 3, name: /^Score: 100 of 100, passed/ })).toHaveFocus();
    const stored = JSON.parse(storage.getItem(STORAGE_KEY));
    expect(stored.attempts).toHaveLength(1);
    expect(stored.attempts[0]).toMatchObject({ caseId: e.id, pack: "first-week", teachingSha: DATA.teaching_sha256, score: { total: 100, passed: true } });
    expect(JSON.stringify(stored)).not.toMatch(/@|name/i);
    await userEvent.click(screen.getByTestId("challenge-next"));
    expect(screen.getByTestId("challenge-case-label")).toHaveFocus();
    expect(screen.getByTestId("challenge-case-label").textContent).toMatch(/^Case 2 of 18/);
  });

  it("works with storage that throws: the mode runs, says progress is not saved, and scores the attempt", async () => {
    const store = createProgressStore(throwing);
    render(<ChallengeView store={store} />);
    expect(screen.getByTestId("challenge-no-storage")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("start-on-the-line"));
    await answerCurrentCase(store, () => ({ decision: "APPROVE", reasonCodes: [], evidence: "supports" }));
    expect(await screen.findByTestId("challenge-reveal")).toBeInTheDocument();
    expect(store.available).toBe(false);
  });
});

describe("browser progress", () => {
  const attempt = (sha, caseId, total) => ({ teachingSha: sha, caseId, pack: "full-set", session: "s", at: "2026-10-24T00:00:00Z", answer: { decision: "APPROVE", reasonCodes: [], evidence: "supports" }, score: { total, passed: total >= 70, decisionCorrect: true } });

  it("keeps attempts made against an earlier teaching SHA but leaves them out of current scores", () => {
    const store = createProgressStore(memoryStorage());
    store.addAttempt(attempt("0000old", "concealment-1/clean", 100));
    store.addAttempt(attempt(DATA.teaching_sha256, "concealment-2/clean", 40));
    const s = summarize(store.load(), DATA);
    expect(s.earlierCount).toBe(1);
    expect(s.tiers.easy).toMatchObject({ attempted: 1, passed: 0, meanScore: 40 });
    render(<ChallengeView store={store} />);
    expect(screen.getByTestId("challenge-progress").textContent).toMatch(/1 attempt was answered against an earlier key/);
  });

  it("reset deletes only Case Explorer's challenge key, after a confirmation that names it", async () => {
    const storage = memoryStorage({ "another-app": "keep me" });
    const store = createProgressStore(storage);
    store.addAttempt(attempt(DATA.teaching_sha256, "concealment-1/clean", 100));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ChallengeView store={store} />);
    await userEvent.click(screen.getByTestId("challenge-reset"));
    expect(confirm.mock.calls[0][0]).toContain(STORAGE_KEY);
    expect(storage.keys()).toEqual(["another-app"]);
    confirm.mockRestore();
  });

  it("the gap pack's card counts decision gaps and reasons gaps; other packs show no such line", () => {
    render(<ChallengeView store={createProgressStore(memoryStorage())} />);
    expect(screen.getByTestId("gap-kinds-engine-limits").textContent).toBe("8 where the decision differs, 7 where only the reasons differ.");
    expect(screen.queryByTestId("gap-kinds-full-set")).toBeNull();
  });

  it("lists the codes most often missed", () => {
    const store = createProgressStore(memoryStorage());
    store.addAttempt({ ...attempt(DATA.teaching_sha256, "near/checking-999-b1", 85), pack: "on-the-line", answer: { decision: "REVIEW", reasonCodes: ["ELEVATED_DTI"], evidence: "application.checking" } });
    render(<ChallengeView store={store} />);
    expect(screen.getByTestId("challenge-missed").textContent).toContain("LIQUIDITY_RISK (1)");
  });
});

describe("accessibility (axe-core, WCAG 2.1 A/AA rules; colour contrast is checked in colors.test.js)", () => {
  const run = async (node) => (await axe.run(node, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, rules: { "color-contrast": { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes.length}`);

  it("the pack list, a blind case with its form, and the reveal have no violations", async () => {
    const store = createProgressStore(memoryStorage());
    const { container } = render(<ChallengeView store={store} />);
    expect(await run(container)).toEqual([]);
    await userEvent.click(screen.getByTestId("start-judgment-calls"));
    expect(await run(container)).toEqual([]);
    await answerCurrentCase(store, (x) => ({ decision: "REVIEW", reasonCodes: ["MISSING_DOCUMENT"], evidence: keyEvidence(x)[0] }));
    await screen.findByTestId("challenge-reveal");
    expect(await run(container)).toEqual([]);
  });
});

describe("the shell gate", () => {
  it("challenge mode replaces the case views, library and Credit Risk Mode; leaving restores them", async () => {
    render(<CaseExplorer />);
    expect(screen.getByTestId("case-list")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("challenge-mode"));
    await waitFor(() => expect(screen.getByTestId("challenge-view")).toBeInTheDocument());
    for (const id of ["case-list", "section-control", "credit-risk-mode", "header-counts", "start-tour", "portfolio-profile"]) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    await userEvent.click(screen.getByTestId("challenge-leave"));
    expect(screen.getByTestId("case-list")).toBeInTheDocument();
    expect(screen.queryByTestId("challenge-view")).toBeNull();
  });
});

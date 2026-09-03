// Outcome-grounded evaluation replaces agreement with the generator's own label. These
// tests check the arithmetic and, more importantly, that the measure can tell a good policy
// from a bad one, which agreement never could.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateBlendedCase, generateCase } from "../../generator.js";
import { evaluateOutcomes, ordinalAuc, DEFAULT_VALUE_ASSUMPTIONS } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "distribution_config.json"), "utf8"));
CONFIG.generation = { as_of_date: "2026-01-15" };

const POP = Array.from({ length: 900 }, (_, i) => generateBlendedCase(i, CONFIG, "outcome-eval"));
const STRESS = ["BUST_OUT", "STRAW_BUYER", "FABRICATION"].flatMap((t) =>
  Array.from({ length: 40 }, (_, i) => generateCase(i, CONFIG, t, "HIGH", `oe-${t}-${i}`)));

describe("ordinalAuc", () => {
  it("scores perfect, inverted and uninformative rankings correctly", () => {
    expect(ordinalAuc([0, 0, 1, 1], [0, 0, 1, 1])).toBe(1);
    expect(ordinalAuc([1, 1, 0, 0], [0, 0, 1, 1])).toBe(0);
    expect(ordinalAuc([1, 1, 1, 1], [0, 0, 1, 1])).toBe(0.5);
  });
  it("handles partial ties the way a rank-sum should", () => {
    // One positive above both negatives, one tied with them.
    expect(ordinalAuc([2, 1, 1, 1], [1, 1, 0, 0])).toBeCloseTo(0.75, 6);
  });
  it("returns null when one class is absent", () => {
    expect(ordinalAuc([1, 2, 3], [0, 0, 0])).toBeNull();
    expect(ordinalAuc([1, 2, 3], [1, 1, 1])).toBeNull();
  });
  it("agrees with a brute-force pair count on random data", () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const scores = Array.from({ length: 120 }, () => Math.floor(rnd() * 3));
    const labels = Array.from({ length: 120 }, () => (rnd() < 0.3 ? 1 : 0));
    const pos = scores.filter((_, i) => labels[i]);
    const neg = scores.filter((_, i) => !labels[i]);
    let conc = 0, ties = 0;
    for (const a of pos) for (const b of neg) { if (a > b) conc++; else if (a === b) ties++; }
    expect(ordinalAuc(scores, labels)).toBeCloseTo((conc + 0.5 * ties) / (pos.length * neg.length), 9);
  });
});

describe("evaluateOutcomes", () => {
  const r = evaluateOutcomes([...POP, ...STRESS], CONFIG, { portfolioIds: new Set(POP.map((c) => c.id)) });

  it("grades the policy against performance, not against another policy", () => {
    expect(r.policy.discrimination_auc).toBeGreaterThan(0.6);
    expect(r.policy.risk_separation).toBeGreaterThan(0.5);
    expect(r.policy.approved_bad_rate).toBeLessThan(r.population.bad_rate);
    // Reference agreement is reported but must not be the thing being graded.
    expect(r.reference_label_agreement).not.toBeNull();
  });

  it("keeps the outcome shares internally consistent", () => {
    const p = r.policy;
    // Each rate is reported rounded to four places, so the sum is checked at that precision.
    expect(p.approval_rate + p.manual_review_rate + p.decline_rate).toBeCloseTo(1, 3);
    const counts = ["APPROVE", "MANUAL_REVIEW", "DECLINE"].map((o) => r.rows.filter((x) => x.policy_outcome === o).length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(r.n);
    expect(r.population.defaults).toBe(r.rows.filter((x) => x.defaulted).length);
    expect(r.population.bad_rate).toBeCloseTo(r.population.defaults / r.n, 4);
  });

  it("computes portfolio value on the representative book only", () => {
    expect(r.value.book_size).toBe(POP.length);
    expect(r.value.approve_all.funded).toBe(POP.length);
    expect(r.value.decline_all.net_value).toBe(0);
    expect(r.value.decline_all.funded).toBe(0);
    // The oracle funds every loan that performs, so it is the ceiling.
    expect(r.value.oracle.net_value).toBeGreaterThanOrEqual(r.value.policy.net_value);
    expect(r.value.oracle.net_value).toBeGreaterThanOrEqual(r.value.approve_all.net_value);
    expect(r.value.oracle.loss_incurred).toBe(0);
    const v = r.value.policy;
    expect(v.net_value).toBe(v.margin_earned - v.loss_incurred - v.origination_cost - v.review_cost);
  });

  it("surfaces the cost of declining applicants who would have paid", () => {
    expect(r.policy.false_decline_rate).toBeGreaterThan(0);
    expect(r.value.foregone_margin_on_good_declines).toBeGreaterThan(0);
    expect(r.value.net_cost_of_conservatism).toBe(r.value.approve_all.net_value - r.value.policy.net_value);
  });

  it("distinguishes a good policy from a bad one, which label agreement could not", () => {
    // A policy that approves everything has no risk separation and no discrimination.
    const approveAll = evaluateOutcomes(POP, { ...CONFIG, underwriting: {
      dti: { approve_max: 99, manual_review_max: 99 },
      credit_score: { approve_min: 0, manual_review_min: 0 },
      reserves: { approve_min_months: 0, manual_review_min_months: 0 },
      tenure: { approve_min_months: 0, manual_review_min_months: 0 }
    } });
    expect(approveAll.policy.approval_rate).toBeGreaterThan(r.policy.approval_rate);
    expect(approveAll.policy.risk_separation).toBeLessThan(r.policy.risk_separation);
    expect(approveAll.policy.approved_bad_rate).toBeGreaterThan(r.policy.approved_bad_rate);
  });

  it("uses the stated value assumptions and lets them be overridden", () => {
    expect(r.value_assumptions.margin_on_performing).toBe(DEFAULT_VALUE_ASSUMPTIONS.margin_on_performing);
    const richer = evaluateOutcomes(POP, CONFIG, { assumptions: { margin_on_performing: 0.06 } });
    expect(richer.value.approve_all.margin_earned).toBeGreaterThan(
      evaluateOutcomes(POP, CONFIG).value.approve_all.margin_earned);
  });

  it("slices outcomes by typology and regime", () => {
    const byType = Object.fromEntries(r.by_fraud_type.map((x) => [x.key, x]));
    expect(byType.NONE.bad_rate).toBeLessThan(byType.BUST_OUT.bad_rate);
    expect(r.by_regime.length).toBeGreaterThan(1);
    for (const g of [...r.by_fraud_type, ...r.by_regime]) {
      expect(g.n).toBeGreaterThan(0);
      expect(g.bad_rate).toBeGreaterThanOrEqual(0);
      expect(g.bad_rate).toBeLessThanOrEqual(1);
    }
  });
});

// Mutation testing showed the suite above accepted many silently wrong arithmetic changes.
// Every figure the module reports is now recomputed independently from the rows it returns,
// so an altered formula fails rather than passing unnoticed.
describe("every reported figure is recomputed independently", () => {
  const r = evaluateOutcomes([...POP, ...STRESS], CONFIG, { portfolioIds: new Set(POP.map((c) => c.id)) });
  const rows = r.rows;
  const where = (o) => rows.filter((x) => x.policy_outcome === o);
  const badRate = (set) => (set.length ? set.filter((x) => x.defaulted).length / set.length : 0);
  const close = (actual, expected) => expect(actual).toBeCloseTo(expected, 4);

  it("recomputes the population block", () => {
    const defaults = rows.filter((x) => x.defaulted);
    expect(r.n).toBe(rows.length);
    expect(r.population.defaults).toBe(defaults.length);
    close(r.population.bad_rate, defaults.length / rows.length);
    expect(r.population.total_loss).toBe(Math.round(defaults.reduce((s, x) => s + x.realized_loss, 0)));
    close(r.population.mean_loss_given_default,
      defaults.reduce((s, x) => s + x.realized_loss / Math.max(1, x.loan_amount), 0) / defaults.length);
    expect(r.population.first_payment_defaults).toBe(rows.filter((x) => x.first_payment_default).length);
  });

  it("recomputes every policy rate, including the review and decline pools", () => {
    close(r.policy.approval_rate, where("APPROVE").length / rows.length);
    close(r.policy.manual_review_rate, where("MANUAL_REVIEW").length / rows.length);
    close(r.policy.decline_rate, where("DECLINE").length / rows.length);
    close(r.policy.approved_bad_rate, badRate(where("APPROVE")));
    close(r.policy.reviewed_bad_rate, badRate(where("MANUAL_REVIEW")));
    close(r.policy.declined_bad_rate, badRate(where("DECLINE")));
    close(r.policy.risk_separation, 1 - badRate(where("APPROVE")) / r.population.bad_rate);
    const notApproved = rows.filter((x) => x.policy_outcome !== "APPROVE");
    close(r.policy.false_decline_rate, notApproved.filter((x) => !x.defaulted).length / notApproved.length);
    close(r.policy.decline_only_false_rate, where("DECLINE").filter((x) => !x.defaulted).length / where("DECLINE").length);
    close(r.policy.discrimination_auc, ordinalAuc(rows.map((x) => x.severity), rows.map((x) => x.defaulted)));
  });

  it("recomputes each portfolio strategy line item", () => {
    const v = r.value_assumptions;
    const book = rows.filter((x) => POP.some((c) => c.id === x.case_id));
    const line = (funded, reviewedCount) => ({
      funded: funded.length,
      margin_earned: Math.round(funded.filter((x) => !x.defaulted).reduce((s, x) => s + x.loan_amount * v.margin_on_performing, 0)),
      loss_incurred: Math.round(funded.reduce((s, x) => s + x.realized_loss, 0)),
      origination_cost: Math.round(funded.length * v.origination_cost),
      review_cost: Math.round(reviewedCount * v.manual_review_cost)
    });
    const bookApproved = book.filter((x) => x.policy_outcome === "APPROVE");
    const bookReviewed = book.filter((x) => x.policy_outcome === "MANUAL_REVIEW");
    const expected = line(bookApproved, bookReviewed.length);
    for (const k of Object.keys(expected)) expect(r.value.policy[k], `policy.${k}`).toBe(expected[k]);
    expect(r.value.policy.net_value).toBe(expected.margin_earned - expected.loss_incurred - expected.origination_cost - expected.review_cost);

    const all = line(book, 0);
    for (const k of Object.keys(all)) expect(r.value.approve_all[k], `approve_all.${k}`).toBe(all[k]);
    const perf = line(book.filter((x) => !x.defaulted), 0);
    for (const k of Object.keys(perf)) expect(r.value.oracle[k], `oracle.${k}`).toBe(perf[k]);

    close(r.value.capture_of_ceiling, r.value.policy.net_value / r.value.oracle.net_value);
    expect(r.value.book_size).toBe(book.length);
    close(r.value.book_bad_rate, badRate(book));
    const bookNotApproved = book.filter((x) => x.policy_outcome !== "APPROVE");
    expect(r.value.foregone_margin_on_good_declines).toBe(Math.round(
      bookNotApproved.filter((x) => !x.defaulted).reduce((s, x) => s + x.loan_amount * v.margin_on_performing - v.origination_cost, 0)));
    expect(r.value.loss_avoided_on_declines).toBe(Math.round(bookNotApproved.reduce((s, x) => s + x.realized_loss, 0)));
    expect(r.value.beats_approve_all).toBe(r.value.policy.net_value > r.value.approve_all.net_value);
    expect(r.value.beats_decline_all).toBe(r.value.policy.net_value > 0);
  });

  it("recomputes each slice group", () => {
    for (const [slice, keyOf] of [[r.by_fraud_type, (x) => x.fraud_type], [r.by_regime, (x) => x.regime ?? "UNKNOWN"]]) {
      expect(slice.reduce((s, g) => s + g.n, 0)).toBe(rows.length);
      for (const g of slice) {
        const members = rows.filter((x) => keyOf(x) === g.key);
        const approvedMembers = members.filter((x) => x.policy_outcome === "APPROVE");
        expect(g.n, `${g.key}.n`).toBe(members.length);
        expect(g.defaults, `${g.key}.defaults`).toBe(members.filter((x) => x.defaulted).length);
        expect(g.approved, `${g.key}.approved`).toBe(approvedMembers.length);
        expect(g.approved_defaults).toBe(approvedMembers.filter((x) => x.defaulted).length);
        close(g.bad_rate, members.filter((x) => x.defaulted).length / members.length);
        close(g.approval_rate, approvedMembers.length / members.length);
        expect(g.mean_loss).toBe(Math.round(members.reduce((s, x) => s + x.realized_loss, 0) / members.length));
        if (approvedMembers.length === 0) expect(g.approved_bad_rate).toBeNull();
        else close(g.approved_bad_rate, approvedMembers.filter((x) => x.defaulted).length / approvedMembers.length);
      }
    }
  });

  it("recomputes the reference-label diagnostic and marks the book scope", () => {
    const withRef = rows.filter((x) => x.reference_label);
    close(r.reference_label_agreement, withRef.filter((x) => x.reference_label === x.policy_outcome).length / withRef.length);
    expect(r.value.book_note).toMatch(/blended population only/);
    expect(evaluateOutcomes(POP, CONFIG).value.book_note).toMatch(/every scored case/);
  });

  it("carries the fields each row is supposed to carry", () => {
    for (const row of rows.slice(0, 25)) {
      const c = [...POP, ...STRESS].find((x) => x.id === row.case_id);
      expect(row.defaulted).toBe(c.performance.defaulted);
      expect(row.status).toBe(c.performance.status);
      expect(row.realized_loss).toBe(c.performance.realized_loss);
      expect(row.months_to_default).toBe(c.performance.months_to_default);
      expect(row.first_payment_default).toBe(c.performance.first_payment_default);
      expect(row.loan_amount).toBe(c.application.loan_amount);
      expect(row.fraud_type).toBe(c.meta.corruption_type);
      expect(row.reference_label).toBe(c.label.expected_outcome);
      expect(row.severity).toBe({ APPROVE: 0, MANUAL_REVIEW: 1, DECLINE: 2 }[row.policy_outcome]);
    }
  });

  it("returns nulls rather than dividing by zero on degenerate input", () => {
    const noDefaults = evaluateOutcomes(POP.filter((c) => !c.performance.defaulted), CONFIG);
    expect(noDefaults.population.bad_rate).toBe(0);
    expect(noDefaults.policy.risk_separation).toBeNull();
    expect(noDefaults.population.mean_loss_given_default).toBeNull();
    expect(evaluateOutcomes([], CONFIG).n).toBe(0);
  });
});

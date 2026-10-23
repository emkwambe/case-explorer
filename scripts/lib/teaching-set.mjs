// scripts/lib/teaching-set.mjs — The teaching-v1 case set: causal pairs, near-threshold cases,
// conflicting signals and thin evidence, every case built from a seeded base through the mutation
// engine (src/mutations.js), never by editing case JSON.
//
// Each case carries two answers:
//   expected  the teaching answer, worked out from the rule or threshold the case tests (the rubric
//             below), never read from the engine;
//   system    what the engine decides today: the Solar credit policy, with the underwriting policy as
//             a second column and the generator's reference label kept apart.
// The benchmark's answer-key gate checks `system` as a regression (the file must rebuild identically
// and its SHA-256 must be named in benchmarks/CHANGELOG.md). Where expected and system differ, the
// case is listed as a named gap with a one-line reason; a gap without a reason fails the tests.

import crypto from "node:crypto";
import path from "node:path";
import { generateBlendedCase } from "../../src/generator.js";
import { applyProfile, getProfile } from "../../src/profiles/index.js";
import { applyMutations, observeCase } from "../../src/mutations.js";
import { isEligibleBase, pctForRatio, BASE_RULE } from "../../src/mutationTable.js";
import { GENERATOR_VERSION, CASE_SCHEMA_VERSION } from "../../src/core/case.js";
import { CREDIT_POLICY } from "../../src/creditRisk.js";
import { extractDecisionView } from "../../src/decisioning/index.js";
import { getRule } from "../../src/decisioning/fraud-rules/rules.js";

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

export const DIFFICULTY_RULE = Object.freeze({
  easy: "One deciding signal at least twice its rule's threshold, or a clean case with margin.",
  medium: "One deciding signal within 10% above its rule's threshold, or a case one step either side of a policy threshold (FICO ±1 point, DTI ±0.1 points, checking at $999 or $1,000).",
  hard: "Two interacting signals, or a missing document."
});

export const RUBRIC = Object.freeze({
  pairClean: "Claims, truth and evidence agree and every policy threshold is met with margin: approve.",
  pairFraud: "The claims alone would pass, but one verified fact contradicts them: refer for verification (review), not approve.",
  pairConcealmentVerified: `Verified debt from the bureau takes DTI past the ${CREDIT_POLICY.dtiDecline * 100}% cap: decline on verified figures.`,
  fico: `Claimed FICO below ${CREDIT_POLICY.ficoDecline} declines; ${CREDIT_POLICY.ficoDecline} and above passes.`,
  dti: `DTI above ${CREDIT_POLICY.dtiDecline * 100}% declines; from ${CREDIT_POLICY.dtiWatchLow * 100}% to ${CREDIT_POLICY.dtiDecline * 100}% goes to review; below ${CREDIT_POLICY.dtiWatchLow * 100}% passes.`,
  liquidity: `At DTI above ${CREDIT_POLICY.liquidityDtiMin * 100}%, checking under $${CREDIT_POLICY.liquidityCheckingMin.toLocaleString("en-US")} adds a liquidity flag; the elevated DTI already means review.`,
  conflictMaterial: "Income overstated and debt understated, each above its HIGH threshold: refer for verification.",
  conflictSubThreshold: "Income overstated and debt understated, each below its HIGH threshold: together the claims cannot be relied on, so re-underwrite on verified figures (review).",
  thin: "A missing document the decision depends on → review; one it does not depend on is noted and the case is decided on the remaining evidence."
});

/** The teaching set's base cases: eligible Solar prime cases from the seed's blended stream, in seed order. */
function bases(set, config, ctx, n) {
  const out = [];
  for (let i = 0; out.length < n && i < 2000; i++) {
    const c = generateBlendedCase(i, config, set.seed);
    if (isEligibleBase(c, observeCase(c, ctx))) out.push({ index: i, c });
  }
  if (out.length < n) throw new Error(`teaching set: only ${out.length} eligible bases, need ${n}`);
  return out;
}

const statement = (c) => c.evidence.find((e) => e.source === "BANK_STATEMENT").fields.checking_balance;
const round4 = (x) => Math.round(x * 1e4) / 1e4;

/** Every recipe: which base, which mutations, the teaching answer, the key fact and the difficulty. */
function recipes(B, ctx) {
  const out = [];
  let b = 0;
  const next = () => B[b++];
  const add = (r) => out.push(r);

  // Causal pairs: the clean twin is the base itself; the fraud twin adds one fact.
  const PAIRS = [
    { typology: "CONCEALMENT", make: (base, easy) => {
      const obs = observeCase(base.c, ctx);
      const income = base.c.truth.current_state.salary / 12;
      const monthly = easy ? Math.round((0.47 - obs.true_dti) * income) : 105;
      // Easy twins take the verified DTI past the cap, so the teaching answer declines on verified figures.
      // The deciding signal is then the verified DTI (47% against the 45% cap, 1.04×), which is medium.
      // FRAUD_REVIEW is acceptable there (no credit, no penalty): referring the case is not wrong, only incomplete.
      const expected = easy ? { decision: "DECLINE", reason_codes: ["HIGH_DTI", "UNDISCLOSED_LIABILITIES"], acceptable_codes: ["FRAUD_REVIEW"], rubric: "pairConcealmentVerified" } : undefined;
      return { mutations: [{ type: "hide_debt", params: { monthly } }], expected, difficulty: "medium", key: { field: "undisclosed monthly debt (truth and credit bureau; not in the claims)", value: monthly, threshold: "FR-003: $100/mo", note: easy ? "verified DTI moves past the 45% cap" : "just above the material threshold" } };
    } },
    { typology: "INFLATION", make: (base, easy) => {
      const ratio = easy ? 1.35 : 1.16;
      return { mutations: [{ type: "inflate_income", params: { pct: pctForRatio(base.c, ratio) } }], key: { field: "claimed salary ÷ employer-verified salary", value: ratio, threshold: "FR-001: above 1.15" } };
    } },
    { typology: "EVIDENCE_TAMPERING", make: (base, easy) => {
      const ratio = easy ? 1.30 : 1.16;
      const claims = base.c.presentation.current_state.checking_balance;
      return { mutations: [{ type: "conflict_document", params: { field: "BANK_STATEMENT.checking_balance", pct: round4(ratio * claims / statement(base.c) - 1) } }], key: { field: "bank-statement balance ÷ claimed balance", value: ratio, threshold: "FR-006: above 1.15" } };
    } },
    { typology: "FABRICATION", make: (base, easy) => {
      const ev = statement(base.c), claims = base.c.presentation.current_state.checking_balance;
      const target = easy ? Math.max(ev * 1.5, ev + 1200) : Math.max(ev * 1.105, ev + 525);
      // The mutation's pct is relative to the claimed balance; the key fact states FR-004's own measure,
      // the excess as a percentage of the statement balance, from the balance the mutation produces.
      const pct = round4(target / claims - 1), excess = Math.round(claims * (1 + pct)) - ev;
      return { mutations: [{ type: "fabricate_assets", params: { pct } }], key: { field: "claimed checking balance over the bank-statement balance (FR-004's measure)", value: `$${excess.toLocaleString("en-US")}, ${(excess / ev * 100).toFixed(2)}% of $${ev.toLocaleString("en-US")}`, threshold: "FR-004: excess above $500 and above 10% of the statement balance" } };
    } }
  ];
  for (const p of PAIRS) {
    for (let k = 1; k <= 5; k++) {
      const base = next(), easy = k <= 3, pair = `${p.typology.toLowerCase().replace(/_/g, "-")}-${k}`;
      const { mutations, key, expected, difficulty } = p.make(base, easy);
      add({ id: `${pair}/clean`, group: "causal-pair", pair, role: "clean", typology: "NONE", base, mutations: [], tests: "control twin",
        expected: { decision: "APPROVE", reason_codes: [], rubric: "pairClean" }, key_fact: { ...key, value: "absent" }, difficulty: "easy" });
      add({ id: `${pair}/fraud`, group: "causal-pair", pair, role: "fraud", typology: p.typology, base, mutations, tests: key.threshold,
        expected: expected ?? { decision: "REVIEW", reason_codes: ["FRAUD_REVIEW"], rubric: "pairFraud" }, key_fact: key, difficulty: difficulty ?? (easy ? "easy" : "medium") });
    }
  }

  // Near-threshold FICO: the applicant's real score is set one point either side of the minimum.
  for (let k = 1; k <= 3; k++) {
    const base = next();
    for (const v of [CREDIT_POLICY.ficoDecline - 1, CREDIT_POLICY.ficoDecline, CREDIT_POLICY.ficoDecline + 1]) {
      add({ id: `near/fico-${v}-b${k}`, group: "near-threshold", typology: "NONE", base, mutations: [{ type: "shift_fico", params: { points: v - base.c.presentation.current_state.credit_score } }],
        tests: `FICO minimum ${CREDIT_POLICY.ficoDecline}`, expected: v < CREDIT_POLICY.ficoDecline ? { decision: "DECLINE", reason_codes: ["LOW_FICO"], rubric: "fico" } : { decision: "APPROVE", reason_codes: [], rubric: "fico" },
        key_fact: { field: "claimed FICO", value: v, threshold: `${CREDIT_POLICY.ficoDecline}` }, difficulty: "medium" });
    }
  }
  // Near-threshold DTI: just either side of the watch line and of the cap.
  for (let k = 1; k <= 3; k++) {
    const base = next();
    for (const t of [0.359, 0.361, 0.449, 0.451]) {
      const exp = t > CREDIT_POLICY.dtiDecline ? { decision: "DECLINE", reason_codes: ["HIGH_DTI"] } : t >= CREDIT_POLICY.dtiWatchLow ? { decision: "REVIEW", reason_codes: ["ELEVATED_DTI"] } : { decision: "APPROVE", reason_codes: [] };
      add({ id: `near/dti-${(t * 100).toFixed(1)}-b${k}`, group: "near-threshold", typology: "NONE", base, mutations: [{ type: "shift_dti_to", params: { target: t } }],
        tests: t < 0.4 ? `DTI watch line ${CREDIT_POLICY.dtiWatchLow * 100}%` : `DTI cap ${CREDIT_POLICY.dtiDecline * 100}%`, expected: { ...exp, rubric: "dti" },
        key_fact: { field: "claimed back-end DTI", value: t, threshold: t < 0.4 ? `${CREDIT_POLICY.dtiWatchLow}` : `${CREDIT_POLICY.dtiDecline}` }, difficulty: "medium" });
    }
  }
  // Near-threshold liquidity: at DTI 41%, checking at $999 and $1,000.
  for (let k = 1; k <= 3; k++) {
    const base = next();
    for (const amount of [CREDIT_POLICY.liquidityCheckingMin - 1, CREDIT_POLICY.liquidityCheckingMin]) {
      add({ id: `near/checking-${amount}-b${k}`, group: "near-threshold", typology: "NONE", base, mutations: [{ type: "shift_dti_to", params: { target: 0.41 } }, { type: "set_checking", params: { amount } }],
        tests: `liquidity rule (checking under $${CREDIT_POLICY.liquidityCheckingMin} with DTI over ${CREDIT_POLICY.liquidityDtiMin * 100}%)`,
        expected: { decision: "REVIEW", reason_codes: amount < CREDIT_POLICY.liquidityCheckingMin ? ["ELEVATED_DTI", "LIQUIDITY_RISK"] : ["ELEVATED_DTI"], rubric: "liquidity" },
        key_fact: { field: "checking balance (at DTI 41%)", value: amount, threshold: `$${CREDIT_POLICY.liquidityCheckingMin}` }, difficulty: "medium" });
    }
  }
  // Conflicting signals: income overstated and debt understated together.
  for (let k = 1; k <= 3; k++) {
    const base = next();
    add({ id: `conflict/sub-threshold-b${k}`, group: "conflicting", typology: "INFLATION+CONCEALMENT", base,
      mutations: [{ type: "inflate_income", params: { pct: pctForRatio(base.c, 1.08) } }, { type: "hide_debt", params: { monthly: 60 } }],
      tests: "FR-001 and FR-003 each between their variance and HIGH thresholds", expected: { decision: "REVIEW", reason_codes: ["INCOME_VARIANCE_REVIEW", "LIABILITY_VARIANCE_REVIEW"], rubric: "conflictSubThreshold" },
      key_fact: { field: "claimed salary ÷ verified, and undisclosed monthly debt", value: "1.08 and $60/mo", threshold: "FR-001 1.15 · FR-003 $100/mo" }, difficulty: "hard" });
    add({ id: `conflict/material-b${k}`, group: "conflicting", typology: "INFLATION+CONCEALMENT", base,
      mutations: [{ type: "inflate_income", params: { pct: pctForRatio(base.c, 1.35) } }, { type: "hide_debt", params: { monthly: 300 } }],
      tests: "FR-001 and FR-003 each above their HIGH thresholds", expected: { decision: "REVIEW", reason_codes: ["FRAUD_REVIEW"], rubric: "conflictMaterial" },
      key_fact: { field: "claimed salary ÷ verified, and undisclosed monthly debt", value: "1.35 and $300/mo", threshold: "FR-001 1.15 · FR-003 $100/mo" }, difficulty: "hard" });
  }
  // Thin evidence: one document missing. The decision depends on the bureau report and the employer
  // verification; it does not depend on the bank statement, so that case is decided on the rest.
  const DEPENDS_ON = new Set(["CREDIT_BUREAU", "EMPLOYER_VERIFICATION"]);
  for (let k = 1; k <= 2; k++) {
    const base = next();
    for (const source of ["BANK_STATEMENT", "CREDIT_BUREAU", "EMPLOYER_VERIFICATION"]) {
      const depends = DEPENDS_ON.has(source);
      add({ id: `thin/${source.toLowerCase().replace(/_/g, "-")}-b${k}`, group: "thin-evidence", typology: "NONE", base, mutations: [{ type: "remove_statement", params: { source } }],
        tests: `${source} present`, expected: depends ? { decision: "REVIEW", reason_codes: ["MISSING_DOCUMENT"], rubric: "thin" } : { decision: "APPROVE", reason_codes: [], rubric: "thin" },
        key_fact: { field: "missing document", value: source, threshold: depends ? "the decision depends on it" : "the decision does not depend on it (noted)" }, difficulty: "hard" });
    }
  }
  return { recipes: out, basesUsed: b };
}

/** One line on why the engine's answer differs from the teaching answer; null when no reason is known. */
export function gapReason(entry) {
  const s = entry.system, m = entry.mutations;
  if (entry.group === "causal-pair" && entry.expected.rubric === "pairConcealmentVerified" && s.decision === "REVIEW" && s.fraud_rules.includes("FR-003:HIGH")) {
    return `The credit policy scores claimed values only: the bureau debt reaches it as a HIGH fraud alert (FR-003), so it refers for review instead of declining on the verified DTI of ${(s.true_dti * 100).toFixed(1)}%.`;
  }
  if (entry.expected.decision === s.decision && entry.expected.reason_codes.includes("UNDISCLOSED_LIABILITIES") && !s.reason_codes.includes("UNDISCLOSED_LIABILITIES") && s.fraud_rules.includes("FR-003:HIGH")) {
    return "Same decision, incomplete reasons: the credit policy reports every HIGH fraud alert as FRAUD_REVIEW and names no undisclosed-liability code, although FR-003 fires HIGH on the bureau debt.";
  }
  if (entry.group === "thin-evidence") {
    const src = m[0].params.source;
    if (s.decision === "APPROVE") return `Neither engine requires document presence: with the ${src} missing, the credit policy approves on the claims.`;
    if (s.decision === "REVIEW" && src === "EMPLOYER_VERIFICATION" && s.fraud_rules.some((r) => r.startsWith("FR-001:HIGH"))) return "Sent to review by FR-001 comparing the claimed salary with W-2 wages (the fallback when employer verification is missing), not because the document is missing.";
    if (s.decision === "REVIEW" && src === "CREDIT_BUREAU" && s.fraud_rules.some((r) => r.startsWith("FR-009:"))) return "Sent to review by FR-009 reading the missing bureau score as 0, not because the document is missing.";
    return null;
  }
  if (entry.group === "conflicting" && entry.expected.rubric === "conflictSubThreshold" && s.decision === "APPROVE"
    && s.fraud_rules.includes("FR-001:MEDIUM") && s.fraud_rules.includes("FR-003:MEDIUM")) {
    return "The credit policy acts on HIGH fraud alerts only; both variances are MEDIUM (FR-001, FR-003), so it approves on the claims.";
  }
  return null;
}

const sortCodes = (xs) => [...xs].sort();
const agrees = (e) => e.expected.decision === e.system.decision && JSON.stringify(sortCodes(e.expected.reason_codes)) === JSON.stringify(sortCodes(e.system.reason_codes));

/** Build the whole set: header and one entry per case, plus the mutated cases themselves. */
export function buildTeachingSet(set, baseConfig, configText) {
  const profile = getProfile(set.profile);
  const config = applyProfile({ ...baseConfig, generation: { ...(baseConfig.generation || {}), as_of_date: set.as_of } }, profile);
  const ctx = { profile, config };
  const B = bases(set, config, ctx, 34);
  const { recipes: rs, basesUsed } = recipes(B, ctx);
  const cases = [];
  const entries = rs.map((r) => {
    const c = applyMutations(r.base.c, r.mutations, ctx);
    cases.push(c);
    const o = observeCase(c, ctx);
    // Where the bureau shows undisclosed debt at FR-003's material level, the teaching answer names it.
    const v = extractDecisionView(c), hidden = (v.evidence.bureau_monthly_obligations ?? 0) - (v.claims.monthly_obligations ?? 0);
    if (hidden >= getRule("FR-003").threshold.min_hidden_monthly && !r.expected.reason_codes.includes("UNDISCLOSED_LIABILITIES")) {
      r.expected = { ...r.expected, reason_codes: [...r.expected.reason_codes, "UNDISCLOSED_LIABILITIES"] };
    }
    const system = {
      decision: o["credit.decision"], reason_codes: o["credit.flags"], fraud_rules: o.fraud_rules,
      claimed_dti: o.claimed_dti, true_dti: o.true_dti, claimed_fico: o.claimed_fico,
      underwriting: { decision: o["underwriting.decision"], reason_codes: o["underwriting.reason_codes"] },
      reference_label: { decision: c.label?.expected_outcome ?? null, reason_codes: [...(c.label?.reason_codes ?? [])] },
      hash: sha256(JSON.stringify(c)).slice(0, 16)
    };
    const entry = {
      id: r.id, group: r.group, ...(r.pair ? { pair: r.pair, role: r.role } : {}), typology: r.typology,
      base: { profile: set.profile, seed: set.seed, index: r.base.index, case_id: r.base.c.id },
      mutations: r.mutations, tests: r.tests, key_fact: r.key_fact, difficulty: r.difficulty,
      expected: r.expected, system
    };
    const gap = agrees(entry) ? null : { reason: gapReason(entry) };
    return gap ? { ...entry, gap } : entry;
  });
  const header = {
    id: set.id, description: set.description, profile: set.profile, seed: set.seed, as_of: set.as_of,
    generator_version: GENERATOR_VERSION, case_schema_version: CASE_SCHEMA_VERSION,
    configuration_hash: `sha256:${sha256(configText)}`,
    base_rule: BASE_RULE, bases_used: basesUsed, difficulty_rule: DIFFICULTY_RULE, rubric: RUBRIC,
    answers: "expected = the teaching answer from the rubric; system = the Solar credit policy today, with the underwriting policy and the reference label as separate columns"
  };
  return { header, entries, cases };
}

/** File text: the header pretty-printed, then one case per line so a diff reads case by case. */
export function serializeTeachingSet({ header, entries }) {
  return `{\n"set": ${JSON.stringify(header, null, 2)},\n"cases": [\n${entries.map((e) => JSON.stringify(e)).join(",\n")}\n]\n}\n`;
}

export const teachingFile = (benchDir, set) => path.join(benchDir, set.file);

/** Counts and named gaps, for the benchmark scorecard and the data README. */
export function teachingSummary(entries) {
  const count = (fn) => entries.reduce((m, e) => { const k = fn(e); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const gaps = entries.filter((e) => e.gap);
  return {
    n: entries.length,
    byGroup: count((e) => e.group), byTypology: count((e) => e.typology), byDifficulty: count((e) => e.difficulty),
    byExpected: count((e) => e.expected.decision), bySystem: count((e) => e.system.decision),
    agree: entries.length - gaps.length, gaps: gaps.map((e) => ({ id: e.id, expected: e.expected, system: { decision: e.system.decision, reason_codes: e.system.reason_codes }, reason: e.gap.reason }))
  };
}

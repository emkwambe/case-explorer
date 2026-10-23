// scripts/challenge-docs.mjs — Writes the challenge-mode data and docs from the committed teaching set:
//   src/challenge/challenge-data.json  the teaching entries the browser needs, the packs, and the set's SHA-256
//   docs/SCORING.md                    the rubric, the formulas and the worked examples (scored by the code)
//   src/challenge/README.md            how the packs are derived and what each contains
//
//   node scripts/challenge-docs.mjs           # print a summary
//   node scripts/challenge-docs.mjs --write   # write all three
//   node scripts/challenge-docs.mjs --check   # exit 1 if any is out of date

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreAttempt, DECISION_POINTS, PASS_MARK, REASON_POINTS, EXTRA_CODE_PENALTY, EVIDENCE_POINTS } from "../src/challenge/score.js";
import { keyEvidence, evidenceLabel, EVIDENCE_ITEMS } from "../src/challenge/evidence.js";
import { REASON_CODE_TEXT } from "../src/challenge/reasonCodes.js";
import { buildPacks } from "../src/challenge/packs.js";
import { gapKind } from "../src/challenge/gaps.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const set = JSON.parse(fs.readFileSync(path.join(ROOT, "benchmarks", "case-sets.json"), "utf8")).sets.find((s) => s.kind === "teaching");
const SET_FILE = path.join(ROOT, "benchmarks", set.file);
export const DATA_FILE = path.join(ROOT, "src", "challenge", "challenge-data.json");
export const SCORING_DOC = path.join(ROOT, "docs", "SCORING.md");
export const CHALLENGE_README = path.join(ROOT, "src", "challenge", "README.md");

const tally = (xs) => xs.reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
const fmt = (obj) => Object.entries(obj).map(([k, v]) => `${k} ${v}`).join(", ");

/** The teaching set as committed, with its SHA-256. */
export function teachingSet() {
  const text = fs.readFileSync(SET_FILE, "utf8");
  return { text, sha: crypto.createHash("sha256").update(text).digest("hex"), ...JSON.parse(text) };
}

/** What the browser needs: everything the blind view, the scorer and the reveal read, and nothing else. */
export function challengeData() {
  const { sha, set: header, cases } = teachingSet();
  const entries = cases.map((e) => ({
    id: e.id, group: e.group, ...(e.pair ? { pair: e.pair, role: e.role } : {}), typology: e.typology,
    base: e.base, mutations: e.mutations, key_fact: e.key_fact, difficulty: e.difficulty, expected: e.expected,
    system: { decision: e.system.decision, reason_codes: e.system.reason_codes, fraud_rules: e.system.fraud_rules, hash: e.system.hash },
    ...(e.gap ? { gap: { ...e.gap, gap_kind: gapKind(e) } } : {})
  }));
  return { teaching_set: header.id, teaching_sha256: sha, profile: header.profile, seed: header.seed, as_of: header.as_of, rubric: header.rubric, cases: entries, packs: buildPacks(entries) };
}

// Worked examples: real teaching-v1 cases, one attempt each, scored by scoreAttempt.
export const WORKED_EXAMPLES = [
  { title: "A clean approval", id: "concealment-1/clean", attempt: { decision: "APPROVE", reasonCodes: [], evidence: "supports" } },
  { title: "A concealment decline answered as Review", id: "concealment-1/fraud", attempt: { decision: "REVIEW", reasonCodes: ["UNDISCLOSED_LIABILITIES", "FRAUD_REVIEW"], evidence: "bureau.obligations" } },
  { title: "A liquidity case: decision right, LIQUIDITY_RISK missed", id: "near/checking-999-b1", attempt: { decision: "REVIEW", reasonCodes: ["ELEVATED_DTI"], evidence: "application.checking" } },
  { title: "Its twin at $1,000, the same answer", id: "near/checking-1000-b1", attempt: { decision: "REVIEW", reasonCodes: ["ELEVATED_DTI"], evidence: "application.checking" } },
  { title: "A thin-evidence case: a missing document the decision does not depend on", id: "thin/bank-statement-b1", attempt: { decision: "REVIEW", reasonCodes: ["MISSING_DOCUMENT"], evidence: "missing" } },
  { title: "A gap case answered the way the engine answers it", id: "conflict/sub-threshold-b1", attempt: { decision: "APPROVE", reasonCodes: [], evidence: "supports" } }
];

const codes = (xs) => (xs?.length ? xs.join(", ") : "none");

function exampleLines(ex, entry) {
  const s = scoreAttempt(entry, ex.attempt);
  const req = entry.expected.reason_codes, acc = entry.expected.acceptable_codes ?? [], chosen = ex.attempt.reasonCodes;
  const hits = chosen.filter((c) => req.includes(c)), extras = chosen.filter((c) => !req.includes(c) && !acc.includes(c)), accepted = chosen.filter((c) => acc.includes(c));
  const coverage = req.length ? `${REASON_POINTS} × ${hits.length}/${req.length} = ${(REASON_POINTS * hits.length) / req.length}` : `no codes required, so ${REASON_POINTS}`;
  const L = [`### ${ex.title}: \`${entry.id}\``, ""];
  L.push(`**Expected:** ${entry.expected.decision}, required codes ${codes(req)}${acc.length ? `, acceptable ${codes(acc)}` : ""}. **Key fact:** ${entry.key_fact.field} = ${entry.key_fact.value}. **Deciding value in:** ${keyEvidence(entry).map(evidenceLabel).join(" or ")}.`, "");
  L.push(`**Attempt:** ${ex.attempt.decision}, codes ${codes(chosen)}, evidence "${evidenceLabel(ex.attempt.evidence)}".`, "");
  L.push("| Part | Working | Points |", "|---|---|---|");
  L.push(`| Decision | expected ${entry.expected.decision}, chosen ${ex.attempt.decision}: matrix cell | ${s.parts.decision} |`);
  L.push(`| Reason codes | ${coverage}${extras.length ? `; ${extras.length} extra (${extras.join(", ")}) × −${EXTRA_CODE_PENALTY}` : ""}${accepted.length ? `; ${accepted.join(", ")} acceptable, no penalty` : ""}${s.parts.reasons === 0 && extras.length ? "; floored at 0" : ""} | ${s.parts.reasons} |`);
  L.push(`| Evidence | ${s.parts.evidence ? "carries the deciding value" : "does not carry the deciding value"} | ${s.parts.evidence} |`);
  L.push(`| **Total** | ${s.passed ? `passed (${PASS_MARK} or more)` : `not passed (below ${PASS_MARK})`}; decision ${s.decisionCorrect ? "correct" : "not correct"} | **${s.total}** |`, "");
  if (entry.gap) L.push(`*Gap case.* The engine decides ${entry.system.decision}${entry.system.reason_codes.length ? ` (${entry.system.reason_codes.join(", ")})` : ""}. ${entry.gap.reason} The learner is scored against the expected answer only.`, "");
  return L;
}

export function scoringMarkdown() {
  const { sha, cases } = teachingSet();
  const byId = new Map(cases.map((e) => [e.id, e]));
  const L = ["# Challenge-mode scoring", "", `_Generated by \`node scripts/challenge-docs.mjs --write\` from \`src/challenge/score.js\` and \`teaching-v1\` (SHA-256 \`${sha}\`). The worked examples are scored by the code; \`npm run test:challenge\` asserts them._`, ""];
  L.push("A learner works a teaching case blind, then commits a decision, the reason codes and the strongest evidence. `scoreAttempt(teachingCase, attempt)` in `src/challenge/score.js` scores the attempt against the teaching answer (`expected`), never against the engine. It is a pure function: the same case and attempt always give the same score. No model or LLM is involved.", "");
  L.push("## 100 points", "", `| Part | Points |`, "|---|---|", `| Decision | 50 |`, `| Reason codes | ${REASON_POINTS} |`, `| Evidence | ${EVIDENCE_POINTS} |`, "", `A case is **passed at ${PASS_MARK} or more**. Decision accuracy is reported on its own as well, so "right decision, weak reasons" reads differently from "wrong decision".`, "");
  L.push("## Decision: 50 points", "", "| Expected ↓ / Chosen → | Approve | Review | Decline |", "|---|---|---|---|");
  for (const [row, cols] of Object.entries(DECISION_POINTS)) L.push(`| **${row.charAt(0) + row.slice(1).toLowerCase()}** | ${cols.APPROVE} | ${cols.REVIEW} | ${cols.DECLINE} |`);
  L.push("", "Approving a case that needed checking is the costliest error, so it scores zero. Declining a good applicant also scores zero: it turns away creditworthy business and triggers an adverse-action notice. Sending a decline case to review is the safe miss, so it gets partial credit (25); sending an approve case to review costs operational time, so it gets less (20). Declining a case that needed review scores 20: the case was not safe to approve, but a decline without verification is still a wrong outcome.", "");
  L.push(`## Reason codes: ${REASON_POINTS} points`, "", `\`${REASON_POINTS} × (required codes chosen ÷ required codes) − ${EXTRA_CODE_PENALTY} × (chosen codes that are neither required nor acceptable)\`, floored at 0.`, "");
  L.push(`- **No codes required** (a clean approval): coverage is full, so choosing none scores ${REASON_POINTS}; each extra code still costs ${EXTRA_CODE_PENALTY}.`);
  L.push("- **Acceptable codes** (`expected.acceptable_codes`): not wrong, not required. They earn nothing and cost nothing. On concealment pairs 1 to 3, FRAUD_REVIEW is acceptable: referring the case is not wrong, only incomplete.");
  L.push("- Choosing a code twice counts once.", "");
  L.push("The codes a learner can choose are every code `teaching-v1` uses:", "", "| Code | Meaning |", "|---|---|", ...Object.entries(REASON_CODE_TEXT).map(([c, t]) => `| ${c} | ${t} |`), "");
  L.push(`## Evidence: ${EVIDENCE_POINTS} points`, "", `The learner picks one item as the strongest evidence. It scores ${EVIDENCE_POINTS} when it carries the case's deciding value, and 0 otherwise (\`keyEvidence\` in \`src/challenge/evidence.js\`):`, "");
  L.push("- a fraud twin: the document that contradicts the application (the bureau's tradelines for hidden debt, the employer verification for overstated income, the bank statement for a fabricated or altered balance);");
  L.push("- a near-threshold case: the field the threshold reads, on the application or on the document that shows the same value (credit score: application or bureau; checking: application or bank statement; debt-to-income: the application's ratio);");
  L.push("- a conflicting case: either key fact (employer verification or bureau tradelines);");
  L.push(`- a missing document the decision depends on: "${evidenceLabel("missing")}";`);
  L.push(`- a clean twin, or a missing document the decision does not depend on: "${evidenceLabel("supports")}".`, "");
  L.push(`The full list (a case offers only the items whose document it has): ${EVIDENCE_ITEMS.map((i) => i.label).join("; ")}.`, "");
  L.push("## Worked examples", "", "Each is a real `teaching-v1` case with one attempt; the points come from `scoreAttempt`.", "");
  for (const ex of WORKED_EXAMPLES) L.push(...exampleLines(ex, byId.get(ex.id)));
  L.push("The two liquidity cases differ only by LIQUIDITY_RISK, so the same answer scores differently: grading reads the reason codes, not only the decision.", "");
  return L.join("\n");
}

export function challengeReadme() {
  const data = challengeData();
  const byId = new Map(data.cases.map((e) => [e.id, e]));
  const L = ["# Challenge mode: packs and scoring", "", "_Generated by `node scripts/challenge-docs.mjs --write`. Do not edit by hand._", ""];
  L.push(`The packs are lists of \`${data.teaching_set}\` case ids, derived by the rules in \`src/challenge/packs.js\` from the set's own fields (group, pair, difficulty, gap), never hand-picked. \`challenge-data.json\` holds them with the teaching entries the browser needs and the set's SHA-256 (\`${data.teaching_sha256}\`); progress saved under another SHA is kept but marked as answered against an earlier key and left out of current scores.`, "");
  L.push("A session's order is seeded and deterministic (`orderPack`): a seeded shuffle, rebuilt so that no two cases from the same base case, twins or the near-threshold cases that share an applicant, are next to each other. The full set runs easy → medium → hard.", "");
  L.push("## Packs", "");
  L.push("| Pack | Skill | Cases | Typology | Difficulty | Expected decision |", "|---|---|---|---|---|---|");
  for (const p of data.packs) {
    const xs = p.caseIds.map((id) => byId.get(id));
    L.push(`| **${p.name}** | ${p.skill} | ${xs.length} | ${fmt(tally(xs.map((e) => e.typology)))} | ${fmt(tally(xs.map((e) => e.difficulty)))} | ${fmt(tally(xs.map((e) => e.expected.decision)))} |`);
  }
  L.push("", ...data.packs.map((p) => `- **${p.name}:** ${p.description}`), "");
  const kinds = tally(data.cases.filter((e) => e.gap).map((e) => e.gap.gap_kind));
  L.push(`**Gap kinds.** Each gap case carries \`gap.gap_kind\`, derived from its two answers (\`src/challenge/gaps.js\`): "decision" when the engine decides differently (${kinds.decision ?? 0} cases), "reasons" when it reaches the same decision with different reason codes (${kinds.reasons ?? 0} cases). The teaching set itself is not changed.`, "");
  L.push("## Scoring in brief", "", `Decision 50 (a matrix), reason codes ${REASON_POINTS} (coverage of the required codes, −${EXTRA_CODE_PENALTY} per extra code), evidence ${EVIDENCE_POINTS} (the item that carries the deciding value); passed at ${PASS_MARK}. The full rules and worked examples are in [docs/SCORING.md](../../docs/SCORING.md).`, "");
  return L.join("\n");
}

/** The opening pair (Sprint 10): the Solar prime library opens on its clean twin; the walkthrough swaps in the fraud twin. */
export const OPENING_PAIR = "concealment-1";
export const OPENING_FILE = path.join(ROOT, "src", "challenge", "opening-pair.json");
export function openingPair() {
  const d = challengeData();
  const recipe = (role) => { const e = d.cases.find((x) => x.id === `${OPENING_PAIR}/${role}`); return { id: e.id, base: e.base, mutations: e.mutations, hash: e.system.hash }; };
  return { pair: OPENING_PAIR, teaching_sha256: d.teaching_sha256, profile: d.profile, seed: d.seed, as_of: d.as_of, clean: recipe("clean"), fraud: recipe("fraud") };
}

const outputs = () => [[DATA_FILE, `${JSON.stringify(challengeData(), null, 1)}\n`], [OPENING_FILE, `${JSON.stringify(openingPair(), null, 1)}\n`], [SCORING_DOC, scoringMarkdown()], [CHALLENGE_README, challengeReadme()]];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "--write") for (const [f, text] of outputs()) { fs.writeFileSync(f, text, "utf8"); console.log(`wrote ${path.relative(ROOT, f)}`); }
  else if (mode === "--check") {
    let ok = true;
    for (const [f, text] of outputs()) {
      const cur = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
      if (cur !== text) { ok = false; console.error(`${path.relative(ROOT, f)} is out of date; run node scripts/challenge-docs.mjs --write`); } else console.log(`${path.relative(ROOT, f)} is up to date`);
    }
    process.exit(ok ? 0 : 1);
  } else {
    const d = challengeData();
    console.log(`teaching ${d.teaching_set} ${d.teaching_sha256}; ${d.cases.length} cases; packs ${d.packs.map((p) => `${p.id} ${p.caseIds.length}`).join(", ")}`);
  }
}

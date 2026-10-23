// src/ui/challenge/ChallengeView.jsx — Challenge mode: pick a scenario pack, work each teaching case
// blind (the application and its documents only), commit a decision, reason codes and the strongest
// evidence, then see the teaching answer and a rubric score. Loaded lazily by the shell.
//
// Blind means the shell shows nothing else (it renders only this view while challenge mode is on),
// and the shared components rendered here ask the gate (challengeGate.js) to drop anything that hints
// at the answer. After the commit the normal case views open for that one case.

import React, { useEffect, useMemo, useRef, useState } from "react";
import DATA from "../../challenge/challenge-data.json";
import CONFIG from "../../distribution_config.json";
import { scoreAttempt } from "../../challenge/score.js";
import { evidenceItemsFor, keyEvidence, evidenceLabel, EVIDENCE_ITEMS } from "../../challenge/evidence.js";
import { REASON_CODES, REASON_CODE_TEXT } from "../../challenge/reasonCodes.js";
import { orderPack } from "../../challenge/packs.js";
import { GAP_KIND_TEXT } from "../../challenge/gaps.js";
import { teachingContext, buildTeachingCase } from "../../challenge/teachingCases.js";
import { createProgressStore, summarize, splitBySha, STORAGE_KEY } from "../../challenge/progress.js";
import { createRng } from "../../utils/prng.js";
import { caseDti } from "../../creditRisk.js";
import { ActiveProfileProvider, useActiveProfile } from "../../profiles/activeProfile.js";
import { ChallengeGateContext } from "./challengeGate.js";
import { CHALLENGE_COLORS as C } from "./colors.js";
import { EvidenceTab, OverviewTab } from "../tabs/caseTabs.jsx";
import { DecisionTab } from "../tabs/decisionTabs.jsx";
import { TryAChangePanel } from "../tabs/TryAChangePanel.jsx";
import { useScoredCase } from "../hooks/useCaseAnalysis.js";
import { useArtifact } from "../hooks/useArtifacts.js";
import { CaseCreditModel } from "../tabs/CreditModelTab.jsx";
import { download } from "../components/download.js";
import { styles, money, titleCase } from "../theme.js";

const BY_ID = new Map(DATA.cases.map((e) => [e.id, e]));
const DECISION_LABELS = { APPROVE: "Approve", REVIEW: "Review", DECLINE: "Decline" };
const pctText = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);
const LABEL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newSeed() {
  try { return window.crypto.getRandomValues(new Uint32Array(1))[0]; } catch { return Date.now() % 4294967296; }
}

/** An opaque per-session label for each case, so no visible id ties twins together. */
function sessionLabels(order, seed) {
  const rng = createRng(`labels:${seed}`), used = new Set(), out = {};
  for (const id of order) {
    let label;
    do { label = Array.from({ length: 4 }, () => LABEL_ALPHABET[Math.floor(rng.random() * LABEL_ALPHABET.length)]).join(""); } while (used.has(label));
    used.add(label);
    out[id] = label;
  }
  return out;
}

const btn = { ...styles.btnSmall, minHeight: 36, padding: "6px 14px", color: C.text, borderColor: C.border, background: C.surface };
const btnPrimary = { ...btn, background: C.accent, borderColor: C.accent, color: C.onAccent, fontWeight: 600 };

// ---------------------------------------------------------------------------------------------
// The blind case: the application as submitted, a DTI worksheet and the evidence documents.

function Row({ label, children }) {
  return <div style={styles.kvRow}><span>{label}</span><strong style={{ textAlign: "right" }}>{children}</strong></div>;
}

export function ApplicationPanel({ caseObj }) {
  const { profile } = useActiveProfile();
  const p = caseObj.presentation.current_state;
  const dti = caseDti(caseObj, profile, "presentation");
  const loan = dti.proposedLoan;
  return (
    <section style={styles.panel} aria-labelledby="ch-application">
      <h3 id="ch-application" style={styles.panelTitle}>Application as submitted</h3>
      <Row label="Applicant">{caseObj.applicant.name}</Row>
      <Row label="Employer">{p.employer}</Row>
      <Row label="Employment status">{titleCase(p.employment_status)}</Row>
      <Row label="Time with employer">{p.tenure_months} months</Row>
      <Row label="Stated annual income">{money(p.salary)}</Row>
      <Row label="Stated monthly debts (excluding housing)">{money(p.monthly_obligations)}/mo</Row>
      <Row label="Stated checking balance">{money(p.checking_balance)}</Row>
      <Row label="Stated credit score">{p.credit_score}</Row>
      <Row label="Current housing payment">{dti.currentHousing === null ? "—" : `${money(dti.currentHousing)}/mo`}</Row>
      {loan && <Row label="Proposed solar loan">{money(loan.amount)} at {(loan.coupon * 100).toFixed(2)}% over {loan.termYears} years: {money(loan.monthlyPayment)}/mo</Row>}
      <Row label={`${dti.label}, from the stated figures`}>{pctText(dti.dti)}</Row>
    </section>
  );
}

/** A worksheet prefilled with the stated figures; income and debts are editable. Not scored, not stored. */
export function DtiWorksheet({ caseObj }) {
  const { profile } = useActiveProfile();
  const dti = caseDti(caseObj, profile, "presentation");
  const [income, setIncome] = useState(String(Math.round(dti.monthlyIncome)));
  const [debts, setDebts] = useState(String(Math.round(dti.nonHousing)));
  const housing = dti.currentHousing ?? 0, solar = dti.proposedPayment ?? 0;
  const inc = Number(income), dbt = Number(debts);
  const result = inc > 0 && Number.isFinite(dbt) ? (dbt + housing + solar) / inc : null;
  const field = { ...styles.seedInput, width: 130, marginBottom: 0 };
  return (
    <section style={styles.panel} aria-labelledby="ch-worksheet">
      <h3 id="ch-worksheet" style={styles.panelTitle}>Debt-to-income worksheet</h3>
      <p style={{ ...styles.note, color: C.muted }}>Prefilled with the stated figures. Change the income or the debts to recompute, for example with a figure from a document. Not scored and not saved.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
        <label style={{ fontSize: 13, color: C.text }}>Monthly income ($)<br /><input type="number" inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} style={field} data-testid="worksheet-income" /></label>
        <label style={{ fontSize: 13, color: C.text }}>Monthly debts, excluding housing ($)<br /><input type="number" inputMode="decimal" value={debts} onChange={(e) => setDebts(e.target.value)} style={field} data-testid="worksheet-debts" /></label>
      </div>
      <p style={{ fontSize: 13, color: C.text, margin: "10px 0 0" }} data-testid="worksheet-result">
        ({money(dbt || 0)} debts + {money(housing)} housing + {money(solar)} solar payment) ÷ {money(inc || 0)} income = <strong>{pctText(result)}</strong>
      </p>
    </section>
  );
}

export function BlindCase({ caseObj }) {
  return (
    <ChallengeGateContext.Provider value={{ active: true, blind: true }}>
      <div data-testid="challenge-blind-case">
        <div style={styles.grid2}>
          <ApplicationPanel caseObj={caseObj} />
          <DtiWorksheet caseObj={caseObj} />
        </div>
        <h3 style={{ ...styles.panelTitle, marginTop: 8 }}>Evidence documents</h3>
        <EvidenceTab caseData={caseObj} />
      </div>
    </ChallengeGateContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------------
// The attempt: decision, reason codes, strongest evidence, commit.

const fieldset = { border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 14px", margin: "0 0 12px" };
const legend = { fontWeight: 700, fontSize: 14, color: C.text, padding: "0 4px" };

export function AttemptForm({ caseObj, onCommit }) {
  const [decision, setDecision] = useState(null);
  const [codes, setCodes] = useState([]);
  const [evidence, setEvidence] = useState(null);
  const items = evidenceItemsFor(caseObj);
  const ready = decision && evidence;
  const toggle = (c) => setCodes((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) onCommit({ decision, reasonCodes: REASON_CODES.filter((c) => codes.includes(c)), evidence }); }} data-testid="challenge-attempt" aria-label="Your answer">
      <fieldset style={fieldset}>
        <legend style={legend}>1. Decision</legend>
        <div role="radiogroup" aria-label="Decision" style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {Object.entries(DECISION_LABELS).map(([value, label]) => (
            <label key={value} style={{ fontSize: 14, color: C.text }}><input type="radio" name="decision" value={value} checked={decision === value} onChange={() => setDecision(value)} /> {label}</label>
          ))}
        </div>
      </fieldset>
      <fieldset style={fieldset}>
        <legend style={legend}>2. Reason codes</legend>
        <p style={{ fontSize: 12, color: C.muted, margin: "0 0 6px" }}>Choose every code that applies. An approval with no reasons is valid.</p>
        {REASON_CODES.map((c) => (
          <label key={c} style={{ display: "block", fontSize: 13, color: C.text, margin: "4px 0" }}>
            <input type="checkbox" checked={codes.includes(c)} onChange={() => toggle(c)} /> <strong>{c}</strong>: {REASON_CODE_TEXT[c]}
          </label>
        ))}
      </fieldset>
      <fieldset style={fieldset}>
        <legend style={legend}>3. Strongest evidence</legend>
        {items.map((i) => (
          <label key={i.id} style={{ display: "block", fontSize: 13, color: C.text, margin: "4px 0" }}>
            <input type="radio" name="evidence" value={i.id} checked={evidence === i.id} onChange={() => setEvidence(i.id)} /> {i.label}
          </label>
        ))}
      </fieldset>
      <button type="submit" style={{ ...btnPrimary, opacity: ready ? 1 : 0.6 }} disabled={!ready} data-testid="challenge-commit">Commit answer</button>
      {!ready && <span style={{ marginLeft: 10, fontSize: 12, color: C.muted }}>Choose a decision and the strongest evidence to commit.</span>}
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// The reveal.

const codesText = (xs) => (xs?.length ? xs.join(", ") : "none");

function ExploreCase({ caseObj, teachingId }) {
  const { profile } = useActiveProfile();
  const ctx = useMemo(() => teachingContext(DATA, CONFIG), []);
  const scored = useScoredCase(caseObj, ctx.config);
  const creditModel = useArtifact("credit-model-cases.json");
  return (
    <div data-testid="challenge-explore">
      <OverviewTab caseData={caseObj} />
      <DecisionTab caseData={caseObj} scored={scored} />
      <CaseCreditModel caseKey={teachingId} cases={creditModel} />
      <TryAChangePanel caseData={caseObj} profile={profile} config={ctx.config} />
    </div>
  );
}

function fieldsOf(caseObj, profile) {
  const p = caseObj.presentation.current_state, dti = caseDti(caseObj, profile, "presentation");
  const rows = [["Application", "Stated annual income", money(p.salary)], ["Application", "Stated monthly debts", money(p.monthly_obligations)], ["Application", "Stated checking balance", money(p.checking_balance)], ["Application", "Stated credit score", String(p.credit_score)], ["Application", "DTI from the stated figures", pctText(dti.dti)]];
  for (const ev of caseObj.evidence) for (const [k, v] of Object.entries(ev.fields)) rows.push([titleCase(ev.source), titleCase(k), typeof v === "object" ? JSON.stringify(v) : String(v)]);
  return rows;
}

export function TwinCompare({ clean, fraud }) {
  const { profile } = useActiveProfile();
  const a = fieldsOf(clean, profile), b = fieldsOf(fraud, profile);
  const keys = [...new Map([...a, ...b].map(([d, f]) => [`${d}|${f}`, [d, f]])).values()];
  const value = (rows, d, f) => rows.find((r) => r[0] === d && r[1] === f)?.[2] ?? "—";
  const diff = keys.filter(([d, f]) => value(a, d, f) !== value(b, d, f));
  return (
    <section style={styles.panel} data-testid="challenge-twins" aria-labelledby="ch-twins">
      <h3 id="ch-twins" style={styles.panelTitle}>The twins side by side</h3>
      <p style={{ ...styles.note, color: C.muted }}>The same applicant, once clean and once with one fact changed. {diff.length} field{diff.length === 1 ? "" : "s"} differ; everything else is identical.</p>
      <div style={styles.tableContainer}>
        <table style={{ ...styles.table, fontSize: 12 }}>
          <thead><tr>{["Document", "Field", "Clean twin", "Fraud twin"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {diff.map(([d, f]) => (
              <tr key={`${d}|${f}`}><td style={styles.td}>{d}</td><td style={styles.td}>{f}</td><td style={{ ...styles.td, wordBreak: "break-word" }}>{value(a, d, f)}</td><td style={{ ...styles.td, wordBreak: "break-word", fontWeight: 700 }}>{value(b, d, f)} (differs)</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Reveal({ entry, caseObj, attempt, score, headingRef, twin, exploreOpen = false }) {
  const [showTwins, setShowTwins] = useState(false);
  const [explore, setExplore] = useState(exploreOpen);
  const keys = keyEvidence(entry);
  const highlight = keys.map((k) => EVIDENCE_ITEMS.find((i) => i.id === k)?.source).filter(Boolean);
  const exp = entry.expected;
  const rows = [
    ["Decision", DECISION_LABELS[attempt.decision], DECISION_LABELS[exp.decision], score.parts.decision, 50, score.explanation.decision],
    ["Reason codes", codesText(attempt.reasonCodes), `${codesText(exp.reason_codes)}${exp.acceptable_codes?.length ? ` (acceptable: ${exp.acceptable_codes.join(", ")})` : ""}`, score.parts.reasons, 30, score.explanation.reasons],
    ["Strongest evidence", evidenceLabel(attempt.evidence), keys.map(evidenceLabel).join(" or "), score.parts.evidence, 20, score.explanation.evidence]
  ];
  return (
    <ChallengeGateContext.Provider value={{ active: true, blind: false }}>
      <section data-testid="challenge-reveal" aria-labelledby="ch-reveal">
        <h3 id="ch-reveal" ref={headingRef} tabIndex={-1} style={{ ...styles.panelTitle, fontSize: 18, color: C.text, outlineOffset: 4 }}>
          Score: {score.total} of 100, {score.passed ? "passed" : "not passed"} (pass mark 70). Decision {score.decisionCorrect ? "correct" : "not correct"}.
        </h3>
        <div style={styles.tableContainer}>
          <table style={{ ...styles.table, fontSize: 13 }} data-testid="challenge-score-table">
            <thead><tr>{["Part", "Your answer", "Teaching answer", "Points", "Why"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(([part, mine, theirs, pts, max, why]) => (
                <tr key={part}><td style={styles.td}><strong>{part}</strong></td><td style={styles.td}>{mine}</td><td style={styles.td}>{theirs}</td><td style={styles.td}><strong>{pts} of {max}</strong></td><td style={styles.td}>{why}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ ...styles.panel, marginTop: 12 }}>
          <p style={{ margin: "0 0 6px", fontSize: 14, color: C.text }}><strong>Why:</strong> {DATA.rubric[exp.rubric]}</p>
          <p style={{ margin: "0 0 6px", fontSize: 14, color: C.text }} data-testid="challenge-key-fact"><strong>Key fact:</strong> {entry.key_fact.field}: {String(entry.key_fact.value)} (threshold: {entry.key_fact.threshold}){entry.key_fact.note ? `; ${entry.key_fact.note}` : ""}.</p>
          <p style={{ margin: 0, fontSize: 14, color: C.text }}><strong>Where it is:</strong> {keys.map(evidenceLabel).join(" or ")}{highlight.length ? "; the document is outlined below." : "."}</p>
        </div>
        {entry.gap && (
          <div role="note" data-testid="challenge-gap" data-gap-kind={entry.gap.gap_kind} style={{ border: `2px solid ${C.warnBorder}`, background: C.warnBg, color: C.warnText, borderRadius: 6, padding: "10px 14px", margin: "12px 0" }}>
            <p style={{ margin: "0 0 6px", fontWeight: 700 }} data-testid="challenge-gap-kind">{GAP_KIND_TEXT[entry.gap.gap_kind]}</p>
            <strong>What the engine does:</strong> {DECISION_LABELS[entry.system.decision]} ({codesText(entry.system.reason_codes)}). <strong>Why it differs:</strong> {entry.gap.reason} You are scored against the teaching answer only.
          </div>
        )}
        {twin && <button type="button" style={{ ...btn, margin: "4px 0 12px" }} onClick={() => setShowTwins((v) => !v)} aria-expanded={showTwins} data-testid="challenge-compare-twins">{showTwins ? "Hide the twins" : "Compare the twins side by side"}</button>}
        {twin && showTwins && <TwinCompare clean={twin.clean} fraud={twin.fraud} />}
        <h3 style={{ ...styles.panelTitle, marginTop: 8 }}>Evidence documents</h3>
        <EvidenceTab caseData={caseObj} highlight={highlight} />
        {/* The normal case views are built only when opened: they score the case and run "Try a change". */}
        <details style={{ marginTop: 12 }} onToggle={(e) => setExplore(e.currentTarget.open)} data-testid="challenge-explore-toggle">
          <summary style={{ cursor: "pointer", fontWeight: 600, color: C.text }}>Explore this case: reference label, rules and "Try a change"</summary>
          {explore && <ExploreCase caseObj={caseObj} teachingId={entry.id} />}
        </details>
      </section>
    </ChallengeGateContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------------
// Progress and packs.

function ProgressPanel({ store, record, onReset }) {
  const s = summarize(record, DATA);
  const fmt = (v) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  const meanFmt = (v) => (v === null ? "—" : v.toFixed(0));
  const attempts = splitBySha(record, DATA.teaching_sha256);
  const reset = () => {
    const n = record.attempts.length;
    if (window.confirm(`Delete all challenge progress saved in this browser (${n} attempt${n === 1 ? "" : "s"}, stored under "${STORAGE_KEY}")? Nothing else is deleted.`)) onReset();
  };
  return (
    <section style={styles.panel} data-testid="challenge-progress" aria-labelledby="ch-progress">
      <h3 id="ch-progress" style={styles.panelTitle}>Your progress</h3>
      {!store.available && <p style={{ ...styles.note, color: C.warnText }} data-testid="challenge-no-storage">This browser is not saving progress (storage is unavailable), so answers are kept only until the page closes.</p>}
      {attempts.earlier.length > 0 && <p style={{ ...styles.note, color: C.muted }}>{attempts.earlier.length} attempt{attempts.earlier.length === 1 ? " was" : "s were"} answered against an earlier key and {attempts.earlier.length === 1 ? "is" : "are"} left out of these scores.</p>}
      <div style={styles.tableContainer}>
        <table style={{ ...styles.table, fontSize: 12 }}>
          <thead><tr>{["Difficulty", "Attempted", "Passed", "Mean score", "Decision accuracy"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>{Object.entries(s.tiers).map(([t, v]) => <tr key={t}><td style={styles.td}>{titleCase(t)}</td><td style={styles.td}>{v.attempted}</td><td style={styles.td}>{v.passed}</td><td style={styles.td}>{meanFmt(v.meanScore)}</td><td style={styles.td}>{fmt(v.decisionAccuracy)}</td></tr>)}</tbody>
        </table>
      </div>
      <p style={{ fontSize: 13, color: C.text, margin: "8px 0" }}>Packs started: {s.packs.filter((p) => p.started).length} of {s.packs.length}; completed: {s.packs.filter((p) => p.completed).length}.</p>
      <p style={{ fontSize: 13, color: C.text, margin: "0 0 8px" }} data-testid="challenge-missed">Codes you most often miss: {s.missedCodes.length ? s.missedCodes.slice(0, 3).map(([c, n]) => `${c} (${n})`).join(", ") : "none yet"}.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={btn} onClick={() => download("case-explorer-challenge-progress.json", store.exportJson())} data-testid="challenge-export">Export progress (JSON)</button>
        <button type="button" style={btn} onClick={reset} data-testid="challenge-reset">Reset progress</button>
      </div>
    </section>
  );
}

/** For a pack made of gap cases: how many differ in the decision and how many only in the reasons. */
function gapCounts(pack) {
  const xs = pack.caseIds.map((id) => BY_ID.get(id));
  if (!xs.every((e) => e.gap)) return null;
  const n = (k) => xs.filter((e) => e.gap.gap_kind === k).length;
  return `${n("decision")} where the decision differs, ${n("reasons")} where only the reasons differ.`;
}

function PackList({ record, onStart, onResume }) {
  const s = summarize(record, DATA);
  const open = new Map();
  for (const session of record.sessions) if (session.teachingSha === DATA.teaching_sha256 && session.position < session.order.length) open.set(session.pack, session);
  return (
    <section aria-labelledby="ch-packs">
      <h2 id="ch-packs" style={{ fontSize: 18, margin: "0 0 10px", color: C.text }}>Scenario packs</h2>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {DATA.packs.map((p) => {
          const stats = s.packs.find((x) => x.id === p.id), resume = open.get(p.id);
          return (
            <div key={p.id} style={{ ...styles.panel, marginBottom: 0 }} data-testid={`pack-${p.id}`}>
              <h3 style={{ ...styles.panelTitle, marginBottom: 4 }}>{p.name}</h3>
              <p style={{ fontSize: 13, color: C.text, margin: "0 0 4px" }}>{p.description}</p>
              {gapCounts(p) && <p style={{ fontSize: 12, color: C.text, margin: "0 0 4px" }} data-testid={`gap-kinds-${p.id}`}>{gapCounts(p)}</p>}
              <p style={{ fontSize: 12, color: C.muted, margin: "0 0 8px" }}>Skill: {p.skill}. {p.caseIds.length} cases. {stats.attempted ? `Attempted ${stats.attempted}, passed ${stats.passed}, mean ${stats.meanScore.toFixed(0)}.` : "Not started."}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={btnPrimary} onClick={() => onStart(p)} data-testid={`start-${p.id}`}>Start {p.name}</button>
                {resume && <button type="button" style={btn} onClick={() => onResume(resume)} data-testid={`resume-${p.id}`}>Resume at case {resume.position + 1}</button>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The session.

function Session({ session, store, onProgress, onLeave }) {
  const ctx = useMemo(() => teachingContext(DATA, CONFIG), []);
  const pack = DATA.packs.find((p) => p.id === session.pack);
  const [position, setPosition] = useState(session.position);
  const [result, setResult] = useState(null);
  const caseHeading = useRef(null), revealHeading = useRef(null);
  const done = position >= session.order.length;
  const entry = done ? null : BY_ID.get(session.order[position]);
  const caseObj = useMemo(() => (entry ? buildTeachingCase(entry, DATA, ctx) : null), [entry, ctx]);
  const answered = store.load().attempts.filter((a) => a.session === session.id).map((a) => a.caseId);

  useEffect(() => { if (result) revealHeading.current?.focus(); }, [result]);
  useEffect(() => { if (!result) caseHeading.current?.focus(); }, [position, result]);

  const commit = (attempt) => {
    const score = scoreAttempt(entry, attempt);
    store.addAttempt({ teachingSha: DATA.teaching_sha256, caseId: entry.id, pack: pack.id, session: session.id, at: new Date().toISOString(), answer: attempt, score: { total: score.total, ...score.parts, passed: score.passed, decisionCorrect: score.decisionCorrect } });
    store.saveSession({ ...session, position: position + 1 });
    setResult({ attempt, score });
    onProgress();
  };
  const next = () => { setResult(null); setPosition((p) => p + 1); };

  // Causal pairs: once both twins of this case's pair are answered in the session, offer the comparison.
  const twin = useMemo(() => {
    if (!result || !entry?.pair) return null;
    const ids = [`${entry.pair}/clean`, `${entry.pair}/fraud`];
    if (!ids.every((id) => id === entry.id || answered.includes(id))) return null;
    const [clean, fraud] = ids.map((id) => (id === entry.id ? caseObj : buildTeachingCase(BY_ID.get(id), DATA, ctx)));
    return { clean, fraud };
  }, [result, entry, answered, caseObj, ctx]);

  if (done) {
    const mine = store.load().attempts.filter((a) => a.session === session.id);
    return (
      <section data-testid="challenge-session-done">
        <h2 ref={caseHeading} tabIndex={-1} style={{ fontSize: 18, color: C.text }}>{pack.name}: finished</h2>
        <p style={{ fontSize: 14, color: C.text }}>{mine.length} cases; passed {mine.filter((a) => a.score.passed).length}; mean score {mine.length ? (mine.reduce((s, a) => s + a.score.total, 0) / mine.length).toFixed(0) : "—"}; decision accuracy {mine.length ? `${Math.round((100 * mine.filter((a) => a.score.decisionCorrect).length) / mine.length)}%` : "—"}.</p>
        <button type="button" style={btnPrimary} onClick={onLeave}>Back to the packs</button>
      </section>
    );
  }
  return (
    <section aria-labelledby="ch-case">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 id="ch-case" ref={caseHeading} tabIndex={-1} style={{ fontSize: 18, margin: 0, color: C.text }} data-testid="challenge-case-label">
          Case {position + 1} of {session.order.length} · {session.labels[entry.id]}
        </h2>
        <span style={{ fontSize: 13, color: C.muted }}>{pack.name}</span>
        <button type="button" style={{ ...btn, marginLeft: "auto" }} onClick={onLeave}>Back to the packs</button>
      </div>
      {!result && (
        <>
          <BlindCase key={entry.id} caseObj={caseObj} />
          <AttemptForm key={`form-${entry.id}`} caseObj={caseObj} onCommit={commit} />
        </>
      )}
      {result && (
        <>
          <Reveal entry={entry} caseObj={caseObj} attempt={result.attempt} score={result.score} headingRef={revealHeading} twin={twin} />
          <button type="button" style={{ ...btnPrimary, marginTop: 12 }} onClick={next} data-testid="challenge-next">{position + 1 < session.order.length ? "Next case" : "Finish the pack"}</button>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

export function ChallengeHome({ store }) {
  const [record, setRecord] = useState(() => store.load());
  const [session, setSession] = useState(null);
  const refresh = () => setRecord(store.load());
  const start = (pack) => {
    const seed = newSeed();
    const order = orderPack(pack, DATA.cases, seed);
    const s = { id: `s-${seed.toString(36)}-${Date.now().toString(36)}`, teachingSha: DATA.teaching_sha256, pack: pack.id, seed, order, labels: sessionLabels(order, seed), position: 0, startedAt: new Date().toISOString() };
    store.saveSession(s);
    setSession(s);
    refresh();
  };
  if (session) return <Session key={session.id} session={session} store={store} onProgress={refresh} onLeave={() => { setSession(null); refresh(); }} />;
  return (
    <div>
      <p style={{ fontSize: 14, color: C.text, maxWidth: 820 }}>
        Work each case from the application and its documents alone, then commit a decision, the reason codes and the strongest evidence. The teaching answer and a score appear after you commit. Scoring is explained in docs/SCORING.md: decision 50, reason codes 30, evidence 20; 70 passes.
      </p>
      <PackList record={record} onStart={start} onResume={(s) => setSession(s)} />
      <div style={{ marginTop: 16 }}><ProgressPanel store={store} record={record} onReset={() => { store.reset(); refresh(); }} /></div>
    </div>
  );
}

/** The whole challenge view, under the Solar prime profile the teaching set was built for. */
export default function ChallengeView({ store: given }) {
  const store = useMemo(() => given ?? createProgressStore(), [given]);
  return (
    <ActiveProfileProvider initialProfileId={DATA.profile}>
      <ChallengeGateContext.Provider value={{ active: true, blind: false }}>
        <div data-testid="challenge-view" style={{ color: C.text }}>
          <ChallengeHome store={store} />
        </div>
      </ChallengeGateContext.Provider>
    </ActiveProfileProvider>
  );
}

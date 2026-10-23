// src/ui/tabs/TryAChangePanel.jsx — "Try a change": apply one controlled mutation to the selected case
// and see the decision before and after, with the rows of the expected-change table that held.
// Read-only: the mutated case is never added to the library, and nothing is scored.

import React, { useMemo, useState } from "react";
import { styles } from "../theme.js";
import { MUTATIONS, applyMutation, applyMutations, observeCase } from "../../mutations.js";
import { MUTATION_TABLE, BASE_RULE, isEligibleBase, checkRow } from "../../mutationTable.js";

const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
const list = (xs) => (xs?.length ? xs.join(", ") : "none");

const ROWS = [
  ["Credit policy decision", (o) => o["credit.decision"]],
  ["Credit policy flags", (o) => list(o["credit.flags"])],
  ["Claimed back-end DTI", (o) => pct(o.claimed_dti)],
  ["True back-end DTI (hidden)", (o) => pct(o.true_dti)],
  ["Claimed FICO", (o) => o.claimed_fico ?? "—"],
  ["Underwriting decision", (o) => o["underwriting.decision"]],
  ["Fraud rules fired", (o) => list(o.fraud_rules)]
];

export function TryAChangePanel({ caseData, profile, config }) {
  const [rowId, setRowId] = useState(MUTATION_TABLE[0].id);
  const row = MUTATION_TABLE.find((r) => r.id === rowId) ?? MUTATION_TABLE[0];
  const ctx = useMemo(() => ({ profile, config }), [profile, config]);

  const result = useMemo(() => {
    if (!caseData) return null;
    try {
      const start = row.setup ? applyMutations(caseData, row.setup, ctx) : caseData;
      const mutation = { type: row.mutation, params: row.params(start) };
      const after = applyMutation(start, mutation, ctx);
      const baseObs = observeCase(caseData, ctx);
      const before = observeCase(start, ctx), now = observeCase(after, ctx);
      return { mutation, before, now, eligible: isEligibleBase(caseData, baseObs), problems: checkRow(row, before, now) };
    } catch (e) {
      return { error: e.message };
    }
  }, [caseData, row, ctx]);

  return (
    <section style={{ ...styles.panel, marginTop: 16 }} data-testid="panel-try-a-change">
      <h3 style={styles.panelTitle}>Try a change</h3>
      <p style={styles.note}>Apply one controlled change to this case and compare the decision before and after. A fraud change alters one layer only (the claim, the hidden truth with the evidence that copies it, or one document); an honest change moves truth, claims and evidence together. The loan is held fixed. Nothing is saved or scored.</p>
      <label style={{ display: "block", fontSize: 13, margin: "8px 0" }}>
        Change{" "}
        <select value={row.id} onChange={(e) => setRowId(e.target.value)} data-testid="try-change-select" style={{ maxWidth: "100%" }}>
          {MUTATION_TABLE.map((r) => <option key={r.id} value={r.id}>{MUTATIONS[r.mutation].label}: {r.when}</option>)}
        </select>
      </label>
      {result?.error && <p style={{ ...styles.note, color: "#b91c1c" }} data-testid="try-change-error">This change cannot be applied to this case: {result.error}</p>}
      {result && !result.error && (
        <>
          <p style={{ fontSize: 12, margin: "4px 0 8px", color: "#475569" }}>
            <code>{result.mutation.type}</code> {JSON.stringify(result.mutation.params)}{row.setup ? ` after setup ${row.setup.map((s) => `${s.type} ${JSON.stringify(s.params)}`).join(", ")}` : ""}
          </p>
          <div style={styles.tableContainer}>
            <table style={{ ...styles.table, fontSize: 12 }} data-testid="try-change-table">
              <thead><tr>{["Output", row.setup ? "Before (after setup)" : "Before", "After"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
              <tbody>
                {ROWS.map(([label, fn]) => {
                  const b = fn(result.before), a = fn(result.now);
                  return <tr key={label}><td style={styles.td}>{label}</td><td style={styles.td}>{b}</td><td style={{ ...styles.td, fontWeight: String(a) !== String(b) ? 700 : 400 }}>{a}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <h4 style={{ fontSize: 13, margin: "12px 0 4px" }}>Expected-change table: {row.id}</h4>
          {!result.eligible && <p style={styles.note} data-testid="try-change-not-base">This case is not a table base, so the row is not asserted here. {BASE_RULE}</p>}
          {result.eligible && (
            <p style={{ fontSize: 13, margin: "4px 0" }} data-testid="try-change-rows">
              {result.problems.length === 0
                ? <span style={{ color: "#15803d" }}>Held: every must-change and must-not-change entry of this row held.</span>
                : <span style={{ color: "#b91c1c" }}>Did not hold: {result.problems.join("; ")}</span>}
            </p>
          )}
          <ul style={{ fontSize: 12, lineHeight: 1.5, margin: "4px 0" }}>
            <li><strong>Must change:</strong> {row.must.map((m) => m.output + (m.to !== undefined ? ` → ${m.to}` : m.includes ? ` gains ${m.includes}` : m.increases ? " rises" : m.decreases ? " falls" : "")).join("; ")}</li>
            <li><strong>May change:</strong> {row.may.join(", ") || "nothing"}</li>
            <li><strong>Must not change:</strong> {row.mustNot.join(", ")}</li>
          </ul>
        </>
      )}
    </section>
  );
}

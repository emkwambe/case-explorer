// src/ui/tabs/creditModelParts.jsx — Small components shared by the Credit model tab's views: a note,
// a plain table and a sub-heading.

import React from "react";
import { styles } from "../theme.js";
import { INK, MUTED } from "./creditModelFormat.js";

export function Note({ children, testId }) {
  return <p style={{ ...styles.note, color: MUTED }} data-testid={testId}>{children}</p>;
}

export function Table({ head, rows, testId }) {
  return (
    <div style={styles.tableContainer}>
      <table style={{ ...styles.table, fontSize: 12 }} data-testid={testId}>
        <thead><tr>{head.map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={styles.td}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function SubHeading({ id, children }) {
  return <h4 id={id} style={{ fontSize: 13, margin: "14px 0 4px", color: INK }}>{children}</h4>;
}

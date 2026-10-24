// src/ui/tabs/creditModelFormat.js — Colours, number formats and fixed wording shared by the Credit
// model tab's views (components live in creditModelParts.jsx and CreditModelProperties.jsx).

export const INK = "#0f172a", MUTED = "#475569", BAR = "#1d4ed8", TRACK = "#e2e8f0";
export const pct = (v, d = 2) => (v === null || v === undefined ? "—" : `${(100 * v).toFixed(d)}%`);
export const f3 = (v) => (v === null || v === undefined ? "—" : v.toFixed(3));
/** A signed figure with a true minus sign. */
export const signed = (v, fmt) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v))}`;
export const usd = (v) => `$${Math.round(v).toLocaleString("en-US")}`;
export const count = (v) => v.toLocaleString("en-US");

/** The model card's legal-status paragraph, word for word (a test holds the two together). */
export const LEGAL_STATUS =
  "ECOA disparate-impact liability was removed from Regulation B effective July 21, 2026, and that change is being litigated (NFHA v. CFPB). Disparate impact remains relevant under the Fair Housing Act where it applies, and under state laws such as New Jersey's LAD and Massachusetts law. Colorado SB 26-189 takes effect January 1, 2027. These tables are monitoring evidence for a reviewer; they don't establish or rule out legal compliance.";

export const ATTRIBUTE_NAMES = {
  age_band: "Age band",
  geography_group: "Region (cost-of-living group)",
  zip3: "ZIP3 (ten largest, the rest as other)",
  income_band: "Income band",
  persona: "Persona (occupation)",
  regime: "Regime",
  family_status_scenario: "Family status (synthetic scenario)",
  disability_income_scenario: "Disability income (synthetic scenario)"
};

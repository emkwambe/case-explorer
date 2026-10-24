// src/ui/tabs/CreditModelProperties.jsx — Sprint 12's properties of the credit model, read-only from
// the committed snapshot (credit-model-properties.json): fairness, champion/challenger, reject inference
// and drift. Developer testing on synthetic data; nothing here changes a decision. The model card
// (docs/MODEL-CARD-credit-pd.md) carries the full tables and method notes.

import React, { useState } from "react";
import { styles } from "../theme.js";
import { INK, pct, f3, signed, usd, count, LEGAL_STATUS, ATTRIBUTE_NAMES } from "./creditModelFormat.js";
import { Note, Table, SubHeading } from "./creditModelParts.jsx";

const SET_NAMES = { opening_library: "Opening library", teaching_v1: "Teaching-v1", pool_seed_42: "Seed-42 pool" };
const CC_ORDER = ["bureau_score_policy", "challenger_a_xgb_alone", "challenger_b_overlay", "as_is_policy_reference"];
const METHOD_NAMES = { funded_only: "Funded-only (Sprint 11)", hard_cutoff: "Hard cut-off augmentation", fuzzy: "Fuzzy augmentation", oracle: "Oracle: every application" };
const BOOK_NAMES = { control: "Control (unchanged)", lower_fico: "Lower FICO", more_fraud: "More fraud", weaker_dealers: "Weaker dealers" };

const range = (lo, hi, fmt = f3) => `${fmt(lo)}–${fmt(hi)}`;
const diffCi = (d, fmt) => `${signed(d.point, fmt)} (${signed(d.low, fmt)} to ${signed(d.high, fmt)})`;
const share = (v) => (v === undefined ? "—" : `${Math.round(100 * v)}%`);

function proxyReading(a) {
  if (a.auc > 0.6) return `usable proxy: ${a.top_features.join(", ")}`;
  if (a.auc_ci95[0] <= 0.5 || a.auc < 0.55) return "no usable proxy";
  return "weak (0.55–0.60)";
}

function Fairness({ f }) {
  const attrs = Object.keys(ATTRIBUTE_NAMES).filter((k) => f.groups[k]);
  const [attr, setAttr] = useState(attrs[0]);
  const g = f.groups[attr];
  const champ = g.policies.bureau_score_policy, model = g.policies.credit_pd_xgb_cutoff, asIs = g.policies.as_is_policy_reference;
  const byGroup = (p) => Object.fromEntries(p.groups.map((r) => [r.group, r]));
  const m = byGroup(model), a = byGroup(asIs);
  const audit = Object.values(f.flips.sets).flat().filter((r) => r.kind !== "financial");
  const financial = Object.entries(f.flips.sets).map(([set, rows]) => [set, rows.find((r) => r.kind === "financial")]).filter(([, r]) => r);
  return (
    <section data-testid="credit-model-fairness" aria-labelledby="cm-fairness">
      <SubHeading id="cm-fairness">Fairness (monitoring evidence, not a legal conclusion)</SubHeading>
      <Note testId="fairness-flips">
        <strong>Counterfactual flips.</strong> Each sensitive attribute flipped to every other value on every case in the opening library, teaching-v1 and the seed-42 pool: {count(audit.reduce((s, r) => s + r.flips, 0))} flips, and {count(audit.reduce((s, r) => s + r.changed, 0))} of them changed any output (credit decision and reasons, underwriting, every fraud rule, the model's features).{" "}
        {f.flips.clean ? "No engine reads a sensitive attribute." : "A flip changed an output; see the model card."}{" "}
        The region flip also moves housing cost, so DTI and decisions follow; that financial channel is reported on its own ({financial.map(([set, r]) => `${SET_NAMES[set]}: ${count(r.flips)} flips, the credit decision changed on ${count(r.decision_changed)}, ${count(r.changed_without_dti_move)} changes without a DTI move`).join("; ")}).
      </Note>
      <label style={{ display: "block", fontSize: 13, color: INK, margin: "8px 0 4px" }}>
        Approval rates by group:{" "}
        <select value={attr} onChange={(e) => setAttr(e.target.value)} data-testid="fairness-attribute" style={{ padding: "2px 6px" }}>
          {attrs.map((k) => <option key={k} value={k}>{ATTRIBUTE_NAMES[k]}</option>)}
        </select>
      </label>
      <Table testId="fairness-groups" head={["Group", "Applicants", "Champion: approval rate (95% CI)", "vs overall", "Champion: AIR (95% CI)", "Model cut-off: rate, AIR", "As-is reference: rate"]} rows={champ.groups.map((r) => [
        r.group,
        count(r.applicants),
        `${pct(r.rate, 1)} (${range(r.rate_ci95[0], r.rate_ci95[1], (v) => pct(v, 1))})`,
        `${signed(100 * r.difference_from_overall, (v) => v.toFixed(1))} pts`,
        !r.rated ? `not rated (under ${f.min_rated_group})` : r.group === champ.reference_group ? "1.000 (reference)" : `${f3(r.adverse_impact_ratio)} (${range(r.air_ci95[0], r.air_ci95[1])})`,
        m[r.group] ? `${pct(m[r.group].rate, 1)}, ${m[r.group].rated ? f3(m[r.group].adverse_impact_ratio) : "not rated"}` : "—",
        a[r.group] ? pct(a[r.group].rate, 1) : "—"
      ])} />
      <Note testId="fairness-note">
        Seed-42 application pool; the champion is the bureau-score policy ({count(f.policies.bureau_score_policy.approvals)} approvals), the model cut-off approves the same number, and the as-is policy sees the true score, so it is a reference only. AIR is the group's rate over the highest rated group's ({f.interval_methods}).{" "}
        {g.legitimate_credit_factor
          ? "Income band is a legitimate credit factor: differences by income are expected and are not evidence of unfair treatment."
          : `AIR reference line: ${f.air_reference_line.value.toFixed(2)}. ${f.air_reference_line.note}`}
      </Note>
      <Note testId="fairness-legal"><strong>Legal status, as of October 2026.</strong> {LEGAL_STATUS}</Note>
      <Table testId="fairness-proxy" head={["Proxy check: attribute", "Groups", "AUC from the 14 features (95% CI)", "Reading"]} rows={Object.keys(ATTRIBUTE_NAMES).filter((k) => f.proxy.attributes[k]).map((k) => {
        const p = f.proxy.attributes[k];
        return [ATTRIBUTE_NAMES[k], p.groups, `${f3(p.auc)} (${range(p.auc_ci95[0], p.auc_ci95[1])})`, proxyReading(p)];
      })} />
      <Note>AUC near 0.5 means the features carry no usable proxy. A strong proxy for region or persona means a model could reproduce group differences without reading the attribute, which is why the group tables are watched.</Note>
    </section>
  );
}

function ChampionChallenger({ c }) {
  const pol = c.policies, champ = pol.bureau_score_policy, b = pol.challenger_b_overlay;
  const sw = b.swaps_by_hidden_typology, inf = sw.swap_out.INFLATION;
  const removed = Object.values(sw.swap_out).reduce((s, v) => s + v.expected_loss, 0);
  const added = Object.values(sw.swap_in).reduce((s, v) => s + v.expected_loss, 0);
  const db = b.difference_vs_champion.expected_loss, adv = -db.point;
  return (
    <section data-testid="credit-model-champion" aria-labelledby="cm-champion">
      <SubHeading id="cm-champion">Champion/challenger</SubHeading>
      <Note>The champion is the bureau-score policy: the credit policy's thresholds reading the bureau FICO the model sees (an evaluation variant, not the app's policy). Every challenger approves the same number on the seed-42 application pool ({count(champ.approvals)} of {count(c.applications)}), where every outcome is simulated. Differences are challenger minus champion with paired bootstrap 95% intervals.</Note>
      <Table testId="champion-table" head={["Policy", "Approvals", "Swapped in / out", "Expected loss", "Difference (95% CI)", "30+ DPD (rate)", "Hidden-fraud loans approved"]} rows={CC_ORDER.map((k) => {
        const r = pol[k], d = k !== "bureau_score_policy" && k !== "as_is_policy_reference" ? r.difference_vs_champion : null;
        return [c.labels[k], count(r.approvals), k === "bureau_score_policy" ? "—" : `${count(r.swap_in)} / ${count(r.swap_out)}`, usd(r.expected_loss), d ? diffCi(d.expected_loss, usd) : "—", `${count(r.dpd30)} (${pct(r.dpd30_rate)})`, count(r.fraud_approved)];
      })} />
      <Note testId="champion-rule">
        <strong>Challenger B's rule.</strong> Start from the champion's approvals; remove the {count(b.rule.k)} with the highest model PD and add the {count(b.rule.k)} champion reviews with the lowest PD that are not fraud referrals. f = {b.rule.f} was chosen on the calibration books, never on seed 42.
      </Note>
      {db.high < 0 && inf && (
        <Note testId="champion-source">
          <strong>Where the overlay's advantage comes from: mostly income-inflation fraud.</strong> Its swap-outs remove {usd(removed)} of expected loss and its swap-ins add {usd(added)}. The {count(inf.loans)} income-inflation loans among the swap-outs carry {usd(inf.expected_loss)} ({share(inf.expected_loss / removed)} of the removed loss), {inf.expected_loss > adv ? "more than the whole" : `${share(inf.expected_loss / adv)} of the`} {usd(adv)} advantage. The model catches income inflation perfectly by construction in this simulation, because only fraud loans have an income gap, so this margin does not transfer to real data.
        </Note>
      )}
      <Note>Both challengers are selectable in the Policy Sandbox (Credit lab), labelled model-based, evaluation only.</Note>
    </section>
  );
}

function RejectInference({ r }) {
  const rows = [];
  for (const [fam, methods] of Object.entries(r.families)) {
    for (const k of ["funded_only", "hard_cutoff", "fuzzy", "oracle"]) {
      const m = methods[k];
      if (!m) continue;
      rows.push([fam, METHOD_NAMES[k], f3(m.auc_all_applications), f3(m.auc_not_funded), signed(m.fico_effect_per_sd, f3), usd(m.expected_loss_at_champion_count), m.gap_closed ? share(m.gap_closed.expected_loss_at_champion_count) : "—"]);
    }
  }
  return (
    <section data-testid="credit-model-reject" aria-labelledby="cm-reject">
      <SubHeading id="cm-reject">Reject inference</SubHeading>
      <Note>The headline model learns from funded loans only. Augmentations are built from the {count(r.training_books.applications)} training-book applications ({count(r.training_books.not_funded)} not funded), never from seed 42; the oracle trains on every application's simulated outcome, which only synthetic data has. Expected loss is that of the lowest-PD applications up to the champion's count ({count(r.approval_count)}). Gap closed: the share of the funded-only-to-oracle gap; negative means worse.</Note>
      <Table testId="reject-table" head={["Family", "Method", "AUC, every application", "AUC, not funded", "FICO effect per SD", "Expected loss", "Gap closed: expected loss"]} rows={rows} />
      <Note>Both augmentations label the not-funded applicants with the funded-only model's own scores, so they can reinforce its bias instead of correcting it. Only real outcomes for declined applicants close the gap.</Note>
    </section>
  );
}

function Drift({ d }) {
  const books = Object.entries(d.books);
  const control = d.books.control, dealers = d.books.weaker_dealers;
  const quiet = (b) => b.max_feature_psi < d.thresholds.watch && b.psi_score.psi < d.thresholds.watch;
  return (
    <section data-testid="credit-model-drift" aria-labelledby="cm-drift">
      <SubHeading id="cm-drift">Drift</SubHeading>
      <Note>Four new books, each a new seed: an unchanged control and three shifts of one existing generator setting. PSI against the training books' funded loans, rated at {d.thresholds.watch.toFixed(2)} (watch) and {d.thresholds.act.toFixed(2)} (act). Performance has decayed if the calibration test fails or the AUC difference from the test book (AUC {f3(d.test_book_auc.auc)}) has a 95% interval wholly below 0.</Note>
      <Table testId="drift-table" head={["Book", "Setting", "Largest feature PSI", "Score PSI", "AUC − test book (95% CI)", "Predicted / observed", "Calibration", "Decayed"]} rows={books.map(([k, b]) => {
        const top = Object.entries(b.psi_features).sort((x, y) => y[1].psi - x[1].psi)[0];
        return [
          `${BOOK_NAMES[k] ?? k} (${b.seed})`,
          b.setting,
          `${f3(top[1].psi)} (${top[0]}, ${top[1].rating})`,
          `${f3(b.psi_score.psi)} (${b.psi_score.rating})`,
          `${signed(b.auc_difference_vs_test.difference, f3)} (${signed(b.auc_difference_vs_test.ci95[0], f3)} to ${signed(b.auc_difference_vs_test.ci95[1], f3)})`,
          `${pct(b.calibration_in_the_large.mean_predicted)} / ${pct(b.calibration_in_the_large.observed)}`,
          b.calibration_test.off ? "off" : "holds",
          b.decayed ? "yes" : "no"
        ];
      })} />
      <Note testId="drift-notes">
        {control && (quiet(control) && !control.decayed
          ? "The control book stays under the watch line on every feature and on the score, and is not flagged as decayed. "
          : "The control book moved or decayed; see the model card. ")}
        With about 250 defaults per book, AUC can't reliably detect drops of about 0.05; calibration is the more sensitive monitor here.
        {dealers && quiet(dealers) && dealers.calibration_test.off && " Feature PSI can't see a channel shift: the weaker-dealer book changes only how strongly dealer quality drives default, so no feature or score moves, yet calibration is off. That takes outcome monitors, which arrive months after funding."}
      </Note>
    </section>
  );
}

/** The four Sprint 12 sections, from the properties snapshot. */
export function ModelProperties({ properties }) {
  if (properties.status === "loading") return <Note>Loading the model's tested properties…</Note>;
  if (properties.status !== "ready") return <Note>The credit-model properties snapshot is not published here.</Note>;
  const p = properties.data;
  return (
    <section style={styles.panel} data-testid="credit-model-properties" aria-labelledby="cm-properties">
      <h3 id="cm-properties" style={styles.panelTitle}>Tested properties</h3>
      <Note>{p.label} Developer testing, not independent validation; these results come from synthetic truth and do not transfer to real lending.</Note>
      <Fairness f={p.fairness} />
      <ChampionChallenger c={p.champion_challenger} />
      <RejectInference r={p.reject_inference} />
      <Drift d={p.drift} />
    </section>
  );
}

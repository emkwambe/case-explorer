// src/ui/tabs/outcomeTab.jsx — What actually happened.
//
// This is ground truth about the future. It is never available when the decision is made,
// and the feature policy bars every field of it from decision inputs. It exists so a policy
// can be graded on outcomes rather than on agreement with another policy.

import React from "react";
import { styles, OUTCOME_COLORS, titleCase } from "../theme.js";
import { MetricCard, Panel, KV, Callout } from "../components/primitives.jsx";

export function OutcomeTab({ caseData, scored }) {
  const p = caseData.performance;
  if (!p) return <Callout tone="warn">This case carries no simulated performance.</Callout>;

  const defaulted = p.status === "DEFAULT";
  const statusColor = defaulted ? "#ef4444" : p.status === "DELINQUENT" ? "#f59e0b" : "#10b981";
  const decision = scored?.decision.outcome;
  const funded = decision === "APPROVE";

  const verdict = defaulted
    ? funded
      ? { tone: "bad", text: "The policy approved this loan and it defaulted. That is a realised loss." }
      : { tone: "good", text: "The policy did not approve this loan, and it would have defaulted. Loss avoided." }
    : funded
      ? { tone: "good", text: "The policy approved this loan and it performed." }
      : { tone: "warn", text: "The policy did not approve this loan, but it would have performed. That is a false decline, and the margin on it is forgone." };

  return (
    <div>
      <Callout tone="info">
        Simulated over {p.horizon_months} months from world truth. A lender never has this at decision time, and the feature
        policy blocks every field here from reaching a rule or a model. Performance is simulated for declined applications
        too, because without that counterfactual a false decline cannot be measured.
      </Callout>

      <div style={styles.grid4}>
        <MetricCard title="Outcome" value={titleCase(p.status)} color={statusColor} subtitle={`${p.months_paid} of ${p.horizon_months} payments made`} />
        <MetricCard
          title="Realised loss"
          value={p.realized_loss ? `$${p.realized_loss.toLocaleString()}` : "None"}
          color={defaulted ? "#ef4444" : "#10b981"}
          subtitle={defaulted ? `loss given default ${(p.loss_given_default * 100).toFixed(1)}%` : "loan performed"}
        />
        <MetricCard title="Months to default" value={p.months_to_default ?? "n/a"} color="#7c3aed" subtitle={p.first_payment_default ? "first-payment default" : "not applicable"} />
        <MetricCard title="Policy decision" value={decision ?? "n/a"} color={OUTCOME_COLORS[decision] ?? "#64748b"} subtitle={funded ? "funded" : "not funded"} />
      </div>

      <Callout tone={verdict.tone}>{verdict.text}</Callout>

      <div style={styles.grid2}>
        <Panel title="Performance detail">
          <KV label="Status">{titleCase(p.status)}</KV>
          <KV label="Horizon">{p.horizon_months} months</KV>
          <KV label="Payments made">{p.months_paid}</KV>
          <KV label="Payments received">${(p.payments_received ?? 0).toLocaleString()}</KV>
          <KV label="Worst run of missed payments">{p.max_consecutive_missed_payments}</KV>
          <KV label="Loss given default">{defaulted ? `${(p.loss_given_default * 100).toFixed(1)}%` : "not applicable"}</KV>
          <KV label="Simulation version" mono>{p.simulation_version}</KV>
        </Panel>

        <Panel title="What drove the outcome">
          {p.drivers?.length ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
              {p.drivers.map((d, i) => (
                <li key={`${d.driver}-${i}`}>
                  <strong>{titleCase(d.driver)}</strong>
                  {Object.entries(d).filter(([k]) => k !== "driver").map(([k, val]) => (
                    <span key={k} style={{ color: "#64748b" }}> · {titleCase(k)} {typeof val === "number" ? val.toLocaleString() : String(val)}</span>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <span style={{ color: "#64748b", fontSize: 13 }}>
              No stress events. True income covered the payment, the obligations and the household costs every month.
            </span>
          )}
          <div style={{ ...styles.note, marginTop: 12, marginBottom: 0 }}>
            The simulation runs on world truth, so an applicant who overstated income is underwritten on the claim but lives
            on the truth. Damage from misrepresentation emerges from that gap rather than being asserted.
          </div>
        </Panel>
      </div>
    </div>
  );
}

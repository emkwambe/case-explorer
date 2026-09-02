// src/observability/metrics.js — In-process operational metrics with Prometheus text exposition.
//
// Tracks: generation failures, schema failures, scoring latency, model prediction distribution,
// decision distribution, rule firing rates, manual-review rate, explanation availability, and the
// component versions in use. Exposed at GET /api/metrics.

import { FRAUD_RULESET_VERSION } from "../decisioning/fraud-rules/rules.js";
import { UNDERWRITING_POLICY_VERSION } from "../decisioning/underwriting/policy.js";
import { REASON_CODE_CATALOG_VERSION } from "../decisioning/reason-codes/catalog.js";
import { GENERATOR_VERSION } from "../core/case.js";

const LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];
const SCORE_BUCKETS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

export class Metrics {
  constructor() { this.reset(); }
  reset() {
    this.counters = {
      cases_generated_total: 0, generation_failures_total: 0, schema_failures_total: 0,
      cases_scored_total: 0, decisions_total: { APPROVE: 0, MANUAL_REVIEW: 0, DECLINE: 0 },
      rule_fired_total: {}, reason_code_total: {}, explanations_available_total: 0,
      review_actions_total: 0, investigations_opened_total: 0, audit_events_total: 0, http_errors_total: {}
    };
    this.scoring_latency_ms = { buckets: new Array(LATENCY_BUCKETS.length + 1).fill(0), sum: 0, count: 0 };
    this.model_scores = { buckets: new Array(SCORE_BUCKETS.length).fill(0), sum: 0, count: 0 };
    this.started_at = Date.now();
  }
  recordGeneration(n = 1) { this.counters.cases_generated_total += n; }
  recordGenerationFailure() { this.counters.generation_failures_total++; }
  recordSchemaFailure() { this.counters.schema_failures_total++; }
  recordScore(record, latencyMs) {
    this.counters.cases_scored_total++;
    this.counters.decisions_total[record.decision.outcome] = (this.counters.decisions_total[record.decision.outcome] || 0) + 1;
    for (const a of record.alerts) this.counters.rule_fired_total[a.rule_id] = (this.counters.rule_fired_total[a.rule_id] || 0) + 1;
    for (const c of record.decision.reason_codes) this.counters.reason_code_total[c] = (this.counters.reason_code_total[c] || 0) + 1;
    if (record.explanation) this.counters.explanations_available_total++;
    let i = LATENCY_BUCKETS.findIndex(b => latencyMs <= b); if (i < 0) i = LATENCY_BUCKETS.length;
    this.scoring_latency_ms.buckets[i]++; this.scoring_latency_ms.sum += latencyMs; this.scoring_latency_ms.count++;
    if (record.model_output?.score !== undefined) {
      const s = record.model_output.score;
      let k = SCORE_BUCKETS.findIndex(b => s <= b); if (k < 0) k = SCORE_BUCKETS.length - 1;
      this.model_scores.buckets[k]++; this.model_scores.sum += s; this.model_scores.count++;
    }
  }
  recordReview(opened = false) { this.counters.review_actions_total++; if (opened) this.counters.investigations_opened_total++; }
  recordAudit(n = 1) { this.counters.audit_events_total += n; }
  recordHttpError(status) { this.counters.http_errors_total[status] = (this.counters.http_errors_total[status] || 0) + 1; }

  snapshot() {
    const c = this.counters;
    const scored = c.cases_scored_total || 1;
    return {
      uptime_seconds: Math.round((Date.now() - this.started_at) / 1000),
      versions: { generator: GENERATOR_VERSION, ruleset: FRAUD_RULESET_VERSION, policy: UNDERWRITING_POLICY_VERSION, reason_codes: REASON_CODE_CATALOG_VERSION },
      counters: c,
      rates: {
        manual_review_rate: c.decisions_total.MANUAL_REVIEW / scored,
        decline_rate: c.decisions_total.DECLINE / scored,
        approval_rate: c.decisions_total.APPROVE / scored,
        explanation_availability: c.explanations_available_total / scored,
        rule_firing_rates: Object.fromEntries(Object.entries(c.rule_fired_total).map(([k, v]) => [k, v / scored]))
      },
      scoring_latency_ms: { mean: this.scoring_latency_ms.count ? this.scoring_latency_ms.sum / this.scoring_latency_ms.count : null, count: this.scoring_latency_ms.count },
      model_score_distribution: { buckets: SCORE_BUCKETS.map((b, i) => ({ le: b, count: this.model_scores.buckets[i] })), mean: this.model_scores.count ? this.model_scores.sum / this.model_scores.count : null }
    };
  }

  /** Prometheus text exposition format. */
  prometheus() {
    const c = this.counters;
    const lines = [];
    const gauge = (name, help, value, labels = "") => { lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name}${labels} ${value}`); };
    const counter = (name, help, entries) => { lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`); for (const [labels, v] of entries) lines.push(`${name}${labels} ${v}`); };
    counter("case_explorer_cases_generated_total", "Cases generated", [["", c.cases_generated_total]]);
    counter("case_explorer_generation_failures_total", "Generation failures", [["", c.generation_failures_total]]);
    counter("case_explorer_schema_failures_total", "Contract validation failures", [["", c.schema_failures_total]]);
    counter("case_explorer_decisions_total", "Decisions by outcome", Object.entries(c.decisions_total).map(([k, v]) => [`{outcome="${k}"}`, v]));
    counter("case_explorer_rule_fired_total", "Rule alerts by rule id", Object.entries(c.rule_fired_total).map(([k, v]) => [`{rule="${k}"}`, v]));
    counter("case_explorer_reason_code_total", "Reason codes issued", Object.entries(c.reason_code_total).map(([k, v]) => [`{code="${k}"}`, v]));
    counter("case_explorer_review_actions_total", "Investigation actions", [["", c.review_actions_total]]);
    counter("case_explorer_audit_events_total", "Audit events appended", [["", c.audit_events_total]]);
    counter("case_explorer_http_errors_total", "HTTP errors by status", Object.entries(c.http_errors_total).map(([k, v]) => [`{status="${k}"}`, v]));
    lines.push("# HELP case_explorer_scoring_latency_ms Scoring latency", "# TYPE case_explorer_scoring_latency_ms histogram");
    let cum = 0;
    LATENCY_BUCKETS.forEach((b, i) => { cum += this.scoring_latency_ms.buckets[i]; lines.push(`case_explorer_scoring_latency_ms_bucket{le="${b}"} ${cum}`); });
    cum += this.scoring_latency_ms.buckets[LATENCY_BUCKETS.length];
    lines.push(`case_explorer_scoring_latency_ms_bucket{le="+Inf"} ${cum}`, `case_explorer_scoring_latency_ms_sum ${this.scoring_latency_ms.sum}`, `case_explorer_scoring_latency_ms_count ${this.scoring_latency_ms.count}`);
    lines.push("# HELP case_explorer_model_score Model prediction distribution", "# TYPE case_explorer_model_score histogram");
    let cs = 0;
    SCORE_BUCKETS.forEach((b, i) => { cs += this.model_scores.buckets[i]; lines.push(`case_explorer_model_score_bucket{le="${b}"} ${cs}`); });
    lines.push(`case_explorer_model_score_bucket{le="+Inf"} ${cs}`, `case_explorer_model_score_sum ${this.model_scores.sum}`, `case_explorer_model_score_count ${this.model_scores.count}`);
    gauge("case_explorer_explanation_availability", "Share of scored cases with an explanation", c.cases_scored_total ? c.explanations_available_total / c.cases_scored_total : 0);
    gauge("case_explorer_component_info", "Component versions", 1, `{generator="${GENERATOR_VERSION}",ruleset="${FRAUD_RULESET_VERSION}",policy="${UNDERWRITING_POLICY_VERSION}",reason_codes="${REASON_CODE_CATALOG_VERSION}"}`);
    return lines.join("\n") + "\n";
  }
}

export const metrics = new Metrics();

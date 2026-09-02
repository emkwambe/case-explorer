-- 001_core.sql — Operational schema for Case Explorer (datasets, cases, models, decisions, investigations, audit).
-- Evidence, decisions, explanations, evaluations and audit events are immutable: UPDATE/DELETE are blocked by trigger.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dataset_versions (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  dataset_version TEXT NOT NULL,
  generator_version TEXT NOT NULL,
  generator_commit TEXT,
  configuration_hash TEXT NOT NULL,
  seed TEXT,
  population_regime TEXT NOT NULL,
  as_of_date DATE,
  record_count INTEGER NOT NULL,
  manifest JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generation_runs (
  id TEXT PRIMARY KEY,
  dataset_version_id TEXT REFERENCES dataset_versions(id),
  requested_by TEXT,
  request JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  error TEXT
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  dataset_version_id TEXT REFERENCES dataset_versions(id),
  schema_version TEXT NOT NULL,
  corruption_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  expected_outcome TEXT NOT NULL,
  body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cases_dataset ON cases(dataset_version_id);
CREATE INDEX IF NOT EXISTS idx_cases_type ON cases(corruption_type);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT,
  owner TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_versions (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id),
  version TEXT NOT NULL,
  strategy TEXT NOT NULL,
  backend TEXT,
  developer TEXT,
  feature_schema_version TEXT,
  dataset_version_id TEXT,
  training_manifest JSONB,
  state TEXT NOT NULL DEFAULT 'DRAFT',
  threshold DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, version)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,           -- MODEL_VERSION | RULESET | BENCHMARK
  subject_id TEXT NOT NULL,
  split TEXT,
  metrics JSONB NOT NULL,
  report_markdown TEXT,
  evaluated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS validation_findings (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
  severity TEXT NOT NULL,
  finding TEXT NOT NULL,
  remediation_status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_versions (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES decision_policies(id),
  version TEXT NOT NULL,
  ruleset_version TEXT,
  reason_code_catalog_version TEXT,
  thresholds JSONB,
  approved_by TEXT,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version)
);

CREATE TABLE IF NOT EXISTS case_decisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  case_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  model_version TEXT,
  outcome TEXT NOT NULL,
  reason_codes TEXT[] NOT NULL,
  alerts JSONB NOT NULL,
  decision JSONB NOT NULL,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_decisions_case ON case_decisions(case_id, scored_at DESC);

CREATE TABLE IF NOT EXISTS decision_explanations (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES case_decisions(id),
  explanation JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  state TEXT NOT NULL,
  body JSONB NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_investigations_case ON investigations(case_id);

CREATE TABLE IF NOT EXISTS review_actions (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id),
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  role TEXT NOT NULL,
  previous_state TEXT,
  new_state TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  case_version TEXT,
  model_version TEXT,
  policy_version TEXT,
  previous_state TEXT,
  new_state TEXT,
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_hash TEXT,
  hash TEXT NOT NULL,
  body JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_case ON audit_events(case_version, seq);

-- Immutability guard
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only (immutable versions)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_events', 'case_decisions', 'decision_explanations', 'evaluations', 'review_actions', 'dataset_versions']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'immutable_' || t) THEN
      EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_mutation()', t, t);
    END IF;
  END LOOP;
END $$;

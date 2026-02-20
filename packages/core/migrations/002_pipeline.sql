-- Pipeline Framework Schema
-- Phase 2: Workflow runs, steps, and artifacts

-- Workflow runs (one per pipeline execution)
CREATE TABLE workflow_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id),
  project_id UUID NOT NULL REFERENCES project(id),
  pipeline_key TEXT NOT NULL,
  pipeline_version TEXT NOT NULL DEFAULT '1.0',
  config_version_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_by_user_id UUID NOT NULL REFERENCES "user"(id),
  correlation_id UUID DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_run_project ON workflow_run(org_id, project_id, created_at DESC);
CREATE INDEX idx_run_status ON workflow_run(org_id, status, created_at DESC);

-- Run steps (each discrete stage of a pipeline)
CREATE TABLE run_step (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_run(id),
  step_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  attempt INT NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  UNIQUE (run_id, step_key, attempt)
);
CREATE INDEX idx_step_run ON run_step(run_id, step_key);

-- Artifacts (final output documents)
CREATE TABLE artifact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id),
  run_id UUID NOT NULL REFERENCES workflow_run(id),
  project_id UUID NOT NULL REFERENCES project(id),
  artifact_type TEXT NOT NULL,
  file_object_id UUID NOT NULL REFERENCES file_object(id),
  version INT NOT NULL DEFAULT 1,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  reviewed_by_user_id UUID REFERENCES "user"(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, artifact_type, version)
);
CREATE INDEX idx_artifact_project ON artifact(org_id, project_id, created_at DESC);

-- Add FK constraints to event table for run tracking
-- Only if not already present
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'event_run_id_fkey') THEN
    ALTER TABLE event ADD CONSTRAINT event_run_id_fkey FOREIGN KEY (run_id) REFERENCES workflow_run(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'event_step_id_fkey') THEN
    ALTER TABLE event ADD CONSTRAINT event_step_id_fkey FOREIGN KEY (step_id) REFERENCES run_step(id);
  END IF;
END $$;

-- Crucible Foundation Schema
-- Phase 0: Core entities + event log

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Orgs
CREATE TABLE org (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users
CREATE TABLE "user" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Memberships
CREATE TABLE membership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id),
  user_id UUID NOT NULL REFERENCES "user"(id),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'staff', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

-- Subjects (the person the workflow is about — may or may not be the user)
CREATE TABLE subject (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id),
  external_ref TEXT,
  display_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subject_org ON subject(org_id);

-- Projects (persistent case/file container)
CREATE TABLE project (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id),
  subject_id UUID NOT NULL REFERENCES subject(id),
  created_by_user_id UUID NOT NULL REFERENCES "user"(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_org_subject ON project(org_id, subject_id, created_at DESC);

-- File objects (pointers to R2/S3 blob storage)
CREATE TABLE file_object (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id),
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  byte_size BIGINT,
  mime_type TEXT,
  sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_file_object_org ON file_object(org_id);

-- Documents (user uploads + derived intermediate files)
CREATE TABLE document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id),
  project_id UUID NOT NULL REFERENCES project(id),
  kind TEXT NOT NULL,
  file_object_id UUID NOT NULL REFERENCES file_object(id),
  source TEXT NOT NULL DEFAULT 'user_upload',
  created_by_user_id UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_document_project ON document(org_id, project_id, created_at DESC);

-- Events (append-only structured audit/telemetry log)
CREATE TABLE event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id),
  project_id UUID REFERENCES project(id),
  run_id UUID,
  step_id UUID,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'error')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'staff', 'system', 'ai', 'admin')),
  actor_user_id UUID REFERENCES "user"(id),
  actor_label TEXT,
  data_classification TEXT NOT NULL DEFAULT 'internal',
  retention_class TEXT NOT NULL DEFAULT 'standard',
  correlation_id UUID,
  parent_event_id UUID REFERENCES event(id),
  payload JSONB NOT NULL DEFAULT '{}',
  sensitive_ref TEXT
);
CREATE INDEX idx_event_org_ts ON event(org_id, ts DESC);
CREATE INDEX idx_event_run ON event(run_id, ts ASC);
CREATE INDEX idx_event_project ON event(project_id, ts DESC);
CREATE INDEX idx_event_type ON event(event_type, ts DESC);

-- Consent records
CREATE TABLE consent_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id),
  subject_id UUID NOT NULL REFERENCES subject(id),
  consent_scope TEXT NOT NULL CHECK (consent_scope IN ('service', 'analytics', 'research')),
  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted', 'revoked')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  granted_by_user_id UUID REFERENCES "user"(id),
  consent_text_version TEXT NOT NULL,
  collection_method TEXT NOT NULL DEFAULT 'ui_checkbox',
  notes TEXT
);
CREATE INDEX idx_consent_subject ON consent_record(org_id, subject_id);

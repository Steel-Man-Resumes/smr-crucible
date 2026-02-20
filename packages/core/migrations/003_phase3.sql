-- Phase 3: Output Expansion + Pipeline Evolution
-- Adds run_data (immutable data products), bundle (package container), artifact extensions

-- Typed, named, immutable data products per run
CREATE TABLE run_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_run(id),
  key TEXT NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  hash TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('pii', 'sensitive', 'internal', 'research_eligible')),
  producer_step_key TEXT NOT NULL,
  data JSONB NOT NULL,
  raw_ref UUID REFERENCES file_object(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, key)
);

CREATE INDEX idx_run_data_run_key ON run_data(run_id, key);
CREATE INDEX idx_run_data_run_created ON run_data(run_id, created_at);

-- Bundle: package container for grouped artifacts
CREATE TABLE bundle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_run(id),
  org_id UUID NOT NULL REFERENCES org(id),
  project_id UUID NOT NULL REFERENCES project(id),
  status TEXT NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'awaiting_review', 'ready', 'published')),
  manifest JSONB,
  zip_file_object_id UUID REFERENCES file_object(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX idx_bundle_run ON bundle(run_id);
CREATE INDEX idx_bundle_project ON bundle(org_id, project_id, created_at DESC);

-- Extend artifact table for Phase 3 dashboard presentation
ALTER TABLE artifact ADD COLUMN IF NOT EXISTS artifact_key TEXT;
ALTER TABLE artifact ADD COLUMN IF NOT EXISTS bundle_id UUID REFERENCES bundle(id);
ALTER TABLE artifact ADD COLUMN IF NOT EXISTS display_title TEXT;
ALTER TABLE artifact ADD COLUMN IF NOT EXISTS display_section TEXT
  CHECK (display_section IS NULL OR display_section IN ('start_here', 'apply', 'interview', 'negotiate', 'barriers', 'online'));
ALTER TABLE artifact ADD COLUMN IF NOT EXISTS preview_type TEXT DEFAULT 'none'
  CHECK (preview_type IN ('none', 'html', 'pdf_thumb'));
ALTER TABLE artifact ADD COLUMN IF NOT EXISTS order_index INT DEFAULT 0;
ALTER TABLE artifact ADD COLUMN IF NOT EXISTS depends_on_keys JSONB;

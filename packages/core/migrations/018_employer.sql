-- 018_employer.sql
-- Verified fair-chance employers, imported from the SMR Employers Airtable
-- (source of truth). The app reads from this table; re-run the importer to
-- refresh. Only `published` rows are shown to job seekers.

CREATE TABLE IF NOT EXISTS employer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'airtable',
  source_record_id TEXT,
  name TEXT NOT NULL,
  employer_type TEXT,
  industry TEXT,
  primary_city TEXT,
  county TEXT,
  wi_region TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  contact_person TEXT,
  website TEXT,
  careers_url TEXT,
  linkedin TEXT,
  role_types TEXT,
  evidence_summary TEXT,
  evidence_type TEXT,
  caveats TEXT,
  confidence_tier TEXT,
  confidence_score INT,
  rank INT,
  board_fit TEXT,
  publish_recommendation TEXT,
  verification_status TEXT,
  follow_up_priority TEXT,
  suggested_outreach_ask TEXT,
  tags TEXT,
  status TEXT,
  last_verified DATE,
  published BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_employer_source UNIQUE (source, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_employer_published ON employer(published) WHERE published = true;
CREATE INDEX IF NOT EXISTS idx_employer_industry ON employer(industry);

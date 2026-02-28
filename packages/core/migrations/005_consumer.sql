-- Consumer Module: Forge + Refinery tables
-- Extends foundation schema for direct-to-consumer reentry platform.
-- References existing: user, org, event tables from 001_foundation.sql

-- Consumer profile: narrative data, readiness stage, preferences
-- Separate from B2B 'subject' — this is the user's own profile.
CREATE TABLE consumer_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  readiness_stage TEXT CHECK (readiness_stage IN (
    'precontemplation', 'contemplation', 'preparation', 'action', 'maintenance'
  )),
  -- Structured profile data (parsed from resume, user input)
  profile_data JSONB NOT NULL DEFAULT '{}',
  -- Narrative elements (strengths, story, goals — never scored)
  narrative_data JSONB NOT NULL DEFAULT '{}',
  -- User preferences (work prefs, location, etc.)
  preferences JSONB NOT NULL DEFAULT '{}',
  -- Skills extracted by AI
  skills JSONB NOT NULL DEFAULT '[]',
  -- Career paths identified
  career_paths JSONB NOT NULL DEFAULT '[]',
  -- The Forge output (full narrative reconstruction)
  forge_output JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_consumer_profile_user ON consumer_profile(user_id);

-- Consumer consent: layered, independently revocable per design brief
-- Separate from B2B consent_record — consumer consent has more granular layers.
CREATE TABLE consumer_consent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- Layered consent per JBS/WS5 requirements
  consent_layer TEXT NOT NULL CHECK (consent_layer IN (
    'core',       -- Essential service operation
    'enhanced',   -- AI-powered analysis and recommendations
    'research',   -- De-identified data for research
    'sharing'     -- Share data with organizations (user controls scope)
  )),
  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted', 'revoked')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  -- Which version of consent text the user agreed to
  consent_text_version TEXT NOT NULL,
  -- How consent was collected
  collection_method TEXT NOT NULL DEFAULT 'ui_toggle',
  -- IP/device fingerprint for audit (hashed, not raw)
  collection_context JSONB NOT NULL DEFAULT '{}',
  UNIQUE (user_id, consent_layer)
);

CREATE INDEX idx_consumer_consent_user ON consumer_consent(user_id);

-- Decision log: append-only audit trail for every AI recommendation
-- Required by WS5 (decision observability) and JBS compliance.
CREATE TABLE decision_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Optional user link (may be anonymous in Forge flow)
  user_id UUID REFERENCES "user"(id) ON DELETE SET NULL,
  -- Anonymous session ID for pre-auth Forge users
  session_id TEXT,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- What page/context the AI was responding in
  context_page TEXT NOT NULL,
  -- The model used
  model_provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  -- Hash of the input (not the raw input — privacy)
  input_hash TEXT NOT NULL,
  -- The AI's explanation of its recommendation (required, not optional)
  explanation TEXT NOT NULL,
  -- Structured output summary
  output_summary JSONB NOT NULL DEFAULT '{}',
  -- Token usage for cost tracking
  token_count INT,
  latency_ms INT,
  -- Was the recommendation accepted/rejected/ignored by the user?
  user_action TEXT CHECK (user_action IN ('accepted', 'rejected', 'ignored', 'modified', NULL))
);

CREATE INDEX idx_decision_log_user ON decision_log(user_id, ts DESC);
CREATE INDEX idx_decision_log_session ON decision_log(session_id, ts DESC);
CREATE INDEX idx_decision_log_page ON decision_log(context_page, ts DESC);

-- Forge session: tracks progress through Forge flow
-- Works for both anonymous and authenticated users.
CREATE TABLE forge_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Anonymous session identifier (set on first page load)
  session_id TEXT NOT NULL UNIQUE,
  -- Linked after account creation
  user_id UUID REFERENCES "user"(id) ON DELETE SET NULL,
  -- Current page in the flow
  current_page TEXT NOT NULL DEFAULT 'landing',
  -- Collected input data per page (keyed by page name)
  page_data JSONB NOT NULL DEFAULT '{}',
  -- Resume text (extracted, may be large)
  resume_text TEXT,
  -- Resume file reference
  resume_file_id UUID REFERENCES file_object(id),
  -- Parsed profile from resume
  parsed_profile JSONB,
  -- The completed Forge output
  forge_output JSONB,
  -- Status
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN (
    'in_progress', 'completed', 'abandoned'
  )),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_forge_session_user ON forge_session(user_id);
CREATE INDEX idx_forge_session_activity ON forge_session(last_activity_at DESC);

-- Refinery artifact: persistent workshop outputs
-- Linked to consumer profile, not a one-time generation.
CREATE TABLE refinery_artifact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- What tool created it
  artifact_type TEXT NOT NULL CHECK (artifact_type IN (
    'resume', 'cover_letter', 'disclosure_plan',
    'interview_prep', 'resource_list', 'job_match'
  )),
  -- Target job/context this artifact was built for
  target_context JSONB NOT NULL DEFAULT '{}',
  -- The artifact content (structured)
  content JSONB NOT NULL,
  -- Optional file in R2
  file_id UUID REFERENCES file_object(id),
  -- Iteration tracking (fading scaffold — WS6)
  iteration_number INT NOT NULL DEFAULT 1,
  -- How much scaffold was provided (1.0 = full template, 0.0 = independent)
  scaffold_level NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refinery_artifact_user ON refinery_artifact(user_id, artifact_type, created_at DESC);

-- Data access log: who accessed what, when, why (JBS compliance)
CREATE TABLE data_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Whose data was accessed
  target_user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- Who accessed it
  accessor_type TEXT NOT NULL CHECK (accessor_type IN ('user', 'staff', 'system', 'ai', 'org')),
  accessor_id TEXT NOT NULL,
  -- What was accessed
  resource_type TEXT NOT NULL,
  resource_id UUID,
  -- Why
  access_reason TEXT NOT NULL,
  -- When
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- What data fields were included
  fields_accessed JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_data_access_user ON data_access_log(target_user_id, accessed_at DESC);
CREATE INDEX idx_data_access_accessor ON data_access_log(accessor_type, accessor_id, accessed_at DESC);

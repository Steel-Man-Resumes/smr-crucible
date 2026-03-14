-- Application Tracker
-- Pipeline: saved → applied → heard_back → interviewing → offered / declined / rejected
-- Snapshots job data at save time so listings can expire without losing user's history.

CREATE TABLE IF NOT EXISTS job_application (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Job data (snapshot from JSearch at save time)
  job_title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  salary TEXT,
  description TEXT,
  employment_type TEXT,
  source TEXT DEFAULT 'jsearch',
  source_id TEXT,

  -- Pipeline
  status TEXT NOT NULL DEFAULT 'saved',
  status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Linked artifacts
  resume_artifact_id UUID REFERENCES refinery_artifact(id),
  disclosure_plan_id UUID REFERENCES refinery_artifact(id),

  -- User notes
  notes TEXT,
  applied_at TIMESTAMPTZ,
  follow_up_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_app_user ON job_application(user_id);
CREATE INDEX IF NOT EXISTS idx_job_app_status ON job_application(user_id, status);
CREATE INDEX IF NOT EXISTS idx_job_app_source ON job_application(source_id);

-- 025: t.ROY hands wave (2026-08-03) -- chat settings + support requests.
--
-- Chat settings follow the users.coach_* column convention from 016:
--   coach_voice          -- read replies aloud (browser speechSynthesis)
--   coach_plain_language -- simplest-possible wording mode
--   coach_language       -- reply language ('en' | 'es'; UI stays English)
--
-- support_request backs the "Message Troy" escalation: the DB row is the
-- source of truth (email notify is best-effort), listed on the admin panel.

ALTER TABLE users ADD COLUMN IF NOT EXISTS coach_voice BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS coach_plain_language BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS coach_language TEXT NOT NULL DEFAULT 'en';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_coach_language_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_coach_language_check
      CHECK (coach_language IN ('en', 'es'));
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS support_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,
  message TEXT NOT NULL,
  thread_excerpt TEXT,
  page TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'replied', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_request_status
  ON support_request (status, created_at DESC);

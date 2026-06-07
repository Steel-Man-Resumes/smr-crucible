-- 016: Onboarding state + AI Career Coach
-- Master plan Section 4 (Intelligence Engine) + Section 5 (AI Career Coach).
-- NOTE: the master plan called this "Migration 018." Renumbered to 016 (next
-- available) because the vertical build needs onboarding/coach BEFORE the content
-- CMS and employer tables. Migration runner applies *.sql in lexical order.
--
-- Canonical user table is "users" (plural, NextAuth) per 008_fix_consumer_fks.sql.
-- All columns added here are idempotent (IF NOT EXISTS) and safe to re-run.

-- --- Onboarding + journey state (Section 3, Stage 0) ---
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_tour_complete BOOL NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_tour_deferrals INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_stage INT NOT NULL DEFAULT 0;

-- next_step_cache: computeNextStep() result, refreshed on action (max staleness 1h)
ALTER TABLE users ADD COLUMN IF NOT EXISTS next_step_cache JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS next_step_cached_at TIMESTAMPTZ;

-- --- AI Career Coach settings (Section 5, Settings -> "Your Coach") ---
ALTER TABLE users ADD COLUMN IF NOT EXISTS coach_name TEXT NOT NULL DEFAULT 'Guide';
ALTER TABLE users ADD COLUMN IF NOT EXISTS coach_style TEXT NOT NULL DEFAULT 'balanced';
ALTER TABLE users ADD COLUMN IF NOT EXISTS coach_length TEXT NOT NULL DEFAULT 'full';
ALTER TABLE users ADD COLUMN IF NOT EXISTS coach_focus TEXT NOT NULL DEFAULT 'guide';
ALTER TABLE users ADD COLUMN IF NOT EXISTS coach_creativity INT NOT NULL DEFAULT 50;

-- Constraint guards (separate statements for IF NOT EXISTS compatibility, per 007 pattern)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_coach_style_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_coach_style_check
      CHECK (coach_style IN ('supportive', 'balanced', 'direct'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_coach_length_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_coach_length_check
      CHECK (coach_length IN ('brief', 'full'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_coach_focus_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_coach_focus_check
      CHECK (coach_focus IN ('guide', 'answer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_coach_creativity_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_coach_creativity_check
      CHECK (coach_creativity BETWEEN 0 AND 100);
  END IF;
END$$;

-- --- Coach conversation history (Section 5) ---
-- Retention: last 50 messages loaded live; older summarized into context_digest.
-- Privacy: NEVER exposed to partner dashboards (Section 6 / Codex governance note).
CREATE TABLE IF NOT EXISTS coach_conversation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  -- Rolling summary of older turns, regenerated when message count exceeds 50
  context_digest TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coach_conversation_user
  ON coach_conversation(user_id, created_at DESC);

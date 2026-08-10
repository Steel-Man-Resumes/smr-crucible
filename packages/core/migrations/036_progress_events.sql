-- 036_progress_events.sql
-- Phase 1D: server activity ledger. The consumer app's ONLY activity store
-- today is a per-browser localStorage blob ("consumer_progress") -- it never
-- reaches the server, so it is lost on a new device, a cleared browser, or a
-- sign-out (RefineryShell clears it on purpose for shared-machine isolation).
-- This table is the server-side counterpart the Progress page and the gate
-- decision (see packages/core/src/journey.ts) can read as truth. Additive
-- and append-only, same shape family as application_status_event (033).
--
-- Phase 4.3 gamification reads the same table -- do not narrow event_type to
-- a fixed enum here; new event types should extend PROGRESS_EVENT_TYPES in
-- journey.ts rather than a migration.
CREATE TABLE IF NOT EXISTS user_progress_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_progress_event_user_type
  ON user_progress_event (user_id, event_type);

CREATE INDEX IF NOT EXISTS idx_user_progress_event_user_created
  ON user_progress_event (user_id, created_at);

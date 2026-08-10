-- 035_voice_sessions.sql
-- Phase 1D: server-enforced voice practice metering.
--
-- Doctrine: the browser can no longer be trusted to cap its own OpenAI
-- Realtime session -- the token route used to hand the browser an ephemeral
-- key and the browser POSTed the SDP offer straight to OpenAI, so the server
-- never learned a call happened, let alone how long it ran. This table is
-- the server-side lease: before any WebRTC connection is allowed to open,
-- the app reserves a row here (atomic minute-budget check + one-active-
-- session-per-user gate), and only after that reservation succeeds does the
-- server relay the SDP exchange to OpenAI on the caller's behalf. See
-- packages/core/src/voiceSession.ts for the reservation/expiry/reconcile
-- logic that reads and writes this table.
--
-- status lifecycle: 'active' (leased, in progress) -> 'ended' (user hit
-- stop) or 'expired' (lease ran out before the user or the provider ended
-- it -- caught by the reconciliation cron, see
-- apps/consumer/app/api/cron/voice-reconcile/route.ts).
--
-- One active session per user is enforced by the partial unique index below
-- (the reservation INSERT relies on it as an ON CONFLICT arbiter -- see
-- VOICE_SESSION_RESERVE_SQL), not by an application-level check-then-insert,
-- so two concurrent "start voice practice" clicks can never both win.
CREATE TABLE IF NOT EXISTS voice_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'expired')),
  reserved_seconds INT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  ended_reason TEXT,
  target_role TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_session_one_active_per_user
  ON voice_session (user_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_voice_session_status_expires
  ON voice_session (status, expires_at);

-- Audio-call metering: ai_token_usage was built for text token counts only
-- (input_tokens/output_tokens). Voice practice has no token count from the
-- provider, so it meters in seconds instead -- this column is additive and
-- defaults to 0 for every pre-existing text-call row, which stays correct
-- (they truly used 0 audio seconds).
ALTER TABLE ai_token_usage ADD COLUMN IF NOT EXISTS audio_seconds INT NOT NULL DEFAULT 0;

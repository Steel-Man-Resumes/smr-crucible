-- 041_conversation_store.sql
-- Phase 5.1: encrypted, TEXT-ONLY conversation store -- the foundation for
-- disclosure rehearsal (5.5) and interview voice transcripts (5.6-5.8).
--
-- DOCTRINE (locked):
--   * Transcripts are TEXT ONLY, never audio. Audio never lands here.
--   * Every chunk of text is encrypted at rest with app-level AES-256-GCM
--     (packages/core/src/crypto.ts), NOT R2. R2 is for binary blobs only; a
--     short text turn is a column, not an object. iv/auth_tag/key_version are
--     stored next to the ciphertext so a read never needs a second lookup.
--   * AAD binds each ciphertext to `${owner}:${purpose}:${session}` -- a stored
--     row cannot be replayed under a different owner, purpose, or session.
--   * Per-purpose SEPARATION: disclosure and interview keep their OWN tables
--     (this mirrors the disclosure_plan vs interview_prep precedent). Purpose,
--     retention, and derived data differ, so the schemas stay apart even
--     though the chunk shape is identical.
--   * UNIQUE (session_id, seq) makes chunk writes IDEMPOTENT: a client retry
--     of the same turn (seq) is a no-op instead of a duplicate, so a mid-call
--     network blip never dupes or reorders the transcript. Ordered, per-turn
--     capture also means a crash loses at most the last turn, not the session
--     (end-only capture would lose everything on a crash).
--   * Owner-exclusive: every row is owned by owner_user_id ON DELETE CASCADE,
--     and every read/write path in conversationStore.ts checks ownership. No
--     admin/org bypass by design.
--
-- Additive and idempotent, style-matched to 040.

-- ── Disclosure rehearsal ─────────────────────────────────────────────────────
-- A practice run of disclosing one's record to an employer/persona. target_context
-- holds only non-sensitive framing (role/company/persona) -- never the transcript.
CREATE TABLE IF NOT EXISTS disclosure_rehearsal_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_context JSONB NOT NULL DEFAULT '{}',
  consent_layer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  struggle_tags TEXT[] NOT NULL DEFAULT '{}',
  takeaways JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_disclosure_rehearsal_session_owner_started
  ON disclosure_rehearsal_session (owner_user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS disclosure_rehearsal_chunk (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES disclosure_rehearsal_session(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq INT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  key_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_disclosure_rehearsal_chunk_owner
  ON disclosure_rehearsal_chunk (owner_user_id);

-- ── Interview voice ──────────────────────────────────────────────────────────
-- The TEXT transcript of a voice interview practice run (the audio itself is
-- never stored here -- see the doctrine header). target_context carries
-- { role, jobApplicationId, jdHash } -- non-sensitive framing only.
CREATE TABLE IF NOT EXISTS interview_voice_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_context JSONB NOT NULL DEFAULT '{}',
  consent_layer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  struggle_tags TEXT[] NOT NULL DEFAULT '{}',
  takeaways JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_interview_voice_session_owner_started
  ON interview_voice_session (owner_user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS interview_voice_chunk (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES interview_voice_session(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq INT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  key_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_interview_voice_chunk_owner
  ON interview_voice_chunk (owner_user_id);

-- ── Consent layers: two new opt-in transcript layers ─────────────────────────
-- disclosure_transcript gates disclosure-rehearsal persistence; interview_transcript
-- gates voice-transcript persistence. Both are opt-in (declined by default via
-- consentDefaultFor) -- storing a transcript is a data-retention decision, not a
-- feature of using the product.
--
-- Superset expansion, style-matched to how 015 added the outcome-publishing
-- layers: drop the existing CHECK (guarded) and recreate it including the new
-- layers. Legacy values stay valid; this only widens what is allowed.
ALTER TABLE consumer_consent
  DROP CONSTRAINT IF EXISTS consumer_consent_consent_layer_check;

ALTER TABLE consumer_consent
  ADD CONSTRAINT consumer_consent_consent_layer_check
  CHECK (consent_layer IN (
    'core',
    'enhanced',
    'research',
    'sharing',
    'outcome_anonymous',
    'outcome_named',
    'disclosure_transcript',
    'interview_transcript'
  ));

-- consumer_consent_event's CHECK is the inline auto-named
-- consumer_consent_event_consent_layer_check (from 034). Same superset widening.
ALTER TABLE consumer_consent_event
  DROP CONSTRAINT IF EXISTS consumer_consent_event_consent_layer_check;

ALTER TABLE consumer_consent_event
  ADD CONSTRAINT consumer_consent_event_consent_layer_check
  CHECK (consent_layer IN (
    'core',
    'enhanced',
    'research',
    'sharing',
    'outcome_anonymous',
    'outcome_named',
    'disclosure_transcript',
    'interview_transcript'
  ));

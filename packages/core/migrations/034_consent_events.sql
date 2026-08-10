-- 034_consent_events.sql
-- Phase 1B: immutable, purpose-scoped consent history.
--
-- Doctrine: consumer_consent stays the mutable "what is true right now" row
-- (one per user+layer, upserted on every grant/revoke) -- it is the fast read
-- the app checks before doing anything consent-gated. This table is the
-- append-only record of every grant/revoke that ever happened, in order,
-- with what text version the user agreed to and how it was collected. It is
-- the authoritative history: if the two ever disagree (e.g. a bug corrupts
-- the mutable row), this table is what compliance and Troy trust.
--
-- Same six layers as consumer_consent (CHECK mirrors 015_proof_spine.sql).
-- collection_method defaults to 'settings' -- the only current entry point is
-- the Settings consent panel; other entry points (Forge onboarding, org
-- invite acceptance, etc.) will pass their own value when they exist.
-- context is free-form JSONB for provenance the row itself doesn't capture,
-- e.g. { reason: "mutual_exclusivity" } when granting one outcome-publishing
-- layer force-revokes the other.

CREATE TABLE IF NOT EXISTS consumer_consent_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_layer TEXT NOT NULL CHECK (consent_layer IN (
    'core',
    'enhanced',
    'research',
    'sharing',
    'outcome_anonymous',
    'outcome_named'
  )),
  action TEXT NOT NULL CHECK (action IN ('granted', 'revoked')),
  text_version TEXT NOT NULL,
  collection_method TEXT NOT NULL DEFAULT 'settings',
  context JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consumer_consent_event_user_created
  ON consumer_consent_event (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_consumer_consent_event_user_layer
  ON consumer_consent_event (user_id, consent_layer);

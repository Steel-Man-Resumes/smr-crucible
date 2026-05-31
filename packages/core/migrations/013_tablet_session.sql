-- tablet_session: Mini Forge (prison tablet) sessions.
-- Users complete career intake on DOC-approved tablets.
-- On release they enter their 6-char import code at steelmanresumes.com
-- to seed their Refinery account.

CREATE TABLE tablet_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_code TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  forge_intake JSONB NOT NULL DEFAULT '{}',
  forge_output JSONB,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  facility_hint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '18 months'
);

CREATE UNIQUE INDEX ON tablet_session(import_code);
CREATE INDEX ON tablet_session(processing_status, created_at);

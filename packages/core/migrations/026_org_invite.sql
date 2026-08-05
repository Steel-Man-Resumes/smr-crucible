-- Org admin-invite (Troy 2026-08-05): an org admin or staff member enters a
-- participant's name + email on the leader dashboard; the app pre-provisions
-- the account, attributes it to the org (a redemption -- consumes a seat), and
-- emails a magic-link welcome. This table is the invite ledger: who invited
-- whom, when, and how many times the email went out. "Pending" is DERIVED, not
-- stored: an invitee is pending while their users row has never signed in
-- ("emailVerified" IS NULL, no password_hash, no accounts row) -- self-healing,
-- no status column to drift.

CREATE TABLE IF NOT EXISTS org_invite (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_name TEXT,
  invited_email TEXT NOT NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  send_count INT NOT NULL DEFAULT 1,
  UNIQUE (access_code_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_invite_user ON org_invite(user_id);

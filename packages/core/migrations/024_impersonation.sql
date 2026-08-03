-- Developer impersonation audit (Troy-only Developer Switcher, 2026-08-03).
-- Every view-as / assist session is durably recorded: who, whose account,
-- which mode, why (break-glass reason, required for assist), and when it
-- started/ended. This log is a governance asset: privileged access to a
-- client account is never invisible.
CREATE TABLE IF NOT EXISTS impersonation_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES users(id),
  target_user_id UUID NOT NULL REFERENCES users(id),
  mode TEXT NOT NULL CHECK (mode IN ('view', 'assist')),
  reason TEXT,
  notified_user BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_impersonation_admin ON impersonation_session(admin_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_target ON impersonation_session(target_user_id, started_at DESC);

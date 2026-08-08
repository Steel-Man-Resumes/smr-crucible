-- 030_account_security.sql
-- Account-security overhaul: self-service password metadata, TOTP two-factor,
-- tracked sessions (so a user can revoke a device -- the JWT strategy can't do
-- this natively), and a security/login event log for new-device alerts.
-- Fully additive + inert to current prod code, which reads none of these yet.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;

-- TOTP secret + one-time backup codes (bcrypt-hashed). One row per user.
CREATE TABLE IF NOT EXISTS user_two_factor (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret       TEXT NOT NULL,
  backup_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tracked sessions: each JWT carries a jti matched here so a user can list and
-- revoke active devices.
CREATE TABLE IF NOT EXISTS user_session (
  jti             TEXT PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent      TEXT,
  ip              TEXT,
  approx_location TEXT,
  revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_session_user ON user_session (user_id, revoked_at);

-- Security/login event log: new-device sign-ins, password changes, 2FA changes.
CREATE TABLE IF NOT EXISTS user_login_event (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event           TEXT NOT NULL,
  ip              TEXT,
  user_agent      TEXT,
  approx_location TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_login_event_user ON user_login_event (user_id, created_at DESC);

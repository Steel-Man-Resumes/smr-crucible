-- 068_email_proven.sql
-- Account pre-hijack fix (auth review F3, 2026-10-02).
--
-- /api/auth/register creates an account with a password and marks
-- "emailVerified" without any proof that the person owns the address, so
-- "emailVerified" cannot tell a proven inbox from a typed one. email_proven_at
-- is set only by a real proof of the inbox: an email-link sign-in, a Google
-- sign-in whose address Google verified, or a password reset by email link.
-- Register leaves it NULL.
--
-- The first proof on an account that is still unproven removes any password and
-- two-step verification on it (they were set by someone who never proved the
-- address), signs out every session, and marks it proven. See
-- apps/consumer/lib/email-proof.ts.
--
-- BACKFILL: every existing account is marked proven, so no current user is
-- wiped on their next email-link or Google sign-in; only accounts created after
-- this runs are subject to the rule. A narrower backfill (only accounts with a
-- recorded email-link or Google sign-in) is not possible: Auth.js records no
-- row for an email-link sign-in (no accounts row, the verification token is
-- deleted on use, the login event log does not record the method), and
-- "emailVerified" is set by register itself. Only Google sign-ins leave a
-- record (accounts), which would cover a small subset and wipe everyone else.
--
-- Additive and idempotent: the backfill only touches rows still NULL, and a
-- re-run finds none. The column is on an existing table, so the app role's
-- existing table grant covers it. Until this runs the app skips the rule.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_proven_at TIMESTAMPTZ;

UPDATE users SET email_proven_at = now() WHERE email_proven_at IS NULL;

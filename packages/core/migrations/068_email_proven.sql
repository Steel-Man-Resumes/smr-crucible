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
-- The first such proof on an account that is still unproven ASKS the person;
-- it never removes anything by itself (apps/consumer/lib/email-proof.ts):
-- with two-step on, the code page adds "I didn't set up two-step on this
-- account"; with a password and no two-step, "Enter your password to keep it"
-- or "I didn't set a password". Entering the code or password marks the
-- address proven and keeps everything. Choosing "I didn't set..." removes the
-- password and two-step, signs out every other session and marks it proven.
-- A password reset marks it proven when the account has no two-step.
--
-- BACKFILL: every existing account is marked proven, so no current user is
-- asked on their next email-link or Google sign-in; only accounts created after
-- this runs are subject to the rule. A narrower backfill (only accounts with a
-- recorded email-link or Google sign-in) is not possible: Auth.js records no
-- row for an email-link sign-in (no accounts row, the verification token is
-- deleted on use, the login event log does not record the method), and
-- "emailVerified" is set by register itself. Only Google sign-ins leave a
-- record (accounts), which would cover a small subset and ask everyone else.
--
-- RUN ONCE, by the migration runner (it records 068 in _migrations). Never
-- re-run the UPDATE by hand after deploy: it would mark every account created
-- since then as proven and switch the rule off for them. The column is on an
-- existing table, so the app role's existing table grant covers it. Until this
-- runs the app skips the rule.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_proven_at TIMESTAMPTZ;

UPDATE users SET email_proven_at = now() WHERE email_proven_at IS NULL;

-- 067_session_mfa.sql
-- Second step on every sign-in method (auth review F1, 2026-10-02).
--
-- Two-step verification was checked only inside the password sign-in. An email
-- link or Google sign-in into an account with two-step got a full session with
-- no code. Those sessions now start "waiting for the code" and reach nothing
-- but /login/verify until /api/auth/mfa-verify accepts one.
--
-- mfa_verified_at records, on the session's own row, when that session entered
-- its code (the step-up, or turning two-step on). The session token is marked
-- verified only after the server re-reads this column; nothing the browser
-- sends can set it.
--
-- Additive and idempotent. MUST run before the code that uses it is deployed:
-- without the column, an email-link or Google sign-in into a two-step account
-- cannot finish its second step (password sign-in is unaffected). The column
-- is on an existing table, so the app role's existing table grant covers it.
ALTER TABLE user_session
  ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ;

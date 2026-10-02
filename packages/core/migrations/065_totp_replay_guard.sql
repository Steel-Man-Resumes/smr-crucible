-- 065_totp_replay_guard.sql
-- TOTP replay guard (auth review F10, 2026-10-02).
--
-- A sign-in code is accepted for the current 30-second step and one step either
-- side, and nothing recorded that it had been used. A code seen over a shoulder
-- or in a screen share worked again for about 90 seconds.
--
-- The app now stores the time step of the last accepted code and refuses any
-- code for that step or an earlier one (lib/second-factor.ts consumeTotpStep,
-- an atomic conditional UPDATE). NULL means no code accepted yet.
--
-- Additive and idempotent. Until this runs, the app accepts codes without the
-- guard (the old behavior) instead of locking two-step users out. The column is
-- on an existing table, so the app role's existing table grant covers it.
ALTER TABLE user_two_factor
  ADD COLUMN IF NOT EXISTS last_totp_step BIGINT;

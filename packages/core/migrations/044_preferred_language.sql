-- 044_preferred_language.sql
-- Phase 1 multilingual AI output. A user's language preference now governs ALL
-- coaching surfaces, not just the in-Refinery coach. Generalizes coach_language
-- (migration 025, en/es only) into preferred_language across the supported set,
-- and gives the anonymous Mini Forge kiosk its own per-session language.
--
-- The old coach_language column is retained and backfilled FROM here is skipped;
-- instead we seed the new column FROM coach_language so existing Spanish coach
-- users keep their choice. coach_language is left in place for now and dropped in
-- a later cleanup once nothing reads it.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en';

-- Seed from the existing coach language so current es users are unaffected.
UPDATE users
   SET preferred_language = coach_language
 WHERE coach_language IN ('en', 'es')
   AND preferred_language = 'en';

-- Supported set: en, es (launched) + vi, zh, ht, ar (beta). Widen here when a
-- language is added to packages/core/src/language.ts.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_preferred_language_check;
ALTER TABLE users
  ADD CONSTRAINT users_preferred_language_check
  CHECK (preferred_language IN ('en', 'es', 'vi', 'zh', 'ht', 'ar'));

-- Mini Forge kiosk sessions are unauthenticated (no user row), so the language
-- lives on the session itself, chosen at kiosk start.
ALTER TABLE tablet_session
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE tablet_session
  DROP CONSTRAINT IF EXISTS tablet_session_language_check;
ALTER TABLE tablet_session
  ADD CONSTRAINT tablet_session_language_check
  CHECK (language IN ('en', 'es', 'vi', 'zh', 'ht', 'ar'));

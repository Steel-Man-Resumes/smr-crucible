-- 028_user_hidden_employer.sql
-- N1: let a user hide an employer (e.g. a former employer, or one they never want
-- to see) so it is filtered out of their job search. Stored per-user by a normalized
-- name key so listings from any provider match regardless of punctuation/suffix.
-- Additive; prod (main) ignores this table.

CREATE TABLE IF NOT EXISTS user_hidden_employer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- Normalized match key (lowercased, punctuation + legal suffix stripped).
  name_key TEXT NOT NULL,
  -- The name as the user saw it, for the Settings un-hide list.
  display_name TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_hidden_employer UNIQUE (user_id, name_key)
);

CREATE INDEX IF NOT EXISTS idx_user_hidden_employer_user
  ON user_hidden_employer(user_id);

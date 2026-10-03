-- 066_auth_rate_limit.sql
-- Durable rate-limit counters for the auth endpoints (auth review F7,
-- 2026-10-02).
--
-- The sign-in, magic-link, reset, register and two-step limits were kept in an
-- in-memory Map per serverless instance: reset on every cold start, and not
-- shared between concurrent instances. These counters are shared by every
-- instance. apps/consumer/lib/auth-rate-limit.ts does one atomic upsert per
-- attempt into the current fixed window and reads the previous window to
-- approximate a sliding window.
--
-- `key` is never the raw key (which holds an email or IP address): it is an
-- HMAC keyed with the server secret (IP_HASH_SECRET, else AUTH_SECRET), the
-- same treatment ai_usage gives IP addresses.
--
-- Rows older than a day are deleted daily by /api/cron/purge-auth-rate-limits.
-- Not under row-level security: no row belongs to a person, and the app must
-- read and write every key. If this table is missing or unreachable the app
-- falls back to the in-memory limiter, so it is safe to deploy before this runs.
CREATE TABLE IF NOT EXISTS auth_rate_limit (
  key          TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limit_window_start
  ON auth_rate_limit (window_start);

-- The app role needs UPDATE (the increment) and DELETE (the purge), which the
-- schema default privileges withhold from new tables since 045.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth_rate_limit TO smr_app;
  END IF;
END $$;

-- Fix consumer table foreign keys: point to "users" (NextAuth) not "user" (B2B)
--
-- The 005_consumer.sql migration created FK constraints referencing the B2B
-- "user" table, but NextAuth stores authenticated users in the "users" table.
-- This caused 500 errors on all save operations (artifacts, forge sessions, etc.)
--
-- Applied manually to production DB on 2026-03-10. This migration file exists
-- so the fix is tracked and reproducible.

ALTER TABLE refinery_artifact DROP CONSTRAINT IF EXISTS refinery_artifact_user_id_fkey;
ALTER TABLE refinery_artifact ADD CONSTRAINT refinery_artifact_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE forge_session DROP CONSTRAINT IF EXISTS forge_session_user_id_fkey;
ALTER TABLE forge_session ADD CONSTRAINT forge_session_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE consumer_profile DROP CONSTRAINT IF EXISTS consumer_profile_user_id_fkey;
ALTER TABLE consumer_profile ADD CONSTRAINT consumer_profile_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE consumer_consent DROP CONSTRAINT IF EXISTS consumer_consent_user_id_fkey;
ALTER TABLE consumer_consent ADD CONSTRAINT consumer_consent_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE data_access_log DROP CONSTRAINT IF EXISTS data_access_log_target_user_id_fkey;
ALTER TABLE data_access_log ADD CONSTRAINT data_access_log_target_user_id_fkey
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE decision_log DROP CONSTRAINT IF EXISTS decision_log_user_id_fkey;
ALTER TABLE decision_log ADD CONSTRAINT decision_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

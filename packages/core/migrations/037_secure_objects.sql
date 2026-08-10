-- 037_secure_objects.sql
-- Phase 1C: secure storage + data lifecycle platform. Additive, idempotent.
--
-- secure_object: the encrypted-at-rest counterpart to file_object (036 and
-- earlier). file_object is org-scoped and unencrypted (existing R2 upload
-- flow in packages/core/src/storage.ts); secure_object is exclusively
-- owner_user_id-scoped and every row is AES-256-GCM ciphertext (see
-- packages/core/src/crypto.ts + secureObject.ts). This is the platform for
-- Phase 6 (client document vault), Phase 5 (interview transcripts /
-- recordings), and Phase 7 (headshots) -- nothing user-facing is wired to it
-- yet in this pass.
CREATE TABLE IF NOT EXISTS secure_object (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key     TEXT NOT NULL UNIQUE,
  bucket         TEXT NOT NULL,
  purpose        TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  byte_size      INT NOT NULL,
  iv             TEXT NOT NULL,
  auth_tag       TEXT NOT NULL,
  key_version    TEXT NOT NULL,
  aad            TEXT NOT NULL,
  sha256         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_secure_object_owner
  ON secure_object (owner_user_id);

-- deletion_task: a retry ledger for deletes that must reach an external
-- store (R2 today) in addition to Postgres. delete-data can always remove
-- its own DB rows synchronously, but an R2 DeleteObjectCommand can fail
-- transiently -- this table lets a cron (deletion-retry) keep retrying
-- until it succeeds instead of silently leaving orphaned objects behind.
CREATE TABLE IF NOT EXISTS deletion_task (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID,
  target_kind  TEXT NOT NULL, -- e.g. 'r2_object'
  target_ref   TEXT NOT NULL, -- e.g. the object key
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  attempts     INT NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deletion_task_status_updated
  ON deletion_task (status, updated_at);

-- TOTP secret encryption-at-rest (030 created user_two_factor.secret as
-- plaintext TEXT). Going forward, new writes store `secret` as AES-256-GCM
-- ciphertext with these three columns populated. Existing rows keep
-- secret_iv/secret_tag/secret_key_version NULL -- `secret` stays plaintext
-- for them until the read path's backfill-on-next-use re-encrypts it (see
-- apps/consumer/auth.ts and apps/consumer/lib/two-factor.ts). No forced
-- re-enrollment, no lockout.
ALTER TABLE user_two_factor
  ADD COLUMN IF NOT EXISTS secret_iv TEXT,
  ADD COLUMN IF NOT EXISTS secret_tag TEXT,
  ADD COLUMN IF NOT EXISTS secret_key_version TEXT;

-- 042_vault_documents.sql
-- Phase 6.2: the document Vault -- the user's LIFELONG document home. Additive,
-- idempotent.
--
-- This table is METADATA ONLY. The document bytes live encrypted-at-rest in
-- secure_object (migration 037, purpose = 'vault'), AES-256-GCM in front of R2.
-- vault_document just gives each secure_object a human-facing identity: a
-- category, a label the user chose, the original filename, an optional note,
-- and an optional link to a saved job application.
--
-- CASCADE NOTE (verified): vault_document has ON DELETE CASCADE off BOTH
-- users(id) and secure_object(id). Account/data deletion
-- (apps/consumer/app/api/user/delete-data/route.ts) deletes secure_object rows
-- (after enqueuing their R2 ciphertext for deletion) -- so every vault_document
-- row is removed automatically by that existing secure_object DELETE, with no
-- new statement needed in delete-data. Deleting the users row cascades the same
-- way. This keeps the "download your data / delete your data" contract whole
-- for the vault with zero changes to those routes.
CREATE TABLE IF NOT EXISTS vault_document (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secure_object_id   UUID NOT NULL REFERENCES secure_object(id) ON DELETE CASCADE,
  category           TEXT NOT NULL CHECK (category IN (
                       'id', 'certificate', 'reference_letter', 'record', 'note', 'other'
                     )),
  label              TEXT NOT NULL,
  original_filename  TEXT,
  note               TEXT,
  -- The real job table is job_application (migration 011). SET NULL so unlinking
  -- a job (or deleting the application) never orphans or removes the document.
  linked_job_id      UUID REFERENCES job_application(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vault_document_user_cat
  ON vault_document (user_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vault_document_secure_object
  ON vault_document (secure_object_id);

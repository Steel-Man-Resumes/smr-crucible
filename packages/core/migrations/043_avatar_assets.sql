-- 043_avatar_assets.sql
-- Phase 7.7: avatar photo + AI-headshot path. Additive, idempotent.
--
-- This table is METADATA ONLY. The photo/headshot bytes live encrypted-at-rest
-- in secure_object (migration 037, purpose = 'headshot'), AES-256-GCM in front
-- of R2. avatar_asset gives each secure_object a human-facing identity: whether
-- it is the user's uploaded original photo or an AI-generated headshot, and (for
-- a generated headshot) which original it was produced from.
--
-- DOCTRINE: zero PII by default. The illustrated avatar (users.ui_avatar,
-- migration 039) stays the default; a photo is only ever shown if the user
-- explicitly selects one. A photo/headshot is NEVER auto-added to a resume.
--
-- CASCADE NOTE (verified, mirrors vault_document / migration 042): avatar_asset
-- has ON DELETE CASCADE off BOTH users(id) and secure_object(id). Account/data
-- deletion (apps/consumer/app/api/user/delete-data/route.ts) deletes
-- secure_object rows (after enqueuing their R2 ciphertext for deletion) -- so
-- every avatar_asset row is removed automatically by that existing secure_object
-- DELETE, with no new statement needed in delete-data. Deleting the users row
-- cascades the same way. The selected-photo pointer (ui_avatar.photoAssetId in
-- the users row) is cleared on account delete with the row; for data-only delete
-- the route resets the selection back to the illustrated avatar.
CREATE TABLE IF NOT EXISTS avatar_asset (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secure_object_id  UUID NOT NULL REFERENCES secure_object(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('original_photo', 'generated_headshot')),
  -- For a generated headshot: the original_photo it was produced from. SET NULL
  -- so deleting the original never removes or orphans a generated headshot.
  source_asset_id   UUID REFERENCES avatar_asset(id) ON DELETE SET NULL,
  width             INT,
  height            INT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_avatar_asset_user_kind
  ON avatar_asset (user_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_avatar_asset_secure_object
  ON avatar_asset (secure_object_id);

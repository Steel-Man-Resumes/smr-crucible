/**
 * Phase 7.7 avatar photo path -- avatar_asset metadata persistence (migration
 * 043). Bytes live in secure_object (037, purpose = 'headshot'); this module is
 * the human-facing index on top of them.
 *
 * OWNERSHIP: every query here is scoped `AND user_id = $userId`. An avatar_asset
 * is exclusively the owning user's; there is no admin/org bypass (matching
 * secure_object's exclusive-owner model). A foreign id silently returns
 * null/nothing -- never another user's row. The photo bytes are a person's face;
 * the routes on top use the NON-impersonatable auth() so an admin impersonation
 * session cannot pull someone's photo.
 *
 * DELETE ordering (neon-http has no cross-statement transaction): deleteAvatarAsset
 * enqueues the R2 ciphertext for deletion BEFORE removing rows, exactly like
 * deleteVaultDocument and delete-data, so a crash mid-delete never orphans an R2
 * object -- the deletion_task cron finishes it. Only after enqueue do we delete
 * the secure_object row (which CASCADE-drops the avatar_asset row too).
 */

import { query, getOne, insert } from "./db";
import { enqueueDeletion } from "./deletionTasks";
import type { AvatarAssetKind } from "./avatarAssetShared";

export interface AvatarAssetRow {
  id: string;
  user_id: string;
  secure_object_id: string;
  kind: AvatarAssetKind;
  source_asset_id: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

/** An avatar_asset joined to its secure_object -- what the list/detail UI needs
 *  (mime, size, and the object_key the image proxy reads from). */
export interface AvatarAssetWithObject extends AvatarAssetRow {
  mime_type: string;
  byte_size: number;
  object_key: string;
  object_created_at: string;
}

export async function createAvatarAsset(params: {
  userId: string;
  secureObjectId: string;
  kind: AvatarAssetKind;
  sourceAssetId?: string | null;
  width?: number | null;
  height?: number | null;
}): Promise<AvatarAssetRow> {
  return insert<AvatarAssetRow>("avatar_asset", {
    user_id: params.userId,
    secure_object_id: params.secureObjectId,
    kind: params.kind,
    source_asset_id: params.sourceAssetId ?? null,
    width: params.width ?? null,
    height: params.height ?? null,
  });
}

/** List a user's avatar assets (optionally one kind), newest first, joined to
 *  secure_object for mime/size/created_at. Owner-scoped. */
export async function listAvatarAssets(
  userId: string,
  opts?: { kind?: AvatarAssetKind }
): Promise<AvatarAssetWithObject[]> {
  const params: unknown[] = [userId];
  let kindClause = "";
  if (opts?.kind) {
    params.push(opts.kind);
    kindClause = ` AND aa.kind = $2`;
  }
  return query<AvatarAssetWithObject>(
    `SELECT aa.*, so.mime_type, so.byte_size, so.object_key,
            so.created_at AS object_created_at
       FROM avatar_asset aa
       JOIN secure_object so ON so.id = aa.secure_object_id
      WHERE aa.user_id = $1${kindClause}
      ORDER BY aa.created_at DESC`,
    params
  );
}

/** One asset by id, owner-scoped, joined to its secure_object so the image proxy
 *  has object_key + mime to fetch and label the bytes. Null if not owned. */
export async function getAvatarAsset(
  userId: string,
  id: string
): Promise<AvatarAssetWithObject | null> {
  return getOne<AvatarAssetWithObject>(
    `SELECT aa.*, so.mime_type, so.byte_size, so.object_key,
            so.created_at AS object_created_at
       FROM avatar_asset aa
       JOIN secure_object so ON so.id = aa.secure_object_id
      WHERE aa.id = $1 AND aa.user_id = $2`,
    [id, userId]
  );
}

export type AvatarAssetDeleteStatus = "deleted" | "not_found";

/**
 * Delete an avatar asset AND its encrypted bytes. Owner-scoped.
 *
 * Order (crash-safe, no cross-statement transaction available):
 *   1. Look up the row + its secure_object (bucket + object_key), owner-scoped.
 *      A foreign/missing id returns "not_found" without touching anything.
 *   2. Enqueue the R2 ciphertext for deletion (deletion_task) -- BEFORE dropping
 *      rows, so the object key is never lost if step 3 crashes.
 *   3. Delete the secure_object row. Its ON DELETE CASCADE removes the
 *      avatar_asset row too, so metadata never survives its bytes. Any
 *      generated headshot that pointed at this original via source_asset_id is
 *      NOT removed (SET NULL) -- deleting an original never wipes a generated one.
 *
 * NOTE: if the deleted asset is the user's currently selected photo
 * (ui_avatar.photoAssetId), the CALLING ROUTE resets the selection back to the
 * illustrated avatar -- this function only removes the asset + bytes.
 */
export async function deleteAvatarAsset(
  userId: string,
  id: string
): Promise<{ status: AvatarAssetDeleteStatus }> {
  const target = await getOne<{ secure_object_id: string; bucket: string; object_key: string }>(
    `SELECT aa.secure_object_id, so.bucket, so.object_key
       FROM avatar_asset aa
       JOIN secure_object so ON so.id = aa.secure_object_id
      WHERE aa.id = $1 AND aa.user_id = $2`,
    [id, userId]
  );
  if (!target) return { status: "not_found" };

  // Enqueue R2 cleanup first (same pattern as delete-data): the cron drains it.
  await enqueueDeletion(userId, "r2_object", `${target.bucket}::${target.object_key}`);

  // Deleting the secure_object row CASCADE-drops the avatar_asset row. Scope the
  // delete to this owner's object so a race can never touch another user's bytes.
  await query(
    `DELETE FROM secure_object WHERE id = $1 AND owner_user_id = $2`,
    [target.secure_object_id, userId]
  );

  return { status: "deleted" };
}

/**
 * Phase 6.2 vault -- document metadata persistence (vault_document, migration
 * 042). Bytes live in secure_object (037, purpose = 'vault'); this module is
 * the human-facing index on top of them.
 *
 * OWNERSHIP: every query here is scoped `AND user_id = $userId`. A vault_document
 * is exclusively the owning user's; there is no admin/org bypass (matching
 * secure_object's exclusive-owner model). A foreign id silently returns
 * null/nothing -- never another user's row.
 *
 * DELETE ordering (neon-http has no cross-statement transaction): deleteVaultDocument
 * enqueues the R2 ciphertext for deletion BEFORE removing rows, exactly like
 * delete-data does, so a crash mid-delete never orphans an R2 object -- the
 * deletion_task cron finishes it. Only after enqueue do we delete the
 * secure_object row (which CASCADE-drops the vault_document row too).
 */

import { query, getOne, insert } from "./db";
import { enqueueDeletion } from "./deletionTasks";
import type { VaultCategory } from "./vaultDocumentShared";

export interface VaultDocumentRow {
  id: string;
  user_id: string;
  secure_object_id: string;
  category: VaultCategory;
  label: string;
  original_filename: string | null;
  note: string | null;
  linked_job_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A vault_document joined to its secure_object -- what the list/detail UI needs
 *  (mime, size, and the object_key the download route proxies from). */
export interface VaultDocumentWithObject extends VaultDocumentRow {
  mime_type: string;
  byte_size: number;
  object_key: string;
  object_created_at: string;
}

export async function createVaultDocument(params: {
  userId: string;
  secureObjectId: string;
  category: VaultCategory;
  label: string;
  originalFilename?: string | null;
  note?: string | null;
  linkedJobId?: string | null;
}): Promise<VaultDocumentRow> {
  return insert<VaultDocumentRow>("vault_document", {
    user_id: params.userId,
    secure_object_id: params.secureObjectId,
    category: params.category,
    label: params.label,
    original_filename: params.originalFilename ?? null,
    note: params.note ?? null,
    linked_job_id: params.linkedJobId ?? null,
  });
}

/** List a user's vault documents (optionally one category), newest first,
 *  joined to secure_object for mime/size/created_at. Owner-scoped. */
export async function listVaultDocuments(
  userId: string,
  opts?: { category?: VaultCategory }
): Promise<VaultDocumentWithObject[]> {
  const params: unknown[] = [userId];
  let categoryClause = "";
  if (opts?.category) {
    params.push(opts.category);
    categoryClause = ` AND vd.category = $2`;
  }
  return query<VaultDocumentWithObject>(
    `SELECT vd.*, so.mime_type, so.byte_size, so.object_key,
            so.created_at AS object_created_at
       FROM vault_document vd
       JOIN secure_object so ON so.id = vd.secure_object_id
      WHERE vd.user_id = $1${categoryClause}
      ORDER BY vd.created_at DESC`,
    params
  );
}

/** One document by id, owner-scoped, joined to its secure_object so the download
 *  route has object_key + mime to fetch and label the bytes. Null if not owned. */
export async function getVaultDocument(
  userId: string,
  id: string
): Promise<VaultDocumentWithObject | null> {
  return getOne<VaultDocumentWithObject>(
    `SELECT vd.*, so.mime_type, so.byte_size, so.object_key,
            so.created_at AS object_created_at
       FROM vault_document vd
       JOIN secure_object so ON so.id = vd.secure_object_id
      WHERE vd.id = $1 AND vd.user_id = $2`,
    [id, userId]
  );
}

/** Metadata-only edit. Owner-scoped; only supplied fields change. linkedJobId
 *  set to null explicitly unlinks. Returns the updated row or null if not owned. */
export async function updateVaultDocument(
  userId: string,
  id: string,
  patch: {
    category?: VaultCategory;
    label?: string;
    note?: string | null;
    linkedJobId?: string | null;
  }
): Promise<VaultDocumentRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (patch.category !== undefined) {
    sets.push(`category = $${i++}`);
    params.push(patch.category);
  }
  if (patch.label !== undefined) {
    sets.push(`label = $${i++}`);
    params.push(patch.label);
  }
  if (patch.note !== undefined) {
    sets.push(`note = $${i++}`);
    params.push(patch.note);
  }
  if (patch.linkedJobId !== undefined) {
    sets.push(`linked_job_id = $${i++}`);
    params.push(patch.linkedJobId);
  }
  if (sets.length === 0) {
    // No-op patch: just return the current row (owner-scoped).
    const row = await getVaultDocument(userId, id);
    return row ? toRow(row) : null;
  }
  sets.push(`updated_at = now()`);
  params.push(id);
  params.push(userId);
  const rows = await query<VaultDocumentRow>(
    `UPDATE vault_document SET ${sets.join(", ")}
      WHERE id = $${i++} AND user_id = $${i}
      RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

export type VaultDeleteStatus = "deleted" | "not_found";

/**
 * Delete a vault document AND its encrypted bytes. Owner-scoped.
 *
 * Order (crash-safe, no cross-statement transaction available):
 *   1. Look up the row + its secure_object (bucket + object_key), owner-scoped.
 *      A foreign/missing id returns "not_found" without touching anything.
 *   2. Enqueue the R2 ciphertext for deletion (deletion_task) -- BEFORE dropping
 *      rows, so the object key is never lost if step 3 crashes.
 *   3. Delete the secure_object row. Its ON DELETE CASCADE removes the
 *      vault_document row too, so metadata never survives its bytes.
 */
export async function deleteVaultDocument(
  userId: string,
  id: string
): Promise<{ status: VaultDeleteStatus }> {
  const target = await getOne<{ secure_object_id: string; bucket: string; object_key: string }>(
    `SELECT vd.secure_object_id, so.bucket, so.object_key
       FROM vault_document vd
       JOIN secure_object so ON so.id = vd.secure_object_id
      WHERE vd.id = $1 AND vd.user_id = $2`,
    [id, userId]
  );
  if (!target) return { status: "not_found" };

  // Enqueue R2 cleanup first (same pattern as delete-data): the cron drains it.
  await enqueueDeletion(userId, "r2_object", `${target.bucket}::${target.object_key}`);

  // Deleting the secure_object row CASCADE-drops the vault_document row. Scope the
  // delete to this owner's object so a race can never touch another user's bytes.
  await query(
    `DELETE FROM secure_object WHERE id = $1 AND owner_user_id = $2`,
    [target.secure_object_id, userId]
  );

  return { status: "deleted" };
}

function toRow(r: VaultDocumentWithObject): VaultDocumentRow {
  return {
    id: r.id,
    user_id: r.user_id,
    secure_object_id: r.secure_object_id,
    category: r.category,
    label: r.label,
    original_filename: r.original_filename,
    note: r.note,
    linked_job_id: r.linked_job_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

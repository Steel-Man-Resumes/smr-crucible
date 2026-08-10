/**
 * Phase 1C: secure object store -- AES-256-GCM envelope encryption in front
 * of R2, backed by the secure_object table (migration 037).
 *
 * This is the PLATFORM for anything that must be encrypted at rest and
 * proxied through the app rather than served via a presigned URL:
 *   - Phase 6 vault (client document uploads)
 *   - Phase 5 interview transcripts / recordings
 *   - Phase 7 headshots
 *
 * Nothing here is wired to a user-facing upload route yet. Phase 6 wires the
 * consumer UI once the preview/prod DB split (a pending manual step) lands.
 * Today this module is exercised by the adversarial suite (pure crypto) and
 * a live encrypt/decrypt round-trip script (scripts/verify-document-
 * encryption.mjs) -- there is no R2/DB integration test in this pass.
 *
 * Design: bytes are encrypted in this module BEFORE they reach R2 -- R2 only
 * ever stores ciphertext. iv/auth_tag/key_version/aad are stored in the
 * secure_object row, not as R2 object metadata, so a lookup never needs a
 * HeadObject round trip.
 *
 * Ownership: secure_object rows are exclusively owned by owner_user_id.
 * getDecryptedObject/deleteObject both verify ownership before touching R2
 * or the DB row -- there is no admin/org-level bypass here by design
 * (unlike file_object, which is org-scoped and has no owner check).
 *
 * getDecryptedObject NEVER returns a presigned URL for plaintext -- the
 * caller (an API route) reads the returned Buffer and proxies bytes back to
 * the browser itself, so a decrypted object is never reachable by a bare
 * link.
 */
import { randomUUID } from "crypto";
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { encryptBuffer, decryptBuffer, EncryptedPayload } from "./crypto";
import { getS3Client, getSecureBucket } from "./storage";
import { query, getOne, insert } from "./db";

export interface SecureObjectRecord {
  id: string;
  owner_user_id: string;
  object_key: string;
  bucket: string;
  purpose: string;
  mime_type: string;
  byte_size: number;
  iv: string;
  auth_tag: string;
  key_version: string;
  aad: string;
  sha256: string | null;
  created_at: string;
}

export type DeleteObjectStatus = "deleted" | "not_found" | "not_owner";

function buildAad(ownerUserId: string, purpose: string, aadExtra?: string): string {
  return aadExtra ? `${ownerUserId}:${purpose}:${aadExtra}` : `${ownerUserId}:${purpose}`;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  const anyBody = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof anyBody?.transformToByteArray === "function") {
    return Buffer.from(await anyBody.transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Namespaced, non-guessable object key -- callers should not hand-build
 *  their own keys. `purpose` groups keys for readability in the bucket
 *  (e.g. "vault", "transcript", "headshot"). */
export function makeSecureObjectKey(ownerUserId: string, purpose: string): string {
  return `secure/${purpose}/${ownerUserId}/${randomUUID()}`;
}

export async function putEncryptedObject(params: {
  ownerUserId: string;
  purpose: string;
  key: string;
  plaintext: Buffer;
  mimeType: string;
  aadExtra?: string;
  sha256?: string | null;
}): Promise<SecureObjectRecord> {
  const { ownerUserId, purpose, key, plaintext, mimeType, aadExtra, sha256 } = params;
  const aad = buildAad(ownerUserId, purpose, aadExtra);
  const encrypted: EncryptedPayload = encryptBuffer(plaintext, aad);
  const bucket = getSecureBucket();
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      // R2 only ever sees ciphertext -- ContentType is deliberately generic
      // (the real mimeType lives in the DB row, never as a header on the
      // encrypted object).
      Body: Buffer.from(encrypted.ciphertext, "base64"),
      ContentType: "application/octet-stream",
    })
  );

  return insert<SecureObjectRecord>("secure_object", {
    owner_user_id: ownerUserId,
    object_key: key,
    bucket,
    purpose,
    mime_type: mimeType,
    byte_size: plaintext.length,
    iv: encrypted.iv,
    auth_tag: encrypted.tag,
    key_version: encrypted.keyVersion,
    aad,
    sha256: sha256 ?? null,
  });
}

export async function getDecryptedObject(params: {
  ownerUserId: string;
  key: string;
}): Promise<{ buffer: Buffer; record: SecureObjectRecord } | null> {
  const { ownerUserId, key } = params;
  const record = await getOne<SecureObjectRecord>(
    `SELECT * FROM secure_object WHERE object_key = $1`,
    [key]
  );
  if (!record) return null;
  if (record.owner_user_id !== ownerUserId) return null; // exclusive ownership, no bypass

  const client = getS3Client();
  const obj = await client.send(new GetObjectCommand({ Bucket: record.bucket, Key: key }));
  const ciphertext = await streamToBuffer(obj.Body);

  const buffer = decryptBuffer(
    {
      ciphertext: ciphertext.toString("base64"),
      iv: record.iv,
      tag: record.auth_tag,
      keyVersion: record.key_version,
    },
    record.aad
  );

  return { buffer, record };
}

export async function deleteObject(params: {
  ownerUserId: string;
  key: string;
}): Promise<{ status: DeleteObjectStatus }> {
  const { ownerUserId, key } = params;
  const record = await getOne<Pick<SecureObjectRecord, "id" | "owner_user_id" | "bucket">>(
    `SELECT id, owner_user_id, bucket FROM secure_object WHERE object_key = $1`,
    [key]
  );
  if (!record) return { status: "not_found" };
  if (record.owner_user_id !== ownerUserId) return { status: "not_owner" };

  const client = getS3Client();
  await client.send(new DeleteObjectCommand({ Bucket: record.bucket, Key: key }));
  await query(`DELETE FROM secure_object WHERE object_key = $1`, [key]);

  return { status: "deleted" };
}

/** List a user's secure_object rows -- used by delete-data to enumerate
 *  what needs R2 cleanup before the rows themselves are deleted. */
export async function listSecureObjectsForOwner(ownerUserId: string): Promise<SecureObjectRecord[]> {
  return query<SecureObjectRecord>(
    `SELECT * FROM secure_object WHERE owner_user_id = $1`,
    [ownerUserId]
  );
}

/**
 * Phase 6.2 vault -- document collection endpoint.
 *
 *   GET  /api/vault/documents[?category=]  -> the signed-in user's documents
 *   POST /api/vault/documents              -> multipart upload of one document
 *
 * The bytes are encrypted at rest in secure_object (purpose "vault") BEFORE they
 * touch R2; vault_document stores only metadata. Uploads NEVER return bytes.
 * Downloads go through the owner-exclusive proxy route ([id]/download).
 *
 * Auth: the NON-impersonatable auth() (same as export-data/export-vault), NOT
 * effectiveAuth. The vault holds a user's IDs and legal records, and the UI
 * promises "only you can open it" -- so an admin in an impersonation session must
 * NOT be able to list, read, download, edit, or delete another person's vault.
 * The user id comes only from the session; a client-supplied id is never trusted.
 * Every query is owner-scoped.
 */

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/auth";
import {
  listVaultDocuments,
  createVaultDocument,
  makeSecureObjectKey,
  putEncryptedObject,
  getOne,
  isVaultCategory,
  decideVaultMime,
  MAX_VAULT_FILE_BYTES,
  incrementUserUsage,
} from "@crucible/core";

export const runtime = "nodejs";
export const maxDuration = 30;

// The vault is a lifelong document home -- guidance, not gatekeeping -- so this
// is a generous anti-abuse ceiling, NOT the AI daily-call budget (withRateLimit's
// "user" mode compares against getUserDailyLimit, which would make uploads eat
// into a client's small AI-chat allowance). A dedicated "vault_upload" counter
// keeps the two independent (getUserDailyUsage excludes vault_% so it never
// shows up as AI usage). Only ACCEPTED uploads are counted -- the increment
// happens after a successful store -- so rejected/malformed requests can't
// exhaust the day.
const VAULT_UPLOADS_PER_DAY = 100;

/** GET -- list the user's vault documents, optionally filtered by category. */
export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const categoryParam = searchParams.get("category");
  if (categoryParam && !isVaultCategory(categoryParam)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const docs = await listVaultDocuments(userId, {
    category: categoryParam && isVaultCategory(categoryParam) ? categoryParam : undefined,
  });
  return NextResponse.json({ data: docs });
}

/** POST -- multipart upload of a single document into the vault. */
export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Ceiling check reads today's ACCEPTED upload count (read-only; the increment
  // happens only after a successful store below, so failures never count).
  const prior = await getOne<{ n: string }>(
    `SELECT COALESCE(SUM(call_count), 0)::text AS n
       FROM ai_usage
      WHERE user_id = $1 AND usage_date = CURRENT_DATE AND endpoint = 'vault_upload'`,
    [userId]
  );
  if (parseInt(prior?.n ?? "0", 10) >= VAULT_UPLOADS_PER_DAY) {
    return NextResponse.json(
      { error: "You have added a lot of documents today. Please try again tomorrow." },
      { status: 429 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Size guard BEFORE buffering the file into memory. File.size is known from the
  // multipart headers without reading the body, so an oversized/empty upload is
  // rejected without allocating it. (On Vercel the ~4.5 MB request-body cap is
  // the effective ceiling in prod; this guard is what protects self-hosted /
  // non-Vercel deployments where no such platform cap exists.)
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_VAULT_FILE_BYTES) {
    return NextResponse.json(
      { error: "That file is over the 25 MB limit. Try a smaller photo or PDF." },
      { status: 413 }
    );
  }

  const category = form.get("category");
  if (typeof category !== "string" || !isVaultCategory(category)) {
    return NextResponse.json({ error: "Choose a category for this document." }, { status: 400 });
  }

  const labelRaw = form.get("label");
  const label = typeof labelRaw === "string" ? labelRaw.trim().slice(0, 200) : "";
  if (!label) {
    return NextResponse.json({ error: "Give this document a short name." }, { status: 400 });
  }

  const noteRaw = form.get("note");
  const note = typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim().slice(0, 2000) : null;

  const linkedJobRaw = form.get("linkedJobId");
  let linkedJobId: string | null = null;
  if (typeof linkedJobRaw === "string" && linkedJobRaw.trim()) {
    // Only accept a job the user actually owns -- otherwise silently unlink.
    const owned = await getOne<{ id: string }>(
      "SELECT id FROM job_application WHERE id = $1 AND user_id = $2",
      [linkedJobRaw.trim(), userId]
    );
    linkedJobId = owned ? owned.id : null;
  }

  // Defense in depth: re-check the real byte length after buffering, in case a
  // client understated File.size in the multipart headers.
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  if (bytes.length > MAX_VAULT_FILE_BYTES) {
    return NextResponse.json(
      { error: "That file is over the 25 MB limit. Try a smaller photo or PDF." },
      { status: 413 }
    );
  }

  // Validate type: allowlist + content sniff (do NOT trust the client MIME alone).
  const decision = decideVaultMime(file.type, bytes);
  if (!decision.ok) {
    return NextResponse.json(
      {
        error:
          "That file type is not supported. Upload a PDF, a photo (JPG, PNG, HEIC), a Word document, or a text note.",
      },
      { status: 400 }
    );
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const originalFilename =
    typeof file.name === "string" && file.name.trim() ? file.name.trim().slice(0, 255) : null;

  try {
    const key = makeSecureObjectKey(userId, "vault");
    const secure = await putEncryptedObject({
      ownerUserId: userId,
      purpose: "vault",
      key,
      plaintext: bytes,
      mimeType: decision.mime,
      sha256,
    });

    const doc = await createVaultDocument({
      userId,
      secureObjectId: secure.id,
      category,
      label,
      originalFilename,
      note,
      linkedJobId,
    });

    // Count only this accepted upload against the generous daily ceiling. Uses
    // the "vault_upload" endpoint, which getUserDailyUsage excludes from the
    // AI-usage total, so it never appears as burned AI calls.
    await incrementUserUsage(userId, "vault_upload").catch(() => {});

    return NextResponse.json(
      {
        data: {
          ...doc,
          mime_type: secure.mime_type,
          byte_size: secure.byte_size,
          object_key: secure.object_key,
          object_created_at: secure.created_at,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("Vault upload error:", err?.message || err);
    return NextResponse.json(
      { error: "Could not save that document. Please try again." },
      { status: 500 }
    );
  }
}

/**
 * Phase 7.7 avatar photo path -- upload endpoint.
 *
 *   POST /api/avatar/photo   -> multipart upload of one client-cropped photo
 *
 * The bytes are encrypted at rest in secure_object (purpose "headshot") BEFORE
 * they touch R2; avatar_asset stores only metadata. Uploads NEVER return bytes.
 * The photo is displayed only through the owner-exclusive proxy route
 * ([id]/image).
 *
 * Auth: the NON-impersonatable auth() (like the vault), NOT effectiveAuth. A
 * photo is a person's face; an admin in an impersonation session must NOT be
 * able to upload, list, view, or delete another person's photo. The user id
 * comes only from the session; a client-supplied id is never trusted. Every
 * query is owner-scoped.
 *
 * USAGE COUNTER: an accepted upload increments the "headshot_upload" counter --
 * a generous own-bucket daily ceiling, NOT the AI budget. getUserDailyUsage
 * explicitly excludes "headshot_upload", so saving a photo never appears as
 * burned AI calls. (AI headshot GENERATION is the separate /generate route and
 * DOES count.) Only ACCEPTED uploads are counted, so a rejected/malformed
 * request can never exhaust the day.
 */

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/auth";
import {
  createAvatarAsset,
  makeSecureObjectKey,
  putEncryptedObject,
  getOne,
  decideAvatarMime,
  MAX_PHOTO_BYTES,
  HEADSHOT_UPLOAD_ENDPOINT,
  incrementUserUsage,
} from "@crucible/core";

export const runtime = "nodejs";
export const maxDuration = 30;

// Generous own-bucket anti-abuse ceiling for photo uploads/day. Not the AI
// budget -- getUserDailyUsage excludes "headshot_upload".
const PHOTO_UPLOADS_PER_DAY = 50;

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
      WHERE user_id = $1 AND usage_date = CURRENT_DATE AND endpoint = $2`,
    [userId, HEADSHOT_UPLOAD_ENDPOINT]
  );
  if (parseInt(prior?.n ?? "0", 10) >= PHOTO_UPLOADS_PER_DAY) {
    return NextResponse.json(
      { error: "You have uploaded a lot of photos today. Please try again tomorrow." },
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
    return NextResponse.json({ error: "No photo provided" }, { status: 400 });
  }

  // Size guard BEFORE buffering the file into memory (File.size is known from the
  // multipart headers). Empty and oversized are rejected without allocating.
  if (file.size === 0) {
    return NextResponse.json({ error: "That photo is empty." }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: "That photo is over the 8 MB limit. It should already be small after cropping -- try again." },
      { status: 413 }
    );
  }

  // Optional client-reported dimensions of the cropped square (informational).
  const width = parseIntOrNull(form.get("width"));
  const height = parseIntOrNull(form.get("height"));

  // Defense in depth: re-check the real byte length after buffering.
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: "That photo is empty." }, { status: 400 });
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: "That photo is over the 8 MB limit." },
      { status: 413 }
    );
  }

  // Validate type: allowlist + content sniff (do NOT trust the client MIME alone).
  const decision = decideAvatarMime(file.type, bytes);
  if (!decision.ok) {
    return NextResponse.json(
      { error: "That file is not a supported image. Use a JPG, PNG, or WebP photo." },
      { status: 400 }
    );
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  try {
    const key = makeSecureObjectKey(userId, "headshot");
    const secure = await putEncryptedObject({
      ownerUserId: userId,
      purpose: "headshot",
      key,
      plaintext: bytes,
      mimeType: decision.mime,
      sha256,
    });

    const asset = await createAvatarAsset({
      userId,
      secureObjectId: secure.id,
      kind: "original_photo",
      width,
      height,
    });

    // Count only this accepted upload against the generous daily ceiling. The
    // "headshot_upload" endpoint is excluded from getUserDailyUsage, so it never
    // shows up as AI usage.
    await incrementUserUsage(userId, HEADSHOT_UPLOAD_ENDPOINT).catch(() => {});

    return NextResponse.json(
      {
        data: {
          id: asset.id,
          kind: asset.kind,
          source_asset_id: asset.source_asset_id,
          width: asset.width,
          height: asset.height,
          created_at: asset.created_at,
          mime_type: secure.mime_type,
          byte_size: secure.byte_size,
          imageUrl: `/api/avatar/${asset.id}/image`,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("Avatar photo upload error:", err?.message || err);
    return NextResponse.json(
      { error: "Could not save that photo. Please try again." },
      { status: 500 }
    );
  }
}

function parseIntOrNull(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 && n <= 10000 ? n : null;
}

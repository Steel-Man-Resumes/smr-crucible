/**
 * Phase 7.7 avatar photo path -- choose which avatar the nav shows.
 *
 *   POST /api/avatar/select
 *     body { kind: "illustrated" }              -> use the illustrated mark
 *     body { kind: "photo", assetId: "<uuid>" } -> use an uploaded/generated photo
 *
 * Writes ui_avatar.photoAssetId via setUiPrefs. For a photo selection the asset
 * MUST belong to the signed-in user (verified via getAvatarAsset) before the
 * pointer is written -- a client cannot point their nav at a stranger's asset,
 * and even if they somehow did, the image proxy re-checks ownership and returns
 * nothing. Owner-exclusive, NON-impersonatable auth(). Returns the new prefs.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getUiPrefs,
  setUiPrefs,
  getAvatarAsset,
  normalizeAvatar,
} from "@crucible/core";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const kind = (body as { kind?: unknown }).kind;
  const prefs = await getUiPrefs(userId);
  // Preserve the user's existing illustrated fields; only the photo pointer
  // changes. Fall back to the current normalized avatar or a fresh default.
  const base = prefs.avatar ?? normalizeAvatar({});

  if (kind === "illustrated") {
    const next = normalizeAvatar({ ...base, photoAssetId: null });
    const updated = await setUiPrefs(userId, { avatar: next });
    return NextResponse.json({ ok: true, data: updated });
  }

  if (kind === "photo") {
    const assetId = (body as { assetId?: unknown }).assetId;
    if (typeof assetId !== "string" || !assetId.trim()) {
      return NextResponse.json({ error: "Missing assetId" }, { status: 400 });
    }
    // Ownership check: only a photo this user owns can be selected.
    const owned = await getAvatarAsset(userId, assetId.trim());
    if (!owned) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const next = normalizeAvatar({ ...base, photoAssetId: owned.id });
    const updated = await setUiPrefs(userId, { avatar: next });
    return NextResponse.json({ ok: true, data: updated });
  }

  return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
}

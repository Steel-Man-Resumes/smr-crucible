/**
 * Phase 7.7 avatar photo path -- delete one asset.
 *
 *   DELETE /api/avatar/[id]  -> remove the asset AND its encrypted bytes
 *
 * Owner-exclusive: the user id is taken only from the session; the core call is
 * scoped to it. A foreign or missing id returns 404, never touching another
 * user's data. NON-impersonatable auth() so an admin impersonation session
 * cannot delete another person's photo.
 *
 * If the deleted asset was the user's currently SELECTED photo
 * (ui_avatar.photoAssetId), the selection is reset back to the illustrated
 * avatar so the nav never points at a now-missing asset.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deleteAvatarAsset,
  getUiPrefs,
  setUiPrefs,
  normalizeAvatar,
} from "@crucible/core";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await context.params;
  const result = await deleteAvatarAsset(userId, id);
  if (result.status === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // If this was the selected photo, fall back to the illustrated avatar. Keep
  // the illustrated fields; only clear the photo pointer.
  let selectionReset = false;
  const prefs = await getUiPrefs(userId);
  if (prefs.avatar?.photoAssetId === id) {
    const cleared = normalizeAvatar({ ...prefs.avatar, photoAssetId: null });
    await setUiPrefs(userId, { avatar: cleared });
    selectionReset = true;
  }

  return NextResponse.json({ success: true, selectionReset });
}

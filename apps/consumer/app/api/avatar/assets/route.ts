/**
 * Phase 7.7 avatar photo path -- list endpoint.
 *
 *   GET /api/avatar/assets[?kind=original_photo|generated_headshot]
 *
 * Returns the signed-in user's avatar assets (ids + kind + created_at + a proxy
 * image URL), NEWEST first. NEVER returns object_key or bytes -- the image is
 * only reachable through the owner-exclusive proxy ([id]/image). Owner-scoped,
 * NON-impersonatable auth().
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listAvatarAssets, isAvatarAssetKind } from "@crucible/core";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const kindParam = searchParams.get("kind");
  if (kindParam && !isAvatarAssetKind(kindParam)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  const assets = await listAvatarAssets(userId, {
    kind: kindParam && isAvatarAssetKind(kindParam) ? kindParam : undefined,
  });

  // Shape the response: expose only safe metadata + the proxy URL, never
  // object_key.
  const data = assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    source_asset_id: a.source_asset_id,
    width: a.width,
    height: a.height,
    mime_type: a.mime_type,
    byte_size: a.byte_size,
    created_at: a.created_at,
    imageUrl: `/api/avatar/${a.id}/image`,
  }));

  return NextResponse.json({ data });
}

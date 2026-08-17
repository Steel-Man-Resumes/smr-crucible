/**
 * Phase 7.7 avatar photo path -- owner-exclusive image proxy.
 *
 *   GET /api/avatar/[id]/image
 *
 * The ONLY way avatar photo/headshot bytes reach the browser. There is NO
 * presigned URL: the route looks up the asset (owner-scoped), decrypts the
 * ciphertext in memory via getDecryptedObject (which itself re-checks
 * owner_user_id), and streams the plaintext bytes with an image Content-Type.
 * A foreign or missing id is a 404. This is how NavAvatar renders a chosen photo.
 *
 * Uses the NON-impersonatable auth() (not effectiveAuth): a photo is a person's
 * face; an admin in an impersonation session must NOT be able to view another
 * person's photo. Owner-exclusive, no exceptions.
 *
 * Caching: `private, no-store` + `X-Content-Type-Options: nosniff`. The image is
 * private to the owner and must not be cached by a shared proxy/CDN.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAvatarAsset, getDecryptedObject } from "@crucible/core";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await context.params;
  const asset = await getAvatarAsset(userId, id);
  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // getDecryptedObject re-verifies ownership against owner_user_id and returns
  // null on any mismatch -- defense in depth on top of the owner-scoped lookup.
  const decrypted = await getDecryptedObject({ ownerUserId: userId, key: asset.object_key });
  if (!decrypted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = new Uint8Array(decrypted.buffer);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": asset.mime_type || "application/octet-stream",
      "Content-Length": String(body.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

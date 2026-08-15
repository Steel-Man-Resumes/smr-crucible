/**
 * Phase 6.2 vault -- owner-exclusive download proxy.
 *
 *   GET /api/vault/documents/[id]/download
 *
 * This is the ONLY way vault bytes reach the browser. There is NO presigned URL:
 * the route looks up the document (owner-scoped), decrypts the ciphertext in
 * memory via getDecryptedObject (which itself re-checks owner_user_id), and
 * proxies the plaintext bytes back with the right Content-Type and an
 * attachment Content-Disposition. A foreign or missing id is a 404.
 *
 * Uses the NON-impersonatable auth() (not effectiveAuth): the UI promises "only
 * you can open it", so an admin in an impersonation session must NOT be able to
 * download another person's ID or legal records. Owner-exclusive, no exceptions.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getVaultDocument,
  getDecryptedObject,
  safeVaultFilename,
} from "@crucible/core";

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
  const doc = await getVaultDocument(userId, id);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // getDecryptedObject re-verifies ownership against owner_user_id and returns
  // null on any mismatch -- defense in depth on top of the owner-scoped lookup.
  const decrypted = await getDecryptedObject({ ownerUserId: userId, key: doc.object_key });
  if (!decrypted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filename = safeVaultFilename(doc.label, doc.mime_type, doc.original_filename);
  // RFC 5987 encoding for the fallback filename* so non-ASCII labels survive.
  const asciiName = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const body = new Uint8Array(decrypted.buffer);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": doc.mime_type || "application/octet-stream",
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

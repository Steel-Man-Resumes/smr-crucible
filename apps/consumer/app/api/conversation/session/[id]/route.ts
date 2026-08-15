/**
 * GET /api/conversation/session/[id]?purpose=... -- the DECRYPTED transcript
 * for one of the caller's OWN sessions (Phase 5.1). This is the session-history
 * detail view. Owner-exclusive: a foreign or unknown id returns 404, never
 * another user's transcript.
 *
 * no-store: a decrypted transcript must never be cached by a browser, proxy,
 * or CDN.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getConversationTranscript, isConversationPurpose } from "@crucible/core";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const purpose = new URL(request.url).searchParams.get("purpose");
  if (!isConversationPurpose(purpose)) {
    return NextResponse.json(
      { error: "Unknown purpose" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const { id } = await context.params;

  const transcript = await getConversationTranscript({
    ownerUserId: userId,
    purpose,
    sessionId: id,
  });
  if (!transcript) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(
    { sessionId: id, purpose, transcript },
    { headers: NO_STORE_HEADERS }
  );
}

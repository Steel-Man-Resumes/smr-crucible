/**
 * GET /api/conversation/sessions?purpose=... -- the caller's OWN session
 * history for one purpose (Phase 5.1). METADATA ONLY: id, framing, status,
 * struggle tags, takeaways, timestamps. No decrypted transcript here -- the
 * detail route (/api/conversation/session/[id]) is where a transcript is read.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listConversationSessions, isConversationPurpose } from "@crucible/core";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

export async function GET(request: Request) {
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

  const sessions = await listConversationSessions(userId, purpose);
  return NextResponse.json({ purpose, sessions }, { headers: NO_STORE_HEADERS });
}

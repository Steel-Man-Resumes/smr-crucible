/**
 * POST /api/conversation/session/end -- close a rehearsal or interview session
 * (Phase 5.1). Owner-scoped: a session id the caller does not own is a no-op.
 *
 * Body: { purpose, sessionId, struggleTags?, takeaways? }
 *   struggleTags / takeaways : optional non-sensitive derived metadata (never
 *   the transcript itself).
 *
 * No consent gate here: ending a session only ever touches a row the user
 * already owns. If persistence was off, there is no row and this no-ops.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { endConversationSession, isConversationPurpose } from "@crucible/core";

export const maxDuration = 10;

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const purpose = body?.purpose;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";

  if (!isConversationPurpose(purpose)) {
    return NextResponse.json({ error: "Unknown purpose" }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const struggleTags = Array.isArray(body?.struggleTags)
    ? body.struggleTags
        .filter((t: unknown): t is string => typeof t === "string")
        .slice(0, 20)
        .map((t: string) => t.slice(0, 60))
    : undefined;

  const takeaways =
    body?.takeaways && typeof body.takeaways === "object" && !Array.isArray(body.takeaways)
      ? (body.takeaways as Record<string, unknown>)
      : undefined;

  try {
    await endConversationSession({
      ownerUserId: userId,
      purpose,
      sessionId,
      struggleTags,
      takeaways,
    });
    return NextResponse.json({ ended: true });
  } catch (err: any) {
    console.error("conversation session end failed:", err?.message || err);
    return NextResponse.json(
      { error: "Could not end the session." },
      { status: 500 }
    );
  }
}

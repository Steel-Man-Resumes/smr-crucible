/**
 * GET /api/coach/proactive -- the coach's opening nudge, if a trigger fires.
 *
 * Deterministic (computeProactiveMessage over getUserProfile). Returns
 * { message, reason } or { message: null }. The chat drawer shows this as the
 * coach's first message when there is no conversation yet. Auth required.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserProfile, computeProactiveMessage } from "@crucible/core";

export const maxDuration = 10;

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const profile = await getUserProfile(userId);
  if (!profile) {
    return NextResponse.json({ data: { message: null } });
  }
  const proactive = computeProactiveMessage(profile);
  return NextResponse.json({ data: proactive ?? { message: null } });
}

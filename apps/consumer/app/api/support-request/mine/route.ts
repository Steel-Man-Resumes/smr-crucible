/**
 * GET /api/support-request/mine -- the signed-in user's own submissions.
 *
 * Powers the Help center history: each row's visible status (received/seen/
 * fixed/replied), Troy's reply when one exists, and the "you have helped
 * improve N times" count. Own rows only.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isSameOriginJsonPost } from "@/lib/same-origin";

export async function PATCH(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.followUp !== "boolean" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id ?? "")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { setIdeaFollowUp } = await import("@crucible/core");
  const ok = await setIdeaFollowUp(session.user.id, body.id, body.followUp);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}

export const maxDuration = 10;

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { listUserSupportRequests, countUserSupportRequests, countUserUnseenReplies } =
    await import("@crucible/core");

  const [rows, count, unseenReplies] = await Promise.all([
    listUserSupportRequests(userId),
    countUserSupportRequests(userId),
    countUserUnseenReplies(userId),
  ]);

  return NextResponse.json({ data: rows, count, unseenReplies });
}

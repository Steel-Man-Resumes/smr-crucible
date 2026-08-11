/**
 * GET /api/support-request/mine -- the signed-in user's own submissions.
 *
 * Powers the Help center history: each row's visible status (received/seen/
 * fixed/replied), Troy's reply when one exists, and the "you have helped
 * improve N times" count. Own rows only.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";

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

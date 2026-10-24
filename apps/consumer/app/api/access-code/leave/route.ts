/**
 * POST /api/access-code/leave {orgId}: leave ONE organization (Settings).
 * Before this the only way out was deleting all your data. The seat is not
 * handed back (durable seats, Troy 2026-06-10); your own work is untouched.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { leaveOrg } from "@crucible/core";
import { isSameOriginJsonPost } from "@/lib/same-origin";

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const orgId = typeof body?.orgId === "string" ? body.orgId : "";
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return NextResponse.json({ error: "Check the request and try again." }, { status: 400 });
  try {
    const left = await leaveOrg(userId, orgId);
    return left
      ? NextResponse.json({ ok: true, message: "You left that organization. Your work is still yours." })
      : NextResponse.json({ error: "You are not part of that organization." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "That did not save. Try again shortly." }, { status: 503 });
  }
}

/**
 * The invitee's side of a staff invitation (migration 100).
 *   GET   my open invitations to join an organization's staff
 *   POST  { inviteId, accept: true | false }
 *
 * Only the signed-in person's own invitations, read through their own row
 * policy, and the answer goes through smr_answer_staff_invite, which takes
 * the person from the database session (app.user_id), never from the body.
 * Not while an admin is viewing as someone: an answer would be recorded for
 * the person being viewed.
 */
import { NextResponse } from "next/server";
import { effectiveAuth } from "@/lib/effective-auth";
import { myStaffInvites, answerStaffInvite } from "@crucible/core";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const session = await effectiveAuth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((session as { impersonation?: unknown }).impersonation) return NextResponse.json({ invites: [], viewing: true });
  const invites = await myStaffInvites(userId).catch((err) => {
    console.error("my staff invites failed:", (err as Error)?.message || err);
    return null;
  });
  if (!invites) return NextResponse.json({ error: "Your invitations could not be loaded. Try again." }, { status: 500 });
  return NextResponse.json({ invites }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const session = await effectiveAuth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((session as { impersonation?: unknown }).impersonation) {
    return NextResponse.json({ error: "Changes are off while viewing as someone else." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const inviteId = String(body?.inviteId ?? "");
  if (!UUID.test(inviteId) || typeof body?.accept !== "boolean") {
    return NextResponse.json({ error: "That invitation was not found." }, { status: 400 });
  }
  const res = await answerStaffInvite(userId, inviteId, body.accept);
  return res.ok
    ? NextResponse.json({ ok: true, result: res.result, message: res.message })
    : NextResponse.json({ error: res.message, result: res.result }, { status: 400 });
}

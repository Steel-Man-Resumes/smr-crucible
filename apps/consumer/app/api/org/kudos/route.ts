/**
 * Good catches between colleagues (migration 111, lane S6).
 *
 *   GET                                   colleagues I can thank (names only)
 *   POST { toUserId, body, workKind?, workId? }   send one
 *   PATCH { id }                          take back one I sent
 *
 * The words never carry record details (the staff t.ROY detector) and never
 * name a participant unless the good catch is sent from that person's own
 * task, note or referral; the database then checks both colleagues can see
 * them, and hides it from either one who later cannot.
 */
import { NextResponse } from "next/server";
import { giveKudos, withdrawKudos, listColleagues, reachableParticipantNames, namesMentioned } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";
import { effectiveAuth } from "@/lib/effective-auth";
import { mayWrite, recordWordsIn, RECORD_WORDS_REFUSAL, VIEWING_REFUSAL } from "@/lib/staff-rewards-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  if (guard.viewing || guard.actor.viaPlatformAdmin) return NextResponse.json({ colleagues: [] });
  const colleagues = await listColleagues(guard.actor);
  return NextResponse.json({ colleagues: colleagues.map((c) => ({ userId: c.userId, name: c.name })) }, { headers: { "Cache-Control": "private, no-store" } });
}

async function gate(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return { response: guard.response } as const;
  const session = await effectiveAuth();
  if (!mayWrite({ viewing: guard.viewing, viaPlatformAdmin: guard.actor.viaPlatformAdmin, actorUserId: guard.actor.userId, sessionUserId: session?.user?.id })) {
    return { response: NextResponse.json({ error: VIEWING_REFUSAL }, { status: 403 }) } as const;
  }
  return { actor: guard.actor } as const;
}

export async function POST(request: Request) {
  const w = await gate(request);
  if ("response" in w) return w.response;
  const body = await request.json().catch(() => ({}));
  const text = String(body?.body ?? "");
  if (recordWordsIn([text])) return NextResponse.json({ error: RECORD_WORDS_REFUSAL }, { status: 400 });
  const mentioned = namesMentioned(text, await reachableParticipantNames(w.actor));
  const res = await giveKudos(w.actor, {
    toUserId: String(body?.toUserId ?? ""), body: text,
    workKind: body?.workKind ? String(body.workKind) as never : null,
    workId: body?.workId ? String(body.workId) : null,
  }, mentioned);
  return res.ok ? NextResponse.json({ ok: true, id: res.id }) : NextResponse.json({ error: res.reason }, { status: 400 });
}

export async function PATCH(request: Request) {
  const w = await gate(request);
  if ("response" in w) return w.response;
  const body = await request.json().catch(() => ({}));
  const ok = await withdrawKudos(w.actor, String(body?.id ?? ""));
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false }, { status: 404 });
}

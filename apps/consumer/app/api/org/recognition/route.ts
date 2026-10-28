/**
 * Recognition notes for funder reports (migration 111, lane S6).
 *
 *   GET                         owner or org admin: every note and its answer,
 *                               plus `forReport`, ONLY the ones the person said yes to
 *   POST { aboutUserId, body, periodLabel? }   owner or org admin writes one
 *   PATCH { id, status }        the person it is about: approved, declined, withdrawn
 *
 * A note reaches a report only with the staff member's own yes, and they can
 * take it back. The words carry no record details.
 */
import { NextResponse } from "next/server";
import { listOrgRecognitionNotes, writeRecognitionNote, answerRecognitionNote, listKudosColleagues } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";
import { effectiveAuth } from "@/lib/effective-auth";
import { mayWrite, recordWordsIn, RECORD_WORDS_REFUSAL, VIEWING_REFUSAL } from "@/lib/staff-rewards-route";
import { readJsonStrict, refuseCrossOrigin, NOT_JSON } from "@/lib/staff-rewards-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  if (guard.viewing || guard.actor.viaPlatformAdmin) return NextResponse.json({ notes: [], forReport: [], staff: [] });
  const notes = await listOrgRecognitionNotes(guard.actor);
  if (!notes) return NextResponse.json({ error: "Only the owner or an org admin sees these." }, { status: 403 });
  const staff = (await listKudosColleagues(guard.actor)).map((c) => ({ userId: c.userId, name: c.name }));
  return NextResponse.json({ notes, forReport: notes.filter((n) => n.status === "approved"), staff }, { headers: { "Cache-Control": "private, no-store" } });
}

async function gate(request: Request) {
  // Same-origin first, before the session is read (lib/org-crm-gate.ts).
  const crossOrigin = refuseCrossOrigin(request);
  if (crossOrigin) return { response: crossOrigin } as const;
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
  const body = await readJsonStrict(request);
  if (!body) return NextResponse.json({ error: NOT_JSON }, { status: 415 });
  if (recordWordsIn([String(body?.body ?? ""), String(body?.periodLabel ?? "")])) return NextResponse.json({ error: RECORD_WORDS_REFUSAL }, { status: 400 });
  const res = await writeRecognitionNote(w.actor, { aboutUserId: String(body?.aboutUserId ?? ""), body: String(body?.body ?? ""), periodLabel: body?.periodLabel == null ? null : String(body.periodLabel) });
  return res.ok ? NextResponse.json({ ok: true, id: res.id }) : NextResponse.json({ error: res.reason }, { status: 400 });
}

export async function PATCH(request: Request) {
  const w = await gate(request);
  if ("response" in w) return w.response;
  const body = await readJsonStrict(request);
  if (!body) return NextResponse.json({ error: NOT_JSON }, { status: 415 });
  const status = String(body?.status ?? "");
  if (!["approved", "declined", "withdrawn"].includes(status)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const ok = await answerRecognitionNote(w.actor, String(body?.id ?? ""), status as "approved" | "declined" | "withdrawn");
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false }, { status: 404 });
}

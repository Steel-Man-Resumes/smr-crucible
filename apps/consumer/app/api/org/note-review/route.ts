/**
 * Supervisor review of case notes (staff side lane S4, migration 109; on only
 * when the organization switches on the note_review module).
 *   GET  ?clientId=<person>   whether it is on, whether you review, and each note's review state
 *   GET  ?queue=1             notes waiting for review (owner and org admins)
 *   POST { action: "submit", noteId }                              the note's author
 *        { action: "decide", noteId, decision: "approve" | "send_back", comment? }   owner or org admin, not the author
 * Every move is a database function; this route only passes it along.
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import { listNoteReviews, listReviewQueue, submitNoteForReview, decideNoteReview } from "@crucible/core";
import { withCrm, refuseCrossOrigin, readJson, UUID } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

async function gate(request: Request) {
  return withCrm(await requireOrgCapability("org.client.view_content", { request }));
}

export async function GET(request: Request) {
  const g = await gate(request);
  if (!g.ok) return g.response;
  const u = new URL(request.url);
  if (u.searchParams.get("queue") === "1") {
    const queue = await listReviewQueue(g.actor);
    return queue ? NextResponse.json({ queue }) : NextResponse.json({ error: "Only the owner or an admin reviews notes." }, { status: 403 });
  }
  const clientId = u.searchParams.get("clientId") ?? "";
  if (!UUID.test(clientId)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const res = await listNoteReviews(g.actor, clientId);
  return res ? NextResponse.json({ ...res, me: g.actor.userId, canWrite: !g.actor.viewedBy }) : NextResponse.json({ error: "Not found." }, { status: 404 });
}

export async function POST(request: Request) {
  const cross = refuseCrossOrigin(request);
  if (cross) return cross;
  const g = await gate(request);
  if (!g.ok) return g.response;
  const b = await readJson(request);
  const noteId = typeof b.noteId === "string" ? b.noteId : "";
  if (!UUID.test(noteId)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const res =
    b.action === "submit" ? await submitNoteForReview(g.actor, noteId)
    : b.action === "decide" ? await decideNoteReview(g.actor, noteId, { decision: b.decision, comment: b.comment })
    : null;
  if (!res) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.error }, { status: 400 });
}

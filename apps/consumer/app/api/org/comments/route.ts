/**
 * Team comments (staff side lane S4, migration 109).
 *   GET  ?clientId=<person>   comments about that person, and who can be mentioned
 *   GET  (no clientId)        the team thread (comments about nobody in particular)
 *   POST { action: "add", clientId?, parentId?, body, mentions? }
 *        { action: "correct", commentId, body, mentions? }
 *        { action: "history", commentId }
 * Every rule (who, reach, mentions) is in core and in the database.
 * Out of reach is one indistinct 404.
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import { listTeamComments, listColleagues, addTeamComment, correctTeamComment, getTeamCommentHistory, COMMENT_CARE_LINE, COMMENT_MAX } from "@crucible/core";
import { withCrm, refuseCrossOrigin, readJson, UUID } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

async function gate(request: Request) {
  return withCrm(await requireOrgCapability("org.client.view_content", { request }));
}
const s = (v: unknown) => (typeof v === "string" ? v : null);

export async function GET(request: Request) {
  const g = await gate(request);
  if (!g.ok) return g.response;
  const clientId = new URL(request.url).searchParams.get("clientId");
  if (clientId && !UUID.test(clientId)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const res = await listTeamComments(g.actor, clientId || null);
  if (!res.ok) return NextResponse.json({ error: res.reason === "no_capability" ? "You do not have access to that." : "Not found." }, { status: res.reason === "no_capability" ? 403 : 404 });
  const colleagues = (await listColleagues(g.actor, clientId || null)) ?? [];
  return NextResponse.json({
    comments: res.comments,
    // Only people who can see this person are offered for @ (the database refuses the rest).
    mentionable: colleagues.filter((c) => c.reaches).map((c) => ({ id: c.user_id, name: c.name })),
    me: g.actor.userId,
    canWrite: !g.actor.viaPlatformAdmin && !g.actor.viewedBy,
    careLine: COMMENT_CARE_LINE,
    max: COMMENT_MAX,
  });
}

export async function POST(request: Request) {
  const cross = refuseCrossOrigin(request);
  if (cross) return cross;
  const g = await gate(request);
  if (!g.ok) return g.response;
  const b = await readJson(request);
  if (b.action === "add") {
    const clientId = s(b.clientId);
    if (clientId && !UUID.test(clientId)) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const res = await addTeamComment(g.actor, { participantId: clientId || null, parentId: s(b.parentId), body: b.body, mentions: b.mentions });
    return res.ok ? NextResponse.json({ ok: true, id: res.id }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  const commentId = s(b.commentId) ?? "";
  if (!UUID.test(commentId)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (b.action === "correct") {
    const res = await correctTeamComment(g.actor, commentId, { body: b.body, mentions: "mentions" in b ? b.mentions : undefined });
    return res.ok ? NextResponse.json({ ok: true, id: res.id }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  if (b.action === "history") {
    const versions = await getTeamCommentHistory(g.actor, commentId);
    return versions ? NextResponse.json({ versions }) : NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

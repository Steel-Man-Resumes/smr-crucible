/**
 * One participant, as their organization's staff may see them.
 *
 *   GET  ?scope=applications|resume|documents   shared content for one scope
 *   GET  (no scope)                              who they are, what is shared, notes
 *   POST { action: "request_sharing", scope, reason }
 *   POST { action: "add_note", body, kind?, visibleToParticipant?, draftedByAssistant? }
 *
 * This route decides NOTHING about access. Every read and write goes through
 * orgClientView, which checks capability, membership, caseload reach and the
 * participant's own grant on every call, and writes the access log in the same
 * transaction as the read. The route's only jobs are the session, the feature
 * flag, and turning a refusal into a status code.
 */
import { NextResponse } from "next/server";
import {
  getOne,
  getClientHeader,
  getClientApplications,
  getClientResumes,
  getClientDocuments,
  getClientNotes,
  addClientNote,
  requestSharing,
  isSharingScope,
  type ClientViewDenied,
} from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function enabledFor(orgId: string): Promise<boolean> {
  const row = await getOne<{ crm_v2: boolean }>(`SELECT crm_v2 FROM access_code WHERE id = $1`, [orgId]);
  return !!row?.crm_v2;
}

/**
 * "Not shared" is a normal state the page renders, so it is a 200 with a
 * reason. Everything else is one indistinct 404: whether a person exists, is in
 * another org, or is on a colleague's caseload is not this caller's to learn.
 */
function refusal(reason: ClientViewDenied) {
  if (reason === "not_shared") return NextResponse.json({ shared: false, rows: [] });
  if (reason === "platform_admin_view") {
    return NextResponse.json(
      { error: "Platform admins can see an organization's console, not what its participants shared with it." },
      { status: 403 }
    );
  }
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireOrgCapability("org.client.view_content");
  if (!guard.ok) return guard.response;
  const { actor } = guard;
  if (!UUID.test(params.id) || !(await enabledFor(actor.orgId))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const scope = new URL(request.url).searchParams.get("scope");
  if (scope) {
    if (!isSharingScope(scope)) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const result =
      scope === "applications" ? await getClientApplications(actor, params.id)
      : scope === "resume" ? await getClientResumes(actor, params.id)
      : await getClientDocuments(actor, params.id);
    if (!result.ok) return refusal(result.reason);
    return NextResponse.json({ shared: true, rows: result.rows });
  }

  const header = await getClientHeader(actor, params.id);
  if (!header.ok) return refusal(header.reason);
  const notes = await getClientNotes(actor, params.id);
  return NextResponse.json({
    client: header.rows[0],
    notes: notes.ok ? notes.rows : [],
    viewer: { userId: actor.userId, canWriteNotes: actor.capabilities.has("org.note.write"), canRequest: actor.capabilities.has("org.client.request_sharing") },
  });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireOrgCapability("org.client.view_content");
  if (!guard.ok) return guard.response;
  const { actor } = guard;
  if (!UUID.test(params.id) || !(await enabledFor(actor.orgId))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));

  if (body.action === "request_sharing") {
    const res = await requestSharing(actor, params.id, String(body.scope ?? ""), String(body.reason ?? ""));
    return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  if (body.action === "add_note") {
    const res = await addClientNote(actor, params.id, {
      body: String(body.body ?? ""),
      kind: typeof body.kind === "string" ? body.kind : undefined,
      visibleToParticipant: body.visibleToParticipant === true,
      draftedByAssistant: body.draftedByAssistant === true,
    });
    return res.ok ? NextResponse.json({ ok: true, id: res.id }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

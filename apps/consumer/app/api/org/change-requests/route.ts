/**
 * Change requests from staff to the owner and org admins (staff side lane S4,
 * migration 109).
 *   GET  ?view=mine (default) | queue (managers) &status=active|open|accepted|declined|done
 *   GET  ?id=<request>                      the request and its replies
 *   POST { action: "create", kind, title, body?, target? }    any staff member
 *        { action: "answer", id, status?, answer? }           owner or org admin
 *        { action: "reply", id, body }                        the asker or a manager
 * S2's "Suggest a change to your organization" posts the create action.
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import {
  listChangeRequests, getChangeRequest, createChangeRequest, answerChangeRequest, replyToChangeRequest, isOrgManager,
  CHANGE_REQUEST_KINDS, CHANGE_REQUEST_KIND_LABELS, CHANGE_REQUEST_STATUSES, CHANGE_REQUEST_STATUS_LABELS, CHANGE_REQUEST_ACTION_LABELS,
  CHANGE_REQUEST_TRANSITIONS, CHANGE_REQUEST_CARE_LINE,
} from "@crucible/core";
import { withCrm, refuseCrossOrigin, readJson, UUID } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

async function gate(request: Request) {
  return withCrm(await requireOrgCapability("org.cohort.view", { request }));
}
const s = (v: unknown) => (typeof v === "string" ? v : null);

export async function GET(request: Request) {
  const g = await gate(request);
  if (!g.ok) return g.response;
  const u = new URL(request.url);
  const id = u.searchParams.get("id");
  if (id) {
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const one = await getChangeRequest(g.actor, id);
    return one ? NextResponse.json(one) : NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const manager = isOrgManager(g.actor);
  const view = u.searchParams.get("view") === "queue" && manager ? "queue" : "mine";
  const requests = await listChangeRequests(g.actor, { view, status: u.searchParams.get("status") });
  if (!requests) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json({
    requests, view, manager, me: g.actor.userId, canWrite: !g.actor.viewedBy && !g.actor.viaPlatformAdmin,
    options: {
      kinds: CHANGE_REQUEST_KINDS.map((k) => ({ value: k, label: CHANGE_REQUEST_KIND_LABELS[k] })),
      statuses: CHANGE_REQUEST_STATUSES.map((v) => ({ value: v, label: CHANGE_REQUEST_STATUS_LABELS[v], action: CHANGE_REQUEST_ACTION_LABELS[v], next: CHANGE_REQUEST_TRANSITIONS[v] })),
      careLine: CHANGE_REQUEST_CARE_LINE,
    },
  });
}

export async function POST(request: Request) {
  const cross = refuseCrossOrigin(request);
  if (cross) return cross;
  const g = await gate(request);
  if (!g.ok) return g.response;
  const b = await readJson(request);
  if (b.action === "create") {
    const res = await createChangeRequest(g.actor, { kind: b.kind, title: b.title, body: b.body, target: b.target });
    return res.ok ? NextResponse.json({ ok: true, id: res.id }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  const id = s(b.id) ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const res =
    b.action === "answer" ? await answerChangeRequest(g.actor, id, { status: b.status, answer: b.answer })
    : b.action === "reply" ? await replyToChangeRequest(g.actor, id, b.body)
    : null;
  if (!res) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  return res.ok ? NextResponse.json({ ok: true, id: res.id }) : NextResponse.json({ error: res.error }, { status: 400 });
}

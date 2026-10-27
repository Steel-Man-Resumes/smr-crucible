/**
 * Staff tasks.
 *   GET  ?clientId=   tasks within the caller's reach (optionally for one participant)
 *   GET  ?assignees=1&clientId=   who a task about that person (or nobody) can go to: you, then colleagues who reach them
 *   POST { action: "add", title, dueOn?, clientId?, shared?, ownerId? } | { action: "done"|"reopen"|"cancel", taskId }
 *        { action: "assign", taskId, ownerId }   hand a task to a colleague who reaches the person (lane S4, migration 109)
 */
import { NextResponse } from "next/server";
import { getOne, listStaffTasks, addStaffTask, updateStaffTask, assignStaffTask, listTaskAssignees } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function gate(request: Request) {
  const guard = await requireOrgCapability("org.client.view_content", { request });
  if (!guard.ok) return guard;
  const flag = await getOne<{ crm_v2: boolean }>(`SELECT crm_v2 FROM access_code WHERE id = $1`, [guard.actor.orgId]);
  if (!flag?.crm_v2) return { ok: false as const, response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  return guard;
}

export async function GET(request: Request) {
  const g = await gate(request);
  if (!g.ok) return g.response;
  const u = new URL(request.url);
  const clientId = u.searchParams.get("clientId");
  if (clientId && !UUID.test(clientId)) return NextResponse.json({ tasks: [], assignees: [] });
  if (u.searchParams.get("assignees") === "1") {
    return NextResponse.json({ assignees: (await listTaskAssignees(g.actor, clientId || null)) ?? [] });
  }
  return NextResponse.json({ tasks: (await listStaffTasks(g.actor, { clientId: clientId ?? undefined })) ?? [] });
}

export async function POST(request: Request) {
  const g = await gate(request);
  if (!g.ok) return g.response;
  const body = await request.json().catch(() => ({}));
  if (body.action === "add") {
    if (body.clientId && !UUID.test(String(body.clientId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (body.ownerId && !UUID.test(String(body.ownerId))) return NextResponse.json({ error: "A task can only go to someone on your team." }, { status: 400 });
    const res = await addStaffTask(g.actor, {
      title: String(body.title ?? ""), dueOn: body.dueOn ? String(body.dueOn) : null, clientId: body.clientId ? String(body.clientId) : null, shared: body.shared === true,
      ownerId: body.ownerId ? String(body.ownerId) : null,
    });
    return res.ok ? NextResponse.json({ ok: true, id: res.id }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  if (body.action === "assign" && UUID.test(String(body.taskId ?? "")) && UUID.test(String(body.ownerId ?? ""))) {
    const res = await assignStaffTask(g.actor, String(body.taskId), String(body.ownerId));
    return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  if (["done", "reopen", "cancel"].includes(body.action) && UUID.test(String(body.taskId ?? ""))) {
    const ok = await updateStaffTask(g.actor, String(body.taskId), body.action);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "That task is not yours to change." }, { status: 400 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

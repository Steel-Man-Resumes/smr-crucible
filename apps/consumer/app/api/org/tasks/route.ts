/**
 * Staff tasks.
 *   GET  ?clientId=   tasks within the caller's reach (optionally for one participant)
 *   POST { action: "add", title, dueOn?, clientId?, shared? } | { action: "done"|"reopen"|"cancel", taskId }
 */
import { NextResponse } from "next/server";
import { getOne, listStaffTasks, addStaffTask, updateStaffTask } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function gate() {
  const guard = await requireOrgCapability("org.client.view_content");
  if (!guard.ok) return guard;
  const flag = await getOne<{ crm_v2: boolean }>(`SELECT crm_v2 FROM access_code WHERE id = $1`, [guard.actor.orgId]);
  if (!flag?.crm_v2) return { ok: false as const, response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  return guard;
}

export async function GET(request: Request) {
  const g = await gate();
  if (!g.ok) return g.response;
  const clientId = new URL(request.url).searchParams.get("clientId");
  if (clientId && !UUID.test(clientId)) return NextResponse.json({ tasks: [] });
  return NextResponse.json({ tasks: (await listStaffTasks(g.actor, { clientId: clientId ?? undefined })) ?? [] });
}

export async function POST(request: Request) {
  const g = await gate();
  if (!g.ok) return g.response;
  const body = await request.json().catch(() => ({}));
  if (body.action === "add") {
    if (body.clientId && !UUID.test(String(body.clientId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const res = await addStaffTask(g.actor, { title: String(body.title ?? ""), dueOn: body.dueOn ? String(body.dueOn) : null, clientId: body.clientId ? String(body.clientId) : null, shared: body.shared === true });
    return res.ok ? NextResponse.json({ ok: true, id: res.id }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  if (["done", "reopen", "cancel"].includes(body.action) && UUID.test(String(body.taskId ?? ""))) {
    const ok = await updateStaffTask(g.actor, String(body.taskId), body.action);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "That task is not yours to change." }, { status: 400 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

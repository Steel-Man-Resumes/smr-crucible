/** The participant's side: tasks their case manager shared with them. GET the list; POST { taskId, done } to tick one. */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMySharedTasks, tickMyTask } from "@crucible/core";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ tasks: await getMySharedTasks(session.user.id) });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!UUID.test(String(body.taskId ?? ""))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const ok = await tickMyTask(session.user.id, String(body.taskId), body.done !== false);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found." }, { status: 404 });
}

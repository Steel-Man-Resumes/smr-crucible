/** GET: the case record across the caller's caseload, newest first. */
import { NextResponse } from "next/server";
import { getOne, listRecentNotes } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOrgCapability("org.client.view_content");
  if (!guard.ok) return guard.response;
  const row = await getOne<{ crm_v2: boolean }>(`SELECT crm_v2 FROM access_code WHERE id = $1`, [guard.actor.orgId]);
  if (!row?.crm_v2) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const res = await listRecentNotes(guard.actor);
  if (!res.ok) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json({ notes: res.rows });
}

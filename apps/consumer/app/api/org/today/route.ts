/** GET: the caller's work queue. What may appear, and the access log it writes, are decided in core (orgToday.ts). */
import { NextResponse } from "next/server";
import { getOne, getTodayQueue, getStaffPrefs, TODAY_SECTIONS, TODAY_SECTION_LABELS } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOrgCapability("org.client.view_content");
  if (!guard.ok) return guard.response;
  const flag = await getOne<{ crm_v2: boolean }>(`SELECT crm_v2 FROM access_code WHERE id = $1`, [guard.actor.orgId]);
  if (!flag?.crm_v2) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const [items, prefs] = await Promise.all([getTodayQueue(guard.actor), getStaffPrefs(guard.actor)]);
  if (!items) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json({
    items,
    sections: TODAY_SECTIONS.map((s) => ({ key: s, label: TODAY_SECTION_LABELS[s] })),
    hidden: prefs.effective.todayHidden,
    canAddTasks: guard.actor.capabilities.has("org.task.write"),
  });
}

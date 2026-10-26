/**
 * GET: the caller's work queue. What may appear, and the access log it writes, are decided in core (orgToday.ts).
 * The ORDER of sections, and which ones a role sees at all, come from the
 * organization's layout for the caller's role (org_role_layout, 104); a
 * section the layout hides is not sent. Each person can still hide or fold
 * sections for themselves (Settings, My workflow; the fold on the page).
 */
import { NextResponse } from "next/server";
import { getOne, getTodayView, getStaffPrefs, getMyRoleLayout, resolveTodaySections, TODAY_SECTIONS, TODAY_SECTION_LABELS } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.client.view_content", { request });
  if (!guard.ok) return guard.response;
  const flag = await getOne<{ crm_v2: boolean }>(`SELECT crm_v2 FROM access_code WHERE id = $1`, [guard.actor.orgId]);
  if (!flag?.crm_v2) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const [view, prefs, layout] = await Promise.all([
    getTodayView(guard.actor),
    getStaffPrefs(guard.actor),
    // A layout that cannot be read falls back to the built-in order, never to an empty day.
    getMyRoleLayout(guard.actor).catch(() => ({ today: null, caseload: null })),
  ]);
  if (!view) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  const sections = resolveTodaySections(TODAY_SECTIONS, layout.today);
  const shown = new Set<string>(sections);
  return NextResponse.json({
    items: view.items.filter((i) => shown.has(i.section)),
    sections: sections.map((s) => ({ key: s, label: TODAY_SECTION_LABELS[s] })),
    hidden: prefs.effective.todayHidden,
    collapsed: prefs.effective.todayCollapsed,
    canAddTasks: guard.actor.capabilities.has("org.task.write"),
    // Counts only, and only for people who see the whole organization (null otherwise).
    reach: view.reach,
    volunteer: view.volunteer,
  });
}

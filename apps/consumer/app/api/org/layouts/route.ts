/**
 * Layouts per role (migration 104): which Today sections show and in what
 * order, and which caseload columns show when nobody picked a view.
 *   GET   every role's layout, the section and column choices
 *   PUT { role, surface: "today" | "caseload", layout }   layout null = back to the built-in default
 * Reading needs org.cohort.view; changing needs org.settings.manage.
 */
import { NextResponse } from "next/server";
import {
  BUILTIN_CASELOAD_COLUMNS, BUILTIN_COLUMN_LABELS, LAYOUT_ROLES, LAYOUT_ROLE_LABELS, TODAY_SECTIONS, TODAY_SECTION_LABELS,
  canManageSharedViews, getRoleLayouts, listFieldDefs, setRoleLayout,
} from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOrgCapability("org.cohort.view");
  if (!guard.ok) return guard.response;
  const [layouts, defs] = await Promise.all([getRoleLayouts(guard.actor), listFieldDefs(guard.actor, { entity: "participant" })]);
  return NextResponse.json({
    layouts,
    roles: LAYOUT_ROLES.map((r) => ({ key: r, label: LAYOUT_ROLE_LABELS[r] })),
    sections: TODAY_SECTIONS.map((s) => ({ key: s, label: TODAY_SECTION_LABELS[s] })),
    columns: [
      ...BUILTIN_CASELOAD_COLUMNS.map((c) => ({ key: c, label: BUILTIN_COLUMN_LABELS[c] })),
      ...defs.map((d) => ({ key: `cf:${d.key}`, label: d.label })),
    ],
    canManage: canManageSharedViews(guard.actor),
    myRole: guard.actor.role,
  });
}

export async function PUT(request: Request) {
  const guard = await requireOrgCapability("org.settings.manage");
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const res = await setRoleLayout(guard.actor, body.role, body.surface, body.layout ?? null);
  return res.ok ? NextResponse.json({ ok: true, layouts: await getRoleLayouts(guard.actor) }) : NextResponse.json({ error: res.error }, { status: 400 });
}

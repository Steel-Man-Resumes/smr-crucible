/**
 * Saved views (migration 104).
 *   GET  ?surface=caseload    your views and the shared ones, plus your role's
 *                             default caseload columns. Reads only: a GET never
 *                             writes (view-as and link previews are GETs).
 *   POST { action: "move_legacy" }   move your old saved sorts (Settings, 052)
 *                             into personal views in this organization, once.
 *                             The People screen calls it on first load; it is
 *                             a write, so read-only view-as refuses it at the edge.
 *   POST { action: "create", surface, name, definition, shared?, roleDefault? }
 *        { action: "update", id, name?, definition?, roleDefault? }
 *        { action: "delete", id }
 *        { action: "reorder", surface, ids, shared? }
 * Anyone on staff keeps personal views; shared views need org.settings.manage
 * (core and the database policy both check). A view never widens reach.
 */
import { NextResponse } from "next/server";
import {
  canManageSharedViews, createSavedView, deleteSavedView, getMyRoleLayout, getStaffPrefs, isViewSurface, listSavedViews, migrateLegacySavedViews,
  reorderSavedViews, updateSavedView,
} from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  const surface = new URL(request.url).searchParams.get("surface") ?? "caseload";
  if (!isViewSurface(surface)) return NextResponse.json({ error: "Unknown list." }, { status: 400 });
  const actor = guard.actor;
  const [views, layout, prefs] = await Promise.all([listSavedViews(actor, surface), getMyRoleLayout(actor), getStaffPrefs(actor)]);
  return NextResponse.json({
    views, role: actor.role, canShare: canManageSharedViews(actor),
    canExport: !actor.viaPlatformAdmin && actor.capabilities.has("org.export"),
    roleColumns: layout.caseload?.columns ?? null,
    personalHidden: prefs.effective.caseloadHidden,
    defaultSort: prefs.effective.caseloadSort,
  });
}

export async function POST(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  switch (body.action) {
    case "move_legacy": {
      if (guard.actor.viaPlatformAdmin) return NextResponse.json({ moved: 0 });
      // Never blocks the screen: a failed move is tried again next time.
      const moved = await migrateLegacySavedViews(guard.actor).catch((err) => { console.error("saved view move failed:", err?.message || err); return 0; });
      return NextResponse.json({ moved });
    }
    case "create": {
      const res = await createSavedView(guard.actor, body);
      return res.ok ? NextResponse.json(res) : NextResponse.json({ error: res.error }, { status: 400 });
    }
    case "update": {
      const res = await updateSavedView(guard.actor, id, body);
      return res.ok ? NextResponse.json(res) : NextResponse.json({ error: res.error }, { status: 400 });
    }
    case "delete":
      return (await deleteSavedView(guard.actor, id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "No such view, or it is not yours to remove." }, { status: 404 });
    case "reorder": {
      const ok = isViewSurface(body.surface) && Array.isArray(body.ids) && (await reorderSavedViews(guard.actor, body.surface, body.ids, body.shared === true));
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "The new order did not save. Try again." }, { status: 400 });
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}

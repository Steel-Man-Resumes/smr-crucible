import { NextResponse } from "next/server";
import {
  cleanKindSettings,
  setLaneKindSettings,
  hurdlesFor,
  HELP_SOURCES,
  HURDLES_NOT_A_VERDICT,
} from "@crucible/core";
import { creativeLane, gate, laneNotFound, loadCreativeContext, readJson } from "@/lib/creative-server";

interface RouteContext {
  params: Promise<{ laneId: string }>;
}

/**
 * GET /api/creative/[laneId]
 *   Everything the creative lane screens read: the lane and its pair, the
 *   practice record, the saved bio and statement (versions and the marks t.ROY
 *   offered; never the stored fingerprints), the sample order, the open items,
 *   and the pair's plan card with its general hurdles and help links.
 * PUT /api/creative/[laneId] { settings }
 *   This lane's choices (name on the page, contact lines, page cap, how each
 *   title that names a facility shows, bio disclosure and pronoun).
 */
export async function GET(request: Request, context: RouteContext) {
  const g = await gate(request);
  if (!g.ok) return g.res;
  const { laneId } = await context.params;
  const lane = await creativeLane(g.userId, laneId);
  if (!lane) return laneNotFound();
  const c = await loadCreativeContext(g.userId, lane);
  const dream = lane.path === "dream" ? lane : c.partner?.path === "dream" ? c.partner : null;
  const realistic = lane.path === "realistic" ? lane : c.partner?.path === "realistic" ? c.partner : null;
  return NextResponse.json({
    lane: c.lane,
    partner: c.partner,
    entries: c.entries,
    settings: c.settings,
    bio: c.bio,
    statement: { versions: c.statement.versions, offeredMarks: c.statement.offeredMarks },
    sampleOrder: c.sampleOrder,
    status: c.status,
    plan: c.plan
      ? {
          plan: c.plan,
          goalFromLane: dream?.target_role ?? dream?.name ?? null,
          realisticAim: realistic?.target_role ?? realistic?.name ?? null,
          hurdles: hurdlesFor(dream?.target_role, dream?.name, realistic?.target_role),
          notAVerdict: HURDLES_NOT_A_VERDICT,
          help: HELP_SOURCES,
        }
      : null,
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const g = await gate(request, { write: true });
  if (!g.ok) return g.res;
  const { laneId } = await context.params;
  const lane = await creativeLane(g.userId, laneId);
  if (!lane) return laneNotFound();
  const body = await readJson(request, 40_000);
  if (!body) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  const next = cleanKindSettings(body.settings, lane.kind_settings ?? {});
  const saved = await setLaneKindSettings(g.userId, lane.id, next as Record<string, unknown>);
  if (!saved) return laneNotFound();
  return NextResponse.json({ settings: cleanKindSettings(saved.kind_settings ?? {}) });
}

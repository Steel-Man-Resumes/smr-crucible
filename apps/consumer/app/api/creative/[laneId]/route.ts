import { NextResponse } from "next/server";
import {
  cleanKindSettings,
  applyTitleMode,
  settingsRev,
  listPracticeEntries,
  setLaneKindSettings,
  hurdlesFor,
  HELP_SOURCES,
  HURDLES_NOT_A_VERDICT,
} from "@crucible/core";
import { creativeLane, gate, laneNotFound, loadCreativeContext, ownerOnly, readJson } from "@/lib/creative-server";

const SETTINGS_CHANGED = { error: "changed_elsewhere", message: "These choices changed in another tab or window. Refresh the page, then try again." };

interface RouteContext {
  params: Promise<{ laneId: string }>;
}

/**
 * GET /api/creative/[laneId]
 *   Everything the creative lane screens read: the lane and its pair, the
 *   practice record, the saved bio and statement (with the revision each save
 *   must be based on), the sample order, the open items, and the pair's plan
 *   card with its general hurdles and help links.
 * PUT /api/creative/[laneId] { settings, rev }  or  { titleMode: { entryId, mode }, rev }
 *   This lane's choices (name on the page, contact lines, page cap, picked
 *   entries, pronoun), or ONE facility choice for one entry. Always on top of
 *   the revision the screen loaded; facility choices never arrive as a whole
 *   map, so a stale tab can't undo a newer "leave it off".
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
    settingsRev: settingsRev(c.settings),
    bio: c.bio,
    bioRev: c.bioRev,
    statement: { versions: c.statement.versions },
    statementRev: c.statementRev,
    sampleOrder: c.sampleOrder,
    sampleRev: c.sampleRev,
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
  // Every settings save names the revision it was based on. No revision, or an old one: refused.
  const current = cleanKindSettings({}, lane.kind_settings ?? {});
  if (typeof body.rev !== "number" || body.rev !== settingsRev(current)) return NextResponse.json(SETTINGS_CHANGED, { status: 409 });
  let next;
  if (body.titleMode && typeof body.titleMode === "object") {
    // A facility choice: one entry at a time, the person's alone (never an assist session).
    if (g.impersonating) return ownerOnly();
    const tm = body.titleMode as { entryId?: unknown; mode?: unknown };
    const entry = (await listPracticeEntries(g.userId)).find((e) => e.id === tm.entryId && e.names_facility);
    next = entry ? applyTitleMode(current, entry.id, tm.mode) : null;
    if (!next) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  } else {
    next = cleanKindSettings(body.settings, current);
  }
  let saved;
  try {
    saved = await setLaneKindSettings(g.userId, lane.id, next as Record<string, unknown>, settingsRev(current));
  } catch (err) {
    // The database's size check (075). The app's caps keep under it; this is the plain answer if not.
    if ((err as { code?: string } | null)?.code === "23514") {
      return NextResponse.json({ error: "too_big", message: "That's too many choices for one lane. Pick fewer entries." }, { status: 400 });
    }
    throw err;
  }
  if (!saved) return NextResponse.json(SETTINGS_CHANGED, { status: 409 });
  return NextResponse.json({ settings: cleanKindSettings({}, saved.kind_settings ?? {}) });
}

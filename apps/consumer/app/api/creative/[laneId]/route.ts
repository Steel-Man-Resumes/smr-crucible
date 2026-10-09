import { NextResponse } from "next/server";
import {
  cleanKindSettings,
  applyTitleMode,
  applyPhraseAnswer,
  settingsRev,
  listPracticeEntries,
  laneKindOf,
  setLaneKindSettings,
  hurdlesFor,
  HELP_SOURCES,
  HURDLES_NOT_A_VERDICT,
} from "@crucible/core";
import { docLane, gate, laneNotFound, loadCreativeContext, loadCvContext, loadPerformerContext, ownerOnly, readJson } from "@/lib/creative-server";
import type { CareerLane, PairPlan } from "@crucible/core";
import { buildCreative } from "@/lib/resume-render";

export const runtime = "nodejs";

/** Paragraphs printed as the person's own words, and the lead reference: the person's alone, never an assist session. */
// The person's own words about themselves and their body: an assist session never types them (combined review C-L6).
const OWNER_ONLY_FIELDS = ["interests", "languages", "leadReference", "skills", "height", "hair", "eyes", "voice", "ageRange"] as const;

/** The pair's plan card as the screens read it (creative and performer lanes alike). */
function planPayload(lane: CareerLane, partner: CareerLane | null, plan: PairPlan | null) {
  if (!plan) return null;
  const dream = lane.path === "dream" ? lane : partner?.path === "dream" ? partner : null;
  const realistic = lane.path === "realistic" ? lane : partner?.path === "realistic" ? partner : null;
  return {
    plan,
    goalFromLane: dream?.target_role ?? dream?.name ?? null,
    realisticAim: realistic?.target_role ?? realistic?.name ?? null,
    hurdles: hurdlesFor(dream?.target_role, dream?.name, realistic?.target_role),
    notAVerdict: HURDLES_NOT_A_VERDICT,
    help: HELP_SOURCES,
  };
}

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
 *     or  { phraseAnswer: { phrase, answer: "yes" | "no" }, rev }
 *   This lane's choices (name on the page, contact lines, page cap, picked
 *   entries, pronoun), ONE facility choice for one entry, or ONE answer to
 *   "Does this name the place you chose to leave off?" for one phrase. Always
 *   on top of the revision the screen loaded; facility choices and answers
 *   never arrive as a whole map, so a stale tab can't undo a newer one.
 */
export async function GET(request: Request, context: RouteContext) {
  const g = await gate(request);
  if (!g.ok) return g.res;
  const { laneId } = await context.params;
  const lane = await docLane(g.userId, laneId, ["creative", "cv", "performer"]);
  if (!lane) return laneNotFound();
  if (laneKindOf(lane) === "performer") {
    // A performer lane: one page, so the page count (at 8x10) comes from the real layout here as in the export.
    let p = await loadPerformerContext(g.userId, lane);
    const pages = buildCreative({ doc: "performer", model: p.model, trim: "8x10" }).layout.pages.length;
    p = await loadPerformerContext(g.userId, lane, pages);
    return NextResponse.json({
      lane: p.lane, partner: p.partner, entries: p.entries, settings: p.settings, settingsRev: settingsRev(p.settings),
      status: p.status, plan: planPayload(p.lane, p.partner, p.plan),
    });
  }
  if (laneKindOf(lane) === "cv") {
    // A CV lane: the record, this lane's choices and the CV's open items.
    // The page count comes from the real layout, so the two-page rule (STD-F07) holds here as in the export.
    let v = await loadCvContext(g.userId, lane);
    const pages = buildCreative({ doc: "cv", model: v.model }).layout.pages.length;
    v = await loadCvContext(g.userId, lane, pages);
    return NextResponse.json({ lane: v.lane, cvType: v.cvType, entries: v.entries, settings: v.settings, settingsRev: settingsRev(v.settings), status: v.status });
  }
  const c = await loadCreativeContext(g.userId, lane);
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
    plan: planPayload(c.lane, c.partner, c.plan),
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const g = await gate(request, { write: true });
  if (!g.ok) return g.res;
  const { laneId } = await context.params;
  const lane = await docLane(g.userId, laneId, ["creative", "cv", "performer"]);
  if (!lane) return laneNotFound();
  const body = await readJson(request, 40_000);
  if (!body) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  // Every settings save names the revision it was based on. No revision, or an old one: refused.
  const current = cleanKindSettings({}, lane.kind_settings ?? {});
  if (typeof body.rev !== "number" || body.rev !== settingsRev(current)) return NextResponse.json(SETTINGS_CHANGED, { status: 409 });
  let next: ReturnType<typeof cleanKindSettings> | null;
  if (body.titleMode && typeof body.titleMode === "object") {
    // A facility choice: one entry at a time, the person's alone (never an assist session).
    if (g.impersonating) return ownerOnly();
    const tm = body.titleMode as { entryId?: unknown; mode?: unknown };
    const entry = (await listPracticeEntries(g.userId)).find((e) => e.id === tm.entryId && e.names_facility);
    next = entry ? applyTitleMode(current, entry.id, tm.mode) : null;
    if (!next) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  } else if (body.phraseAnswer && typeof body.phraseAnswer === "object") {
    // Whether a phrase names a place kept off: the person's alone (never an assist session).
    if (g.impersonating) return ownerOnly();
    const pa = body.phraseAnswer as { phrase?: unknown; answer?: unknown };
    next = applyPhraseAnswer(current, pa.phrase, pa.answer);
    if (!next) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  } else {
    next = cleanKindSettings(body.settings, current);
    if (g.impersonating && OWNER_ONLY_FIELDS.some((f) => JSON.stringify(next?.[f] ?? null) !== JSON.stringify(current[f] ?? null))) return ownerOnly();
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

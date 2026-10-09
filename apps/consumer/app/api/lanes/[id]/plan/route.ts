import { NextResponse } from "next/server";
import { setLanePlan, cleanPlan, isUuid, getLane } from "@crucible/core";
import { gate, readJson } from "@/lib/creative-server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/lanes/[id]/plan { goal?, steps: [], helpNotes? }
 * The private plan card of a realistic/dream pair, kept on the dream lane.
 * Either lane of the pair may be the one in the URL. The plan holds the
 * person's own words only; hurdles and help links are general and are never
 * stored per person.
 */
export async function PUT(request: Request, context: RouteContext) {
  const g = await gate(request, { write: true });
  if (!g.ok) return g.res;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await readJson(request, 12_000);
  if (!body) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  const lane = await getLane(g.userId, id.toLowerCase());
  if (!lane || !lane.pair_lane_id) {
    return NextResponse.json({ error: "not_paired", message: "Pair a realistic lane and a dream lane first." }, { status: 409 });
  }
  const dreamId = lane.path === "dream" ? lane.id : lane.pair_lane_id;
  const saved = await setLanePlan(g.userId, dreamId, cleanPlan(body) as unknown as Record<string, unknown>);
  if (!saved) return NextResponse.json({ error: "not_paired", message: "Pair a realistic lane and a dream lane first." }, { status: 409 });
  return NextResponse.json({ lane: saved });
}

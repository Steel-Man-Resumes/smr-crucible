import { NextResponse } from "next/server";
import { pairLanes, unpairLane, isUuid, isLanePath, incrementUserUsage, LANE_WRITES_PER_DAY } from "@crucible/core";
import { gate, readJson } from "@/lib/creative-server";
import { LANE_ERROR_COPY } from "@/lib/lanes";
import { isSameOriginRequest } from "@/lib/same-origin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function underCap(userId: string): Promise<boolean> {
  const writes = await incrementUserUsage(userId, "lane-write").catch(() => 0);
  return writes <= LANE_WRITES_PER_DAY;
}

/**
 * POST /api/lanes/[id]/pair { partnerId, path }
 *   Pair this lane (taking `path`: "realistic" or "dream") with another open
 *   lane of the person's (taking the other path). Both sides in one statement;
 *   the database refuses anything one-sided, cross-account or doubled.
 * DELETE /api/lanes/[id]/pair
 *   Unpair both sides. The plan card stays on the dream lane.
 */
export async function POST(request: Request, context: RouteContext) {
  const g = await gate(request, { write: true, bucket: "lane-write", cap: LANE_WRITES_PER_DAY });
  if (!g.ok) return g.res;
  const { id } = await context.params;
  const body = await readJson(request, 2_000);
  if (!body || !isUuid(id) || !isUuid(body.partnerId) || !isLanePath(body.path)) {
    return NextResponse.json({ error: "pair_refused", message: LANE_ERROR_COPY.pair_refused }, { status: 400 });
  }
  const r = await pairLanes(g.userId, id.toLowerCase(), (body.partnerId as string).toLowerCase(), body.path);
  if (r.status === "ok") return NextResponse.json({ lanes: r.lanes });
  return NextResponse.json({ error: "pair_refused", message: LANE_ERROR_COPY.pair_refused }, { status: 409 });
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const g = await gate(request);
  if (!g.ok) return g.res;
  const { id } = await context.params;
  if (!(await underCap(g.userId))) return NextResponse.json({ error: "too_many_writes", message: LANE_ERROR_COPY.too_many_writes }, { status: 429 });
  const rows = await unpairLane(g.userId, id);
  if (!rows.length) return NextResponse.json({ error: "not_found", message: LANE_ERROR_COPY.not_found }, { status: 404 });
  return NextResponse.json({ lanes: rows });
}

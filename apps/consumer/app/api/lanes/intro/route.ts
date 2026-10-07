import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { dismissIntro, getOpenLane, isLaneKey, isLaneTool, MAIN_LANE_KEY } from "@crucible/core";

/**
 * POST /api/lanes/intro { laneKey: "main" | <lane id>, tool: "tailor" | "library" }
 * Remembers that the person dismissed t.ROY's one-line introduction to a tool
 * in a lane, so it does not come back.
 */
export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const laneKey = typeof body?.laneKey === "string" ? body.laneKey.toLowerCase() : null;
  if (!isLaneKey(laneKey) || !isLaneTool(body?.tool)) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }
  if (laneKey !== MAIN_LANE_KEY && !(await getOpenLane(userId, laneKey))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await dismissIntro(userId, laneKey, body.tool);
  return NextResponse.json({ ok: true });
}

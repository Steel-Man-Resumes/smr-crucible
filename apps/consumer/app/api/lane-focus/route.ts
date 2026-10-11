/**
 * Today's task on the person's lane (migration 083, Phase 5 lane R2).
 *
 * GET  -> { focus: { task, laneId, target, updatedAt } | null, laneTarget }
 *         laneTarget is the target of the lane the focus points at, when the
 *         person named one there (the header reads it).
 * POST { task, laneId?, target? } -> { focus }
 *
 * Owner only, signed in fully, never while viewing as someone (the same
 * account checks as saved revisions, lib/revision-route.ts). Same-origin JSON
 * writes only. A missing table (083 not applied) reads as "no task picked"
 * and a write answers 503, so the screens fall back to this browser.
 */

import { NextResponse } from "next/server";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { revisionCaller } from "@/lib/revision-route";

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** Generous: a person changes today's task a few times a day at most. */
const LANE_FOCUS_WRITES_PER_DAY = 200;

export async function GET() {
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status, headers: NO_STORE });
  const core = await import("@crucible/core");
  const focus = await core.getLaneFocus(caller.userId);
  let laneTarget: string | null = null;
  if (focus?.laneId) {
    const lane = await core.getLane(caller.userId, focus.laneId).catch(() => null);
    laneTarget = lane && !lane.archived_at ? lane.target_role || lane.name : null;
  }
  return NextResponse.json({ focus, laneTarget }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 10_000) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const core = await import("@crucible/core");
  const writes = await core.incrementUserUsage(caller.userId, "lane-focus").catch(() => 0);
  if (writes > LANE_FOCUS_WRITES_PER_DAY) {
    return NextResponse.json({ error: "Too many changes today. Your pick still works on this computer." }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const input = core.readLaneFocusInput(body);
  if (!input.ok) return NextResponse.json({ error: "Invalid request", reason: input.reason }, { status: 400 });
  const r = await core.setLaneFocus(caller.userId, input.focus);
  if (r.status === "bad_lane") return NextResponse.json({ error: "That lane isn't yours." }, { status: 404 });
  if (r.status === "not_ready") return NextResponse.json({ error: "Saving this isn't ready here yet. Your pick still works on this computer." }, { status: 503 });
  return NextResponse.json({ focus: r.focus }, { headers: NO_STORE });
}

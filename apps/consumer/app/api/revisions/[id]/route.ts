/**
 * GET /api/revisions/<id>: one saved revision, the person's own only
 * (migration 081). Someone else's, a malformed id, or a missing one: 404.
 */

import { currentRevisionStatus } from "@/lib/revision-status";
import { NextResponse } from "next/server";
import { revisionCaller } from "@/lib/revision-route";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { id } = await ctx.params;
  const { getRevision, publicRevision } = await import("@crucible/core");
  const rev = await getRevision(caller.userId, id);
  if (!rev) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ revision: publicRevision(currentRevisionStatus(rev)) }, { headers: { "Cache-Control": "no-store" } });
}

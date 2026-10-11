/**
 * The source for "Build it with t.ROY" / "Rewrite it with t.ROY" (Phase 6
 * lane S1, round 2; lib/rebuild-source.ts).
 *
 * GET ?artifactId=<id>  { pageText, ownResumeText, origin } for the person's
 *                       own saved resume: the page to show, and what counts
 *                       as their own resume text, decided here from stored
 *                       data, owner only. Read only. The writer reads the
 *                       same thing itself (generate-docs rebuildFrom); this is
 *                       for the screen and the Forge run.
 *
 * Signed in fully, never while viewing as someone.
 */

import { NextResponse } from "next/server";
import { revisionCaller } from "@/lib/revision-route";
import { loadRebuildSource, rebuildStore } from "@/lib/rebuild-source";

export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status, headers: NO_STORE });
  const artifactId = new URL(request.url).searchParams.get("artifactId") || "";
  if (!artifactId) return NextResponse.json({ error: "Which resume?" }, { status: 400, headers: NO_STORE });
  try {
    const rb = await loadRebuildSource(caller.userId, artifactId, await rebuildStore());
    if (!rb) return NextResponse.json({ error: "We couldn't open that resume." }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ pageText: rb.pageText, ownResumeText: rb.ownResumeText, origin: rb.origin }, { headers: NO_STORE });
  } catch (err: any) {
    console.error("Rebuild source error:", err?.name || "error");
    return NextResponse.json({ error: "We couldn't open that resume. Try again." }, { status: 500, headers: NO_STORE });
  }
}

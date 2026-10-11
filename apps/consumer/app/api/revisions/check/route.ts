/**
 * "Check and finish" (Phase 5 lane R2): a resume that was never finished in
 * the Forge, opened on the finish page and saved as a revision of that same
 * resume (lib/revision-check.ts).
 *
 * GET  ?artifactId=<id>               R1's checked version of the resume
 *                                     (text, the person's words, the second
 *                                     check, the answers). Read only. 409
 *                                     needs_check when none is current: the
 *                                     page calls R1's POST /api/forge/recheck.
 * POST { artifactId, finish }         the person's answers, saved on top of
 *                                     that checked version; everything the
 *                                     gate trusts is carried from it, never
 *                                     taken from the request
 *
 * Owner only, signed in fully, never while viewing as someone (the same
 * checks as every revision route). Same-origin JSON writes only. Saves count
 * against the same daily revision allowance.
 */

import { NextResponse } from "next/server";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { revisionCaller, REVISION_SAVES_PER_DAY } from "@/lib/revision-route";
import { laneFirstStore } from "@/lib/lane-first-save";
import { LOCKED_REASON, NEEDS_CHECK_REASON, loadCheckSource, saveCheckRevision } from "@/lib/revision-check";

/** Said plainly when the resume is a locked baseline (review L4). */
const LOCKED_MESSAGE = "This resume is locked as a baseline, so it can't change here. Unlock it in My resumes, or tailor a copy and check that one.";

export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status, headers: NO_STORE });
  const artifactId = new URL(request.url).searchParams.get("artifactId") || "";
  if (!artifactId) return NextResponse.json({ error: "Which resume?" }, { status: 400, headers: NO_STORE });
  try {
    const r = await loadCheckSource(caller.userId, artifactId, await laneFirstStore());
    if (!r.ok) {
      const error = r.reason === LOCKED_REASON ? LOCKED_MESSAGE : r.reason === NEEDS_CHECK_REASON ? "This resume needs its check first." : "We couldn't open that resume.";
      return NextResponse.json({ error, reason: r.reason }, { status: r.status, headers: NO_STORE });
    }
    return NextResponse.json({ source: r.source }, { headers: NO_STORE });
  } catch (err: any) {
    console.error("Check source error:", err?.name || "error");
    return NextResponse.json({ error: "We couldn't open that resume. Try again." }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 1_000_000) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { incrementUserUsage } = await import("@crucible/core");
  const saves = await incrementUserUsage(caller.userId, "revision-save").catch(() => 0);
  if (saves > REVISION_SAVES_PER_DAY) {
    return NextResponse.json({ error: "Too many saves today. Your work is still on this page." }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.artifactId !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const r = await saveCheckRevision(caller.userId, body.artifactId, body.finish, await laneFirstStore());
    if (!r.ok) {
      const error =
        r.reason === "not_ready"
          ? "Saving to your account isn't ready here yet. Your work is still on this page."
          : r.reason === LOCKED_REASON
            ? LOCKED_MESSAGE
            : r.reason === NEEDS_CHECK_REASON
              ? "This resume changed since its check. Open it again from My resumes."
              : "We couldn't save that version.";
      return NextResponse.json({ error, reason: r.reason }, { status: r.status, headers: NO_STORE });
    }
    return NextResponse.json({ revision: r.revision }, { headers: NO_STORE });
  } catch (err: any) {
    console.error("Check save error:", err?.name || "error");
    return NextResponse.json({ error: "We couldn't save that version. Try again." }, { status: 500, headers: NO_STORE });
  }
}

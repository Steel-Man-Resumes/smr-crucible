/**
 * The lanes-first first save and saved versions (Phase 5 lane R2, review H2
 * and H3; lib/lane-first-save.ts).
 *
 * GET  ?artifactId=<id>  every saved version of that resume (My resumes,
 *                        "Earlier versions"). Read only.
 * GET  (no id)           { hasSaved }: whether the person already has a saved
 *                        resume, so the screen knows to ask before saving.
 * POST { action: "first", text, typed, keep?, laneTarget? }
 *                        the first section. The server builds the save: the
 *                        page, no answers, and only `typed` as the person's
 *                        own words. 409 ask_keep: they have a saved resume and
 *                        have not said "new" or "replace".
 * POST { action: "restore", artifactId, revisionId }
 *                        bring an earlier version back as the newest.
 *
 * Owner only, signed in fully, never while viewing as someone (the revision
 * route checks). Same-origin JSON writes only. Counts against the daily
 * revision allowance.
 */

import { NextResponse } from "next/server";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { revisionCaller, REVISION_SAVES_PER_DAY } from "@/lib/revision-route";
import { laneFirstStore, listVersions, restoreVersion, saveFirstSection, savedMain } from "@/lib/lane-first-save";

export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status, headers: NO_STORE });
  const store = await laneFirstStore();
  const artifactId = new URL(request.url).searchParams.get("artifactId");
  if (!artifactId) {
    const main = await savedMain(caller.userId, store);
    return NextResponse.json({ hasSaved: !!main, status: main?.rev.status ?? null }, { headers: NO_STORE });
  }
  const versions = await listVersions(caller.userId, artifactId, store);
  if (!versions) return NextResponse.json({ error: "We couldn't find that resume." }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ versions }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 300_000) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { incrementUserUsage } = await import("@crucible/core");
  const saves = await incrementUserUsage(caller.userId, "revision-save").catch(() => 0);
  if (saves > REVISION_SAVES_PER_DAY) {
    return NextResponse.json({ error: "Too many saves today. Your work is still on this page." }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const store = await laneFirstStore();
    const r =
      body.action === "first"
        ? await saveFirstSection(caller.userId, { text: body.text, typed: body.typed, keep: body.keep, laneTarget: body.laneTarget }, store)
        : body.action === "restore" && typeof body.artifactId === "string" && typeof body.revisionId === "string"
          ? await restoreVersion(caller.userId, body.artifactId, body.revisionId, store)
          : ({ ok: false, status: 400, reason: "unknown action" } as const);
    if (!r.ok) {
      const error =
        r.reason === "ask_keep"
          ? "You already have a saved resume. Start a new resume, or replace your current one?"
          : r.reason === "locked"
            ? "That resume is locked as a baseline. Unlock it in My resumes first."
            : r.reason === "not_ready"
              ? "Saving to your account isn't ready here yet. Your work is still on this page."
              : "We couldn't save that version.";
      return NextResponse.json({ error, reason: r.reason }, { status: r.status, headers: NO_STORE });
    }
    return NextResponse.json({ revision: r.revision, keptCopyId: r.keptCopyId }, { headers: NO_STORE });
  } catch (err: any) {
    console.error("Lane first save error:", err?.name || "error");
    return NextResponse.json({ error: "We couldn't save that version. Try again." }, { status: 500, headers: NO_STORE });
  }
}

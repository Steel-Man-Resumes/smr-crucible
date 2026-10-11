/**
 * Saved resume revisions (migration 081, Phase 5 lane R1).
 *
 * POST { kind: "finish", finish, source?, laneTarget? }
 *      The Forge finish page (or the import on sign-in) saves its whole
 *      state. The server runs the finish gate and the page measurement itself
 *      and stores the version it decided: { revision: { id, number, status,
 *      pageCount, pageLimit, openItems, ... } }. The page shows "Saved to
 *      your account" only after this answers 200.
 * POST { kind: "edit", artifactId, resumeText, letterText? }
 *      An edit in the Refinery workspace: a new revision on top of the
 *      artifact's newest one, evidence carried over by the server.
 * POST { kind: "export", artifactId, letterText? }
 *      Before a Refinery download, print or attachment: the revision that IS
 *      this artifact now (its newest, when the stored content is still
 *      exactly that), or a new one the server makes from the STORED content
 *      (lib/revision-current.ts). The text never comes from the request.
 * GET  ?artifactId=<id>  the newest revision of that artifact
 * GET  ?forge=1          the newest revision of the person's Forge resume
 *
 * Owner only, signed in fully, never while viewing as someone
 * (lib/revision-route.ts). Same-origin JSON writes only.
 */

import { NextResponse } from "next/server";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { revisionCaller, REVISION_SAVES_PER_DAY, REVISION_TOO_LARGE } from "@/lib/revision-route";
import { coreStore, pickForgeArtifact, saveEditRevision, saveFinishRevision, type ArtifactLite, type SaveResult } from "@/lib/revision-save";
import { ensureExportRevision } from "@/lib/revision-current";

export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 1_000_000) return NextResponse.json({ error: REVISION_TOO_LARGE, reason: "too large" }, { status: 413 });
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const userId = caller.userId;

  const { incrementUserUsage } = await import("@crucible/core");
  const saves = await incrementUserUsage(userId, "revision-save").catch(() => 0);
  if (saves > REVISION_SAVES_PER_DAY) {
    return NextResponse.json({ error: "Too many saves today. Your work is still on this page." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const b = body as Record<string, unknown>;
  try {
    const store = await coreStore();
    if (b.kind === "export") {
      if (b.letterText !== undefined && typeof b.letterText !== "string") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      const ex = await ensureExportRevision(userId, typeof b.artifactId === "string" ? b.artifactId : "", store, {
        letterText: typeof b.letterText === "string" ? b.letterText : undefined,
      });
      if (!ex.ok) return NextResponse.json({ error: "We couldn't prepare that resume.", reason: ex.reason }, { status: ex.status, headers: NO_STORE });
      const { publicRevision } = await import("@crucible/core");
      const p = publicRevision(ex.revision);
      return NextResponse.json({ revision: { id: p.id, artifactId: p.artifactId, number: p.number, status: p.status, pageCount: p.pageCount, pageLimit: p.pageLimit, openItems: p.openItems, reused: ex.reused } }, { headers: NO_STORE });
    }
    const result: SaveResult =
      b.kind === "edit"
        ? await saveEditRevision(userId, typeof b.artifactId === "string" ? b.artifactId : "", b.resumeText, b.letterText, store)
        : b.kind === "finish"
          ? await saveFinishRevision(
              userId,
              b.finish,
              { source: b.source === "forge_import" ? "forge_import" : "forge_finish", laneTarget: typeof b.laneTarget === "string" ? b.laneTarget : "" },
              store
            )
          : ({ ok: false, status: 400, reason: "kind must be finish or edit" } as const);
    if (!result.ok) {
      const error =
        result.status === 413
          ? REVISION_TOO_LARGE
          : result.reason === "not_ready"
            ? "Saving to your account isn't ready here yet. Your work is still on this page."
            : "We couldn't save that version.";
      return NextResponse.json({ error, reason: result.reason }, { status: result.status, headers: NO_STORE });
    }
    return NextResponse.json({ revision: result.revision }, { headers: NO_STORE });
  } catch (err: any) {
    console.error("Revision save error:", err?.message || err);
    return NextResponse.json({ error: "We couldn't save that version. Try again." }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(request: Request) {
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const url = new URL(request.url);
  const core = await import("@crucible/core");
  let artifactId = url.searchParams.get("artifactId") || "";
  if (!artifactId && url.searchParams.get("forge") === "1") {
    const list = await core.listArtifacts(caller.userId, { type: "resume", examples: "hide", limit: 50 });
    artifactId = pickForgeArtifact(list as unknown as ArtifactLite[])?.id ?? "";
  }
  if (!artifactId) return NextResponse.json({ revision: null }, { headers: NO_STORE });
  const rev = await core.getLatestRevision(caller.userId, artifactId);
  return NextResponse.json({ revision: rev ? core.publicRevision(rev) : null }, { headers: NO_STORE });
}

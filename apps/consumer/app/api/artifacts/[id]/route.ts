import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import {
  getArtifact,
  updateArtifact,
  deleteArtifact,
  setCurrentResume,
  clearCurrentResume,
  lockBaseline,
  unlockBaseline,
  setArtifactLane,
  setArtifactDemo,
  isCreativeType,
} from "@crucible/core";
import { validateResumeContent } from "@/lib/resume-validate";
import { parseLaneIdBody } from "@/lib/lanes";
import { isSameOriginJsonPost, isSameOriginRequest } from "@/lib/same-origin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/artifacts/[id] — load a single artifact */
export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await context.params;
  const artifact = await getArtifact(id, userId);
  if (!artifact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: artifact });
}

/** PATCH /api/artifacts/[id] — update artifact content */
export async function PATCH(request: Request, context: RouteContext) {
  // CSRF: only a page on this app's own origin may change the person's work.
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json();

  // N4: pin/unpin this resume as the user's current one (no content change).
  if (body && typeof body === "object" && "setCurrent" in body && !body.content) {
    if (body.setCurrent) {
      const ok = await setCurrentResume(userId, id);
      if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    } else {
      await clearCurrentResume(userId);
    }
    const artifact = await getArtifact(id, userId);
    return NextResponse.json({ data: artifact });
  }

  // R6: lock/unlock this resume as an approved per-lane baseline (no content
  // change). Optional `lane` labels the career lane when locking.
  if (body && typeof body === "object" && "lock" in body && !body.content) {
    const ok = body.lock
      ? await lockBaseline(userId, id, typeof body.lane === "string" ? body.lane : null)
      : await unlockBaseline(userId, id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const artifact = await getArtifact(id, userId);
    return NextResponse.json({ data: artifact });
  }

  // Career lanes (073): move this work into one of the person's open lanes,
  // or back to main with null. Not a content edit, so a locked baseline can
  // move too. The lane must be theirs and open (the SQL checks; the composite
  // foreign key is the hard guard).
  if (body && typeof body === "object" && "laneId" in body && !body.content) {
    const laneId = parseLaneIdBody(body.laneId);
    if (laneId === "bad" || laneId === undefined) {
      return NextResponse.json({ error: "Invalid lane" }, { status: 400 });
    }
    // Creative documents belong to their lane and never move (075).
    const current = await getArtifact(id, userId);
    if (current && isCreativeType(current.artifact_type)) {
      return NextResponse.json({ error: "creative_doc", message: "Creative documents stay in their own lane." }, { status: 409 });
    }
    const ok = await setArtifactLane(userId, id, laneId);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const artifact = await getArtifact(id, userId);
    return NextResponse.json({ data: artifact });
  }

  // FU2: mark an example or test resume (hidden behind "Show examples"), or
  // bring it back. Nothing is deleted.
  if (body && typeof body === "object" && "isDemo" in body && !body.content) {
    const ok = await setArtifactDemo(userId, id, body.isDemo === true);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const artifact = await getArtifact(id, userId);
    return NextResponse.json({ data: artifact });
  }

  if (!body || typeof body !== "object" || !body.content) {
    return NextResponse.json(
      { error: "Missing required field: content" },
      { status: 400 }
    );
  }
  // Phase 1A: structural schema gate. A v2 resume envelope (formatVersion
  // marker) must be structurally valid before it can overwrite content.
  if ((body.content as any)?.formatVersion !== undefined) {
    const verdict = validateResumeContent(body.content);
    if (!verdict.ok) {
      return NextResponse.json(
        { error: "invalid_resume_content", reason: verdict.reason },
        { status: 400 }
      );
    }
  }

  const result = await updateArtifact(
    id,
    userId,
    body.content,
    body.scaffoldLevel
  );
  if (result.status === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (result.status === "creative_doc") {
    // Statements, bios and the other creative documents save only through
    // their own tools, which check every word first.
    return NextResponse.json(
      { error: "creative_doc", message: "Open this in Creative work to change it." },
      { status: 409 }
    );
  }
  if (result.status === "locked") {
    return NextResponse.json(
      {
        error: "artifact_locked",
        message:
          "This is a locked baseline. Unlock it in your Library to edit, or tailor a copy instead.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ data: result.artifact });
}

/** DELETE /api/artifacts/[id] — delete an artifact */
export async function DELETE(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await context.params;
  const deleted = await deleteArtifact(id, userId);
  if (deleted === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (deleted === "locked") {
    return NextResponse.json(
      {
        error: "artifact_locked",
        message:
          "This is a locked baseline. Unlock it in your Library before deleting.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true });
}

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
} from "@crucible/core";

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

  if (!body || typeof body !== "object" || !body.content) {
    return NextResponse.json(
      { error: "Missing required field: content" },
      { status: 400 }
    );
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
  if (result.status === "locked") {
    return NextResponse.json(
      {
        error: "artifact_locked",
        message:
          "This is a locked baseline. Unlock it in My Materials to edit, or tailor a copy instead.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ data: result.artifact });
}

/** DELETE /api/artifacts/[id] — delete an artifact */
export async function DELETE(_request: Request, context: RouteContext) {
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
          "This is a locked baseline. Unlock it in My Materials before deleting.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true });
}

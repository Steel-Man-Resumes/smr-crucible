import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import {
  getArtifact,
  updateArtifact,
  deleteArtifact,
  setCurrentResume,
  clearCurrentResume,
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

  if (!body || typeof body !== "object" || !body.content) {
    return NextResponse.json(
      { error: "Missing required field: content" },
      { status: 400 }
    );
  }

  const artifact = await updateArtifact(
    id,
    userId,
    body.content,
    body.scaffoldLevel
  );
  if (!artifact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: artifact });
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
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listArtifacts, createArtifact } from "@crucible/core";
import type { ArtifactType } from "@crucible/core";

/** GET /api/artifacts — list artifacts for the authenticated user */
export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") as ArtifactType | null;
  const limit = searchParams.get("limit");

  const artifacts = await listArtifacts(userId, {
    type: type || undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
  });

  return NextResponse.json({ data: artifacts });
}

/** POST /api/artifacts — create a new artifact */
export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  if (!body || typeof body !== "object" || !body.type || !body.content) {
    return NextResponse.json(
      { error: "Missing required fields: type, content" },
      { status: 400 }
    );
  }

  const artifact = await createArtifact(
    userId,
    body.type as ArtifactType,
    body.targetContext || {},
    body.content,
    body.scaffoldLevel ?? 1.0
  );

  return NextResponse.json({ data: artifact }, { status: 201 });
}

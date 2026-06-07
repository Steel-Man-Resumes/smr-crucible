import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listArtifacts, createArtifact } from "@crucible/core";
import type { ArtifactType } from "@crucible/core";

const ALLOWED_ARTIFACT_TYPES: ArtifactType[] = [
  "resume",
  "cover_letter",
  "disclosure_plan",
  "interview_prep",
  "resource_list",
  "job_match",
];

function isArtifactType(value: unknown): value is ArtifactType {
  return typeof value === "string" && ALLOWED_ARTIFACT_TYPES.includes(value as ArtifactType);
}

/** GET /api/artifacts — list artifacts for the authenticated user */
export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get("type");
  const limit = searchParams.get("limit");
  if (typeParam && !isArtifactType(typeParam)) {
    return NextResponse.json({ error: "Invalid artifact type" }, { status: 400 });
  }
  const type = typeParam && isArtifactType(typeParam) ? typeParam : undefined;
  const parsedLimit = limit ? parseInt(limit, 10) : undefined;
  if (limit && (!Number.isFinite(parsedLimit) || parsedLimit! < 1)) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  }

  const artifacts = await listArtifacts(userId, {
    type,
    limit: parsedLimit ? Math.min(parsedLimit, 100) : undefined,
  });

  return NextResponse.json({ data: artifacts });
}

/** POST /api/artifacts — create a new artifact */
export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

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
  if (!isArtifactType(body.type)) {
    return NextResponse.json({ error: "Invalid artifact type" }, { status: 400 });
  }
  if (
    typeof body.content !== "object" ||
    body.content === null ||
    Array.isArray(body.content)
  ) {
    return NextResponse.json({ error: "Invalid artifact content" }, { status: 400 });
  }

  try {
    const artifact = await createArtifact(
      userId,
      body.type,
      body.targetContext && typeof body.targetContext === "object" && !Array.isArray(body.targetContext)
        ? body.targetContext
        : {},
      body.content,
      typeof body.scaffoldLevel === "number" ? body.scaffoldLevel : 1.0
    );

    return NextResponse.json({ data: artifact }, { status: 201 });
  } catch (err: any) {
    console.error("Create artifact error:", err?.message || err);
    return NextResponse.json(
      { error: "Failed to save. Please try again.", detail: err?.message },
      { status: 500 }
    );
  }
}

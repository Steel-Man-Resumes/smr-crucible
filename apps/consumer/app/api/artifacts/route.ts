import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { listArtifacts, createArtifact, query, invalidateNextStep } from "@crucible/core";
import type { ArtifactType } from "@crucible/core";

// Journey instrumentation: which artifact types link back to a target job
// application, and into which (whitelisted) column. The column names are fixed
// literals, never user input, so interpolating them below is safe.
const APPLICATION_LINK_COLUMN: Partial<Record<ArtifactType, string>> = {
  resume: "resume_artifact_id",
  disclosure_plan: "disclosure_plan_id",
};

// Creating any of these moves a journey gate, so the next-step engine must
// recompute rather than serve its 1h cache.
const NEXT_STEP_RELEVANT: ArtifactType[] = ["resume", "disclosure_plan", "interview_prep"];

const ALLOWED_ARTIFACT_TYPES: ArtifactType[] = [
  "resume",
  "cover_letter",
  "follow_up",
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
    const targetContext =
      body.targetContext && typeof body.targetContext === "object" && !Array.isArray(body.targetContext)
        ? body.targetContext
        : {};

    const artifact = await createArtifact(
      userId,
      body.type,
      targetContext,
      body.content,
      typeof body.scaffoldLevel === "number" ? body.scaffoldLevel : 1.0
    );

    // Journey instrumentation: link a tailored resume / disclosure plan back to
    // its target job application so computeNextStep() can see Stage 3/4 is done.
    // Ownership-scoped: the UPDATE only touches an application owned by this user
    // (a bogus or foreign applicationId silently affects zero rows).
    const linkColumn = APPLICATION_LINK_COLUMN[body.type as ArtifactType];
    const applicationId = targetContext.applicationId;
    if (linkColumn && typeof applicationId === "string" && applicationId) {
      try {
        await query(
          `UPDATE job_application SET ${linkColumn} = $1, updated_at = now()
           WHERE id = $2 AND user_id = $3`,
          [artifact.id, applicationId, userId]
        );
      } catch (linkErr: any) {
        // A linkage failure must not fail the save; the artifact is already stored.
        console.error("Artifact link error:", linkErr?.message || linkErr);
      }
    }

    // Force the next-step engine to recompute on the next read.
    if (NEXT_STEP_RELEVANT.includes(body.type as ArtifactType)) {
      await invalidateNextStep(userId).catch(() => {});
    }

    return NextResponse.json({ data: artifact }, { status: 201 });
  } catch (err: any) {
    console.error("Create artifact error:", err?.message || err);
    return NextResponse.json(
      { error: "Failed to save. Please try again.", detail: err?.message },
      { status: 500 }
    );
  }
}

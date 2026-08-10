import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { forkArtifact } from "@crucible/core";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DEFAULT_REASON = "edit-copy";
const MAX_REASON_LEN = 60;

function sanitizeReason(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_REASON;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_REASON_LEN) : DEFAULT_REASON;
}

/** POST /api/artifacts/[id]/fork -- fork a successor artifact from this one */
export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  const reason = sanitizeReason(body?.reason);
  const operationKey =
    typeof body?.operationKey === "string" && body.operationKey.trim()
      ? body.operationKey.trim()
      : null;
  const targetContext =
    body?.targetContext && typeof body.targetContext === "object" && !Array.isArray(body.targetContext)
      ? body.targetContext
      : null;

  const result = await forkArtifact({
    userId,
    sourceArtifactId: id,
    reason,
    operationKey,
    targetContext,
  });

  if (result.status === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: result.artifact, deduped: result.deduped });
}

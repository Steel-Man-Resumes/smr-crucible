import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { updateLane, setLaneArchived, isUuid, incrementUserUsage, LANE_WRITES_PER_DAY } from "@crucible/core";
import { LANE_ERROR_COPY } from "@/lib/lanes";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/lanes/[id]
 *   { archived: true | false }   archive a lane, or bring it back (never a delete)
 *   { name?, targetRole?, format?, hybridUnevenHistory?, hybridFieldChange?, lengthPref? }
 * Runs as the person: someone else's lane id is simply not found.
 */
export async function PATCH(request: Request, context: RouteContext) {
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found", message: LANE_ERROR_COPY.not_found }, { status: 404 });

  // Lane writes per account per day: stops a loop or a script, never a person.
  const writes = await incrementUserUsage(userId, "lane-write").catch(() => 0);
  if (writes > LANE_WRITES_PER_DAY) {
    return NextResponse.json({ error: "too_many_writes", message: LANE_ERROR_COPY.too_many_writes }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const result =
    "archived" in body
      ? await setLaneArchived(userId, id, body.archived === true)
      : await updateLane(userId, id, body);

  if (result.status === "ok") return NextResponse.json({ lane: result.lane });
  const code = result.status === "invalid" ? result.error : result.status;
  return NextResponse.json(
    { error: code, message: LANE_ERROR_COPY[code] ?? LANE_ERROR_COPY.failed },
    { status: result.status === "not_found" ? 404 : result.status === "duplicate_name" ? 409 : 400 }
  );
}

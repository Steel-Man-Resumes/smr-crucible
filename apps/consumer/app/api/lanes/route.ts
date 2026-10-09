import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { createLane, listLanes, listDismissedIntros, laneOfNewestResume, incrementUserUsage, LANE_WRITES_PER_DAY } from "@crucible/core";
import { LANE_ERROR_COPY } from "@/lib/lanes";

/**
 * Career lanes (migration 073). Every read and write runs AS the person; the
 * owner-only policies decide what exists for them.
 *
 * GET  /api/lanes  -> { lanes (open), archived, introsSeen: ["<laneKey>:<tool>"],
 *                     defaultLaneId: the open lane holding the newest resume, or null (main) }
 * POST /api/lanes  -> create { name, targetRole?, format?, hybridUnevenHistory?,
 *                    hybridFieldChange?, lengthPref? }
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [all, intros, defaultLaneId] = await Promise.all([
    listLanes(userId, { includeArchived: true }),
    listDismissedIntros(userId),
    laneOfNewestResume(userId),
  ]);
  return NextResponse.json({
    lanes: all.filter((l) => !l.archived_at),
    archived: all.filter((l) => !!l.archived_at),
    introsSeen: intros.map((r) => `${r.lane_key}:${r.tool}`),
    defaultLaneId,
  });
}

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Lane writes per account per day: stops a loop or a script, never a person.
  const writes = await incrementUserUsage(userId, "lane-write").catch(() => 0);
  if (writes > LANE_WRITES_PER_DAY) {
    return NextResponse.json({ error: "too_many_writes", message: LANE_ERROR_COPY.too_many_writes }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }
  const result = await createLane(userId, body);
  if (result.status === "ok") return NextResponse.json({ lane: result.lane }, { status: 201 });
  const code = result.status === "invalid" ? result.error : result.status;
  return NextResponse.json(
    { error: code, message: LANE_ERROR_COPY[code] ?? LANE_ERROR_COPY.failed },
    { status: result.status === "duplicate_name" ? 409 : result.status === "not_found" ? 404 : result.status === "too_many_total" ? 429 : 400 }
  );
}

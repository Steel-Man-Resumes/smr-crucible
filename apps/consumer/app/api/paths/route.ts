import { NextResponse } from "next/server";
import { revisionCaller } from "@/lib/revision-route";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { readJobFit } from "@/lib/job-fit";
import { EMPTY_PATH_INPUTS, explorePaths, readPathInputs, type PathContext } from "@/lib/paths/explore";
import { isUuid } from "@crucible/core/src/careerLaneShared";

const headers = { "Cache-Control": "no-store" };
export const revalidate = 0;

async function answer(request: Request, raw: unknown, pick?: unknown) {
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status, headers });
  if (pick !== undefined && pick !== null && pick !== "main" && !isUuid(pick)) return NextResponse.json({ error: "Choose an available lane." }, { status: 400, headers });
  const inputs = readPathInputs(raw);
  if (!inputs) return NextResponse.json({ error: "Check your path choices and try again." }, { status: 400, headers });
  try {
    const core = await import("@crucible/core");
    const [profile, focus, account] = await Promise.all([
      core.getUserProfile(caller.userId), core.getLaneFocus(caller.userId),
      core.getOneAsUser<{ preferences: Record<string, unknown> | null }>(caller.userId, "SELECT preferences FROM consumer_profile WHERE user_id = $1", [caller.userId]),
    ]);
    const laneId = pick === null || pick === "main" ? null : typeof pick === "string" ? pick.toLowerCase() : focus?.laneId ?? null;
    const lane = laneId ? await core.getOpenLane(caller.userId, laneId) : null;
    if (laneId && !lane) return NextResponse.json({ error: "That lane is unavailable. Reopen your current lane and try again." }, { status: 404, headers });
    const fit = readJobFit(account?.preferences?.jobFit);
    const context: PathContext = {
      savedSkills: profile?.topSkills ?? [], location: [profile?.city, profile?.state].filter(Boolean).join(", "),
      target: lane?.target_role || lane?.name || (focus?.laneId === laneId ? focus?.target : null) || null,
      laneId, savedConstraints: [fit.noDriving && "No required driving", fit.noHeavyLifting && "No required heavy lifting", fit.noOvernight && "No required overnight work", ...fit.excludedTitles.map((title) => `Avoid job title: ${title}`)].filter((s): s is string => !!s),
    };
    return NextResponse.json(explorePaths(context, inputs), { headers });
  } catch {
    return NextResponse.json({ error: "Your path context could not be loaded. Try again. Your saved work has not changed." }, { status: 503, headers });
  }
}

export async function GET(request: Request) {
  const laneId = new URL(request.url).searchParams.get("laneId");
  return answer(request, EMPTY_PATH_INPUTS, laneId ?? undefined);
}
export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403, headers });
  if (Number(request.headers.get("content-length") || 0) > 12_000) return NextResponse.json({ error: "Request too large" }, { status: 413, headers });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Check your path choices and try again." }, { status: 400, headers });
  return answer(request, body.inputs, body.laneId);
}

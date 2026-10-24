/** Account-scoped orientation state. Tour progress is separate from career progress. */
import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import {
  getOneAsUser,
  getUserProfile, computeNextStep,
} from "@crucible/core";
import { loadSelectedWork } from "@/lib/assistant-work-context";
import { workspaceNextAction } from "@/lib/workspace-next-action";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { TOUR_STOP_COUNT, TOUR_VERSION } from "@/lib/guidedTour";
import { tourRewardClaimed } from "@/lib/progression-server";
import { handleTourWrite } from "@/lib/tour/tour-write";
import { tourStore } from "@/lib/tour/tour-store";

export const maxDuration = 10;
export const revalidate = 0;

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [profile, row, work, rewardClaimedAt] = await Promise.all([
    getUserProfile(userId),
    getOneAsUser<{ progress: { version?: number; stop?: number; inProgress?: boolean; runId?: string; sequence?: number } | null }>(userId,
      `SELECT preferences->'guidedTour' AS progress FROM consumer_profile WHERE user_id = $1`, [userId]),
    loadSelectedWork(userId, {}, false),
    // Unknown (undefined) rather than a false "never claimed" when the read fails.
    tourRewardClaimed(userId).catch(() => undefined),
  ]);
  if (!profile) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const progress = row?.progress;
  // Read the normal ladder with orientation satisfied only in memory. This does
  // not cache/write a stage, unlock a tool or create a career progress event.
  const nextStep = computeNextStep({ ...profile, onboardingComplete: true, onboardingDeferrals: 0 });
  const selectedNext = workspaceNextAction({ work, profileFirst: !profile.profileComplete });
  return NextResponse.json({ data: {
    accountId: userId,
    tourComplete: profile.onboardingComplete,
    tourDeferrals: profile.onboardingDeferrals,
    coachName: profile.coachName || "Guide",
    forgeComplete: profile.forgeComplete,
    version: progress?.version === TOUR_VERSION ? TOUR_VERSION : undefined,
    inProgress: progress?.version === TOUR_VERSION && progress.inProgress === true,
    stop: progress?.version === TOUR_VERSION && Number.isInteger(progress.stop)
      ? Math.max(0, Math.min(TOUR_STOP_COUNT - 1, progress.stop!)) : 0,
    previousRunId: progress?.runId ?? null,
    runId: progress?.version === TOUR_VERSION ? progress.runId : undefined,
    sequence: progress?.version === TOUR_VERSION ? progress.sequence ?? 0 : 0,
    nextStep: selectedNext ? { action: selectedNext.label, href: selectedNext.href } : { action: nextStep.action, href: nextStep.href },
    rewardClaimedAt,
  } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Invalid request" }, { status: 403, headers });
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in again before saving your place." }, { status: 401, headers });
  if (session.impersonation?.mode === "view") return NextResponse.json({ error: "This account view is read only." }, { status: 403, headers });
  if (request.headers.get("X-Orientation-Account") !== userId) return NextResponse.json({ error: "Your account changed. Reload before continuing." }, { status: 409, headers });
  const raw = await request.text();
  if (raw.length > 1024) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400, headers }); }
  const result = await handleTourWrite(tourStore, userId, body);
  return NextResponse.json(result.json, { status: result.status, headers });
}

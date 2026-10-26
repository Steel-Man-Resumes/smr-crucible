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
import { TOURS, isTourId, readTourSlot } from "@/lib/tour/registry";
import { metMinWatch } from "@/lib/tour/settings-tour";

export const maxDuration = 10;
export const revalidate = 0;

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const asked = new URL(request.url).searchParams.get("tourId");
  const tourId = asked ?? "entrance";
  if (!isTourId(tourId)) return NextResponse.json({ error: "Unknown tour" }, { status: 400 });
  // Under any impersonation the tours never open (T2); say so rather than hand back a place.
  const impersonating = !!session.impersonation;

  if (tourId !== "entrance") {
    const def = TOURS[tourId];
    const row = await getOneAsUser<{ tours: unknown; guided: unknown }>(userId,
      `SELECT preferences->'tours' AS tours, preferences->'guidedTour' AS guided FROM consumer_profile WHERE user_id = $1`, [userId]);
    const slot = readTourSlot({ tours: row?.tours, guidedTour: row?.guided }, tourId);
    const current = slot?.version === def.version;
    // A quiz tour's chip offers the questions alone on a finished run until the bonus exists.
    // Unknown (undefined) rather than a false "never claimed" when the read fails.
    const rewardClaimedAt = def.quiz && def.grants ? await tourRewardClaimed(userId, def.rewardKey).catch(() => undefined) : undefined;
    return NextResponse.json({ data: {
      accountId: userId, tourId, impersonating,
      version: current ? def.version : undefined,
      inProgress: current && slot?.inProgress === true,
      stop: current && Number.isInteger(slot?.stop) ? Math.max(0, Math.min(def.stopCount - 1, slot!.stop!)) : 0,
      previousRunId: slot?.runId ?? null,
      runId: current ? slot?.runId : undefined,
      sequence: current ? slot?.sequence ?? 0 : 0,
      completedAt: current ? slot?.completedAt ?? null : null,
      // Quiz tours: whether the finished run met the minimum watch (the questions-alone chip shows only then),
      // and whether an older version was finished (not "New here?"). Watch time is measured as before.
      ...(def.quiz ? { rewardClaimedAt, metMinWatch: current && !!slot?.completedAt ? metMinWatch(slot, def.minWatchMs) : undefined, earlierDone: !current && !!slot?.completedAt } : {}),
    } }, { headers: { "Cache-Control": "no-store" } });
  }

  const [profile, row, work, rewardClaimedAt] = await Promise.all([
    getUserProfile(userId),
    getOneAsUser<{ tours: unknown; guided: unknown }>(userId,
      `SELECT preferences->'tours' AS tours, preferences->'guidedTour' AS guided FROM consumer_profile WHERE user_id = $1`, [userId]),
    loadSelectedWork(userId, {}, false),
    // Unknown (undefined) rather than a false "never claimed" when the read fails.
    tourRewardClaimed(userId).catch(() => undefined),
  ]);
  if (!profile) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  // tours.entrance, or the old single slot guidedTour until the first write moves it.
  const progress = readTourSlot({ tours: row?.tours, guidedTour: row?.guided }, "entrance");
  // Read the normal ladder with orientation satisfied only in memory. This does
  // not cache/write a stage, unlock a tool or create a career progress event.
  const nextStep = computeNextStep({ ...profile, onboardingComplete: true, onboardingDeferrals: 0 });
  const selectedNext = workspaceNextAction({ work, profileFirst: !profile.profileComplete });
  return NextResponse.json({ data: {
    accountId: userId,
    tourId: "entrance",
    impersonating,
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
  // Tours are the person's own. No write under ANY impersonation, assist included (T2).
  if (session.impersonation) return NextResponse.json({ error: "The tour is the person's own. It does not open or save while you view or assist as them." }, { status: 403, headers });
  if (request.headers.get("X-Orientation-Account") !== userId) return NextResponse.json({ error: "Your account changed. Reload before continuing." }, { status: 409, headers });
  const raw = await request.text();
  if (raw.length > 1024) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400, headers }); }
  const result = await handleTourWrite(tourStore, userId, body);
  return NextResponse.json(result.json, { status: result.status, headers });
}

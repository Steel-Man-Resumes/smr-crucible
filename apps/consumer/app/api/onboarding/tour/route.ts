/** Account-scoped orientation state. Tour progress is separate from career progress. */
import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import {
  query, getOneAsUser, queryAsUser, invalidateNextStep,
  getUserProfile, computeNextStep,
} from "@crucible/core";
import { loadSelectedWork } from "@/lib/assistant-work-context";
import { workspaceNextAction } from "@/lib/workspace-next-action";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { TOUR_STOP_COUNT, TOUR_VERSION } from "@/lib/guidedTour";

export const maxDuration = 10;
export const revalidate = 0;

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [profile, row, work] = await Promise.all([
    getUserProfile(userId),
    getOneAsUser<{ progress: { version?: number; stop?: number; inProgress?: boolean } | null }>(userId,
      `SELECT preferences->'guidedTour' AS progress FROM consumer_profile WHERE user_id = $1`, [userId]),
    loadSelectedWork(userId, {}, false),
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
    nextStep: selectedNext ? { action: selectedNext.label, href: selectedNext.href } : { action: nextStep.action, href: nextStep.href },
  } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const action = body?.action;

  if (action === "progress") {
    if (body.version !== TOUR_VERSION || !Number.isInteger(body.stop) || body.stop < 0 || body.stop >= TOUR_STOP_COUNT) {
      return NextResponse.json({ error: "Invalid tour stop" }, { status: 400 });
    }
    // Same established preferences upsert as job-fit. Only this namespace is
    // changed; accessibility, location and job preferences remain intact.
    await queryAsUser(userId,
      `INSERT INTO consumer_profile (user_id, preferences)
       VALUES ($1, jsonb_build_object('guidedTour', $2::jsonb))
       ON CONFLICT (user_id) DO UPDATE
       SET preferences = jsonb_set(COALESCE(consumer_profile.preferences, '{}'::jsonb), '{guidedTour}', $2::jsonb),
           updated_at = now()`,
      [userId, JSON.stringify({ version: TOUR_VERSION, stop: body.stop, inProgress: true })]);
    return NextResponse.json({ ok: true });
  }

  if (action === "complete" || action === "skip") {
    const coachName = typeof body.coachName === "string" && body.coachName.trim()
      ? body.coachName.trim().slice(0, 40) : null;
    // This flag dismisses orientation. It never certifies the resume, interview
    // readiness, an application, or any other career milestone.
    await query(`UPDATE users SET onboarding_tour_complete = true,
      coach_name = COALESCE($2, coach_name) WHERE id = $1`, [userId, coachName]);
    await queryAsUser(userId, `UPDATE consumer_profile SET preferences = jsonb_set(
      COALESCE(preferences, '{}'::jsonb), '{guidedTour}',
      COALESCE(preferences->'guidedTour', '{}'::jsonb) || '{"inProgress":false}'::jsonb)
      WHERE user_id = $1`, [userId]);
    await invalidateNextStep(userId);
    return NextResponse.json({ ok: true });
  }

  // Retain the old API contract for already-open clients. The new tour pauses
  // using progress, so it does not accrue mandatory-orientation deferrals.
  if (action === "defer") {
    await query(`UPDATE users SET onboarding_tour_deferrals = LEAST(onboarding_tour_deferrals + 1, 2) WHERE id = $1`, [userId]);
    await invalidateNextStep(userId);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

/** Account-scoped orientation state. Tour progress is separate from career progress. */
import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import {
  getOneAsUser, queryAsUser, invalidateNextStep,
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
    getOneAsUser<{ progress: { version?: number; stop?: number; inProgress?: boolean; runId?: string; sequence?: number } | null }>(userId,
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
    previousRunId: progress?.runId ?? null,
    runId: progress?.version === TOUR_VERSION ? progress.runId : undefined,
    sequence: progress?.version === TOUR_VERSION ? progress.sequence ?? 0 : 0,
    nextStep: selectedNext ? { action: selectedNext.label, href: selectedNext.href } : { action: nextStep.action, href: nextStep.href },
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
  let body;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400, headers }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.version !== TOUR_VERSION ||
      typeof body.runId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.runId) ||
      !Number.isSafeInteger(body.sequence) || body.sequence < 0 || body.sequence > 1000000 ||
      !Number.isInteger(body.stop) || body.stop < 0 || body.stop >= TOUR_STOP_COUNT ||
      !["start", "progress", "complete"].includes(body.action)) {
    return NextResponse.json({ error: "This tour changed. Reload to continue." }, { status: 400, headers });
  }
  try {
    if (body.action === "start") {
      if (body.sequence !== 0) return NextResponse.json({ error: "Invalid starting place." }, { status: 400, headers });
      if (body.previousRunId !== null && (typeof body.previousRunId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.previousRunId))) return NextResponse.json({ error: "Reload before starting this tour." }, { status: 400, headers });
      const started = await queryAsUser<{ user_id: string }>(userId, `INSERT INTO consumer_profile (user_id, preferences)
        VALUES ($1, jsonb_build_object('guidedTour', $2::jsonb))
        ON CONFLICT (user_id) DO UPDATE SET preferences = jsonb_set(COALESCE(consumer_profile.preferences, '{}'::jsonb),
        '{guidedTour}', $2::jsonb), updated_at = now()
        WHERE consumer_profile.preferences->'guidedTour'->>'runId' IS NOT DISTINCT FROM $4::text
          AND consumer_profile.preferences->'guidedTour'->>'runId' IS DISTINCT FROM $3::text
          AND COALESCE((consumer_profile.preferences->'guidedTour'->>'version')::int, 0) <= $5::int
        RETURNING user_id`,
        [userId, JSON.stringify({ version: TOUR_VERSION, runId: body.runId, sequence: 0, stop: body.stop, inProgress: true }), body.runId, body.previousRunId, TOUR_VERSION]);
      if (!started.length) {
        const sameRun = await getOneAsUser<{ run_id: string }>(userId, `SELECT preferences->'guidedTour'->>'runId' AS run_id FROM consumer_profile WHERE user_id=$1 AND preferences->'guidedTour'->>'version'=$2::text`, [userId, String(TOUR_VERSION)]);
        if (sameRun?.run_id !== body.runId) return NextResponse.json({ error: "Another tab started a newer tour. Reload to continue from there." }, { status: 409, headers });
      }
    } else {
      // A replay owns a new run. Old tabs and delayed saves cannot overwrite it
      // or reopen a completed run. The completion flag and stop commit together.
      const rows = await queryAsUser<{ user_id: string }>(userId, `WITH saved AS (
        UPDATE consumer_profile SET preferences = jsonb_set(preferences, '{guidedTour}',
          jsonb_build_object('version', $2::int, 'runId', $3::text, 'sequence', $4::int, 'stop', $5::int, 'inProgress', $6::boolean)),
          updated_at = now()
        WHERE user_id = $1 AND preferences->'guidedTour'->>'runId' = $3
          AND preferences->'guidedTour'->>'version' = $2::int::text
          AND preferences->'guidedTour'->>'inProgress' = 'true'
          AND COALESCE((preferences->'guidedTour'->>'sequence')::int, 0) < $4 RETURNING user_id
      ), completed AS (
        UPDATE users SET onboarding_tour_complete = true
        WHERE id IN (SELECT user_id FROM saved) AND $6 = false RETURNING id
      ) SELECT user_id FROM saved`,
        [userId, TOUR_VERSION, body.runId, body.sequence, body.stop, body.action !== "complete"]);
      if (!rows.length) {
        const completed = body.action === "complete" ? await getOneAsUser<{ done: boolean }>(userId,
          `SELECT true AS done FROM consumer_profile WHERE user_id=$1
           AND preferences->'guidedTour'->>'runId'=$2 AND preferences->'guidedTour'->>'inProgress'='false'
           AND preferences->'guidedTour'->>'version'=$3::text`, [userId, body.runId, String(TOUR_VERSION)]) : null;
        if (!completed?.done) return NextResponse.json({ error: "Your tour changed in another tab. Reload to pick up its saved place." }, { status: 409, headers });
      }
      if (body.action === "complete") await invalidateNextStep(userId);
    }
    return NextResponse.json({ ok: true, runId: body.runId, sequence: body.sequence }, { headers });
  } catch {
    return NextResponse.json({ error: "Your place could not be saved. Keep reading or try again." }, { status: 503, headers });
  }
}

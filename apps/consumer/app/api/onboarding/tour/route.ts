/**
 * Onboarding tour state (master plan Section 3, Stage 0).
 *
 * GET  -> { tourComplete, tourDeferrals, coachName }
 * POST -> { action: "complete", coachName? } | { action: "defer" }
 *
 * Completion is DB-persisted (cannot be reset by clearing localStorage).
 * Two deferrals are allowed; after that the tour is mandatory (enforced by
 * computeNextStep, which returns Stage 0 once deferrals >= 2).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, getOne, invalidateNextStep } from "@crucible/core";

export const maxDuration = 10;

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const row = await getOne<{
    onboarding_tour_complete: boolean;
    onboarding_tour_deferrals: number;
    coach_name: string;
  }>(
    `SELECT onboarding_tour_complete, onboarding_tour_deferrals, coach_name
     FROM users WHERE id = $1`,
    [userId]
  );

  return NextResponse.json({
    data: {
      tourComplete: !!row?.onboarding_tour_complete,
      tourDeferrals: row?.onboarding_tour_deferrals ?? 0,
      coachName: row?.coach_name || "Guide",
    },
  });
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const action = body?.action;

  if (action === "complete") {
    const coachName =
      typeof body.coachName === "string" && body.coachName.trim()
        ? body.coachName.trim().slice(0, 40)
        : null;
    await query(
      `UPDATE users
         SET onboarding_tour_complete = true,
             coach_name = COALESCE($2, coach_name)
       WHERE id = $1`,
      [userId, coachName]
    );
    await invalidateNextStep(userId);
    return NextResponse.json({ ok: true });
  }

  if (action === "defer") {
    await query(
      `UPDATE users
         SET onboarding_tour_deferrals = onboarding_tour_deferrals + 1
       WHERE id = $1`,
      [userId]
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

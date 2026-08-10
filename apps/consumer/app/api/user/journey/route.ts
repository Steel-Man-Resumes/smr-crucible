/**
 * GET /api/user/journey
 *
 * Phase 1D: the single server-computed answer to "where is this user in the
 * journey, and what tools are unlocked" -- replaces useOnboarding's old
 * 3-fetch client-side derivation (/api/user/profile + two /api/artifacts
 * calls) with one call into buildJourneySnapshot() + computeGateDecision().
 * See packages/core/src/journey.ts for the full doctrine.
 */

import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import {
  buildJourneySnapshot,
  computeGateDecision,
  getUserTier,
  getProgressEventDates,
  computeMilestones,
  computeStreak,
  detectComeback,
} from "@crucible/core";

export const revalidate = 0; // gate decisions must never serve stale cache

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // One place answers "where is this user + what has this user earned." Folding
  // milestones/streak in here (Phase 4.3) keeps Progress to a single fetch.
  const [snapshot, tier, eventDates] = await Promise.all([
    buildJourneySnapshot(userId),
    getUserTier(userId),
    getProgressEventDates(userId),
  ]);
  const gate = computeGateDecision(snapshot, tier);

  // Every milestone is backed by a real fact off the snapshot (or a comeback
  // derived from the same event ledger the streak reads). Pure functions.
  const milestones = computeMilestones({
    resumeTailored: snapshot.metrics.resumeTailored,
    applicationsSent: snapshot.metrics.applicationsSent,
    interviewsCompleted: snapshot.metrics.interviewsCompleted,
    hasDisclosurePlan: snapshot.metrics.hasDisclosurePlan,
    disclosurePlansCreated: snapshot.metrics.disclosurePlansCreated,
    comeback: detectComeback(eventDates),
  });
  const streak = computeStreak(eventDates);

  return NextResponse.json({ snapshot, gate, milestones, streak });
}

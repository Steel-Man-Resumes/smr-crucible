/**
 * How each staff member's caseload is actually going.
 *
 * The org dashboard could tell an admin how many clients each staff member had
 * and nothing else. A count is not performance: three people who are all stuck
 * and three people who all started work look identical. The question an org
 * leader actually has is "who needs help from me today", and nothing answered
 * it.
 *
 * DERIVED, NOT QUERIED, and that is a privacy decision rather than a shortcut.
 * This is a pure function over the cohort that `getPartnerCohort` already
 * returned, so it inherits three properties for free and cannot lose them:
 *
 *   1. The consent gate. Only clients who granted the 'sharing' layer are in
 *      that cohort at all, so no count here can describe somebody who did not
 *      agree to be described.
 *   2. The org scope, including the staff-assignment fix -- a foreign org's
 *      assignments are already filtered out upstream.
 *   3. The content boundary. Progress signals only. Never resume text, never
 *      practice transcripts, never a disclosure plan.
 *
 * A new SQL query would have had to re-earn all three, and would have been one
 * forgotten predicate away from losing any of them.
 */

import type { CohortClient } from "./partnerDashboard";

/** Days without any tracked activity before a client is worth a second look. */
export const STALLED_AFTER_DAYS = 14;

export interface StaffPerformance {
  staffUserId: string | null; // null = the unassigned bucket
  staffName: string | null;
  caseload: number;
  activeThisWeek: number;
  /** No tracked activity for STALLED_AFTER_DAYS, or never active at all. */
  stalled: number;
  /** Of those, the ones who have never been active. Never started, not stopped. */
  neverStarted: number;
  hired: number;
  /** Mean journey stage across the caseload, or null when there is no one. */
  avgStage: number | null;
  /** Highest-value thing the admin could do about this caseload right now. */
  headline: string;
}

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= 0) return null;
  return (now - t) / 86_400_000;
}

/**
 * One line telling the admin what this caseload needs.
 *
 * Deliberately names a PERSON'S SITUATION, never a judgement of the staff
 * member. "Four people have not moved in two weeks" is actionable; "Kelly is
 * underperforming" is a conclusion this data cannot support -- a stalled
 * caseload can mean a hard caseload, a part-time worker, or a month of court
 * dates. The tool reports what it can see and leaves the judgement to the human
 * who knows the context.
 */
function headlineFor(p: Omit<StaffPerformance, "headline">): string {
  if (p.caseload === 0) return "No one assigned yet.";
  if (p.stalled > 0) {
    // Someone who has NEVER been active has not "stopped moving" -- they never
    // started, which is a different conversation and a different intervention.
    // Saying "has not moved in two weeks" about somebody who joined yesterday
    // is simply untrue. (Found in review, 2026-09-19.)
    const onlyNeverStarted = p.stalled === p.neverStarted;
    const noun = p.stalled === 1 ? "1 person" : `${p.stalled} people`;
    if (onlyNeverStarted) {
      return p.stalled === 1
        ? "1 person has not started yet."
        : `${noun} have not started yet.`;
    }
    if (p.neverStarted > 0) {
      return `${noun} need a nudge, including ${p.neverStarted} who have not started.`;
    }
    return p.stalled === 1
      ? "1 person has not moved in two weeks."
      : `${noun} have not moved in two weeks.`;
  }
  if (p.hired > 0) {
    return p.hired === 1 ? "1 person started work." : `${p.hired} people started work.`;
  }
  if (p.activeThisWeek === p.caseload) return "Everyone active this week.";
  return `${p.activeThisWeek} of ${p.caseload} active this week.`;
}

/**
 * Roll a cohort up by assigned staff member.
 *
 * Clients with no assignment land in a bucket with a null id. That bucket is
 * the point, not a leftover: an unassigned participant is nobody's
 * responsibility, which is the most common way someone quietly gets lost.
 *
 * `now` is injectable so the "this week" and "stalled" boundaries are testable
 * rather than dependent on when the suite happens to run.
 */
export function summarizeStaffPerformance(
  clients: readonly CohortClient[],
  opts: { now?: number } = {}
): StaffPerformance[] {
  const now = opts.now ?? Date.now();
  const buckets = new Map<string, { name: string | null; clients: CohortClient[] }>();

  for (const c of clients) {
    const key = c.assignedStaffId ?? "";
    const existing = buckets.get(key);
    if (existing) existing.clients.push(c);
    else buckets.set(key, { name: c.assignedStaffName, clients: [c] });
  }

  const out: StaffPerformance[] = [];
  // Array.from rather than iterating the Map directly: this module is
  // compiled by the consumer app too, under a lower target where Map
  // iteration needs downlevelIteration.
  for (const [key, bucket] of Array.from(buckets.entries())) {
    const list = bucket.clients;
    const stages = list.map((c) => c.currentStage).filter((n) => Number.isFinite(n));

    const base = {
      staffUserId: key || null,
      staffName: key ? bucket.name : null,
      caseload: list.length,
      activeThisWeek: list.filter((c) => {
        const d = daysSince(c.lastActiveAt, now);
        return d !== null && d <= 7;
      }).length,
      stalled: list.filter((c) => {
        const d = daysSince(c.lastActiveAt, now);
        // Never seen active counts as stalled: someone who has done nothing
        // since joining is the clearest case of needing a nudge.
        return d === null || d >= STALLED_AFTER_DAYS;
      }).length,
      neverStarted: list.filter((c) => daysSince(c.lastActiveAt, now) === null).length,
      hired: list.filter((c) => c.hired).length,
      avgStage: stages.length
        ? Math.round((stages.reduce((a, b) => a + b, 0) / stages.length) * 10) / 10
        : null,
    };

    out.push({ ...base, headline: headlineFor(base) });
  }

  // Most in need of attention first, then biggest caseload. The unassigned
  // bucket sorts last only when it has nothing wrong with it.
  return out.sort((a, b) => b.stalled - a.stalled || b.caseload - a.caseload);
}

/**
 * The database's reach rule, for the application's own reach checks (house
 * lane L3a, migration 103 on top of 102).
 *
 * The database decides reach in policy (smr_staff_reach, 102). The app keeps
 * its own checks as a second wall (orgClientView IN_REACH, staffTasks,
 * orgToday, orgOutcomes, the caseload filter); they said "assigned or sees
 * everyone". They now also ask the database's rule, which since 103 includes
 * a lead or member of an active unit where the person has an open enrollment
 * (a lead also covers the units below). The unit hook itself is not callable
 * by the app (102 keeps it inside definer functions), so this calls
 * smr_staff_reach, which answers only for the caller's own org scope: every
 * caller runs inside runScoped with that org.
 *
 * Never widens a "case manager only" sharing requirement: those checks stay on
 * the assignment alone (orgClientView SHARED).
 */
import { runScoped } from "./db";

/** SQL: does `actor` reach `who` in `org`, by the database's rule? Arguments are SQL expressions. */
export function dbReachSql(org: string, actor: string, who: string): string {
  return `public.smr_staff_reach(${org}, ${actor}, ${who})`;
}

/**
 * The participants a staff member reaches through an open enrollment, for the
 * caseload filter: the enrollment rows the reach policy lets them read.
 * Empty (never an error) when 103 is not applied.
 */
export async function participantsReachedThroughUnits(orgId: string, staffId: string): Promise<Set<string>> {
  try {
    const [rows] = await runScoped<[{ participant_user_id: string }[]]>({ orgId, userId: staffId, role: "staff" }, (c) => [
      (c as unknown as (s: string, p: unknown[]) => unknown)(
        `SELECT DISTINCT e.participant_user_id FROM enrollment e
          WHERE e.access_code_id = $1::uuid AND e.status IN ('referred', 'enrolled', 'active', 'paused')`,
        [orgId]
      ),
    ]);
    return new Set(rows.map((r) => r.participant_user_id));
  } catch {
    return new Set();
  }
}

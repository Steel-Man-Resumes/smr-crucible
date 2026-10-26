/**
 * Reach through an organization unit, for the application's own reach checks
 * (house lane L3a, migration 103).
 *
 * The database decides reach in policy (smr_staff_reach, 102); the app keeps
 * its own checks as a second wall (orgClientView IN_REACH, staffTasks,
 * orgToday, orgOutcomes, the caseload filter). Those checks said "assigned or
 * sees everyone". This adds the third way in, the same one the database uses:
 * a lead or member of an active unit where the person has an open enrollment
 * (a lead also covers the units below). It calls 102's hook,
 * smr_staff_unit_reach, which 102 creates as `false` and 103 fills in, so
 * before 103 it changes nothing. APPLY 102 BEFORE THE APP RELEASE THAT SHIPS
 * THIS (every staff read calls the hook).
 *
 * Never widens a "case manager only" sharing requirement: those checks stay on
 * the assignment alone (orgClientView SHARED).
 */
import { runScoped } from "./db";

/** SQL: does `actor` reach `who` through a unit in `org`? Arguments are SQL expressions (parameters or columns). */
export function unitReachSql(org: string, actor: string, who: string): string {
  return `public.smr_staff_unit_reach(${org}, ${actor}, ${who})`;
}

/**
 * The participants a staff member reaches through units in one organization,
 * for the caseload filter. Empty (never an error) when 103 is not applied.
 */
export async function participantsReachedThroughUnits(orgId: string, staffId: string): Promise<Set<string>> {
  try {
    const [rows] = await runScoped<[{ participant_user_id: string }[]]>({ orgId, userId: staffId, role: "staff" }, (c) => [
      (c as unknown as (s: string, p: unknown[]) => unknown)(
        `SELECT DISTINCT e.participant_user_id FROM enrollment e
          WHERE e.access_code_id = $1::uuid AND e.status IN ('referred', 'enrolled', 'active', 'paused')
            AND ${unitReachSql("$1::uuid", "$2::uuid", "e.participant_user_id")}`,
        [orgId, staffId]
      ),
    ]);
    return new Set(rows.map((r) => r.participant_user_id));
  } catch {
    return new Set();
  }
}

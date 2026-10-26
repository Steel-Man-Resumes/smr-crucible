/**
 * Reach through an organization unit, computed by the APPLICATION (house lane
 * L3a, migration 103; review fix round 1).
 *
 * Two walls. The database decides reach in policy (smr_staff_reach, 102, with
 * 103's unit hook). The app keeps its own checks as an independent second wall
 * (orgClientView IN_REACH, staffTasks, orgToday, orgOutcomes, the caseload
 * filter, listEnrollments): "assigned, or sees everyone, or reaches through a
 * unit". This file is the unit part, written out in app SQL with the SAME rule
 * as smr_staff_unit_reach, so a bug in either wall does not open the other:
 *   a lead or member of an ACTIVE unit where the person has an OPEN enrollment
 *   (referred, enrolled, active, paused); a lead also covers the three levels
 *   of units below theirs; still on staff; never a volunteer (the preset's two
 *   staff-role denies). A viewer reaches nobody.
 * The pglite test compares the two on every staff x person pair.
 *
 * Never widens a "case manager only" sharing requirement: those checks stay on
 * the assignment alone (orgClientView SHARED).
 */
import { runScoped } from "./db";

/** SQL: does `actor` reach `who` through a unit in `org`? Arguments are SQL expressions (parameters or columns). */
export function unitReachSql(org: string, actor: string, who: string): string {
  return `EXISTS (
    SELECT 1 FROM enrollment ur_e
      JOIN org_unit ur_u ON ur_u.id = ur_e.org_unit_id AND ur_u.access_code_id = ${org} AND ur_u.status = 'active'
      LEFT JOIN org_unit ur_p1 ON ur_p1.id = ur_u.parent_id
      LEFT JOIN org_unit ur_p2 ON ur_p2.id = ur_p1.parent_id
      LEFT JOIN org_unit ur_p3 ON ur_p3.id = ur_p2.parent_id
      JOIN unit_member ur_m ON ur_m.access_code_id = ${org} AND ur_m.user_id = ${actor}
       AND ((ur_m.org_unit_id = ur_u.id AND ur_m.role_in_unit IN ('lead', 'member'))
            OR (ur_m.role_in_unit = 'lead' AND ur_m.org_unit_id IN (ur_p1.id, ur_p2.id, ur_p3.id)))
     WHERE ur_e.access_code_id = ${org} AND ur_e.participant_user_id = ${who}
       AND ur_e.status IN ('referred', 'enrolled', 'active', 'paused')
       AND EXISTS (SELECT 1 FROM org_staff ur_s WHERE ur_s.access_code_id = ${org} AND ur_s.user_id = ${actor})
       AND NOT (EXISTS (SELECT 1 FROM org_capability_override ur_o WHERE ur_o.org_id = ${org} AND ur_o.user_id = ${actor}
                          AND ur_o.capability = 'org.participant.invite' AND ur_o.effect = 'deny')
            AND EXISTS (SELECT 1 FROM org_capability_override ur_o WHERE ur_o.org_id = ${org} AND ur_o.user_id = ${actor}
                          AND ur_o.capability = 'org.outcome.write' AND ur_o.effect = 'deny')))`;
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
          WHERE e.access_code_id = $1::uuid AND ${unitReachSql("$1::uuid", "$2::uuid", "e.participant_user_id")}`,
        [orgId, staffId]
      ),
    ]);
    return new Set(rows.map((r) => r.participant_user_id));
  } catch {
    return new Set();
  }
}

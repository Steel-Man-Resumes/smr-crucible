/**
 * SQL fragments team talk shares (lane S4, migration 109). Parameter
 * convention, as in orgWorkflowSql: $1 org, $2 the actor sees everyone
 * (org.client.view_all), $3 the actor.
 *
 * TWO WALLS, as everywhere on the staff side. The app checks reach with its
 * own predicate (assignment, sees-all, or a unit: the same rule as IN_REACH in
 * orgClientView), and the database repeats it in the restrictive policies.
 * A COLLEAGUE's reach (may Dana be mentioned here, may this task go to Dana)
 * is asked of the database's own rule, smr_staff_reach, which answers only
 * inside the org scope the statement runs in.
 */
import { unitReachSql } from "./orgUnitReach";

/** The person is a member of this organization and the actor reaches them. */
export const actorReaches = (who: string) => `(
  EXISTS (SELECT 1 FROM access_code_redemption tr WHERE tr.user_id = ${who} AND tr.access_code_id = $1::uuid)
  AND ($2::boolean
       OR EXISTS (SELECT 1 FROM client_staff_assignment ta
                   WHERE ta.access_code_id = $1::uuid AND ta.client_user_id = ${who} AND ta.staff_user_id = $3::uuid)
       OR ${unitReachSql("$1::uuid", "$3::uuid", who)}))`;

/** Does this colleague reach that person? (The database's rule; NULL person = a team thread, always true.) */
export const colleagueReaches = (colleague: string, who: string) =>
  `(${who} IS NULL OR public.smr_staff_reach($1::uuid, ${colleague}, ${who}))`;

/** Everyone on this organization's staff: the owner and every org_staff row. */
export const TEAM_SQL = `(
  SELECT ac.partner_user_id AS user_id, 'owner'::text AS role FROM access_code ac WHERE ac.id = $1::uuid AND ac.partner_user_id IS NOT NULL
  UNION
  SELECT os.user_id, os.role FROM org_staff os WHERE os.access_code_id = $1::uuid)`;

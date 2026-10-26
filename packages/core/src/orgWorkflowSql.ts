/**
 * SQL fragments the workflow modules share (migration 105, lane L5). One place,
 * so when reach widens (programs and units, migration 103) it changes here once.
 *
 * Parameter convention for every statement that uses these: $1 org, $2 the
 * actor sees everyone (org.client.view_all), $3 the actor.
 */
import type { OrgActor } from "./authz/resolveOrgActor";
import type { OrgScope } from "./db";

export const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
export const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
export const reachParams = (a: OrgActor) => [a.orgId, a.capabilities.has("org.client.view_all"), a.userId] as const;

/**
 * The person is a member of this organization AND the actor sees everyone or
 * is assigned to them. The same rule as IN_REACH in orgClientView.ts; the
 * database repeats it in the restrictive reach policies (102, 105).
 */
export const inReach = (who: string) => `(
  EXISTS (SELECT 1 FROM access_code_redemption rr WHERE rr.user_id = ${who} AND rr.access_code_id = $1::uuid)
  AND ($2::boolean OR EXISTS (SELECT 1 FROM client_staff_assignment ra
        WHERE ra.access_code_id = $1::uuid AND ra.client_user_id = ${who} AND ra.staff_user_id = $3::uuid)))`;

/**
 * Who a person is, BY CONSENT (review BL1), the same rule as the client header:
 * their account's name and email only with progress sharing on; otherwise what
 * this organization typed when it invited them; otherwise nothing.
 */
export const consentName = (who: string) => `(CASE WHEN EXISTS (SELECT 1 FROM staff_progress_counts cpc WHERE cpc.user_id = ${who})
    THEN (SELECT cu.name FROM users cu WHERE cu.id = ${who})
    ELSE (SELECT coi.invited_name FROM org_invite coi WHERE coi.user_id = ${who} AND coi.access_code_id = $1::uuid) END)`;

export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

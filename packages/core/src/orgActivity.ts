/**
 * Reading the organization activity log (migration 102).
 *
 * TWO DOORS:
 *   listOrgActivity          the Audit screen, for `org.audit.view` (owners
 *                            and admins by default): the whole organization,
 *                            filtered by person, team member, kind and date.
 *   listParticipantActivity  one person's history, for staff who may open
 *                            that person (`org.client.view_content`).
 * Both are reach-scoped TWICE: the row policy on org_activity (a staff session
 * sees rows about a person only when smr_staff_reach says so) and the same
 * assignment predicate in this SQL, the house's second wall.
 *
 * Rows are written only by database triggers; nothing here writes.
 */
import { runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { activityFilters, type ActivityFilters, type ActivityRow } from "./orgActivityShared";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;

/** Until org_profile.timezone exists (103), dates are read in the build's default zone. */
export const DEFAULT_ORG_TIME_ZONE = "America/Chicago";

/** A participant's name by consent: their account name with progress sharing on, else the name the org typed, else none. */
const GATED_NAME = (uid: string) => `CASE WHEN EXISTS (SELECT 1 FROM staff_progress_counts pc WHERE pc.user_id = ${uid})
  THEN (SELECT u2.name FROM users u2 WHERE u2.id = ${uid})
  ELSE (SELECT oi.invited_name FROM org_invite oi WHERE oi.user_id = ${uid} AND oi.access_code_id = $1::uuid) END`;

/** The second wall: a row about a person is in reach (`seesAll` and `actor` name the parameters). */
const inReachRow = (seesAll: string, actor: string) => `(a.participant_user_id IS NULL OR ${seesAll}::boolean OR EXISTS (
  SELECT 1 FROM client_staff_assignment x WHERE x.access_code_id = $1::uuid AND x.client_user_id = a.participant_user_id AND x.staff_user_id = ${actor}::uuid))`;

export const ACTIVITY_SQL = {
  /**
   * $1 org, $2 person, $3 team member (actor or subject), $4 kind, $5 from date, $6 to date (inclusive),
   * $7 older than id, $8 limit, $9 sees all, $10 actor, $11 time zone. Newest first.
   */
  list: `WITH page AS (
      SELECT a.id::text AS id, a.at, a.entity, a.action, a.summary, a.actor_user_id, a.actor_role, a.participant_user_id, a.staff_user_id
        FROM org_activity a
       WHERE a.access_code_id = $1::uuid
         AND ($2::uuid IS NULL OR a.participant_user_id = $2::uuid)
         AND ($3::uuid IS NULL OR a.actor_user_id = $3::uuid OR a.staff_user_id = $3::uuid)
         AND ($4::text IS NULL OR a.entity = $4::text)
         AND ($5::date IS NULL OR a.at >= ($5::date)::timestamp AT TIME ZONE $11::text)
         AND ($6::date IS NULL OR a.at < ($6::date + 1)::timestamp AT TIME ZONE $11::text)
         AND ($7::bigint IS NULL OR a.id < $7::bigint)
         AND ${inReachRow("$9", "$10")}
       ORDER BY a.id DESC
       LIMIT $8::int)
    SELECT page.*,
           CASE WHEN page.actor_role IN ('owner', 'org_admin', 'staff') THEN au.name
                WHEN page.actor_role = 'participant' THEN ${GATED_NAME("page.actor_user_id")} END AS actor_name,
           CASE WHEN page.participant_user_id IS NOT NULL THEN ${GATED_NAME("page.participant_user_id")} END AS participant_name,
           su.name AS staff_name
      FROM page
      LEFT JOIN users au ON au.id = page.actor_user_id
      LEFT JOIN users su ON su.id = page.staff_user_id
     ORDER BY page.id::bigint DESC`,
  /** $1 org. The owner and current team, for the "team member" filter. */
  team: `SELECT u.id, u.name FROM users u
          WHERE u.id IN (SELECT ac.partner_user_id FROM access_code ac WHERE ac.id = $1::uuid
                         UNION SELECT os.user_id FROM org_staff os WHERE os.access_code_id = $1::uuid)
          ORDER BY u.name NULLS LAST`,
  /** $1 org, $2 sees all, $3 actor. People the log mentions, in reach, named by consent. */
  people: `WITH p AS (SELECT DISTINCT a.participant_user_id AS uid FROM org_activity a
                    WHERE a.access_code_id = $1::uuid AND a.participant_user_id IS NOT NULL AND ${inReachRow("$2", "$3")})
           SELECT p.uid AS id, ${GATED_NAME("p.uid")} AS name FROM p LIMIT 1000`,
} as const;

export type ActivityRefusal = "no_capability" | "platform_admin_view";
export type ActivityResult = { ok: true; rows: ActivityRow[]; nextBefore: string | null } | { ok: false; reason: ActivityRefusal };

function listParams(actor: OrgActor, f: ActivityFilters, timeZone: string) {
  return [actor.orgId, f.participantId, f.staffId, f.entity, f.from, f.to, f.before, f.limit,
    actor.capabilities.has("org.client.view_all"), actor.userId, timeZone];
}

async function readPage(actor: OrgActor, f: ActivityFilters, timeZone: string): Promise<ActivityResult> {
  const [rows] = await runScoped<[ActivityRow[]]>(scopeOf(actor), (sql) => [run(sql)(ACTIVITY_SQL.list, listParams(actor, f, timeZone))]);
  return { ok: true, rows, nextBefore: rows.length === f.limit ? rows[rows.length - 1].id : null };
}

/** The Audit screen: the organization's activity, for `org.audit.view`. */
export async function listOrgActivity(actor: OrgActor, input: Record<string, unknown> | ActivityFilters = {}, opts: { timeZone?: string; maxLimit?: number } = {}): Promise<ActivityResult> {
  if (actor.viaPlatformAdmin) return { ok: false, reason: "platform_admin_view" };
  if (!actor.capabilities.has("org.audit.view")) return { ok: false, reason: "no_capability" };
  return readPage(actor, activityFilters(input as Record<string, unknown>, opts.maxLimit ?? 200), opts.timeZone ?? DEFAULT_ORG_TIME_ZONE);
}

/** One person's history, for staff who may open them. Reach decides; a person out of reach is an empty list. */
export async function listParticipantActivity(actor: OrgActor, participantId: string, input: Record<string, unknown> = {}, opts: { timeZone?: string } = {}): Promise<ActivityResult> {
  if (actor.viaPlatformAdmin) return { ok: false, reason: "platform_admin_view" };
  if (!actor.capabilities.has("org.client.view_content")) return { ok: false, reason: "no_capability" };
  const f = activityFilters({ ...input, participantId }, 200);
  if (!f.participantId) return { ok: true, rows: [], nextBefore: null };
  return readPage(actor, f, opts.timeZone ?? DEFAULT_ORG_TIME_ZONE);
}

/** Choices for the Audit screen's filters: the team, and the people the log mentions (in reach, named by consent). */
export async function activityFilterChoices(actor: OrgActor): Promise<{ team: { id: string; name: string | null }[]; people: { id: string; name: string | null }[] } | null> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.audit.view")) return null;
  const [team, people] = await runScoped<[{ id: string; name: string | null }[], { id: string; name: string | null }[]]>(scopeOf(actor), (sql) => [
    run(sql)(ACTIVITY_SQL.team, [actor.orgId]),
    run(sql)(ACTIVITY_SQL.people, [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId]),
  ]);
  return { team, people };
}

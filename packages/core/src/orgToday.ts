/**
 * Today: a case manager's work queue. Who needs me, why, and the one thing to do.
 *
 * A QUEUE REASON IS INFORMATION ABOUT A PERSON. "Interview Thursday" tells the
 * reader that someone has an interview. So each kind of reason is drawn only
 * from what that person agreed their organization can see:
 *   - quiet / never started     -> the long-standing progress switch
 *   - follow-up due, interview  -> ONLY people sharing their applications, and
 *                                  surfacing it is written to their access log
 *                                  (once a day per staff member, not per page load)
 *   - they answered your ask, awaiting acknowledgement, tasks
 *                               -> the organization's own records
 * Someone who shares nothing appears for nothing here. That is correct.
 *
 * Counts use the SAME definitions as the caseload, Insights and the assistant
 * (STALLED_AFTER_DAYS via summarizeStaffPerformance's rule), so four screens
 * cannot give four answers.
 */
import { runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { getPartnerCohort, getInvitedNotSharing } from "./partnerDashboard";
import { getQuietAfterDays } from "./orgStaffPerformance";
import { listStaffTasks } from "./staffTasks";
import { listOutcomes } from "./orgOutcomes";
import { WORK_QUEUE_TEXT_VERSIONS } from "./sharingScopes";

export { TODAY_SECTIONS, TODAY_SECTION_LABELS, INTERVIEW_STALE_DAYS, FOLLOWUP_OVERDUE_DAYS, buildTodayItems } from "./orgTodayItems";
export type { TodaySection, TodayItem, TodayInput } from "./orgTodayItems";
import { buildTodayItems, type TodayItem, type TodayAppRow } from "./orgTodayItems";
import { matchesPreset } from "./authz/capabilities";
import { unitReachSql } from "./orgUnitReach";

/**
 * Who the viewer's Today is drawn over, for the empty state. Counts only:
 * `joined` and `sharing` are given to people who see the whole organization;
 * someone who sees only their own caseload gets null, so an empty Today never
 * tells a volunteer how many people the organization has.
 */
export interface TodayReach { joined: number; sharing: number }
export interface TodayView { items: TodayItem[]; reach: TodayReach | null; volunteer: boolean }

/**
 * The org-wide counts for the empty state. `cohort.totalJoined` is counted
 * BEFORE the assigned-staff filter, so it may only go to someone who sees the
 * whole organization. Do not relax this gate: it is the only thing keeping a
 * volunteer from learning the organization's size.
 */
export function todayReachFor(capabilities: ReadonlySet<string>, cohort: { totalJoined: number; summary: { consented: number } }): TodayReach | null {
  return capabilities.has("org.client.view_all") ? { joined: cohort.totalJoined, sharing: cohort.summary.consented } : null;
}

/** The Volunteer preset, read from what this person may actually do. */
export function todayIsVolunteer(role: string, capabilities: ReadonlySet<string>): boolean {
  return role === "staff" && matchesPreset("volunteer", capabilities);
}

export async function getTodayQueue(actor: OrgActor): Promise<TodayItem[] | null> {
  return (await getTodayView(actor))?.items ?? null;
}

export async function getTodayView(actor: OrgActor): Promise<TodayView | null> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.client.view_content")) return null;
  const scope: OrgScope = { orgId: actor.orgId, userId: actor.userId, role: actor.role };
  const seesAll = actor.capabilities.has("org.client.view_all");
  const p = [actor.orgId, seesAll, actor.userId, [...WORK_QUEUE_TEXT_VERSIONS]];
  const run = (sql: unknown) => sql as (s: string, q: unknown[]) => unknown;
  const reach = (who: string) => `($2::boolean OR EXISTS (SELECT 1 FROM client_staff_assignment a
      WHERE a.access_code_id = $1::uuid AND a.client_user_id = ${who} AND a.staff_user_id = $3::uuid)
      OR ${unitReachSql("$1::uuid", "$3::uuid", who)})`;
  // Sharing applications, to THIS actor (a required grant may be "case manager only").
  const sharesApps = (who: string) => `EXISTS (SELECT 1 FROM sharing_grant g LEFT JOIN org_sharing_policy_version pv ON pv.id = g.policy_version_id
      WHERE g.user_id = ${who} AND g.access_code_id = $1::uuid AND g.scope = 'applications' AND g.revoked_at IS NULL
        AND g.text_version = ANY($4::text[])
        AND ja.created_at >= COALESCE(g.covers_from, '-infinity'::timestamptz)
        AND (pv.id IS NULL OR pv.audience = 'assigned_staff_and_admins' OR EXISTS (SELECT 1 FROM client_staff_assignment a2
              WHERE a2.access_code_id = $1::uuid AND a2.client_user_id = ${who} AND a2.staff_user_id = $3::uuid)))`;

  type AppRow = TodayAppRow;
  type AnsRow = { user_id: string; name: string | null; scope: string; status: string; answered_at: string };
  type AckRow = { user_id: string; name: string | null };
  const [apps, answered, awaiting] = await runScoped<[AppRow[], AnsRow[], AckRow[], unknown[]]>(scope, (sql) => [
    run(sql)(
      `SELECT ja.id, ja.user_id, u.name, ja.job_title, ja.company, ja.status, ja.follow_up_at, ja.status_updated_at, ja.updated_at
         FROM staff_shared_application ja JOIN users u ON u.id = ja.user_id
         JOIN access_code_redemption r ON r.user_id = ja.user_id AND r.access_code_id = $1::uuid
        WHERE ${reach("ja.user_id")} AND ${sharesApps("ja.user_id")}
          AND (ja.status = 'interviewing' OR (ja.follow_up_at IS NOT NULL AND ja.follow_up_at < now() + interval '3 days'
               AND ja.status NOT IN ('hired', 'started_work', 'rejected', 'declined')))
        ORDER BY ja.follow_up_at NULLS LAST LIMIT 100`, p),
    run(sql)(
      `SELECT sr.user_id, u.name, sr.scope, sr.status, sr.answered_at FROM sharing_request sr JOIN users u ON u.id = sr.user_id
        WHERE sr.access_code_id = $1::uuid AND sr.requested_by = $2::uuid AND sr.status IN ('approved', 'declined')
          AND sr.answered_at > now() - interval '7 days' ORDER BY sr.answered_at DESC`, [actor.orgId, actor.userId]),
    run(sql)(
      `SELECT r.user_id, u.name FROM access_code_redemption r JOIN users u ON u.id = r.user_id
         JOIN org_sharing_policy_version v ON v.access_code_id = r.access_code_id AND v.retired_at IS NULL
        WHERE r.access_code_id = $1::uuid AND ${reach("r.user_id")}
          AND NOT EXISTS (SELECT 1 FROM sharing_ack k WHERE k.user_id = r.user_id AND k.policy_version_id = v.id AND k.ended_at IS NULL)`, p.slice(0, 3)),
    // The access-log entry for the application-derived reasons above: same
    // predicate, same transaction, at most one row per staff member, person and day.
    run(sql)(
      `INSERT INTO data_access_log (target_user_id, accessor_type, accessor_id, resource_type, access_reason, fields_accessed)
       SELECT DISTINCT ja.user_id, 'staff', ($3::uuid)::text, 'shared:applications', 'org_work_queue', jsonb_build_object('orgId', ($1::uuid)::text)
         FROM staff_shared_application ja JOIN access_code_redemption r ON r.user_id = ja.user_id AND r.access_code_id = $1::uuid
        WHERE ${reach("ja.user_id")} AND ${sharesApps("ja.user_id")}
          AND (ja.status = 'interviewing' OR (ja.follow_up_at IS NOT NULL AND ja.follow_up_at < now() + interval '3 days'
               AND ja.status NOT IN ('hired', 'started_work', 'rejected', 'declined')))
          AND NOT EXISTS (SELECT 1 FROM data_access_log l WHERE l.target_user_id = ja.user_id AND l.accessor_id = ($3::uuid)::text
                           AND l.access_reason = 'org_work_queue' AND l.accessed_at > date_trunc('day', now()))`, p),
  ]);

  const cohort = await getPartnerCohort(actor.userId, { accessCodeId: actor.orgId, assignedToStaffId: seesAll ? undefined : actor.userId });
  const canAssignAll = seesAll && actor.capabilities.has("org.client.assign");
  const items = buildTodayItems({
    actorUserId: actor.userId,
    canAssignAll,
    canRecordOutcomes: actor.capabilities.has("org.outcome.write"),
    quietDays: await getQuietAfterDays(actor.orgId),
    tasks: (await listStaffTasks(actor)) ?? [],
    outcomes: actor.capabilities.has("org.outcome.write") ? (await listOutcomes(actor)) ?? [] : [],
    apps, answered, awaiting,
    cohort: cohort.clients,
    invited: canAssignAll ? await getInvitedNotSharing(actor.orgId, actor.userId).catch(() => []) : [],
  }, Date.now());
  return {
    items,
    reach: todayReachFor(actor.capabilities, cohort),
    volunteer: todayIsVolunteer(actor.role, actor.capabilities),
  };
}

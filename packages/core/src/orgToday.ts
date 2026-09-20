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
import { getPartnerCohort } from "./partnerDashboard";
import { getQuietAfterDays } from "./orgStaffPerformance";
import { listStaffTasks } from "./staffTasks";
import { listOutcomes } from "./orgOutcomes";
import { WORK_QUEUE_TEXT_VERSIONS } from "./sharingScopes";

export const TODAY_SECTIONS = ["tasks", "retention", "interviews", "followups", "answered", "acknowledgement", "quiet", "never_started", "unassigned"] as const;
export type TodaySection = (typeof TODAY_SECTIONS)[number];
export const TODAY_SECTION_LABELS: Record<TodaySection, string> = {
  tasks: "Your tasks", retention: "Retention check-ins due", interviews: "Interviews coming up", followups: "Follow-ups due", answered: "They answered you",
  acknowledgement: "Waiting on an acknowledgement", quiet: "Gone quiet", never_started: "Never started", unassigned: "Not assigned to anyone",
};

export interface TodayItem {
  key: string;
  section: TodaySection;
  clientId: string | null;
  clientName: string | null;
  /** One sentence, already written. */
  reason: string;
  when: string | null;
  action: { label: string; href: string };
  taskId?: string;
}

const day = (s: string) => new Date(s).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

export async function getTodayQueue(actor: OrgActor): Promise<TodayItem[] | null> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.client.view_content")) return null;
  const scope: OrgScope = { orgId: actor.orgId, userId: actor.userId, role: actor.role };
  const seesAll = actor.capabilities.has("org.client.view_all");
  const p = [actor.orgId, seesAll, actor.userId, [...WORK_QUEUE_TEXT_VERSIONS]];
  const run = (sql: unknown) => sql as (s: string, q: unknown[]) => unknown;
  const reach = (who: string) => `($2::boolean OR EXISTS (SELECT 1 FROM client_staff_assignment a
      WHERE a.access_code_id = $1::uuid AND a.client_user_id = ${who} AND a.staff_user_id = $3::uuid))`;
  // Sharing applications, to THIS actor (a required grant may be "case manager only").
  const sharesApps = (who: string) => `EXISTS (SELECT 1 FROM sharing_grant g LEFT JOIN org_sharing_policy_version pv ON pv.id = g.policy_version_id
      WHERE g.user_id = ${who} AND g.access_code_id = $1::uuid AND g.scope = 'applications' AND g.revoked_at IS NULL
        AND g.text_version = ANY($4::text[])
        AND ja.created_at >= COALESCE(g.covers_from, '-infinity'::timestamptz)
        AND (pv.id IS NULL OR pv.audience = 'assigned_staff_and_admins' OR EXISTS (SELECT 1 FROM client_staff_assignment a2
              WHERE a2.access_code_id = $1::uuid AND a2.client_user_id = ${who} AND a2.staff_user_id = $3::uuid)))`;

  type AppRow = { user_id: string; name: string | null; job_title: string | null; company: string | null; status: string; follow_up_at: string | null };
  type AnsRow = { user_id: string; name: string | null; scope: string; status: string; answered_at: string };
  type AckRow = { user_id: string; name: string | null };
  const [apps, answered, awaiting] = await runScoped<[AppRow[], AnsRow[], AckRow[], unknown[]]>(scope, (sql) => [
    run(sql)(
      `SELECT ja.user_id, u.name, ja.job_title, ja.company, ja.status, ja.follow_up_at
         FROM job_application ja JOIN users u ON u.id = ja.user_id
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
         FROM job_application ja JOIN access_code_redemption r ON r.user_id = ja.user_id AND r.access_code_id = $1::uuid
        WHERE ${reach("ja.user_id")} AND ${sharesApps("ja.user_id")}
          AND (ja.status = 'interviewing' OR (ja.follow_up_at IS NOT NULL AND ja.follow_up_at < now() + interval '3 days'
               AND ja.status NOT IN ('hired', 'started_work', 'rejected', 'declined')))
          AND NOT EXISTS (SELECT 1 FROM data_access_log l WHERE l.target_user_id = ja.user_id AND l.accessor_id = ($3::uuid)::text
                           AND l.access_reason = 'org_work_queue' AND l.accessed_at > date_trunc('day', now()))`, p),
  ]);

  const items: TodayItem[] = [];
  const first = (n: string | null) => (n ?? "").trim().split(/\s+/)[0] || "They";
  const href = (id: string) => `/dashboard/clients/${id}`;

  for (const t of (await listStaffTasks(actor)) ?? []) {
    if (t.done_at) continue;
    if (t.owner_user_id !== actor.userId) continue;
    const overdue = t.due_on && t.due_on < new Date().toISOString().slice(0, 10);
    items.push({
      key: `task:${t.id}`, section: "tasks", clientId: t.client_user_id, clientName: t.client_name, taskId: t.id, when: t.due_on,
      reason: `${t.title}${t.due_on ? (overdue ? ` (was due ${day(t.due_on)})` : ` (due ${day(t.due_on)})`) : ""}${t.shared_with_participant ? ` · shared with ${first(t.client_name)}` : ""}`,
      action: t.client_user_id ? { label: `Open ${first(t.client_name)}`, href: href(t.client_user_id) } : { label: "Mark done", href: "#" },
    });
  }
  for (const o of (await listOutcomes(actor)) ?? []) {
    if (o.due_marks.length === 0 || o.ended_on) continue;
    const mark = o.due_marks[0];
    items.push({ key: `ret:${o.id}:${mark}`, section: "retention", clientId: o.client_user_id, clientName: o.client_name, when: o.start_date,
      reason: `${first(o.client_name)} started at ${o.employer} ${mark}+ days ago. Time for the ${mark}-day check-in: still there?`,
      action: { label: "Record the check-in", href: href(o.client_user_id) } });
  }
  for (const a of apps) {
    const job = [a.job_title, a.company].filter(Boolean).join(" at ") || "a job";
    if (a.status === "interviewing") {
      items.push({ key: `int:${a.user_id}:${job}`, section: "interviews", clientId: a.user_id, clientName: a.name, when: a.follow_up_at,
        reason: `${first(a.name)} is interviewing for ${job}${a.follow_up_at ? `, next date ${day(a.follow_up_at)}` : ""}.`,
        action: { label: "Help them prepare", href: href(a.user_id) } });
    } else {
      items.push({ key: `fu:${a.user_id}:${job}`, section: "followups", clientId: a.user_id, clientName: a.name, when: a.follow_up_at,
        reason: `${first(a.name)} planned to follow up on ${job} by ${day(a.follow_up_at!)}.`,
        action: { label: "Check in", href: href(a.user_id) } });
    }
  }
  for (const r of answered) {
    items.push({ key: `ans:${r.user_id}:${r.scope}`, section: "answered", clientId: r.user_id, clientName: r.name, when: r.answered_at,
      reason: r.status === "approved" ? `${first(r.name)} shared what you asked for (${r.scope}).` : `${first(r.name)} said not now to sharing their ${r.scope}. That is theirs to decide.`,
      action: { label: r.status === "approved" ? "Open it" : `Open ${first(r.name)}`, href: href(r.user_id) } });
  }
  for (const k of awaiting) {
    items.push({ key: `ack:${k.user_id}`, section: "acknowledgement", clientId: k.user_id, clientName: k.name, when: null,
      reason: `${first(k.name)} has not acknowledged what your program requires. Nothing is open until they do, and only they can.`,
      action: { label: "Talk it through", href: href(k.user_id) } });
  }

  const cohort = await getPartnerCohort(actor.userId, { accessCodeId: actor.orgId, assignedToStaffId: seesAll ? undefined : actor.userId });
  const now = Date.now();
  const quietDays = await getQuietAfterDays(actor.orgId);
  // Someone who has STARTED WORK and stopped using a job-search tool is not a
  // concern, so they are left off this list -- though the rollup the assistant
  // and Insights share still counts them as not active. Deliberate, and noted.
  for (const c of cohort.clients) {
    if (c.hired) continue;
    const last = c.lastActiveAt ? new Date(c.lastActiveAt).getTime() : 0;
    if (!last) {
      items.push({ key: `ns:${c.userId}`, section: "never_started", clientId: c.userId, clientName: c.name, when: c.joinedAt,
        reason: `${first(c.name)} joined and has not started. A first conversation usually does more than a reminder.`, action: { label: "Reach out", href: href(c.userId) } });
    } else if (now - last >= quietDays * 86400000) {
      items.push({ key: `q:${c.userId}`, section: "quiet", clientId: c.userId, clientName: c.name, when: c.lastActiveAt,
        reason: `${first(c.name)} was last active ${Math.floor((now - last) / 86400000)} days ago. Worth asking what is in the way.`, action: { label: "Check in", href: href(c.userId) } });
    }
    if (seesAll && actor.capabilities.has("org.client.assign") && !c.assignedStaffId) {
      items.push({ key: `un:${c.userId}`, section: "unassigned", clientId: c.userId, clientName: c.name, when: c.joinedAt,
        reason: `${first(c.name)} is not assigned to anyone, so they are on nobody's list.`, action: { label: "Assign them", href: "/dashboard" } });
    }
  }
  return items;
}

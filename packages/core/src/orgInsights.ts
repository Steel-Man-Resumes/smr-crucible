/**
 * The organization's numbers, for the people who run it (`org.insights.view`).
 *
 * WHAT MAY BE COUNTED, and the line is deliberate:
 *  - About everyone who joined: that they joined, and when. Nothing else.
 *  - About people sharing PROGRESS (the long-standing switch): stage, activity,
 *    how many applications, practice sessions, hired. That is what they agreed
 *    their organization sees, and nothing here goes past it.
 *  - Interview and offer counts come ONLY from people who separately shared
 *    their APPLICATIONS, and the screen says so. A small cohort makes an
 *    "anonymous" total personal: if one person is interviewing, the number 1 is
 *    about them.
 *
 * Staff workload uses the same definitions as the caseload screen and the
 * staff assistant (`summarizeStaffPerformance`), so three places cannot give
 * three answers to "how many of Russ's people have gone quiet".
 */
import { runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { getPartnerCohort } from "./partnerDashboard";
import { summarizeStaffPerformance, STALLED_AFTER_DAYS } from "./orgStaffPerformance";
import { SHARING_SCOPES } from "./sharingScopes";

export interface OrgInsights {
  asOf: string;
  quietAfterDays: number;
  people: { joined: number; sharingProgress: number; notSharing: number; pendingInvites: number };
  stages: { stage: number; count: number }[];
  activity: { activeThisWeek: number; quiet: number; neverStarted: number };
  outcomes: { withAnApplication: number; applications: number; practicing: number; tailoredResume: number; hired: number };
  /** Only among people who shared their applications. */
  pipeline: { sharers: number; applied: number; interviewing: number; offered: number; hired: number };
  sharing: { scope: string; people: number }[];
  joinsByWeek: { weekOf: string; joined: number }[];
  staff: {
    userId: string; name: string | null; caseload: number; sharingProgress: number; quiet: number; neverStarted: number;
    hired: number; notes30: number; lastNoteAt: string | null; openRequests: number;
  }[];
  unassigned: number;
}

export async function getOrgInsights(actor: OrgActor): Promise<OrgInsights | null> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.insights.view")) return null;
  const scope: OrgScope = { orgId: actor.orgId, userId: actor.userId, role: actor.role };
  const cohort = await getPartnerCohort(actor.userId, { accessCodeId: actor.orgId });
  const clients = cohort.clients;
  const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;

  type StaffRow = { user_id: string; name: string | null; caseload: number; notes30: number; last_note: string | null; open_requests: number };
  const [sharing, pipeline, weeks, staffRows, invites] = await runScoped<[
    { scope: string; people: number }[],
    { sharers: number; applied: number; interviewing: number; offered: number; hired: number }[],
    { week_of: string; joined: number }[],
    StaffRow[],
    { n: number }[],
  ]>(scope, (sql) => [
    run(sql)(`SELECT scope, COUNT(DISTINCT user_id)::int AS people FROM sharing_grant
               WHERE access_code_id = $1::uuid AND revoked_at IS NULL GROUP BY scope`, [actor.orgId]),
    run(sql)(
      `WITH sharers AS (SELECT DISTINCT g.user_id FROM sharing_grant g
                         WHERE g.access_code_id = $1::uuid AND g.scope = 'applications' AND g.revoked_at IS NULL)
       SELECT (SELECT COUNT(*) FROM sharers)::int AS sharers,
              COUNT(DISTINCT ja.user_id) FILTER (WHERE ja.status <> 'saved')::int AS applied,
              COUNT(DISTINCT ja.user_id) FILTER (WHERE ja.status IN ('interviewing','heard_back'))::int AS interviewing,
              COUNT(DISTINCT ja.user_id) FILTER (WHERE ja.status = 'offered')::int AS offered,
              COUNT(DISTINCT ja.user_id) FILTER (WHERE ja.status IN ('hired','started_work'))::int AS hired
         FROM sharers s LEFT JOIN job_application ja ON ja.user_id = s.user_id`, [actor.orgId]),
    run(sql)(`SELECT to_char(date_trunc('week', redeemed_at), 'YYYY-MM-DD') AS week_of, COUNT(*)::int AS joined
                FROM access_code_redemption WHERE access_code_id = $1::uuid AND redeemed_at > now() - interval '12 weeks'
               GROUP BY 1 ORDER BY 1`, [actor.orgId]),
    run(sql)(
      `SELECT p.user_id, u.name,
              (SELECT COUNT(*)::int FROM client_staff_assignment a WHERE a.access_code_id = $1::uuid AND a.staff_user_id = p.user_id) AS caseload,
              (SELECT COUNT(*)::int FROM case_note n WHERE n.access_code_id = $1::uuid AND n.author_user_id = p.user_id AND n.created_at > now() - interval '30 days') AS notes30,
              (SELECT MAX(n.occurred_at) FROM case_note n WHERE n.access_code_id = $1::uuid AND n.author_user_id = p.user_id) AS last_note,
              (SELECT COUNT(*)::int FROM sharing_request r WHERE r.access_code_id = $1::uuid AND r.requested_by = p.user_id AND r.status = 'pending') AS open_requests
         FROM (SELECT user_id FROM org_staff WHERE access_code_id = $1::uuid
               UNION SELECT DISTINCT staff_user_id FROM client_staff_assignment WHERE access_code_id = $1::uuid) p
         JOIN users u ON u.id = p.user_id`, [actor.orgId]),
    run(sql)(`SELECT COUNT(*)::int AS n FROM org_invite oi JOIN users u ON u.id = oi.user_id
               WHERE oi.access_code_id = $1::uuid AND u."emailVerified" IS NULL AND u.password_hash IS NULL`, [actor.orgId]),
  ]);

  const perf = summarizeStaffPerformance(clients);
  // Organization totals are the SUM of the per-staff rollup (which includes the
  // unassigned bucket), never a second calculation of the same idea.
  const sum = (k: "stalled" | "neverStarted" | "activeThisWeek") => perf.reduce((n, p) => n + p[k], 0);

  return {
    asOf: new Date().toISOString(),
    quietAfterDays: STALLED_AFTER_DAYS,
    people: { joined: cohort.totalJoined, sharingProgress: clients.length, notSharing: cohort.pendingCount, pendingInvites: invites[0]?.n ?? 0 },
    stages: [0, 1, 2, 3, 4, 5, 6].map((stage) => ({ stage, count: clients.filter((c) => c.currentStage === stage).length })),
    activity: { activeThisWeek: sum("activeThisWeek"), quiet: sum("stalled"), neverStarted: sum("neverStarted") },
    outcomes: {
      withAnApplication: clients.filter((c) => c.applications > 0).length,
      applications: clients.reduce((n, c) => n + c.applications, 0),
      practicing: clients.filter((c) => c.practiceSessions > 0).length,
      tailoredResume: clients.filter((c) => c.hasResumeTailored).length,
      hired: clients.filter((c) => c.hired).length,
    },
    pipeline: pipeline[0] ?? { sharers: 0, applied: 0, interviewing: 0, offered: 0, hired: 0 },
    sharing: SHARING_SCOPES.map((s) => ({ scope: s, people: sharing.find((x) => x.scope === s)?.people ?? 0 })),
    joinsByWeek: weeks.map((w) => ({ weekOf: w.week_of, joined: w.joined })),
    staff: staffRows.map((s) => {
      const p = perf.find((x) => x.staffUserId === s.user_id);
      return {
        userId: s.user_id, name: s.name, caseload: s.caseload,
        sharingProgress: p?.caseload ?? 0, quiet: p?.stalled ?? 0, neverStarted: p?.neverStarted ?? 0, hired: p?.hired ?? 0,
        notes30: s.notes30, lastNoteAt: s.last_note, openRequests: s.open_requests,
      };
    }).sort((a, b) => b.caseload - a.caseload),
    unassigned: clients.filter((c) => !c.assignedStaffId).length,
  };
}

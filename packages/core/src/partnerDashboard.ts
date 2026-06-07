/**
 * Partner dashboard -- consent-gated cohort progress.
 *
 * A "monitoring partner" (e.g., a reentry org case manager) owns access codes
 * (access_code.partner_user_id). Their cohort is the set of users who redeemed
 * those codes. Progress is shown ONLY for clients who granted the 'sharing'
 * consent layer; everyone else is counted but never identified. We surface
 * progress signals (stage, counts, activity, outcome) -- never practice content,
 * resume content, or disclosure plans.
 *
 * Reuses the existing models: access_code / access_code_redemption (cohort) and
 * consumer_consent (the 'sharing' / 'outcome_named' layers). No parallel tables.
 */

import { query, getOne } from "./db";

export interface CohortClient {
  userId: string;
  name: string | null;
  email: string | null;
  currentStage: number;
  nextStepAction: string | null;
  applications: number;
  savedJobs: number;
  practiceSessions: number;
  hasResumeTailored: boolean;
  hasDisclosurePlan: boolean;
  hired: boolean;
  outcomeNamed: boolean;
  lastActiveAt: string | null;
  joinedAt: string;
}

export interface PartnerCohort {
  clients: CohortClient[]; // sharing-consented only, most-recently-active first
  pendingCount: number; // joined but have not granted 'sharing'
  totalJoined: number;
  summary: {
    consented: number;
    avgStage: number | null;
    hired: number;
    activeThisWeek: number;
  };
}

/** A monitoring partner owns >=1 access code; admins see every cohort. */
export async function isPartnerUser(userId: string, tier?: string): Promise<boolean> {
  if (tier === "admin") return true;
  const row = await getOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM access_code WHERE partner_user_id = $1`,
    [userId]
  );
  return Number(row?.n ?? 0) > 0;
}

/**
 * Resolve the partner's cohort with consent-gated progress.
 * Admin (isAdmin) sees all redeemers across all codes.
 */
export async function getPartnerCohort(
  userId: string,
  opts: { isAdmin?: boolean } = {}
): Promise<PartnerCohort> {
  // 1. Cohort membership + consent flags (one row per distinct client).
  const members = await query<{
    user_id: string;
    joined_at: string;
    sharing: boolean;
    outcome_named: boolean;
  }>(
    `SELECT acr.user_id,
            MIN(acr.redeemed_at) AS joined_at,
            bool_or(cs.consent_layer = 'sharing'       AND cs.status = 'granted') AS sharing,
            bool_or(cs.consent_layer = 'outcome_named' AND cs.status = 'granted') AS outcome_named
       FROM access_code_redemption acr
       JOIN access_code ac ON ac.id = acr.access_code_id
       LEFT JOIN consumer_consent cs
         ON cs.user_id = acr.user_id
        AND cs.consent_layer IN ('sharing', 'outcome_named')
      WHERE ${opts.isAdmin ? "TRUE" : "ac.partner_user_id = $1"}
      GROUP BY acr.user_id`,
    opts.isAdmin ? [] : [userId]
  );

  const totalJoined = members.length;
  const consentedMembers = members.filter((m) => m.sharing);
  const pendingCount = totalJoined - consentedMembers.length;

  if (consentedMembers.length === 0) {
    return {
      clients: [],
      pendingCount,
      totalJoined,
      summary: { consented: 0, avgStage: null, hired: 0, activeThisWeek: 0 },
    };
  }

  // 2. Progress for consented clients only (progress signals, never content).
  const ids = consentedMembers.map((m) => m.user_id);
  const rows = await query<{
    id: string;
    name: string | null;
    email: string | null;
    current_stage: number | null;
    next_step_action: string | null;
    applications: string;
    saved_jobs: string;
    practice_sessions: string;
    has_resume_tailored: boolean;
    has_disclosure_plan: boolean;
    hired: boolean;
    last_active_at: string | null;
  }>(
    `SELECT u.id, u.name, u.email, u.current_stage,
            u.next_step_cache->>'action' AS next_step_action,
            (SELECT COUNT(*) FROM job_application ja WHERE ja.user_id = u.id AND ja.status <> 'saved')::text AS applications,
            (SELECT COUNT(*) FROM job_application ja WHERE ja.user_id = u.id AND ja.status = 'saved')::text AS saved_jobs,
            (SELECT COUNT(*) FROM refinery_artifact ra WHERE ra.user_id = u.id AND ra.artifact_type = 'interview_prep')::text AS practice_sessions,
            EXISTS(SELECT 1 FROM job_application ja WHERE ja.user_id = u.id AND ja.resume_artifact_id IS NOT NULL) AS has_resume_tailored,
            EXISTS(SELECT 1 FROM refinery_artifact ra WHERE ra.user_id = u.id AND ra.artifact_type = 'disclosure_plan') AS has_disclosure_plan,
            EXISTS(SELECT 1 FROM job_application ja WHERE ja.user_id = u.id AND (ja.status IN ('hired','started_work') OR ja.hired_at IS NOT NULL)) AS hired,
            GREATEST(
              COALESCE(u.next_step_cached_at, to_timestamp(0)),
              COALESCE((SELECT MAX(updated_at) FROM job_application ja WHERE ja.user_id = u.id), to_timestamp(0)),
              COALESCE((SELECT MAX(updated_at) FROM refinery_artifact ra WHERE ra.user_id = u.id), to_timestamp(0))
            ) AS last_active_at
       FROM users u
      WHERE u.id = ANY($1::uuid[])`,
    [ids]
  );

  const byId = new Map(consentedMembers.map((m) => [m.user_id, m]));
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const clients: CohortClient[] = rows.map((r) => {
    const m = byId.get(r.id)!;
    const lastActive =
      r.last_active_at && new Date(r.last_active_at).getTime() > 0
        ? r.last_active_at
        : null;
    return {
      userId: r.id,
      name: r.name,
      email: r.email,
      currentStage: r.current_stage ?? 0,
      nextStepAction: r.next_step_action,
      applications: Number(r.applications),
      savedJobs: Number(r.saved_jobs),
      practiceSessions: Number(r.practice_sessions),
      hasResumeTailored: r.has_resume_tailored,
      hasDisclosurePlan: r.has_disclosure_plan,
      hired: r.hired,
      outcomeNamed: m.outcome_named,
      lastActiveAt: lastActive,
      joinedAt: m.joined_at,
    };
  });

  clients.sort(
    (a, b) =>
      (b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0) -
      (a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0)
  );

  const hired = clients.filter((c) => c.hired).length;
  const activeThisWeek = clients.filter(
    (c) => c.lastActiveAt && new Date(c.lastActiveAt).getTime() > weekAgo
  ).length;
  const avgStage =
    clients.length > 0
      ? Math.round(
          (clients.reduce((s, c) => s + c.currentStage, 0) / clients.length) * 10
        ) / 10
      : null;

  return {
    clients,
    pendingCount,
    totalJoined,
    summary: { consented: clients.length, avgStage, hired, activeThisWeek },
  };
}

/** CSV export of the consent-shared cohort (progress signals only, no content). */
export function cohortToCsv(cohort: PartnerCohort): string {
  const header = [
    "name",
    "email",
    "stage",
    "next_step",
    "applications",
    "saved_jobs",
    "practice_sessions",
    "resume_tailored",
    "disclosure_plan",
    "hired",
    "last_active",
    "joined",
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = cohort.clients.map((c) =>
    [
      c.name,
      c.email,
      c.currentStage,
      c.nextStepAction,
      c.applications,
      c.savedJobs,
      c.practiceSessions,
      c.hasResumeTailored ? "yes" : "no",
      c.hasDisclosurePlan ? "yes" : "no",
      c.hired ? "yes" : "no",
      c.lastActiveAt ? c.lastActiveAt.slice(0, 10) : "",
      c.joinedAt.slice(0, 10),
    ]
      .map(esc)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

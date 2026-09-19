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
  /** Staff member responsible for this client (org build-out). */
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  /** Exact AI spend for this client, USD (sponsoring org sees what it funds). */
  aiCostUsd: number;
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
  opts: {
    isAdmin?: boolean;
    /** Scope to one org's anchor code instead of ownership (org build-out). */
    accessCodeId?: string;
    /** Only clients assigned to this staff member. */
    assignedToStaffId?: string;
  } = {}
): Promise<PartnerCohort> {
  // 1. Cohort membership + consent flags (one row per distinct client).
  const scopeByCode = !!opts.accessCodeId;
  const members = await query<{
    user_id: string;
    joined_at: string;
    code_ids: string[];
    sharing: boolean;
    outcome_named: boolean;
  }>(
    `SELECT acr.user_id,
            MIN(acr.redeemed_at) AS joined_at,
            array_agg(DISTINCT ac.id) AS code_ids,
            bool_or(cs.consent_layer = 'sharing'       AND cs.status = 'granted') AS sharing,
            bool_or(cs.consent_layer = 'outcome_named' AND cs.status = 'granted') AS outcome_named
       FROM access_code_redemption acr
       JOIN access_code ac ON ac.id = acr.access_code_id
       LEFT JOIN consumer_consent cs
         ON cs.user_id = acr.user_id
        AND cs.consent_layer IN ('sharing', 'outcome_named')
      WHERE ${
        scopeByCode ? "ac.id = $1" : opts.isAdmin ? "TRUE" : "ac.partner_user_id = $1"
      }
      GROUP BY acr.user_id`,
    scopeByCode ? [opts.accessCodeId] : opts.isAdmin ? [] : [userId]
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
  // The access codes that DEFINED this cohort. The staff-assignment join below
  // must be restricted to them: a participant can hold codes from more than one
  // organization, and an unscoped join surfaced the OTHER org's staff name
  // inside this dashboard. Cohort membership was already scoped correctly; the
  // assigned-staff columns were not.
  const scopeCodeIds = Array.from(
    new Set(consentedMembers.flatMap((m) => m.code_ids ?? []))
  );
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
    assigned_staff_id: string | null;
    assigned_staff_name: string | null;
    ai_cost_usd: string;
  }>(
    `SELECT u.id, u.name, u.email, u.current_stage,
            csa.staff_user_id AS assigned_staff_id,
            su.name AS assigned_staff_name,
            COALESCE((SELECT SUM(atu.cost_usd) FROM ai_token_usage atu WHERE atu.user_id = u.id), 0)::text AS ai_cost_usd,
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
       LEFT JOIN client_staff_assignment csa
         ON csa.client_user_id = u.id
        AND csa.access_code_id = ANY($2::uuid[])
       LEFT JOIN users su ON su.id = csa.staff_user_id
      WHERE u.id = ANY($1::uuid[])`,
    [ids, scopeCodeIds]
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
      assignedStaffId: r.assigned_staff_id,
      assignedStaffName: r.assigned_staff_name,
      aiCostUsd: Number(r.ai_cost_usd || 0),
    };
  });

  const scopedClients = opts.assignedToStaffId
    ? clients.filter((c) => c.assignedStaffId === opts.assignedToStaffId)
    : clients;

  scopedClients.sort(
    (a, b) =>
      (b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0) -
      (a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0)
  );

  const hired = scopedClients.filter((c) => c.hired).length;
  const activeThisWeek = scopedClients.filter(
    (c) => c.lastActiveAt && new Date(c.lastActiveAt).getTime() > weekAgo
  ).length;
  const avgStage =
    scopedClients.length > 0
      ? Math.round(
          (scopedClients.reduce((s, c) => s + c.currentStage, 0) /
            scopedClients.length) *
            10
        ) / 10
      : null;

  return {
    clients: scopedClients,
    pendingCount,
    totalJoined,
    summary: { consented: scopedClients.length, avgStage, hired, activeThisWeek },
  };
}

// ─── Org staff hierarchy (EXPO build-out, 2026-08-02) ───────────────────────

export interface OrgStaffMember {
  userId: string;
  name: string | null;
  email: string | null;
  role: "org_admin" | "staff";
  title: string | null;
  clientCount: number;
}

export interface OrgContext {
  accessCodeId: string;
  code: string;
  orgName: string;
  logoUrl: string | null;
  /** Seat cap (access_code.max_redemptions); null = unlimited. */
  seatLimit: number | null;
  /** Caller's role within the org. */
  role: "owner" | "org_admin" | "staff";
  userId: string;
}

/**
 * Resolve the org context for a user: either they own the org's access code
 * (partner_user_id) or they appear in org_staff. Platform admins resolving a
 * specific code pass overrideCodeId.
 */
export async function getOrgContext(
  userId: string,
  opts: { isAdmin?: boolean; overrideCodeId?: string } = {}
): Promise<OrgContext | null> {
  if (opts.isAdmin && opts.overrideCodeId) {
    const row = await getOne<{ id: string; code: string; partner_name: string; org_logo_url: string | null; max_redemptions: number | null }>(
      `SELECT id, code, partner_name, org_logo_url, max_redemptions FROM access_code WHERE id = $1`,
      [opts.overrideCodeId]
    );
    if (!row) return null;
    return {
      accessCodeId: row.id,
      code: row.code,
      orgName: row.partner_name,
      logoUrl: row.org_logo_url,
      seatLimit: row.max_redemptions,
      role: "owner",
      userId,
    };
  }

  // Code owner wins
  const owned = await getOne<{ id: string; code: string; partner_name: string; org_logo_url: string | null; max_redemptions: number | null }>(
    `SELECT id, code, partner_name, org_logo_url, max_redemptions FROM access_code
      WHERE partner_user_id = $1 AND is_active = true
      ORDER BY created_at ASC LIMIT 1`,
    [userId]
  );
  if (owned) {
    return {
      accessCodeId: owned.id,
      code: owned.code,
      orgName: owned.partner_name,
      logoUrl: owned.org_logo_url,
      seatLimit: owned.max_redemptions,
      role: "owner",
      userId,
    };
  }

  const staff = await getOne<{
    access_code_id: string;
    role: string;
    code: string;
    partner_name: string;
    org_logo_url: string | null;
    max_redemptions: number | null;
  }>(
    `SELECT os.access_code_id, os.role, ac.code, ac.partner_name, ac.org_logo_url, ac.max_redemptions
       FROM org_staff os
       JOIN access_code ac ON ac.id = os.access_code_id
      WHERE os.user_id = $1
      ORDER BY os.created_at ASC LIMIT 1`,
    [userId]
  );
  if (!staff) return null;
  return {
    accessCodeId: staff.access_code_id,
    code: staff.code,
    orgName: staff.partner_name,
    logoUrl: staff.org_logo_url,
    seatLimit: staff.max_redemptions,
    role: staff.role === "org_admin" ? "org_admin" : "staff",
    userId,
  };
}

export async function getOrgStaff(accessCodeId: string): Promise<OrgStaffMember[]> {
  const rows = await query<{
    user_id: string;
    name: string | null;
    email: string | null;
    role: string;
    title: string | null;
    client_count: string;
  }>(
    `SELECT os.user_id, u.name, u.email, os.role, os.title,
            (SELECT COUNT(*) FROM client_staff_assignment csa
              WHERE csa.staff_user_id = os.user_id
                AND csa.access_code_id = os.access_code_id)::text AS client_count
       FROM org_staff os
       JOIN users u ON u.id = os.user_id
      WHERE os.access_code_id = $1
      ORDER BY os.role DESC, u.name ASC`,
    [accessCodeId]
  );
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: r.email,
    role: r.role === "org_admin" ? "org_admin" : "staff",
    title: r.title,
    clientCount: Number(r.client_count),
  }));
}

/** Assign (or reassign) a cohort client to a staff member. Pass null staff to unassign. */
export async function assignClientStaff(
  accessCodeId: string,
  clientUserId: string,
  staffUserId: string | null,
  assignedBy: string
): Promise<void> {
  if (!staffUserId) {
    await query(
      `DELETE FROM client_staff_assignment
        WHERE access_code_id = $1 AND client_user_id = $2`,
      [accessCodeId, clientUserId]
    );
    return;
  }
  // BOTH PARTIES MUST BELONG TO THIS ORG.
  //
  // Neither was checked. The route passes clientUserId and staffUserId straight
  // from the request body, so an org admin could pair their own access code
  // with ANY user id in the system -- and because the dashboard then renders
  // the assigned staff member's name, that made this an existence-and-name
  // oracle over the whole users table.
  //
  // Enforced in SQL rather than by a prior SELECT so there is no window between
  // the check and the write: the INSERT sources its values from a SELECT whose
  // WHERE clause is the authorization, and writes nothing when either side
  // fails. Membership = redeemed this code; staff = listed for this code.
  const written = await query<{ client_user_id: string }>(
    `INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by)
     SELECT $1, $2, $3, $4
      WHERE EXISTS (
              SELECT 1 FROM access_code_redemption acr
               WHERE acr.access_code_id = $1 AND acr.user_id = $2
            )
        AND (
              EXISTS (
                SELECT 1 FROM org_staff os
                 WHERE os.access_code_id = $1 AND os.user_id = $3
              )
              -- The org OWNER is not necessarily listed in org_staff, and
              -- assigning a participant to themselves is a legitimate thing for
              -- a one-person organization to do.
              OR EXISTS (
                SELECT 1 FROM access_code ac
                 WHERE ac.id = $1 AND ac.partner_user_id = $3
              )
            )
     ON CONFLICT (access_code_id, client_user_id)
     DO UPDATE SET staff_user_id = $3, assigned_by = $4, created_at = NOW()
     RETURNING client_user_id`,
    [accessCodeId, clientUserId, staffUserId, assignedBy]
  );

  if (written.length === 0) {
    throw new Error(
      "Cannot assign: the participant is not in this organization's cohort, or that staff member does not belong to this organization."
    );
  }
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

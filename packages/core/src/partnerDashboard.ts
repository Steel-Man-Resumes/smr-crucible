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

import { query, getOne, getOneAsUser, runScoped, runPerOrg, type OrgScope } from "./db";

/**
 * query(), but with the organization scope set so row-level policies pass.
 *
 * Exists so converting a call site is a one-word change rather than a rewrite
 * into transaction-array style -- the friction is what leaves queries
 * unconverted, and an unconverted query is now an empty result rather than a
 * leak, which is safe but silently broken.
 */
async function runScopedRows<T>(
  sql: string,
  params: unknown[],
  orgId: string,
  userId = "",
  role: OrgScope["role"] = "org_admin"
): Promise<T[]> {
  const out = await runScoped<unknown[][]>({ orgId, userId, role }, (c) => [
    (c as unknown as (s: string, p: unknown[]) => unknown)(sql, params),
  ]);
  return (out[0] ?? []) as T[];
}

/**
 * Which assignment to show for a participant who is assigned in more than one
 * organization. The org this cohort was requested for wins; otherwise the
 * first by code order, which is at least deterministic.
 */
function pickAssignment(
  all: Map<string, { staffId: string; staffName: string | null; codeId: string }>,
  clientId: string,
  preferredCodeId?: string
) {
  if (preferredCodeId) {
    const exact = all.get(`${clientId}:${preferredCodeId}`);
    if (exact) return exact;
  }
  const matches = Array.from(all.entries())
    .filter(([k]) => k.startsWith(`${clientId}:`))
    .sort(([a], [b]) => a.localeCompare(b));
  return matches[0]?.[1];
}

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
  //
  // Membership is row-level protected, one organization at a time. So first
  // decide WHICH codes this cohort is made of -- from access_code, which says
  // who owns what -- then read each code's members scoped to that code. This
  // used to be one unscoped join with the scope in a WHERE clause; under RLS
  // that returns nothing and the console shows an empty organization.
  let codeIds: string[];
  if (opts.accessCodeId) {
    codeIds = [opts.accessCodeId];
  } else {
    const codes = opts.isAdmin
      ? await query<{ id: string }>(`SELECT id FROM access_code`)
      : await query<{ id: string }>(`SELECT id FROM access_code WHERE partner_user_id = $1`, [userId]);
    codeIds = codes.map((c) => c.id);
  }

  type MemberRow = {
    user_id: string;
    joined_at: string;
    code_ids: string[];
    sharing: boolean;
    outcome_named: boolean;
  };
  const perCode = await runPerOrg<MemberRow>(
    codeIds,
    userId,
    `SELECT acr.user_id,
            MIN(acr.redeemed_at) AS joined_at,
            array_agg(DISTINCT acr.access_code_id) AS code_ids,
            COALESCE(bool_or(cs.consent_layer = 'sharing'       AND cs.status = 'granted'), false) AS sharing,
            COALESCE(bool_or(cs.consent_layer = 'outcome_named' AND cs.status = 'granted'), false) AS outcome_named
       FROM access_code_redemption acr
       LEFT JOIN consumer_consent cs
         ON cs.user_id = acr.user_id
        AND cs.consent_layer IN ('sharing', 'outcome_named')
      WHERE acr.access_code_id = $1
      GROUP BY acr.user_id`,
    (codeId) => [codeId]
  );
  // One person can hold several of this cohort's codes: merge to one row.
  const merged = new Map<string, MemberRow>();
  for (const rows of Array.from(perCode.values())) {
    for (const r of rows) {
      const prior = merged.get(r.user_id);
      if (!prior) {
        merged.set(r.user_id, { ...r, code_ids: [...(r.code_ids ?? [])] });
        continue;
      }
      if (new Date(r.joined_at) < new Date(prior.joined_at)) prior.joined_at = r.joined_at;
      prior.code_ids = Array.from(new Set([...prior.code_ids, ...(r.code_ids ?? [])]));
      prior.sharing = prior.sharing || r.sharing;
      prior.outcome_named = prior.outcome_named || r.outcome_named;
    }
  }
  const members = Array.from(merged.values());

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
  const rows = await runScopedRows<{
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
            -- Counts and dates come from staff_progress_counts, a view. The
            -- participant's own tables are owner-only under row-level security
            -- (migration 060); the view serves exactly these signals, for members
            -- of the scoped org who have progress sharing on, and nothing else.
            COALESCE(pc.applications, 0)::text AS applications,
            COALESCE(pc.saved_jobs, 0)::text AS saved_jobs,
            COALESCE(pc.practice_sessions, 0)::text AS practice_sessions,
            COALESCE(pc.has_resume_tailored, false) AS has_resume_tailored,
            COALESCE(pc.has_disclosure_plan, false) AS has_disclosure_plan,
            COALESCE(pc.hired, false) AS hired,
            GREATEST(
              COALESCE(u.next_step_cached_at, to_timestamp(0)),
              COALESCE(pc.last_application_at, to_timestamp(0)),
              COALESCE(pc.last_artifact_at, to_timestamp(0))
            ) AS last_active_at
       FROM users u
       LEFT JOIN staff_progress_counts pc ON pc.user_id = u.id
       LEFT JOIN client_staff_assignment csa
         ON csa.client_user_id = u.id
        AND csa.access_code_id = ANY($2::uuid[])
       LEFT JOIN users su ON su.id = csa.staff_user_id
      WHERE u.id = ANY($1::uuid[])`,
    [ids, scopeCodeIds],
    // client_staff_assignment is row-level protected, so this join needs an
    // org scope. A policy scopes to ONE org, and a cohort resolved by
    // ownership can span several codes -- so the assignments are fetched
    // separately, one scoped read per code, and merged below.
    //
    // I previously scoped this to the first code and called the result "empty
    // rather than wrong". That was wrong twice over: participants under the
    // other codes stayed in the list but appeared UNASSIGNED, which is a
    // mixed result presented as complete -- the worst of both. And the "first"
    // code came from an unordered array_agg, so it was not even stable
    // between calls. (Found in review.)
    scopeCodeIds[0] ?? ""
  );

  // One scoped read per code in the cohort, merged. Costs a round trip per
  // organization, which is the honest price of a boundary the database
  // enforces one org at a time.
  const assignments = new Map<
    string,
    { staffId: string; staffName: string | null; codeId: string }
  >();
  for (const codeId of scopeCodeIds) {
    const rows = await runScopedRows<{ client_user_id: string; staff_user_id: string; staff_name: string | null }>(
      `SELECT csa.client_user_id, csa.staff_user_id, su.name AS staff_name
         FROM client_staff_assignment csa
         LEFT JOIN users su ON su.id = csa.staff_user_id
        WHERE csa.access_code_id = $1 AND csa.client_user_id = ANY($2::uuid[])`,
      [codeId, ids],
      codeId
    );
    for (const r of rows) {
      // Keyed by client AND code. Keying on the client alone meant a
      // participant assigned in two organizations kept whichever row happened
      // to be read last -- an arbitrary winner, with no ordering guarantee
      // between runs. (Found in review.)
      assignments.set(`${r.client_user_id}:${codeId}`, {
        staffId: r.staff_user_id,
        staffName: r.staff_name,
        codeId,
      });
    }
  }

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
      // Prefer the assignment from the org this cohort was asked for; fall
      // back to any other code the participant is assigned under, so a
      // multi-org participant shows a real staff member rather than "nobody".
      assignedStaffId: pickAssignment(assignments, r.id, opts.accessCodeId)?.staffId ?? r.assigned_staff_id,
      assignedStaffName: pickAssignment(assignments, r.id, opts.accessCodeId)?.staffName ?? r.assigned_staff_name,
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

  // MISSED IN THE CUTOVER, AND IT BROKE STAFF IN PRODUCTION. org_staff is
  // row-level protected, and this ran on an unscoped connection -- so anyone
  // who is staff but does NOT own an access code resolved to "no organization"
  // and lost their console entirely. resolveOrgActor was converted; this
  // sibling lookup, which feeds the nav and /api/user/role, was not.
  //
  // The self-read clause exists precisely for this: discovering which org you
  // belong to cannot itself be org-scoped.
  const staff = await getOneAsUser<{
    access_code_id: string;
    role: string;
    code: string;
    partner_name: string;
    org_logo_url: string | null;
    max_redemptions: number | null;
  }>(
    userId,
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
  // org_staff is row-level protected. Without the org scope set, this query
  // returns nothing -- which is the point: a forgotten scope is an empty list,
  // never another organization's team.
  const rows = await runScopedRows<{
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
    [accessCodeId],
    accessCodeId
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
    const removed = await runScopedRows<{ id: string }>(
      `DELETE FROM client_staff_assignment
        WHERE access_code_id = $1 AND client_user_id = $2
        RETURNING id`,
      [accessCodeId, clientUserId],
      accessCodeId,
      // The actor, so the audit row names a person rather than falling back to
      // a database role. An unattributed write is a gap in the record.
      assignedBy
    );
    // A DELETE that matched nothing used to return success. Under row-level
    // security that is exactly what a wrong or missing scope looks like, so
    // "it worked" and "it silently did nothing" were indistinguishable to the
    // caller and to the person clicking. (Found in review.)
    if (removed.length === 0) {
      throw new Error(
        "Nothing to unassign -- that participant is not assigned to anyone in this organization."
      );
    }
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
  // client_staff_assignment is RLS-protected: without the scope this write
  // affects zero rows and the guard below would report a refusal that was
  // actually a missing scope. Silent no-ops are their own bug class.
  const written = await runScopedRows<{ client_user_id: string }>(
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
    [accessCodeId, clientUserId, staffUserId, assignedBy],
    accessCodeId,
    assignedBy
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

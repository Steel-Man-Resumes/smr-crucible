/**
 * The participant's side of sharing: what is on, who asked, who looked.
 *
 * Every write here runs AS the person (`runAsUser`), with no organization
 * scope. That is not a convention: the row-level policies on sharing_grant
 * refuse an INSERT or UPDATE that carries an org scope, so there is no way to
 * call these "on behalf of" an organization even by mistake.
 */
import { query, queryAsUser, runAsUser } from "./db";
import { isSharingScope, SHARING_SCOPES, SHARING_TEXT_VERSION, type SharingScope } from "./sharingScopes";

const SCOPES_FOR_SQL: readonly string[] = SHARING_SCOPES;

export interface SharingOrgState {
  orgId: string;
  orgName: string;
  /** Is the new sharing model switched on for this organization at all? */
  enabled: boolean;
  caseManagerName: string | null;
  granted: { scope: SharingScope; grantedAt: string; basis: string }[];
  requests: { id: string; scope: SharingScope; reason: string; requestedByName: string | null; createdAt: string }[];
}

/** Everything the "Who can see what" page needs, for every org the person belongs to. */
export async function getSharingState(userId: string): Promise<SharingOrgState[]> {
  const orgs = await queryAsUser<{ id: string; partner_name: string; crm_v2: boolean }>(
    userId,
    `SELECT ac.id, ac.partner_name, ac.crm_v2
       FROM access_code_redemption r JOIN access_code ac ON ac.id = r.access_code_id
      WHERE r.user_id = $1 ORDER BY r.redeemed_at`,
    [userId]
  );
  if (orgs.length === 0) return [];
  const [grants, requests] = await runAsUser<
    [
      { access_code_id: string; scope: string; granted_at: string; basis: string }[],
      { id: string; access_code_id: string; scope: string; reason: string; requested_by_name: string | null; created_at: string }[],
    ]
  >(userId, (sql) => [
    sql`SELECT access_code_id, scope, granted_at, basis FROM sharing_grant
         WHERE user_id = ${userId} AND revoked_at IS NULL`,
    sql`SELECT sr.id, sr.access_code_id, sr.scope, sr.reason, u.name AS requested_by_name, sr.created_at
          FROM sharing_request sr LEFT JOIN users u ON u.id = sr.requested_by
         WHERE sr.user_id = ${userId} AND sr.status = 'pending' ORDER BY sr.created_at`,
  ]);
  // The assigned case manager's NAME. client_staff_assignment is org-scoped and
  // a participant has no org scope, so this one fact comes from a function.
  // It takes no argument: it answers for whoever app.user_id says is asking.
  const managers = await queryAsUser<{ access_code_id: string; name: string | null }>(
    userId,
    `SELECT access_code_id, name FROM smr_my_case_managers()`
  ).catch(() => [] as { access_code_id: string; name: string | null }[]);

  return orgs.map((o) => ({
    orgId: o.id,
    orgName: o.partner_name,
    enabled: o.crm_v2,
    caseManagerName: managers.find((m) => m.access_code_id === o.id)?.name ?? null,
    granted: grants
      .filter((g) => g.access_code_id === o.id && isSharingScope(g.scope))
      .map((g) => ({ scope: g.scope as SharingScope, grantedAt: g.granted_at, basis: g.basis })),
    requests: requests
      .filter((r) => r.access_code_id === o.id && isSharingScope(r.scope))
      .map((r) => ({ id: r.id, scope: r.scope as SharingScope, reason: r.reason, requestedByName: r.requested_by_name, createdAt: r.created_at })),
  }));
}

export type SharingResult = { ok: true } | { ok: false; error: string };

/** Turn a scope on for one organization. Idempotent: already on is success. */
export async function grantSharing(userId: string, orgId: string, scope: string): Promise<SharingResult> {
  if (!isSharingScope(scope)) return { ok: false, error: "That is not something that can be shared." };
  const [rows] = await runAsUser<[{ id: string }[]]>(userId, (sql) => [
    // Membership and "this org has the feature" are both inside the statement:
    // the policy checks membership again, and a non-member inserts nothing.
    sql`INSERT INTO sharing_grant (user_id, access_code_id, scope, text_version)
        SELECT ${userId}::uuid, ac.id, ${scope}, ${SHARING_TEXT_VERSION}
          FROM access_code ac
         WHERE ac.id = ${orgId}::uuid AND ac.crm_v2
           AND EXISTS (SELECT 1 FROM access_code_redemption r WHERE r.user_id = ${userId}::uuid AND r.access_code_id = ac.id)
        ON CONFLICT DO NOTHING
        RETURNING id`,
  ]);
  if (rows.length > 0) return { ok: true };
  const [existing] = await runAsUser<[{ id: string }[]]>(userId, (sql) => [
    sql`SELECT id FROM sharing_grant WHERE user_id = ${userId} AND access_code_id = ${orgId}::uuid AND scope = ${scope} AND revoked_at IS NULL`,
  ]);
  return existing.length > 0 ? { ok: true } : { ok: false, error: "You can only share with an organization you belong to." };
}

/** Turn a scope off. Says so if there was nothing to turn off. */
export async function revokeSharing(userId: string, orgId: string, scope: string): Promise<SharingResult> {
  if (!isSharingScope(scope)) return { ok: false, error: "That is not something that can be shared." };
  const [rows] = await runAsUser<[{ id: string }[]]>(userId, (sql) => [
    // Stopping something a PROGRAM requires is allowed -- it is the person's
    // material -- and it is recorded as exactly that, so the program sees an
    // honest "stopped" rather than a silent gap. The page warns them first.
    sql`UPDATE sharing_grant
           SET revoked_at = now(),
               revoked_reason = CASE WHEN basis = 'program_requirement' THEN 'participant_stopped_required' ELSE 'participant' END
         WHERE user_id = ${userId} AND access_code_id = ${orgId}::uuid AND scope = ${scope} AND revoked_at IS NULL
        RETURNING id`,
  ]);
  return rows.length > 0 ? { ok: true } : { ok: false, error: "That was not being shared." };
}

/**
 * Answer a staff member's request. Approving creates the grant IN THE SAME
 * STATEMENT as marking the request approved, so there is never an approved
 * request with no grant, or a grant made from a request somebody else answered.
 */
export async function answerSharingRequest(userId: string, requestId: string, approve: boolean): Promise<SharingResult> {
  if (!approve) {
    const [rows] = await runAsUser<[{ id: string }[]]>(userId, (sql) => [
      sql`UPDATE sharing_request SET status = 'declined'
           WHERE id = ${requestId}::uuid AND user_id = ${userId} AND status = 'pending' RETURNING id`,
    ]);
    return rows.length > 0 ? { ok: true } : { ok: false, error: "That request is no longer open." };
  }
  const [rows] = await runAsUser<[{ id: string }[]]>(userId, (sql) => [
    sql`WITH ok AS (
          UPDATE sharing_request SET status = 'approved'
           WHERE id = ${requestId}::uuid AND user_id = ${userId} AND status = 'pending'
             AND scope = ANY(${[...SCOPES_FOR_SQL]}::text[])
          RETURNING id, access_code_id, scope
        )
        INSERT INTO sharing_grant (user_id, access_code_id, scope, text_version, request_id)
        SELECT ${userId}::uuid, ok.access_code_id, ok.scope, ${SHARING_TEXT_VERSION}, ok.id FROM ok
        ON CONFLICT DO NOTHING
        RETURNING id`,
  ]);
  if (rows.length > 0) return { ok: true };
  // Already shared when they approved: the request is closed and that is fine.
  const [closed] = await runAsUser<[{ status: string }[]]>(userId, (sql) => [
    sql`SELECT status FROM sharing_request WHERE id = ${requestId}::uuid AND user_id = ${userId}`,
  ]);
  return closed[0]?.status === "approved" ? { ok: true } : { ok: false, error: "That request is no longer open." };
}

export interface AccessLogEntry {
  at: string;
  /** 'opened' = they opened it. 'queue' = your dates appeared on their daily work list. */
  kind: 'opened' | 'queue';
  who: string | null;
  orgName: string | null;
  scope: string;
}

/**
 * Who opened what. "Opened", never "read": the log records that the content
 * was fetched for that person, which is all software can honestly know.
 */
export async function getMyAccessLog(userId: string, limit = 50): Promise<AccessLogEntry[]> {
  const rows = await query<{ accessed_at: string; who: string | null; org_name: string | null; resource_type: string; access_reason: string }>(
    `SELECT l.access_reason, l.accessed_at, u.name AS who, ac.partner_name AS org_name, l.resource_type
       FROM data_access_log l
       LEFT JOIN users u ON u.id::text = l.accessor_id
       LEFT JOIN access_code ac ON ac.id::text = l.fields_accessed->>'orgId'
      WHERE l.target_user_id = $1 AND l.accessor_type = 'staff' AND l.access_reason IN ('org_client_view', 'org_work_queue')
      ORDER BY l.accessed_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.map((r) => ({ kind: r.access_reason === 'org_work_queue' ? 'queue' as const : 'opened' as const, at: r.accessed_at, who: r.who, orgName: r.org_name, scope: r.resource_type.replace(/^shared:/, "") }));
}

/* -------------------------------------------- what my case manager suggested -- */

export interface MySuggestion {
  id: string; kind: "job" | "comment"; job_title: string | null; company: string | null; location: string | null; apply_url: string | null;
  artifact_id: string | null; artifact_label: string | null; quote: string | null; body: string; status: string; from_name: string | null; created_at: string;
}

export async function getMySuggestions(userId: string): Promise<MySuggestion[]> {
  return queryAsUser<MySuggestion>(
    userId,
    `SELECT s.id, s.kind, s.job_title, s.company, s.location, s.apply_url, s.artifact_id, s.quote, s.body, s.status, u.name AS from_name, s.created_at,
            CASE WHEN ra.id IS NULL THEN NULL
                 ELSE COALESCE(NULLIF(ra.target_context->>'targetJob', ''), CASE ra.artifact_type WHEN 'cover_letter' THEN 'your cover letter' ELSE 'your resume' END) END AS artifact_label
       FROM staff_suggestion s LEFT JOIN users u ON u.id = s.author_user_id LEFT JOIN refinery_artifact ra ON ra.id = s.artifact_id
      WHERE s.client_user_id = $1 AND s.status IN ('open', 'saved') AND (s.status = 'open' OR s.responded_at > now() - interval '7 days')
      ORDER BY (s.status = 'open') DESC, s.created_at DESC LIMIT 50`,
    [userId]
  );
}

/** The participant's answer. 'saved' on a job means THEY saved it (the page does that with their own session first). */
export async function answerSuggestion(userId: string, suggestionId: string, status: "saved" | "dismissed"): Promise<boolean> {
  const [rows] = await runAsUser<[{ id: string }[]]>(userId, (sql) => [
    sql`UPDATE staff_suggestion SET status = ${status} WHERE id = ${suggestionId}::uuid AND client_user_id = ${userId} AND status = 'open' RETURNING id`,
  ]);
  return rows.length > 0;
}

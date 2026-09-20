/**
 * THE ONLY DOOR through which organization staff read anything a participant
 * made. API routes, the client page, exports and the staff assistant all come
 * through here, so there is one place where the rule lives and one place to
 * get it wrong.
 *
 * THE RULE, all of it, every time:
 *   1. the actor holds `org.client.view_content` (deny overrides already
 *      applied by resolveOrgActor -- a denied admin is refused here too);
 *   2. the actor is a MEMBER of the org, not a platform admin looking in;
 *   3. the person is currently a member of that organization;
 *   4. the actor is assigned to them, or holds `org.client.view_all`;
 *   5. the person has an active grant for THIS scope to THIS organization.
 *
 * 1 and 2 are checked in TypeScript against the resolved actor. 3, 4 and 5 are
 * inside the SQL of every read, so they cannot be skipped by a caller who
 * forgets a step: a read that fails them returns no rows, and the same
 * statement is what decides whether an access-log row is written.
 *
 * COLUMNS ARE AN ALLOWLIST. A row policy can only admit whole rows, and these
 * rows hold things no scope covers -- a person's private notes on a job, the
 * pay they wrote down. Each projection below names what it returns. Adding a
 * column here is adding to a promise in sharingScopes.ts; change both or neither.
 *
 * THE LOG IS PART OF THE READ. Content and its access-log row go in one
 * transaction. If the log cannot be written, nothing is returned.
 *
 * HONEST STATUS: until participant-owned tables get row-level security of
 * their own, steps 3-5 are enforced by THIS module's SQL, not by policies on
 * job_application / refinery_artifact. The security statement must say so.
 */
import { runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { SHARING_SCOPES, isSharingScope, type SharingScope } from "./sharingScopes";

export type ClientViewDenied =
  | "no_capability"
  | "platform_admin_view"
  | "not_in_reach_or_not_member"
  | "not_shared";

export type ClientViewResult<T> = { ok: true; rows: T[] } | { ok: false; reason: ClientViewDenied };

function scopeOf(actor: OrgActor): OrgScope {
  return { orgId: actor.orgId, userId: actor.userId, role: actor.role };
}

/** Steps 1 and 2. Returns a refusal, or null when the actor may proceed to SQL. */
function refuseActor(actor: OrgActor): ClientViewDenied | null {
  if (actor.viaPlatformAdmin) return "platform_admin_view";
  if (!actor.capabilities.has("org.client.view_content")) return "no_capability";
  return null;
}

/**
 * Steps 3 and 4 as SQL over ($1 client, $2 org, $3 actor may see all, $4 actor).
 * Both tables are row-level protected and are read here inside the org scope.
 */
const IN_REACH = `
  EXISTS (SELECT 1 FROM access_code_redemption r WHERE r.user_id = $1::uuid AND r.access_code_id = $2::uuid)
  AND ($3::boolean OR EXISTS (
        SELECT 1 FROM client_staff_assignment a
         WHERE a.access_code_id = $2::uuid AND a.client_user_id = $1::uuid AND a.staff_user_id = $4::uuid))`;

/**
 * Step 5 for one scope ($5). A grant made under a PROGRAM REQUIREMENT carries
 * the audience the participant acknowledged: "only my case manager" means an
 * admin who merely sees the whole cohort does not get it, whatever $3 says.
 */
const SHARED = `
  EXISTS (SELECT 1 FROM sharing_grant g
           LEFT JOIN org_sharing_policy_version pv ON pv.id = g.policy_version_id
           WHERE g.user_id = $1::uuid AND g.access_code_id = $2::uuid AND g.scope = $5::text AND g.revoked_at IS NULL
             AND (pv.id IS NULL OR pv.audience = 'assigned_staff_and_admins'
                  OR EXISTS (SELECT 1 FROM client_staff_assignment a2
                              WHERE a2.access_code_id = $2::uuid AND a2.client_user_id = $1::uuid AND a2.staff_user_id = $4::uuid)))`;

/**
 * "From today on": when a requirement was acknowledged as covering only future
 * material, rows created before that moment stay closed. If the person ALSO
 * chose to share the scope themselves (covers_from NULL), everything is open.
 */
const covered = (createdAt: string) => `
  ${createdAt} >= COALESCE((SELECT CASE WHEN bool_or(g.covers_from IS NULL) THEN '-infinity'::timestamptz ELSE MIN(g.covers_from) END
                              FROM sharing_grant g
                             WHERE g.user_id = $1::uuid AND g.access_code_id = $2::uuid AND g.scope = $5::text AND g.revoked_at IS NULL),
                           'infinity'::timestamptz)`;

function params(actor: OrgActor, clientId: string, scope?: SharingScope) {
  const base = [clientId, actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId];
  return scope ? [...base, scope] : base;
}

export interface ClientHeader {
  userId: string;
  name: string | null;
  email: string | null;
  currentStage: number;
  joinedAt: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  /** Per scope: is it shared, and is there an open request? */
  scopes: Record<SharingScope, {
    shared: boolean; sharedAt: string | null; requestPending: boolean;
    /** The program requires this scope. */
    required: boolean;
    /** Required, acknowledged, and then stopped by the participant. */
    stoppedByParticipant: boolean;
    /** Shared only "from today on": earlier material stays closed. */
    fromDate: string | null;
  }>;
  /** The program requires something and this person has not acknowledged it yet. */
  awaitingAcknowledgement: boolean;
  /**
   * Progress signals, ONLY if the person has the long-standing "share my
   * progress" switch on. Counts and a next step; never content. null = off.
   */
  progress: {
    nextStepAction: string | null; applications: number; savedJobs: number; practiceSessions: number;
    hasTailoredResume: boolean; lastActiveAt: string | null;
  } | null;
}

/**
 * Who this is and what they have chosen to share. Needs reach (steps 1-4) but
 * no grant: knowing THAT a resume is not shared is how staff know to ask.
 */
export async function getClientHeader(actor: OrgActor, clientId: string): Promise<ClientViewResult<ClientHeader>> {
  const refused = refuseActor(actor);
  if (refused) return { ok: false, reason: refused };
  type Row = { id: string; name: string | null; email: string | null; current_stage: number | null; joined_at: string | null; staff_id: string | null; staff_name: string | null };
  const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
  type PolicyRow = { scopes: string[]; acked: boolean; stopped: string[] | null };
  type ProgressRow = { next_step_action: string | null; applications: number; saved_jobs: number; practice_sessions: number; has_tailored: boolean; last_active_at: string | null };
  const [who, grants, requests, policy, progress] = await runScoped<[Row[], { scope: string; granted_at: string; covers_from: string | null; chose: boolean }[], { scope: string }[], PolicyRow[], ProgressRow[]]>(
    scopeOf(actor),
    (sql) => [
      run(sql)(
        `SELECT u.id, u.name, u.email, u.current_stage,
                (SELECT MIN(r.redeemed_at) FROM access_code_redemption r WHERE r.user_id = u.id AND r.access_code_id = $2::uuid) AS joined_at,
                a.staff_user_id AS staff_id, su.name AS staff_name
           FROM users u
           LEFT JOIN client_staff_assignment a ON a.client_user_id = u.id AND a.access_code_id = $2::uuid
           LEFT JOIN users su ON su.id = a.staff_user_id
          WHERE u.id = $1::uuid AND ${IN_REACH}`,
        params(actor, clientId)
      ),
      run(sql)(
        `SELECT g.scope, MIN(g.granted_at) AS granted_at,
                CASE WHEN bool_or(g.covers_from IS NULL) THEN NULL ELSE MIN(g.covers_from) END AS covers_from,
                bool_or(g.basis = 'participant_choice') AS chose
           FROM sharing_grant g
          WHERE g.user_id = $1::uuid AND g.access_code_id = $2::uuid AND g.revoked_at IS NULL AND ${IN_REACH}
          GROUP BY g.scope`,
        params(actor, clientId)
      ),
      run(sql)(
        `SELECT sr.scope FROM sharing_request sr
          WHERE sr.user_id = $1::uuid AND sr.access_code_id = $2::uuid AND sr.status = 'pending' AND ${IN_REACH}`,
        params(actor, clientId)
      ),
      run(sql)(
        `SELECT v.scopes,
                EXISTS (SELECT 1 FROM sharing_ack a WHERE a.user_id = $1::uuid AND a.policy_version_id = v.id AND a.ended_at IS NULL) AS acked,
                (SELECT array_agg(DISTINCT g.scope) FROM sharing_grant g
                  WHERE g.user_id = $1::uuid AND g.policy_version_id = v.id AND g.revoked_reason = 'participant_stopped_required') AS stopped
           FROM org_sharing_policy_version v
          WHERE v.access_code_id = $2::uuid AND v.retired_at IS NULL AND ${IN_REACH}`,
        params(actor, clientId)
      ),
      // The same signals the caseload table already shows, behind the same
      // consent: the person's own "share my progress" switch.
      run(sql)(
        `SELECT u.next_step_cache->>'action' AS next_step_action,
                pc.applications, pc.saved_jobs, pc.practice_sessions, pc.has_resume_tailored AS has_tailored,
                GREATEST(COALESCE(u.next_step_cached_at, to_timestamp(0)),
                         COALESCE(pc.last_application_at, to_timestamp(0)),
                         COALESCE(pc.last_artifact_at, to_timestamp(0))) AS last_active_at
           FROM users u
           -- INNER join: the view has a row only for someone with progress sharing on.
           JOIN staff_progress_counts pc ON pc.user_id = u.id
          WHERE u.id = $1::uuid AND ${IN_REACH}`,
        params(actor, clientId)
      ),
    ]
  );
  const row = who[0];
  if (!row) return { ok: false, reason: "not_in_reach_or_not_member" };
  const scopes = {} as ClientHeader["scopes"];
  for (const s of SHARING_SCOPES) {
    const g = grants.find((x) => x.scope === s);
    const required = !!policy[0]?.scopes.includes(s);
    scopes[s] = {
      shared: !!g, sharedAt: g?.granted_at ?? null, requestPending: requests.some((x) => x.scope === s),
      required, stoppedByParticipant: required && !g && !!policy[0]?.stopped?.includes(s), fromDate: g?.covers_from ?? null,
    };
  }
  return {
    ok: true,
    rows: [{
      userId: row.id, name: row.name, email: row.email, currentStage: row.current_stage ?? 0,
      joinedAt: row.joined_at, assignedStaffId: row.staff_id, assignedStaffName: row.staff_name, scopes,
      awaitingAcknowledgement: !!policy[0] && !policy[0].acked,
      progress: progress[0] ? {
        nextStepAction: progress[0].next_step_action, applications: progress[0].applications, savedJobs: progress[0].saved_jobs,
        practiceSessions: progress[0].practice_sessions, hasTailoredResume: progress[0].has_tailored,
        lastActiveAt: progress[0].last_active_at && new Date(progress[0].last_active_at).getTime() > 0 ? progress[0].last_active_at : null,
      } : null,
    }],
  };
}

/**
 * One scoped, logged read. `select` is the projection; it may use $1 (client)
 * and must name its columns. The access-log INSERT carries the SAME predicate,
 * so a refused read writes no "opened" entry and an allowed one always does.
 */
async function readShared<T>(actor: OrgActor, clientId: string, scope: SharingScope, select: string): Promise<ClientViewResult<T>> {
  const refused = refuseActor(actor);
  if (refused) return { ok: false, reason: refused };
  const p = params(actor, clientId, scope);
  const run = (sql: unknown) => sql as (s: string, q: unknown[]) => unknown;
  const [allowed, rows] = await runScoped<[{ in_reach: boolean; shared: boolean }[], T[], unknown[]]>(scopeOf(actor), (sql) => [
    run(sql)(`SELECT (${IN_REACH}) AS in_reach, (${SHARED}) AS shared`, p),
    run(sql)(`${select} AND ${IN_REACH} AND ${SHARED}`, p),
    run(sql)(
      `INSERT INTO data_access_log (target_user_id, accessor_type, accessor_id, resource_type, access_reason, fields_accessed)
       SELECT $1::uuid, 'staff', ($4::uuid)::text, 'shared:' || $5::text, 'org_client_view', jsonb_build_object('orgId', ($2::uuid)::text)
        WHERE ${IN_REACH} AND ${SHARED}`,
      p
    ),
  ]);
  const gate = allowed[0];
  if (!gate?.in_reach) return { ok: false, reason: "not_in_reach_or_not_member" };
  if (!gate.shared) return { ok: false, reason: "not_shared" };
  return { ok: true, rows };
}

export interface SharedApplication {
  id: string;
  job_title: string | null;
  company: string | null;
  location: string | null;
  employment_type: string | null;
  status: string;
  status_updated_at: string | null;
  applied_at: string | null;
  follow_up_at: string | null;
  hired_at: string | null;
  apply_url: string | null;
  has_tailored_resume: boolean;
  has_cover_letter: boolean;
  created_at: string;
  updated_at: string;
}

/** NOT returned, on purpose: notes, salary, description, every jd_* column. */
export function getClientApplications(actor: OrgActor, clientId: string) {
  return readShared<SharedApplication>(
    actor, clientId, "applications",
    // staff_shared_application is a VIEW (migration 060). The base table is
    // owner-only, and the view has no notes, salary, description or saved
    // posting in it -- so those are out of reach however this is written.
    `SELECT ja.id, ja.job_title, ja.company, ja.location, ja.employment_type, ja.status,
            ja.status_updated_at, ja.applied_at, ja.follow_up_at, ja.hired_at, ja.apply_url,
            ja.has_tailored_resume, ja.has_cover_letter, ja.created_at, ja.updated_at
       FROM staff_shared_application ja
      WHERE ja.user_id = $1::uuid AND ${covered("ja.created_at")}`
  );
}

export interface SharedArtifact {
  id: string;
  lane: string | null;
  /** The one resume the person has pinned as their main one. */
  is_current: boolean;
  is_locked: boolean;
  target_context: unknown;
  content: unknown;
  updated_at: string;
  approved_at: string | null;
}

/**
 * The person's library of ONE artifact type, as each document stands now.
 *
 * In this schema a resume tailored to a job is its own artifact, not a version
 * of another one, so "their resumes" is several rows. What is NOT here is the
 * edit history of any of them: that lives in artifact_revisions, which this
 * module never reads.
 *
 * The type is a literal in this file, never a parameter: a resume grant must
 * not be able to fetch a disclosure plan by asking for a different type.
 */
function artifactLibrary(actor: OrgActor, clientId: string, scope: SharingScope, artifactType: "resume" | "cover_letter") {
  return readShared<SharedArtifact>(
    actor, clientId, scope,
    `SELECT ra.id, ra.lane, ra.is_current, ra.is_locked, ra.target_context, ra.content, ra.updated_at, ra.approved_at
       FROM staff_shared_artifact ra
      WHERE ra.user_id = $1::uuid AND ra.artifact_type = '${artifactType}' AND ${covered("ra.created_at")}`
  );
}
export const getClientResumes = (actor: OrgActor, clientId: string) => artifactLibrary(actor, clientId, "resume", "resume");
export const getClientDocuments = (actor: OrgActor, clientId: string) => artifactLibrary(actor, clientId, "documents", "cover_letter");

/** Ask a participant to share one scope. Staff ask; only the person answers. */
export async function requestSharing(actor: OrgActor, clientId: string, scope: string, reason: string):
  Promise<{ ok: true } | { ok: false; error: string }> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.client.request_sharing")) {
    return { ok: false, error: "You do not have access to that." };
  }
  if (!isSharingScope(scope)) return { ok: false, error: "That is not something that can be shared." };
  const text = reason.trim();
  if (text.length < 3 || text.length > 500) return { ok: false, error: "Say why in a sentence, so they know what it is for." };
  const run = (sql: unknown) => sql as (s: string, q: unknown[]) => unknown;
  const [made] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `INSERT INTO sharing_request (access_code_id, user_id, scope, requested_by, reason)
       SELECT $2::uuid, $1::uuid, $5::text, $4::uuid, $6
        WHERE ${IN_REACH} AND NOT (${SHARED})
       ON CONFLICT DO NOTHING RETURNING id`,
      [...params(actor, clientId, scope), text]
    ),
  ]);
  return made.length > 0 ? { ok: true } : { ok: false, error: "Already shared, already asked, or not someone on your caseload." };
}

export interface CaseNote {
  id: string;
  kind: string;
  body: string;
  occurred_at: string;
  author_name: string | null;
  author_user_id: string | null;
  visible_to_participant: boolean;
  drafted_by_assistant: boolean;
  edited_at: string | null;
}

export async function getClientNotes(actor: OrgActor, clientId: string): Promise<ClientViewResult<CaseNote>> {
  const refused = refuseActor(actor);
  if (refused) return { ok: false, reason: refused };
  const run = (sql: unknown) => sql as (s: string, q: unknown[]) => unknown;
  const [reach, notes] = await runScoped<[{ ok: boolean }[], CaseNote[]]>(scopeOf(actor), (sql) => [
    run(sql)(`SELECT (${IN_REACH}) AS ok`, params(actor, clientId)),
    run(sql)(
      `SELECT n.id, n.kind, n.body, n.occurred_at, u.name AS author_name, n.author_user_id,
              n.visible_to_participant, n.drafted_by_assistant, n.edited_at
         FROM case_note n LEFT JOIN users u ON u.id = n.author_user_id
        WHERE n.client_user_id = $1::uuid AND n.access_code_id = $2::uuid AND ${IN_REACH}
        ORDER BY n.occurred_at DESC LIMIT 200`,
      params(actor, clientId)
    ),
  ]);
  if (!reach[0]?.ok) return { ok: false, reason: "not_in_reach_or_not_member" };
  return { ok: true, rows: notes };
}

const NOTE_KINDS = new Set(["note", "call", "meeting", "text", "email", "referral"]);

export async function addClientNote(actor: OrgActor, clientId: string, input: {
  body: string; kind?: string; visibleToParticipant?: boolean; draftedByAssistant?: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.note.write")) return { ok: false, error: "You do not have access to that." };
  const body = (input.body ?? "").trim();
  if (!body || body.length > 8000) return { ok: false, error: "A note needs some text, up to 8000 characters." };
  const kind = NOTE_KINDS.has(input.kind ?? "") ? input.kind! : "note";
  const run = (sql: unknown) => sql as (s: string, q: unknown[]) => unknown;
  const [made] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `INSERT INTO case_note (access_code_id, client_user_id, author_user_id, kind, body, visible_to_participant, drafted_by_assistant)
       SELECT $2::uuid, $1::uuid, $4::uuid, $5::text, $6, $7, $8 WHERE ${IN_REACH} RETURNING id`,
      [...params(actor, clientId), kind, body, !!input.visibleToParticipant, !!input.draftedByAssistant]
    ),
  ]);
  return made[0] ? { ok: true, id: made[0].id } : { ok: false, error: "That person is not on your caseload." };
}

/* ------------------------------------------------ across the whole caseload -- */

/** "In my reach" for a row that names its participant as `WHO` ($1 org, $2 sees-all, $3 actor). */
const reachOf = (who: string) => `
  ($2::boolean OR EXISTS (
     SELECT 1 FROM client_staff_assignment a
      WHERE a.access_code_id = $1::uuid AND a.client_user_id = ${who} AND a.staff_user_id = $3::uuid))`;

function listParams(actor: OrgActor) {
  return [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId];
}

export interface OrgSharingRequest {
  id: string;
  client_user_id: string;
  client_name: string | null;
  scope: string;
  reason: string;
  status: "pending" | "approved" | "declined" | "cancelled";
  requested_by: string | null;
  requested_by_name: string | null;
  created_at: string;
  answered_at: string | null;
}

/**
 * Every ask made of people on this actor's caseload, newest first. A decline is
 * shown as a decline and nothing more: the participant is promised that staff
 * are not told why, and there is no "why" stored to tell.
 */
export async function listSharingRequests(actor: OrgActor): Promise<ClientViewResult<OrgSharingRequest>> {
  const refused = refuseActor(actor);
  if (refused) return { ok: false, reason: refused };
  const run = (sql: unknown) => sql as (s: string, q: unknown[]) => unknown;
  const [rows] = await runScoped<[OrgSharingRequest[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `SELECT sr.id, sr.user_id AS client_user_id, u.name AS client_name, sr.scope, sr.reason, sr.status,
              sr.requested_by, rb.name AS requested_by_name, sr.created_at, sr.answered_at
         FROM sharing_request sr
         JOIN users u ON u.id = sr.user_id
         LEFT JOIN users rb ON rb.id = sr.requested_by
        WHERE sr.access_code_id = $1::uuid AND ${reachOf("sr.user_id")}
        ORDER BY (sr.status = 'pending') DESC, sr.created_at DESC LIMIT 200`,
      listParams(actor)
    ),
  ]);
  return { ok: true, rows: rows.filter((r) => isSharingScope(r.scope)) };
}

/** Take back an ask that has not been answered. Your own, or any if you see the whole cohort. */
export async function withdrawSharingRequest(actor: OrgActor, requestId: string): Promise<{ ok: boolean }> {
  if (refuseActor(actor) || !actor.capabilities.has("org.client.request_sharing")) return { ok: false };
  const run = (sql: unknown) => sql as (s: string, q: unknown[]) => unknown;
  const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `UPDATE sharing_request SET status = 'cancelled'
        WHERE id = $4::uuid AND access_code_id = $1::uuid AND status = 'pending'
          AND ($2::boolean OR requested_by = $3::uuid)
        RETURNING id`,
      [...listParams(actor), requestId]
    ),
  ]);
  return { ok: rows.length > 0 };
}

export interface OrgNote extends CaseNote {
  client_user_id: string;
  client_name: string | null;
}

/** The record across this actor's caseload, newest first. */
export async function listRecentNotes(actor: OrgActor, limit = 100): Promise<ClientViewResult<OrgNote>> {
  const refused = refuseActor(actor);
  if (refused) return { ok: false, reason: refused };
  const run = (sql: unknown) => sql as (s: string, q: unknown[]) => unknown;
  const [rows] = await runScoped<[OrgNote[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `SELECT n.id, n.client_user_id, c.name AS client_name, n.kind, n.body, n.occurred_at,
              u.name AS author_name, n.author_user_id, n.visible_to_participant, n.drafted_by_assistant, n.edited_at
         FROM case_note n
         JOIN users c ON c.id = n.client_user_id
         LEFT JOIN users u ON u.id = n.author_user_id
        WHERE n.access_code_id = $1::uuid AND ${reachOf("n.client_user_id")}
        ORDER BY n.occurred_at DESC LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}`,
      listParams(actor)
    ),
  ]);
  return { ok: true, rows };
}

/* -------------------------------------------------------------- suggestions -- */

export interface StaffSuggestion {
  id: string; kind: "job" | "comment"; job_title: string | null; company: string | null; location: string | null; apply_url: string | null;
  artifact_id: string | null; quote: string | null; body: string; status: "open" | "saved" | "dismissed" | "withdrawn";
  author_name: string | null; author_user_id: string | null; created_at: string; responded_at: string | null;
}

const canSuggest = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.suggest.write");

export async function listSuggestions(actor: OrgActor, clientId: string): Promise<ClientViewResult<StaffSuggestion>> {
  const refused = refuseActor(actor);
  if (refused) return { ok: false, reason: refused };
  const run = (sql: unknown) => sql as (s: string, q: unknown[]) => unknown;
  const [rows] = await runScoped<[StaffSuggestion[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `SELECT s.id, s.kind, s.job_title, s.company, s.location, s.apply_url, s.artifact_id, s.quote, s.body, s.status,
              u.name AS author_name, s.author_user_id, s.created_at, s.responded_at
         FROM staff_suggestion s LEFT JOIN users u ON u.id = s.author_user_id
        WHERE s.client_user_id = $1::uuid AND s.access_code_id = $2::uuid AND ${IN_REACH}
        ORDER BY s.created_at DESC LIMIT 200`,
      params(actor, clientId)
    ),
  ]);
  return { ok: true, rows };
}

/** A job worth a look. It becomes THEIR saved job only if they save it themselves. */
export async function suggestJob(actor: OrgActor, clientId: string, input: { jobTitle: string; company: string; location?: string | null; applyUrl?: string | null; why: string }):
  Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!canSuggest(actor)) return { ok: false, error: "You do not have access to that." };
  const title = input.jobTitle?.trim(), company = input.company?.trim(), why = input.why?.trim();
  if (!title || !company) return { ok: false, error: "A job title and an employer are needed." };
  if (!why || why.length < 3) return { ok: false, error: "Say why it might suit them. They will read it." };
  const url = input.applyUrl?.trim() || null;
  if (url && !/^https:\/\/\S+$/.test(url)) return { ok: false, error: "The link has to start with https://" };
  const run = (sql: unknown) => sql as (s: string, q: unknown[]) => unknown;
  const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `INSERT INTO staff_suggestion (access_code_id, client_user_id, author_user_id, kind, job_title, company, location, apply_url, body)
       SELECT $2::uuid, $1::uuid, $4::uuid, 'job', $5, $6, $7, $8, $9 WHERE ${IN_REACH} RETURNING id`,
      [...params(actor, clientId), title, company, input.location?.trim() || null, url, why]
    ),
  ]);
  return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, error: "That person is not on your caseload." };
}

/**
 * A comment beside a resume or letter. Allowed only on a document the person
 * has SHARED, with the same predicate that lets staff read it: nobody comments
 * on what they cannot see, and the comment cannot outlive nothing -- it is a
 * staff record, shown to the participant, that never touches the document.
 */
export async function commentOnArtifact(actor: OrgActor, clientId: string, artifactId: string, body: string, quote?: string | null):
  Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!canSuggest(actor)) return { ok: false, error: "You do not have access to that." };
  const text = body?.trim();
  if (!text || text.length < 3) return { ok: false, error: "Write the comment first." };
  const run = (sql: unknown) => sql as (s: string, q: unknown[]) => unknown;
  // The document's type decides which scope must be shared. Looked up inside
  // the scoped transaction, never taken from the caller.
  for (const [type, scope] of [["resume", "resume"], ["cover_letter", "documents"]] as const) {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `INSERT INTO staff_suggestion (access_code_id, client_user_id, author_user_id, kind, artifact_id, quote, body)
         SELECT $2::uuid, $1::uuid, $4::uuid, 'comment', ra.id, $7, $8
           FROM staff_shared_artifact ra
          WHERE ra.id = $6::uuid AND ra.user_id = $1::uuid AND ra.artifact_type = '${type}'
            AND ${IN_REACH} AND ${SHARED} AND ${covered("ra.created_at")}
         RETURNING id`,
        [...params(actor, clientId, scope), artifactId, quote?.trim()?.slice(0, 500) || null, text]
      ),
    ]);
    if (rows[0]) return { ok: true, id: rows[0].id };
  }
  return { ok: false, error: "You can only comment on a document they have shared with you." };
}

export async function withdrawSuggestion(actor: OrgActor, suggestionId: string): Promise<boolean> {
  if (!canSuggest(actor)) return false;
  const run = (sql: unknown) => sql as (s: string, q: unknown[]) => unknown;
  const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
    run(sql)(`UPDATE staff_suggestion SET status = 'withdrawn'
               WHERE id = $2::uuid AND access_code_id = $1::uuid AND status = 'open' AND ($3::boolean OR author_user_id = $4::uuid) RETURNING id`,
      [actor.orgId, suggestionId, actor.capabilities.has("org.client.view_all"), actor.userId]),
  ]);
  return rows.length > 0;
}

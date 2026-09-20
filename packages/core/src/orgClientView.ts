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

/** Step 5 for one scope ($5). */
const SHARED = `
  EXISTS (SELECT 1 FROM sharing_grant g
           WHERE g.user_id = $1::uuid AND g.access_code_id = $2::uuid AND g.scope = $5::text AND g.revoked_at IS NULL)`;

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
  scopes: Record<SharingScope, { shared: boolean; sharedAt: string | null; requestPending: boolean }>;
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
  const [who, grants, requests] = await runScoped<[Row[], { scope: string; granted_at: string }[], { scope: string }[]]>(
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
        `SELECT g.scope, g.granted_at FROM sharing_grant g
          WHERE g.user_id = $1::uuid AND g.access_code_id = $2::uuid AND g.revoked_at IS NULL AND ${IN_REACH}`,
        params(actor, clientId)
      ),
      run(sql)(
        `SELECT sr.scope FROM sharing_request sr
          WHERE sr.user_id = $1::uuid AND sr.access_code_id = $2::uuid AND sr.status = 'pending' AND ${IN_REACH}`,
        params(actor, clientId)
      ),
    ]
  );
  const row = who[0];
  if (!row) return { ok: false, reason: "not_in_reach_or_not_member" };
  const scopes = {} as ClientHeader["scopes"];
  for (const s of SHARING_SCOPES) {
    const g = grants.find((x) => x.scope === s);
    scopes[s] = { shared: !!g, sharedAt: g?.granted_at ?? null, requestPending: requests.some((x) => x.scope === s) };
  }
  return {
    ok: true,
    rows: [{
      userId: row.id, name: row.name, email: row.email, currentStage: row.current_stage ?? 0,
      joinedAt: row.joined_at, assignedStaffId: row.staff_id, assignedStaffName: row.staff_name, scopes,
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
    `SELECT ja.id, ja.job_title, ja.company, ja.location, ja.employment_type, ja.status,
            ja.status_updated_at, ja.applied_at, ja.follow_up_at, ja.hired_at, ja.apply_url,
            (ja.resume_artifact_id IS NOT NULL) AS has_tailored_resume,
            (ja.cover_letter_artifact_id IS NOT NULL) AS has_cover_letter,
            ja.created_at, ja.updated_at
       FROM job_application ja
      WHERE ja.user_id = $1::uuid`
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
       FROM refinery_artifact ra
      WHERE ra.user_id = $1::uuid AND ra.artifact_type = '${artifactType}'`
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

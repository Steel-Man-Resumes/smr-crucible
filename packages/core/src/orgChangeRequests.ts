/**
 * Change requests (lane S4, migration 109): a staff member asks the people who
 * run the organization (the owner and org admins) for a change to fields,
 * layouts, shared views, programs and sites, the words, or what staff may
 * change for themselves. Managers answer (yes, no with a reason, done) and
 * both sides can reply. Every step lands in the other side's inbox.
 *
 * WHO, as the database states it (109): any staff member asks, as themselves;
 * they read their own requests; the owner and org admins read all of them and
 * are the only ones who change a status or an answer. "Manager" here is
 * exactly smr_org_manager: the owner or an org_admin. (Staff side S3 gives
 * org admins org.settings.manage too, so the two agree.)
 *
 * No participant data: a request is about how the organization works. The
 * form says so ("leave out people's names and record details").
 */
import { runScoped } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { scopeOf, run } from "./orgWorkflowSql";
import {
  UUID_PATTERN, changeRequestTarget, checkChangeMove, checkChangeRequestDraft, checkCommentBody, isChangeRequestStatus, teamTalkErrorLine,
  CHANGE_BODY_MAX, type ChangeRequestKind, type ChangeRequestStatus,
} from "./teamTalkShared";

/** Owner or org admin, acting as themselves: the database's smr_org_manager. */
export const isOrgManager = (a: OrgActor) => !a.viaPlatformAdmin && (a.role === "owner" || a.role === "org_admin");
const canAsk = (a: OrgActor) => !a.viaPlatformAdmin;

export interface ChangeRequest {
  id: string; kind: ChangeRequestKind; title: string; body: string | null; target: string | null;
  status: ChangeRequestStatus; answer: string | null;
  requested_by: string | null; requested_by_name: string | null;
  answered_by_name: string | null; answered_at: string | null;
  created_at: string; updated_at: string; reply_count: number; mine: boolean;
}
export interface ChangeReply { id: string; author_user_id: string | null; author_name: string | null; body: string; created_at: string }
/** One answer: who moved it, from what to what, with what words (109 review round 2). */
export interface ChangeEvent { from_status: ChangeRequestStatus; to_status: ChangeRequestStatus; answer: string | null; actor_name: string | null; at: string }

const COLS = `q.id, q.kind, q.title, q.body, q.target, q.status, q.answer, q.requested_by, rb.name AS requested_by_name,
  ab.name AS answered_by_name, q.answered_at, q.created_at, q.updated_at,
  (SELECT count(*)::int FROM org_change_reply r WHERE r.request_id = q.id) AS reply_count,
  (q.requested_by = $2::uuid) AS mine`;
const FROM = `FROM org_change_request q LEFT JOIN users rb ON rb.id = q.requested_by LEFT JOIN users ab ON ab.id = q.answered_by`;

/** $1 org, $2 me, $3 queue (managers: everyone's), $4 status filter or NULL ('active' = open or accepted). Exported for the database test. */
export const LIST_CHANGE_REQUESTS_SQL = `SELECT ${COLS} ${FROM}
 WHERE q.access_code_id = $1::uuid
   AND ($3::boolean OR q.requested_by = $2::uuid)
   AND (CASE WHEN $4::text IS NULL THEN true WHEN $4::text = 'active' THEN q.status IN ('open', 'accepted') ELSE q.status = $4::text END)
 ORDER BY (q.status IN ('open', 'accepted')) DESC, q.created_at DESC
 LIMIT 200`;

export async function listChangeRequests(actor: OrgActor, opts: { view?: "mine" | "queue"; status?: string | null } = {}): Promise<ChangeRequest[] | null> {
  if (!canAsk(actor)) return null;
  const queue = opts.view === "queue";
  if (queue && !isOrgManager(actor)) return null;
  const status = opts.status === "active" || isChangeRequestStatus(opts.status) ? opts.status : null;
  const [rows] = await runScoped<[ChangeRequest[]]>(scopeOf(actor), (sql) => [
    run(sql)(LIST_CHANGE_REQUESTS_SQL, [actor.orgId, actor.userId, queue, status]),
  ]);
  return rows;
}

/** $1 org, $2 me, $3 request, $4 manager. Exported for the database test. */
export const CHANGE_EVENTS_SQL = `SELECT e.from_status, e.to_status, e.answer, u.name AS actor_name, e.at
  FROM org_change_request_event e JOIN org_change_request q ON q.id = e.request_id LEFT JOIN users u ON u.id = e.actor_user_id
 WHERE e.request_id = $3::uuid AND q.access_code_id = $1::uuid AND ($4::boolean OR q.requested_by = $2::uuid)
 ORDER BY e.at, e.id`;

export async function getChangeRequest(actor: OrgActor, id: string): Promise<{ request: ChangeRequest; replies: ChangeReply[]; events: ChangeEvent[] } | null> {
  if (!canAsk(actor) || !UUID_PATTERN.test(id)) return null;
  const [req, replies, events] = await runScoped<[ChangeRequest[], ChangeReply[], ChangeEvent[]]>(scopeOf(actor), (sql) => [
    run(sql)(`SELECT ${COLS} ${FROM} WHERE q.access_code_id = $1::uuid AND q.id = $3::uuid AND ($4::boolean OR q.requested_by = $2::uuid)`,
      [actor.orgId, actor.userId, id, isOrgManager(actor)]),
    run(sql)(`SELECT r.id, r.author_user_id, u.name AS author_name, r.body, r.created_at
                FROM org_change_reply r JOIN org_change_request q ON q.id = r.request_id LEFT JOIN users u ON u.id = r.author_user_id
               WHERE r.request_id = $3::uuid AND q.access_code_id = $1::uuid AND ($4::boolean OR q.requested_by = $2::uuid)
               ORDER BY r.created_at`, [actor.orgId, actor.userId, id, isOrgManager(actor)]),
    run(sql)(CHANGE_EVENTS_SQL, [actor.orgId, actor.userId, id, isOrgManager(actor)]),
  ]);
  return req[0] ? { request: req[0], replies, events } : null;
}

export type ChangeWrite = { ok: true; id: string } | { ok: false; error: string };

/**
 * Ask for a change. `target` is the page it came from (optional, a /dashboard
 * path). This is the call behind "Suggest a change to your organization" (S2)
 * and behind a t.ROY draft the staff member sends with their own click (S1/S3).
 */
export async function createChangeRequest(actor: OrgActor, input: { kind?: unknown; title?: unknown; body?: unknown; target?: unknown }): Promise<ChangeWrite> {
  if (!canAsk(actor)) return { ok: false, error: "You do not have access to that." };
  const draft = checkChangeRequestDraft(input);
  if (!draft.ok) return draft;
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`INSERT INTO org_change_request (access_code_id, requested_by, kind, title, body, target)
                VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6) RETURNING id`,
        [actor.orgId, actor.userId, draft.kind, draft.title, draft.body, changeRequestTarget(input.target)]),
    ]);
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, error: "That did not save. Try again in a moment." };
  } catch (e) {
    return { ok: false, error: teamTalkErrorLine((e as Error)?.message) };
  }
}

/** A manager answers: a new status, and/or the answer text. A "no" needs a reason. */
export async function answerChangeRequest(actor: OrgActor, id: string, input: { status?: unknown; answer?: unknown }): Promise<ChangeWrite> {
  if (!isOrgManager(actor)) return { ok: false, error: "Only the owner or an admin answers change requests." };
  if (!UUID_PATTERN.test(id)) return { ok: false, error: "That request is not here." };
  const answer = typeof input.answer === "string" ? input.answer.trim() || null : null;
  if (answer && answer.length > CHANGE_BODY_MAX) return { ok: false, error: `Keep the answer under ${CHANGE_BODY_MAX} characters.` };
  const [cur] = await runScoped<[{ status: ChangeRequestStatus; answer: string | null }[]]>(scopeOf(actor), (sql) => [
    run(sql)(`SELECT status, answer FROM org_change_request WHERE id = $2::uuid AND access_code_id = $1::uuid`, [actor.orgId, id]),
  ]);
  if (!cur[0]) return { ok: false, error: "That request is not here." };
  const to = isChangeRequestStatus(input.status) ? input.status : cur[0].status;
  const finalAnswer = answer ?? cur[0].answer;
  // A "no" needs words given now, different from any earlier answer (review N4).
  const fresh = !!answer && answer.trim() !== (cur[0].answer ?? "").trim();
  const bad = checkChangeMove(cur[0].status, to, finalAnswer, to === "declined" && cur[0].status !== "declined" ? fresh : true);
  if (bad) return { ok: false, error: bad };
  if (to === cur[0].status && finalAnswer === cur[0].answer) return { ok: false, error: "Nothing changed." };
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`UPDATE org_change_request SET status = $3, answer = $4
                 WHERE id = $2::uuid AND access_code_id = $1::uuid AND status = $5 RETURNING id`,
        [actor.orgId, id, to, finalAnswer, cur[0].status]),
    ]);
    return rows[0] ? { ok: true, id } : { ok: false, error: "Someone answered it a moment ago. Open it again to see the answer." };
  } catch (e) {
    return { ok: false, error: teamTalkErrorLine((e as Error)?.message) };
  }
}

/** The asker or a manager adds a reply under a request. */
export async function replyToChangeRequest(actor: OrgActor, id: string, bodyIn: unknown): Promise<ChangeWrite> {
  if (!canAsk(actor)) return { ok: false, error: "You do not have access to that." };
  if (!UUID_PATTERN.test(id)) return { ok: false, error: "That request is not here." };
  const body = checkCommentBody(bodyIn);
  if (!body.ok) return body;
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`INSERT INTO org_change_reply (request_id, access_code_id, author_user_id, body)
                SELECT q.id, $1::uuid, $2::uuid, $4 FROM org_change_request q
                 WHERE q.id = $3::uuid AND q.access_code_id = $1::uuid AND ($5::boolean OR q.requested_by = $2::uuid)
                RETURNING id`, [actor.orgId, actor.userId, id, body.body, isOrgManager(actor)]),
    ]);
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, error: "Only the person who asked, the owner or an admin replies here." };
  } catch (e) {
    return { ok: false, error: teamTalkErrorLine((e as Error)?.message) };
  }
}

/**
 * Supervisor review of case notes (lane S4, migration 109). Optional, per
 * organization: org_profile.modules.note_review, default off.
 *
 * The path (as the clinical tools do it): a note is written (not sent for
 * review yet), its author sends it for review (pending, read-only), and the
 * owner or an org admin who did not write it approves it (locked) or sends it
 * back with a comment they must write. The author corrects it (the earlier
 * wording is kept, as always) and sends it again.
 *
 * Every move is a SECURITY DEFINER function in the database
 * (smr_note_review_submit / smr_note_review_decide): the app cannot write
 * note_review or its events directly. The lock is a trigger on case_note.
 * Reads are reach-scoped twice (here and the restrictive policy).
 */
import { runScoped } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { scopeOf, run, reachParams, consentName } from "./orgWorkflowSql";
import { actorReaches } from "./teamTalkSql";
import { isOrgManager } from "./orgChangeRequests";
import { NOTE_REVIEW_REASONS, NOTE_REVIEW_COMMENT_MAX, UUID_PATTERN, type NoteReviewStatus } from "./teamTalkShared";

const canView = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.client.view_content");

export interface NoteReviewEvent { to_status: NoteReviewStatus; from_status: NoteReviewStatus | null; actor_name: string | null; comment: string | null; at: string }
export interface NoteReviewState { note_id: string; status: NoteReviewStatus; updated_at: string; events: NoteReviewEvent[] }
export interface NoteReviews { enabled: boolean; reviewer: boolean; reviews: NoteReviewState[] }

/** $1 org, $2 sees all, $3 me, $4 person. */
export const NOTE_REVIEWS_SQL = `SELECT r.note_id, r.status, r.updated_at,
    COALESCE((SELECT json_agg(json_build_object('to_status', e.to_status, 'from_status', e.from_status, 'actor_name', u.name, 'comment', e.comment, 'at', e.at) ORDER BY e.at)
                FROM note_review_event e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.note_id = r.note_id), '[]'::json) AS events
  FROM note_review r
 WHERE r.access_code_id = $1::uuid AND r.participant_user_id = $4::uuid AND ${actorReaches("$4::uuid")}`;

/** Reviews for one person's notes, and whether the module is on and the viewer reviews. Empty when 109 is not applied. */
export async function listNoteReviews(actor: OrgActor, participantId: string): Promise<NoteReviews | null> {
  if (!canView(actor) || !UUID_PATTERN.test(participantId)) return null;
  try {
    const [on, rows] = await runScoped<[{ enabled: boolean }[], NoteReviewState[]]>(scopeOf(actor), (sql) => [
      run(sql)(`SELECT public.smr_note_review_on($1::uuid) AS enabled`, [actor.orgId]),
      run(sql)(NOTE_REVIEWS_SQL, [...reachParams(actor), participantId]),
    ]);
    return { enabled: !!on[0]?.enabled, reviewer: isOrgManager(actor), reviews: rows };
  } catch {
    return { enabled: false, reviewer: false, reviews: [] };
  }
}

export interface ReviewQueueItem { note_id: string; participant_user_id: string; participant_name: string | null; author_name: string | null; kind: string; waiting_since: string }

/** Notes waiting for review, for the owner and org admins. $1 org, $2 sees all, $3 me. */
export const REVIEW_QUEUE_SQL = `SELECT r.note_id, r.participant_user_id, ${consentName("r.participant_user_id")} AS participant_name,
    au.name AS author_name, n.kind, r.updated_at AS waiting_since
  FROM note_review r JOIN case_note n ON n.id = r.note_id LEFT JOIN users au ON au.id = n.author_user_id
 WHERE r.access_code_id = $1::uuid AND r.status = 'pending' AND n.author_user_id IS DISTINCT FROM $3::uuid
   AND ${actorReaches("r.participant_user_id")}
 ORDER BY r.updated_at
 LIMIT 200`;

export async function listReviewQueue(actor: OrgActor): Promise<ReviewQueueItem[] | null> {
  if (!isOrgManager(actor) || !canView(actor)) return null;
  try {
    const [rows] = await runScoped<[ReviewQueueItem[]]>(scopeOf(actor), (sql) => [run(sql)(REVIEW_QUEUE_SQL, [...reachParams(actor)])]);
    return rows;
  } catch {
    return [];
  }
}

export type ReviewWrite = { ok: true } | { ok: false; error: string };
const say = (word: string | null | undefined) => NOTE_REVIEW_REASONS[word ?? ""] ?? NOTE_REVIEW_REASONS.refused;

export async function submitNoteForReview(actor: OrgActor, noteId: string): Promise<ReviewWrite> {
  if (!canView(actor) || !actor.capabilities.has("org.note.write")) return { ok: false, error: "You do not have access to that." };
  if (!UUID_PATTERN.test(noteId)) return { ok: false, error: say("not_found") };
  const [rows] = await runScoped<[{ r: string }[]]>(scopeOf(actor), (sql) => [run(sql)(`SELECT public.smr_note_review_submit($1::uuid) AS r`, [noteId])]);
  return rows[0]?.r === "ok" ? { ok: true } : { ok: false, error: say(rows[0]?.r) };
}

export async function decideNoteReview(actor: OrgActor, noteId: string, input: { decision: unknown; comment?: unknown }): Promise<ReviewWrite> {
  if (!isOrgManager(actor) || !canView(actor)) return { ok: false, error: say("not_reviewer") };
  if (!UUID_PATTERN.test(noteId)) return { ok: false, error: say("not_found") };
  const decision = input.decision === "approve" || input.decision === "send_back" ? input.decision : null;
  if (!decision) return { ok: false, error: say("refused") };
  const comment = typeof input.comment === "string" ? input.comment.trim() : "";
  if (decision === "send_back" && (comment.length < 3 || comment.length > NOTE_REVIEW_COMMENT_MAX)) return { ok: false, error: say("needs_comment") };
  const [rows] = await runScoped<[{ r: string }[]]>(scopeOf(actor), (sql) => [
    run(sql)(`SELECT public.smr_note_review_decide($1::uuid, $2::text, $3::text) AS r`, [noteId, decision, comment || null]),
  ]);
  return rows[0]?.r === "ok" ? { ok: true } : { ok: false, error: say(rows[0]?.r) };
}

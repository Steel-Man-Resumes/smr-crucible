/**
 * Team comments (lane S4, migration 109): staff talking to each other about a
 * person, or about nothing in particular (a team thread), with @mentions.
 *
 * WHO. Staff of the organization only; never the participant, never a
 * platform admin acting from outside. A comment about a person is read and
 * written only while the reader reaches that person (app check here, the
 * restrictive policy team_comment_reach in the database).
 *
 * MENTIONS are user ids. A mention of a colleague who cannot reach the person
 * is refused with a plain sentence that names them, before anything is
 * written; the database refuses it again if the app check is ever skipped.
 *
 * NEVER DELETED. A correction keeps the earlier wording (team_comment_version,
 * written by the trigger), like case notes.
 *
 * MODELS. Comment bodies are staff-written free text. Nothing in this module
 * sends them anywhere. A t.ROY tool that ever reads them must pass each body
 * through the staff record gate (apps/consumer/lib/staff-ai-safety.ts
 * staffTextGate), exactly as case-note bodies are; the app's
 * lib/team-talk-safety.ts does that in one call.
 */
import { runScoped } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { scopeOf, run, reachParams } from "./orgWorkflowSql";
import { actorReaches, colleagueReaches, TEAM_SQL } from "./teamTalkSql";
import { UUID_PATTERN, checkCommentBody, normalizeMentions, mentionRefusedLine, teamTalkErrorLine } from "./teamTalkShared";

const canTalk = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.client.view_content");

export interface TeamComment {
  id: string;
  participant_user_id: string | null;
  parent_id: string | null;
  author_user_id: string | null;
  author_name: string | null;
  body: string;
  mentioned: { id: string; name: string | null }[];
  created_at: string;
  edited_at: string | null;
  earlier_count: number;
}

export type CommentsResult =
  | { ok: true; comments: TeamComment[] }
  | { ok: false; reason: "no_capability" | "not_in_reach_or_not_member" };

/** $4 the person, or NULL for the team thread. Exported so the database test runs it. */
export const LIST_COMMENTS_SQL = `SELECT c.id, c.participant_user_id, c.parent_id, c.author_user_id, au.name AS author_name, c.body,
    COALESCE((SELECT json_agg(json_build_object('id', mu.id, 'name', mu.name) ORDER BY mu.name)
                FROM users mu WHERE mu.id = ANY (c.mentions)), '[]'::json) AS mentioned,
    c.created_at, c.edited_at,
    (SELECT count(*)::int FROM team_comment_version v WHERE v.comment_id = c.id) AS earlier_count
  FROM team_comment c LEFT JOIN users au ON au.id = c.author_user_id
 WHERE c.access_code_id = $1::uuid
   AND (CASE WHEN $4::uuid IS NULL THEN c.participant_user_id IS NULL
             ELSE c.participant_user_id = $4::uuid AND ${actorReaches("$4::uuid")} END)
 ORDER BY c.created_at
 LIMIT 400`;

const GATE_SQL = `SELECT (CASE WHEN $4::uuid IS NULL THEN true ELSE ${actorReaches("$4::uuid")} END) AS ok`;

export async function listTeamComments(actor: OrgActor, participantId: string | null): Promise<CommentsResult> {
  if (!canTalk(actor)) return { ok: false, reason: "no_capability" };
  if (participantId !== null && !UUID_PATTERN.test(participantId)) return { ok: false, reason: "not_in_reach_or_not_member" };
  const params = [...reachParams(actor), participantId];
  const [gate, rows] = await runScoped<[{ ok: boolean }[], TeamComment[]]>(scopeOf(actor), (sql) => [
    run(sql)(GATE_SQL, params),
    run(sql)(LIST_COMMENTS_SQL, params),
  ]);
  if (!gate[0]?.ok) return { ok: false, reason: "not_in_reach_or_not_member" };
  return { ok: true, comments: rows };
}

export interface Colleague { user_id: string; name: string | null; role: string; reaches: boolean }

/**
 * Who can be mentioned (or given a task) about this person: everyone on the
 * team, each marked with whether they reach the person. The author is left out.
 * $4 the person or NULL.
 */
export const COLLEAGUES_SQL = `SELECT DISTINCT ON (t.user_id) t.user_id, u.name, t.role, ${colleagueReaches("t.user_id", "$4::uuid")} AS reaches
  FROM ${TEAM_SQL} t JOIN users u ON u.id = t.user_id
 WHERE t.user_id <> $3::uuid
   AND $2::boolean IS NOT NULL -- (every parameter is typed; $2 is unused here)
 ORDER BY t.user_id, (t.role = 'owner') DESC`;

export async function listColleagues(actor: OrgActor, participantId: string | null): Promise<Colleague[] | null> {
  if (!canTalk(actor)) return null;
  if (participantId !== null && !UUID_PATTERN.test(participantId)) return null;
  const [gate, rows] = await runScoped<[{ ok: boolean }[], Colleague[]]>(scopeOf(actor), (sql) => [
    run(sql)(GATE_SQL, [...reachParams(actor), participantId]),
    run(sql)(COLLEAGUES_SQL, [...reachParams(actor), participantId]),
  ]);
  if (!gate[0]?.ok) return null;
  return rows.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

/** Pure: which of the asked-for mentions are refused, and the sentence to show. */
export function refuseMentions(asked: readonly string[], colleagues: readonly Colleague[]): string | null {
  for (const id of asked) {
    const c = colleagues.find((x) => x.user_id.toLowerCase() === id.toLowerCase());
    if (!c) return mentionRefusedLine(null, "not_team");
    if (!c.reaches) return mentionRefusedLine(c.name, "out_of_reach");
  }
  return null;
}

export type CommentWrite = { ok: true; id: string } | { ok: false; error: string };

export async function addTeamComment(actor: OrgActor, input: { participantId?: string | null; parentId?: string | null; body: unknown; mentions?: unknown }): Promise<CommentWrite> {
  if (!canTalk(actor)) return { ok: false, error: "You do not have access to that." };
  const participantId = input.participantId ?? null;
  if (participantId !== null && !UUID_PATTERN.test(participantId)) return { ok: false, error: "That person is not on your caseload." };
  const parentId = input.parentId ?? null;
  if (parentId !== null && !UUID_PATTERN.test(parentId)) return { ok: false, error: "That comment is not here." };
  const body = checkCommentBody(input.body);
  if (!body.ok) return body;
  const mentions = normalizeMentions(input.mentions, actor.userId);
  if (mentions.length) {
    const colleagues = await listColleagues(actor, participantId);
    if (!colleagues) return { ok: false, error: "That person is not on your caseload." };
    const refused = refuseMentions(mentions, colleagues);
    if (refused) return { ok: false, error: refused };
  }
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `INSERT INTO team_comment (access_code_id, participant_user_id, parent_id, author_user_id, body, mentions)
         SELECT $1::uuid, $4::uuid, $5::uuid, $3::uuid, $6, $7::uuid[]
          WHERE $4::uuid IS NULL OR ${actorReaches("$4::uuid")}
         RETURNING id`,
        [...reachParams(actor), participantId, parentId, body.body, mentions]
      ),
    ]);
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, error: "That person is not on your caseload." };
  } catch (e) {
    return { ok: false, error: teamTalkErrorLine((e as Error)?.message) };
  }
}

/** Correct your own comment. The earlier wording is kept. Mentions: omitted keeps them; given replaces them (new ones are checked). */
export async function correctTeamComment(actor: OrgActor, commentId: string, input: { body: unknown; mentions?: unknown }): Promise<CommentWrite> {
  if (!canTalk(actor)) return { ok: false, error: "You do not have access to that." };
  if (!UUID_PATTERN.test(commentId)) return { ok: false, error: "That comment is not here." };
  const body = checkCommentBody(input.body);
  if (!body.ok) return body;
  const mentions = input.mentions === undefined ? null : normalizeMentions(input.mentions, actor.userId);
  if (mentions && mentions.length) {
    const [found] = await runScoped<[{ participant_user_id: string | null }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`SELECT participant_user_id FROM team_comment WHERE id = $2::uuid AND access_code_id = $1::uuid AND author_user_id = $3::uuid`,
        [actor.orgId, commentId, actor.userId]),
    ]);
    if (!found[0]) return { ok: false, error: "Only the person who wrote a comment can correct it." };
    const colleagues = await listColleagues(actor, found[0].participant_user_id);
    if (!colleagues) return { ok: false, error: "That person is not on your caseload." };
    const refused = refuseMentions(mentions, colleagues);
    if (refused) return { ok: false, error: refused };
  }
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `UPDATE team_comment c SET body = $5, mentions = COALESCE($6::uuid[], c.mentions)
          WHERE c.id = $4::uuid AND c.access_code_id = $1::uuid AND c.author_user_id = $3::uuid
            AND (c.participant_user_id IS NULL OR ${actorReaches("c.participant_user_id")})
            AND (c.body IS DISTINCT FROM $5 OR c.mentions IS DISTINCT FROM COALESCE($6::uuid[], c.mentions))
          RETURNING c.id`,
        [...reachParams(actor), commentId, body.body, mentions]
      ),
    ]);
    return rows[0] ? { ok: true, id: rows[0].id }
      : { ok: false, error: "Nothing changed. Only the person who wrote a comment can correct it, and the wording has to be different." };
  } catch (e) {
    return { ok: false, error: teamTalkErrorLine((e as Error)?.message) };
  }
}

export interface CommentVersion { body: string; replaced_at: string; replaced_by_name: string | null }

/** Every earlier wording of a comment, newest first, for anyone who can read the comment. */
export async function getTeamCommentHistory(actor: OrgActor, commentId: string): Promise<CommentVersion[] | null> {
  if (!canTalk(actor) || !UUID_PATTERN.test(commentId)) return null;
  const [visible, rows] = await runScoped<[{ ok: boolean }[], CommentVersion[]]>(scopeOf(actor), (sql) => [
    run(sql)(`SELECT EXISTS (SELECT 1 FROM team_comment c WHERE c.id = $4::uuid AND c.access_code_id = $1::uuid
                AND (c.participant_user_id IS NULL OR ${actorReaches("c.participant_user_id")})) AS ok`, [...reachParams(actor), commentId]),
    run(sql)(`SELECT v.body, v.replaced_at, u.name AS replaced_by_name
                FROM team_comment_version v JOIN team_comment c ON c.id = v.comment_id LEFT JOIN users u ON u.id = v.replaced_by
               WHERE v.comment_id = $4::uuid AND c.access_code_id = $1::uuid
                 AND (c.participant_user_id IS NULL OR ${actorReaches("c.participant_user_id")})
               ORDER BY v.replaced_at DESC`, [...reachParams(actor), commentId]),
  ]);
  return visible[0]?.ok ? rows : null;
}

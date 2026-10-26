/**
 * The staff t.ROY skill-run log (migration 106, house build L6).
 *
 * Every staff answer writes one row: who asked, which skill, about whom (NULL
 * for caseload skills), a short input summary the APP has already put through
 * the record-word gate (lib/staff-ai-safety.ts skillRunInputSummary), the
 * names of the tools that ran, and a sha256 of the answer. Never the answer,
 * never a tool result.
 *
 * ACCEPTANCE is a staff member's own click: saving a t.ROY draft as a note,
 * or copying an answer to use it. Only the person who ran it, only once. The
 * database enforces both (106 guard trigger and update policy); the checks
 * here only keep a refused write from becoming an error page.
 *
 * Everything runs through runScoped as the actor, so the 106 policies (org,
 * actor, reach) decide what is written and read.
 */
import { createHash } from "node:crypto";
import { runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Skill ids the log accepts (the 106 CHECK is the same shape). "staff-general" = no skill chosen. */
export const SKILL_RUN_ID = /^staff-[a-z][a-z-]{1,40}$/;
export const GENERAL_STAFF_SKILL = "staff-general";

/** sha256 of the answer text, lower-case hex. The answer itself is never stored. */
export function skillOutputHash(text: string): string {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

export interface SkillRunInput {
  skill: string;
  /** The participant the run was about, or null for a caseload skill. */
  participantId: string | null;
  /** Already through the record-word gate, by the app. Cut to 300 here. */
  inputSummary: string;
  /** Names of the tools that ran, in order. */
  tools: readonly string[];
  /** The answer as shown; only its hash is kept. */
  output: string;
}

/** The row as the 106 table takes it. Pure, so the shape and limits are tested without a database. */
export function skillRunRow(input: SkillRunInput) {
  const skill = SKILL_RUN_ID.test(input.skill) ? input.skill : GENERAL_STAFF_SKILL;
  const participant = input.participantId && UUID.test(input.participantId) ? input.participantId.toLowerCase() : null;
  const summary = String(input.inputSummary ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || skill;
  const tools = [...new Set((input.tools ?? []).filter((t) => /^[a-z_]{3,60}$/.test(t)))].slice(0, 12);
  return { skill, participant, summary, tools, outputHash: skillOutputHash(input.output) };
}

/**
 * Write the run. Returns its id, or null when it could not be written (the
 * caller reports that and still shows the answer: the participant's access
 * log is written by the reads themselves, fail-closed, as before).
 */
export async function logSkillRun(actor: OrgActor, input: SkillRunInput): Promise<string | null> {
  if (actor.viaPlatformAdmin) return null;
  const r = skillRunRow(input);
  const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `INSERT INTO ai_skill_run (access_code_id, actor_user_id, skill, participant_user_id, input_summary, tools, output_hash)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6::text[], $7) RETURNING id`,
      [actor.orgId, actor.userId, r.skill, r.participant, r.summary, r.tools, r.outputHash]
    ),
  ]);
  return rows[0]?.id ?? null;
}

/** Mark a run used, by the person who ran it, once. False when it is not theirs, not found, or already accepted. */
export async function acceptSkillRun(actor: OrgActor, runId: string): Promise<boolean> {
  if (actor.viaPlatformAdmin || !UUID.test(String(runId ?? ""))) return false;
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `UPDATE ai_skill_run SET accepted_by = $3::uuid, accepted_at = now()
          WHERE id = $1::uuid AND access_code_id = $2::uuid AND actor_user_id = $3::uuid AND accepted_at IS NULL
          RETURNING id`,
        [runId, actor.orgId, actor.userId]
      ),
    ]);
    return rows.length === 1;
  } catch {
    return false;
  }
}

export interface SkillRunRow {
  id: string; skill: string; actor_user_id: string | null; participant_user_id: string | null;
  input_summary: string; tools: string[]; output_hash: string; accepted_by: string | null; accepted_at: string | null; at: string;
}

/**
 * Runs the actor may read: their own; every run in the organization for the
 * owner and org admins (the 106 select policy decides, not this filter). The
 * audit screen (lane L3b) can list these beside the activity log.
 */
export async function listSkillRuns(actor: OrgActor, opts: { participantId?: string; limit?: number } = {}): Promise<SkillRunRow[]> {
  if (actor.viaPlatformAdmin) return [];
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 100)));
  const [rows] = await runScoped<[SkillRunRow[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `SELECT id, skill, actor_user_id, participant_user_id, input_summary, tools, output_hash, accepted_by, accepted_at, at
         FROM ai_skill_run
        WHERE access_code_id = $1::uuid AND ($2::uuid IS NULL OR participant_user_id = $2::uuid)
        ORDER BY at DESC LIMIT ${limit}`,
      [actor.orgId, opts.participantId && UUID.test(opts.participantId) ? opts.participantId : null]
    ),
  ]);
  return rows;
}

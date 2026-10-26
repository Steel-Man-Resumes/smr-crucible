/**
 * Autosaved drafts (migration 105 staff_draft, lane L5).
 *
 * One unsaved text per staff member, organization, participant and field. The
 * page saves it every 10 seconds while someone types and when they leave the
 * box; it comes back after a refresh or a dropped connection; it is cleared
 * when the real thing is saved.
 *
 * OWNER ONLY. The policy admits a row only to the person who wrote it, in the
 * organization they wrote it in. An admin, the owner and a platform admin
 * looking in all get nothing. A draft about a participant also needs reach
 * (the restrictive policy): lose the person, lose the draft from view.
 */
import { runScoped } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { scopeOf, run, UUID_RE } from "./orgWorkflowSql";
import { draftKindOk, DRAFT_MAX_CHARS } from "./orgWorkflowShared";

const NO_ONE = "00000000-0000-0000-0000-000000000000";
/** A platform admin looking in never writes drafts in someone else's organization. */
const canDraft = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.client.view_content");

export interface StaffDraft { kind: string; body: string; updated_at: string }

function clean(participantId: string | null | undefined): string | null | false {
  if (participantId == null || participantId === "") return null;
  return UUID_RE.test(participantId) ? participantId : false;
}

/** Exported so the database test runs these exact statements. $1 org, $2 actor, $3 participant or NULL, $4 kind. */
export const DRAFT_SQL = {
  get: `SELECT kind, body, updated_at FROM staff_draft
         WHERE user_id = $2::uuid AND access_code_id = $1::uuid
           AND COALESCE(participant_user_id, '${NO_ONE}'::uuid) = COALESCE($3::uuid, '${NO_ONE}'::uuid) AND kind = $4`,
  /** $5 body. Reach is checked by the policy; membership by the policy's WITH CHECK. */
  save: `INSERT INTO staff_draft (user_id, access_code_id, participant_user_id, kind, body)
         VALUES ($2::uuid, $1::uuid, $3::uuid, $4, $5)
         ON CONFLICT (user_id, access_code_id, (COALESCE(participant_user_id, '${NO_ONE}'::uuid)), kind)
         DO UPDATE SET body = EXCLUDED.body
         RETURNING updated_at`,
  clear: `DELETE FROM staff_draft
           WHERE user_id = $2::uuid AND access_code_id = $1::uuid
             AND COALESCE(participant_user_id, '${NO_ONE}'::uuid) = COALESCE($3::uuid, '${NO_ONE}'::uuid) AND kind = $4`,
  /** Every draft untouched for 30 days, anyone's (migration 105, owner-run): run whenever someone saves one. */
  purge: `SELECT public.smr_purge_stale_staff_drafts() AS purged`,
};

export async function getStaffDraft(actor: OrgActor, participantId: string | null, kind: string): Promise<StaffDraft | null> {
  const p = clean(participantId);
  if (!canDraft(actor) || p === false || !draftKindOk(kind)) return null;
  const [rows] = await runScoped<[StaffDraft[]]>(scopeOf(actor), (sql) => [run(sql)(DRAFT_SQL.get, [actor.orgId, actor.userId, p, kind])]);
  return rows[0] ?? null;
}

export async function saveStaffDraft(actor: OrgActor, participantId: string | null, kind: string, body: string):
  Promise<{ ok: true; savedAt: string } | { ok: false; error: string }> {
  const p = clean(participantId);
  if (!canDraft(actor) || p === false || !draftKindOk(kind)) return { ok: false, error: "That cannot be saved as a draft." };
  if (typeof body !== "string") return { ok: false, error: "Nothing to save." };
  if (body.length > DRAFT_MAX_CHARS) return { ok: false, error: "That draft is too long to keep." };
  // An empty box is not a draft: clear instead of storing nothing.
  if (!body.trim()) { await clearStaffDraft(actor, p, kind); return { ok: true, savedAt: new Date().toISOString() }; }
  try {
    const [, rows] = await runScoped<[unknown, { updated_at: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(DRAFT_SQL.purge, []),
      run(sql)(DRAFT_SQL.save, [actor.orgId, actor.userId, p, kind, body]),
    ]);
    return rows[0] ? { ok: true, savedAt: rows[0].updated_at } : { ok: false, error: "That draft did not save." };
  } catch {
    // Not in reach, not a member, or the person left: the policy refused.
    return { ok: false, error: "That draft did not save." };
  }
}

export async function clearStaffDraft(actor: OrgActor, participantId: string | null, kind: string): Promise<boolean> {
  const p = clean(participantId);
  if (!canDraft(actor) || p === false || !draftKindOk(kind)) return false;
  await runScoped(scopeOf(actor), (sql) => [run(sql)(DRAFT_SQL.clear, [actor.orgId, actor.userId, p, kind])]);
  return true;
}

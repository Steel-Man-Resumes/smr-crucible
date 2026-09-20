/**
 * Staff tasks, and the participant's view of the ones shared with them.
 * Reach is enforced in SQL exactly as it is for notes: a case manager sees
 * tasks they own, and tasks about people on their caseload.
 */
import { queryAsUser, runAsUser, runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
const ok = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.task.write");

/** $1 org, $2 sees-all, $3 actor. A task with no participant is reachable by its owner (or someone who sees all). */
const TASK_REACH = `
  (t.owner_user_id = $3::uuid OR $2::boolean
   OR (t.client_user_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM client_staff_assignment a
          WHERE a.access_code_id = $1::uuid AND a.client_user_id = t.client_user_id AND a.staff_user_id = $3::uuid)))`;

export interface StaffTask {
  id: string; title: string; due_on: string | null; client_user_id: string | null; client_name: string | null;
  owner_user_id: string | null; owner_name: string | null; shared_with_participant: boolean;
  done_at: string | null; done_by_participant: boolean; created_at: string;
}
const COLS = `t.id, t.title, to_char(t.due_on, 'YYYY-MM-DD') AS due_on, t.client_user_id, c.name AS client_name, t.owner_user_id, o.name AS owner_name,
  t.shared_with_participant, t.done_at, (t.done_by IS NOT NULL AND t.done_by = t.client_user_id) AS done_by_participant, t.created_at`;

export async function listStaffTasks(actor: OrgActor, opts: { clientId?: string; includeDone?: boolean } = {}): Promise<StaffTask[] | null> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.client.view_content")) return null;
  const [rows] = await runScoped<[StaffTask[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `SELECT ${COLS} FROM staff_task t LEFT JOIN users c ON c.id = t.client_user_id LEFT JOIN users o ON o.id = t.owner_user_id
        WHERE t.access_code_id = $1::uuid AND t.cancelled_at IS NULL AND ${TASK_REACH}
          AND ($4::uuid IS NULL OR t.client_user_id = $4::uuid)
          AND ($5::boolean OR t.done_at IS NULL OR t.done_at > now() - interval '2 days')
        ORDER BY (t.done_at IS NOT NULL), t.due_on NULLS LAST, t.created_at LIMIT 300`,
      [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, opts.clientId ?? null, !!opts.includeDone]
    ),
  ]);
  return rows;
}

export async function addStaffTask(actor: OrgActor, input: { title: string; dueOn?: string | null; clientId?: string | null; shared?: boolean }):
  Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!ok(actor)) return { ok: false, error: "You do not have access to that." };
  const title = (input.title ?? "").trim();
  if (title.length < 2 || title.length > 300) return { ok: false, error: "Say what needs doing, in a line." };
  const due = input.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) ? input.dueOn : null;
  const clientId = input.clientId || null;
  if (input.shared && !clientId) return { ok: false, error: "Only a task about a participant can be shared with them." };
  const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title, due_on, shared_with_participant)
       SELECT $1::uuid, $4::uuid, $3::uuid, $3::uuid, $5, $6::date, $7::boolean
        WHERE $4::uuid IS NULL OR $2::boolean OR EXISTS (
                SELECT 1 FROM client_staff_assignment a
                 WHERE a.access_code_id = $1::uuid AND a.client_user_id = $4::uuid AND a.staff_user_id = $3::uuid)
       RETURNING id`,
      [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, clientId, title, due, !!input.shared]
    ),
  ]);
  return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, error: "That person is not on your caseload." };
}

/** done | reopen | cancel. Only within reach. */
export async function updateStaffTask(actor: OrgActor, taskId: string, action: "done" | "reopen" | "cancel"): Promise<boolean> {
  if (!ok(actor)) return false;
  const set = action === "done" ? "done_at = now(), done_by = $3::uuid" : action === "reopen" ? "done_at = NULL, done_by = NULL" : "cancelled_at = now()";
  const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
    run(sql)(`UPDATE staff_task t SET ${set} WHERE t.id = $4::uuid AND t.access_code_id = $1::uuid AND t.cancelled_at IS NULL AND ${TASK_REACH} RETURNING t.id`,
      [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, taskId]),
  ]);
  return rows.length > 0;
}

/* ------------------------------------------------------------ the participant -- */

export interface MyTask { id: string; title: string; due_on: string | null; done_at: string | null; from_name: string | null; org_name: string | null }

export async function getMySharedTasks(userId: string): Promise<MyTask[]> {
  return queryAsUser<MyTask>(
    userId,
    `SELECT t.id, t.title, to_char(t.due_on, 'YYYY-MM-DD') AS due_on, t.done_at, u.name AS from_name, ac.partner_name AS org_name
       FROM staff_task t LEFT JOIN users u ON u.id = t.created_by LEFT JOIN access_code ac ON ac.id = t.access_code_id
      WHERE t.client_user_id = $1 AND t.shared_with_participant AND t.cancelled_at IS NULL
        AND (t.done_at IS NULL OR t.done_at > now() - interval '7 days')
      ORDER BY (t.done_at IS NOT NULL), t.due_on NULLS LAST`,
    [userId]
  );
}

export async function tickMyTask(userId: string, taskId: string, done: boolean): Promise<boolean> {
  const [rows] = await runAsUser<[{ r: boolean }[]]>(userId, (sql) => [sql`SELECT smr_tick_my_task(${taskId}::uuid, ${done}) AS r`]);
  return !!rows[0]?.r;
}

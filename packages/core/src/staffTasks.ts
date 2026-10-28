/**
 * Staff tasks, and the participant's view of the ones shared with them.
 * Reach is enforced in SQL exactly as it is for notes: a case manager sees
 * tasks they own, and tasks about people on their caseload.
 *
 * HANDING A TASK TO A COLLEAGUE (staff side lane S4, migration 109). A task
 * can be given to someone else on the team when it is made, or handed on
 * later, but only to a team member who reaches the person it is about. Who
 * may hand one on: the person who made it, its current owner, or someone who
 * assigns work (org.client.assign). A task about nobody in particular can be
 * handed on only by someone who sees everyone (102's staff_task_reach). The
 * database repeats every rule (staff_task_assign_guard) and the new owner
 * gets an inbox item.
 */
import { queryAsUser, runAsUser, runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { unitReachSql } from "./orgUnitReach";
import { listColleagues } from "./teamComments";
import { teamTalkErrorLine, UUID_PATTERN } from "./teamTalkShared";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
const ok = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.task.write");

/** $1 org, $2 sees-all, $3 actor. A task with no participant is reachable by its owner (or someone who sees all). */
const TASK_REACH = `
  (t.owner_user_id = $3::uuid OR $2::boolean
   OR (t.client_user_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM client_staff_assignment a
          WHERE a.access_code_id = $1::uuid AND a.client_user_id = t.client_user_id AND a.staff_user_id = $3::uuid))
   OR (t.client_user_id IS NOT NULL AND ${unitReachSql("$1::uuid", "$3::uuid", "t.client_user_id")}))`;

export interface StaffTask {
  id: string; title: string; due_on: string | null; client_user_id: string | null; client_name: string | null;
  owner_user_id: string | null; owner_name: string | null; shared_with_participant: boolean;
  done_at: string | null; done_by_participant: boolean; created_at: string;
  /** "retention" for a check-in task the system made (migration 105), with its placement and day mark. */
  source_kind: string | null; source_id: string | null; source_mark: number | null;
}
const COLS = `t.id, t.title, to_char(t.due_on, 'YYYY-MM-DD') AS due_on, t.client_user_id, c.name AS client_name, t.owner_user_id, o.name AS owner_name,
  t.shared_with_participant, t.done_at, (t.done_by IS NOT NULL AND t.done_by = t.client_user_id) AS done_by_participant, t.created_at,
  t.source_kind, t.source_id, t.source_mark`;

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

export async function addStaffTask(actor: OrgActor, input: { title: string; dueOn?: string | null; clientId?: string | null; shared?: boolean; ownerId?: string | null }):
  Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!ok(actor)) return { ok: false, error: "You do not have access to that." };
  const title = (input.title ?? "").trim();
  if (title.length < 2 || title.length > 300) return { ok: false, error: "Say what needs doing, in a line." };
  const due = input.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) ? input.dueOn : null;
  const clientId = input.clientId || null;
  if (input.shared && !clientId) return { ok: false, error: "Only a task about a participant can be shared with them." };
  // Given to a colleague when it is made (lane S4). Yourself, or nothing, keeps today's behavior.
  let ownerId: string | null = null;
  if (input.ownerId && input.ownerId.toLowerCase() !== actor.userId.toLowerCase()) {
    const refused = await refuseAssignee(actor, clientId, input.ownerId);
    if (refused) return { ok: false, error: refused };
    ownerId = input.ownerId;
  }
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title, due_on, shared_with_participant)
         SELECT $1::uuid, $4::uuid, COALESCE($8::uuid, $3::uuid), $3::uuid, $5, $6::date, $7::boolean
          WHERE $4::uuid IS NULL OR $2::boolean OR EXISTS (
                  SELECT 1 FROM client_staff_assignment a
                   WHERE a.access_code_id = $1::uuid AND a.client_user_id = $4::uuid AND a.staff_user_id = $3::uuid)
             OR ${unitReachSql("$1::uuid", "$3::uuid", "$4::uuid")}
         RETURNING id`,
        [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, clientId, title, due, !!input.shared, ownerId]
      ),
    ]);
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, error: "That person is not on your caseload." };
  } catch (e) {
    return { ok: false, error: teamTalkErrorLine((e as Error)?.message) };
  }
}

/**
 * Why a task about `clientId` cannot go to `ownerId`, in a sentence, or null
 * when it can: the colleague must be on the team and reach the person; a task
 * about nobody goes to a colleague only from someone who sees everyone.
 */
async function refuseAssignee(actor: OrgActor, clientId: string | null, ownerId: string): Promise<string | null> {
  if (!UUID_PATTERN.test(ownerId)) return "A task can only go to someone on your team.";
  if (!clientId && !actor.capabilities.has("org.client.view_all")) {
    return "A task about nobody in particular stays with you. Pick the person it is about to hand it to a colleague.";
  }
  const colleagues = await listColleagues(actor, clientId);
  if (!colleagues) return "That person is not on your caseload.";
  const c = colleagues.find((x) => x.user_id.toLowerCase() === ownerId.toLowerCase());
  if (!c) return "A task can only go to someone on your team.";
  if (!c.reaches) return `${c.name?.trim() || "That team member"} cannot see this person, so the task cannot go to them. Ask an admin to add them first.`;
  return null;
}

/** Someone a task can go to: you, or a colleague who reaches the person. */
export interface TaskAssignee { user_id: string; name: string | null; me: boolean }

/** Who a task about this person (or nobody) can be given to. You first. Null when you cannot write tasks. */
export async function listTaskAssignees(actor: OrgActor, clientId: string | null): Promise<TaskAssignee[] | null> {
  if (!ok(actor)) return null;
  if (clientId !== null && !UUID_PATTERN.test(clientId)) return null;
  const me: TaskAssignee = { user_id: actor.userId, name: null, me: true };
  if (!clientId && !actor.capabilities.has("org.client.view_all")) return [me];
  const colleagues = (await listColleagues(actor, clientId)) ?? [];
  return [me, ...colleagues.filter((c) => c.reaches).map((c) => ({ user_id: c.user_id, name: c.name, me: false }))];
}

/**
 * Hand a task on. Only an open task you can see; only by its maker, its owner,
 * or someone who assigns work; only to a team member who reaches the person.
 */
export async function assignStaffTask(actor: OrgActor, taskId: string, ownerId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ok(actor)) return { ok: false, error: "You do not have access to that." };
  if (!UUID_PATTERN.test(taskId) || !UUID_PATTERN.test(ownerId)) return { ok: false, error: "That task is not yours to change." };
  const params = [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, taskId];
  const [found] = await runScoped<[{ client_user_id: string | null; created_by: string | null; owner_user_id: string | null; done_at: string | null }[]]>(scopeOf(actor), (sql) => [
    run(sql)(`SELECT t.client_user_id, t.created_by, t.owner_user_id, t.done_at FROM staff_task t
               WHERE t.id = $4::uuid AND t.access_code_id = $1::uuid AND t.cancelled_at IS NULL AND ${TASK_REACH}`, params),
  ]);
  const t = found[0];
  if (!t) return { ok: false, error: "That task is not yours to change." };
  const me = actor.userId.toLowerCase();
  if (!(t.created_by?.toLowerCase() === me || t.owner_user_id?.toLowerCase() === me || actor.capabilities.has("org.client.assign"))) {
    return { ok: false, error: "Only the person who made a task, its owner, or someone who assigns work can hand it on." };
  }
  if (t.done_at) return { ok: false, error: "A finished task stays where it is." };
  if (t.owner_user_id?.toLowerCase() === ownerId.toLowerCase()) return { ok: false, error: "It is already theirs." };
  if (ownerId.toLowerCase() !== me) {
    const refused = await refuseAssignee(actor, t.client_user_id, ownerId);
    if (refused) return { ok: false, error: refused };
  }
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`UPDATE staff_task t SET owner_user_id = $5::uuid
                 WHERE t.id = $4::uuid AND t.access_code_id = $1::uuid AND t.cancelled_at IS NULL AND t.done_at IS NULL
                   AND t.owner_user_id IS NOT DISTINCT FROM $6::uuid AND ${TASK_REACH}
                 RETURNING t.id`, [...params, ownerId, t.owner_user_id]),
    ]);
    return rows[0] ? { ok: true } : { ok: false, error: "Someone changed this task a moment ago. Open it again." };
  } catch (e) {
    return { ok: false, error: teamTalkErrorLine((e as Error)?.message) };
  }
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

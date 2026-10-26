/**
 * Caseload-wide reads for staff t.ROY (house build L6). READ ONLY.
 *
 * Every read here goes through a scoped reader that already exists
 * (getPartnerCohort, listStaffTasks, listOutcomes, listSharingRequests) or
 * through runScoped as the actor with a reach predicate in the SQL. The
 * predicate is lane L3b's smr_staff_reach(org, staff, participant) when that
 * function exists (migration 102, replaced by 103), and the app's own
 * assigned-or-sees-all rule before that. Tables other lanes add in this build
 * (enrollment 103, custom fields 104, referral 105) are read only when they
 * exist; a missing table means "not set up here", never an error page.
 *
 * WHAT IS NEVER READ: note bodies (only the date of the newest note per
 * person), wages, anything a participant has not shared, anything from
 * another organization. Free text the app may still return (task titles,
 * referral reasons, custom field values) goes through the record-word gate in
 * the app before the model sees it (apps/consumer/lib/staff-ai-safety.ts).
 *
 * Pure builders (buildCaseloadDigest, summarizeOutcomesForPeriod) carry the
 * rules, so they are tested with dated fixtures and no database.
 */
import { query, runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { getPartnerCohort } from "./partnerDashboard";
import { getQuietAfterDays } from "./orgStaffPerformance";
import { listStaffTasks } from "./staffTasks";
import { listOutcomes, summarizeOutcomes, OUTCOME_SOURCE_LABELS, type Outcome } from "./orgOutcomes";
import { listSharingRequests } from "./orgClientView";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
const DAY_MS = 86_400_000;
const first = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || null;
const ymd = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : null);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------- reach -- */

let reachFn: { at: number; has: boolean } | null = null;
/** Is lane L3b's smr_staff_reach on this database? Cached five minutes. */
export async function hasStaffReachFunction(): Promise<boolean> {
  if (reachFn && Date.now() - reachFn.at < 300_000) return reachFn.has;
  const [row] = await query<{ has: boolean }>(`SELECT to_regprocedure('public.smr_staff_reach(uuid,uuid,uuid)') IS NOT NULL AS has`);
  reachFn = { at: Date.now(), has: !!row?.has };
  return reachFn.has;
}

/**
 * The reach predicate over ($1 org, $2 sees-all, $3 actor) for a participant
 * column. smr_staff_reach when present; the narrower app rule otherwise.
 */
export function staffReachPredicate(who: string, hasReachFunction: boolean): string {
  if (!/^(?:[a-z_][a-z0-9_.]*|\$\d::uuid)$/i.test(who)) throw new Error("bad column");
  // $2 is named in both forms: Postgres refuses a statement with a parameter it never sees.
  return hasReachFunction
    ? `(public.smr_staff_reach($1::uuid, $3::uuid, ${who}) AND $2::boolean IS NOT NULL)`
    : `($2::boolean OR EXISTS (SELECT 1 FROM client_staff_assignment a
         WHERE a.access_code_id = $1::uuid AND a.client_user_id = ${who} AND a.staff_user_id = $3::uuid))`;
}

const OPTIONAL_TABLES = new Set(["org_profile", "enrollment", "custom_field_def", "custom_field_value", "referral"]);
/** Is a table another lane adds in this build present? Only names on the list are asked about. */
export async function optionalTableExists(name: string): Promise<boolean> {
  if (!OPTIONAL_TABLES.has(name)) return false;
  const [row] = await query<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`]);
  return !!row?.ok;
}

/* ------------------------------------------------------ the AI switch -- */

/**
 * The organization's "AI assist" module (org_profile.modules.ai_assist, lane
 * L3a, migration 103). On unless the organization turned it off; on when the
 * table is not there yet. A failed read counts as on: the staff assistant is
 * read-and-draft only, and turning it off is the organization's choice, not
 * an outage's.
 */
export async function orgAiAssistEnabled(actor: OrgActor): Promise<boolean> {
  try {
    if (!(await optionalTableExists("org_profile"))) return true;
    const [rows] = await runScoped<[{ on: boolean | null }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`SELECT (modules->>'ai_assist')::boolean AS on FROM org_profile WHERE access_code_id = $1::uuid`, [actor.orgId]),
    ]);
    return rows[0]?.on !== false;
  } catch {
    return true;
  }
}

/* --------------------------------------------------- caseload digest -- */

export type StaleFlag = "quiet" | "never_started" | "overdue_task" | "retention_due" | "ask_waiting" | "no_recent_note" | "unassigned";
export const STALE_FLAG_LABELS: Record<StaleFlag, string> = {
  quiet: "Gone quiet", never_started: "Never started", overdue_task: "Task past due", retention_due: "Retention check-in due",
  ask_waiting: "Ask waiting on them", no_recent_note: "No recent note", unassigned: "Not assigned to anyone",
};
/** An ask unanswered this long is worth a nudge. */
export const ASK_WAITING_DAYS = 14;
/** No case note this long is worth a look. */
export const NOTE_STALE_DAYS = 30;

export interface DigestPerson {
  participantId: string;
  firstName: string | null;
  /** Only for people who share progress. */
  progressShared: boolean;
  lastActiveOn: string | null;
  joinedOn: string | null;
  startedWork: boolean;
  assignedToYou: boolean;
  openTasks: number;
  overdueTasks: number;
  nextTaskDue: string | null;
  retentionDue: number[];
  asksWaiting: number;
  lastNoteOn: string | null;
  flags: { flag: StaleFlag; reason: string }[];
}
export interface CaseloadDigest {
  asOf: string;
  quietDays: number;
  reach: "all" | "assigned";
  people: DigestPerson[];
  counts: { people: number; flagged: number; quiet: number; neverStarted: number; overdueTasks: number; retentionDue: number; asksWaiting: number; noRecentNote: number; startedWork: number };
  more: boolean;
}

export interface DigestInput {
  actorUserId: string;
  seesAll: boolean;
  quietDays: number;
  cohort: { userId: string; name: string | null; lastActiveAt: string | null; joinedAt: string; hired: boolean; assignedStaffId: string | null }[];
  tasks: { client_user_id: string | null; client_name: string | null; due_on: string | null; done_at: string | null }[];
  outcomes: { client_user_id: string; client_name: string | null; due_marks: number[]; ended_on: string | null }[];
  asks: { client_user_id: string; client_name: string | null; scope: string; status: string; created_at: string }[];
  lastNotes: { client_user_id: string; last_on: string }[];
  /** Assignment for people outside the cohort (from tasks, outcomes, asks): null means unknown. */
  assigned?: { client_user_id: string; staff_user_id: string | null }[];
}

const shortDay = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Pure: who on this caseload needs a look, and why, in plain reasons. */
export function buildCaseloadDigest(input: DigestInput, nowMs: number, cap = 40): CaseloadDigest {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const people = new Map<string, DigestPerson>();
  const get = (id: string, name: string | null): DigestPerson => {
    let p = people.get(id);
    if (!p) {
      p = { participantId: id, firstName: first(name), progressShared: false, lastActiveOn: null, joinedOn: null, startedWork: false, assignedToYou: false,
        openTasks: 0, overdueTasks: 0, nextTaskDue: null, retentionDue: [], asksWaiting: 0, lastNoteOn: null, flags: [] };
      people.set(id, p);
    }
    if (!p.firstName && name) p.firstName = first(name);
    return p;
  };
  for (const c of input.cohort) {
    const p = get(c.userId, c.name);
    p.progressShared = true;
    p.lastActiveOn = ymd(c.lastActiveAt);
    p.joinedOn = ymd(c.joinedAt);
    p.startedWork = c.hired;
    p.assignedToYou = c.assignedStaffId === input.actorUserId;
  }
  const assignedOutside = new Map((input.assigned ?? []).map((a) => [a.client_user_id, a.staff_user_id]));
  const oldestOverdue = new Map<string, string>();
  for (const t of input.tasks) {
    if (!t.client_user_id || t.done_at) continue;
    const p = get(t.client_user_id, t.client_name);
    p.openTasks++;
    if (t.due_on && t.due_on < today) {
      p.overdueTasks++;
      const was = oldestOverdue.get(p.participantId);
      if (!was || t.due_on < was) oldestOverdue.set(p.participantId, t.due_on);
    } else if (t.due_on && (!p.nextTaskDue || t.due_on < p.nextTaskDue)) p.nextTaskDue = t.due_on;
  }
  for (const o of input.outcomes) {
    if (o.ended_on || !o.due_marks.length) continue;
    const p = get(o.client_user_id, o.client_name);
    p.retentionDue = [...new Set([...p.retentionDue, ...o.due_marks])].sort((a, b) => a - b);
  }
  const oldestAsk = new Map<string, { scope: string; days: number }>();
  for (const a of input.asks) {
    if (a.status !== "pending") continue;
    const days = Math.floor((nowMs - new Date(a.created_at).getTime()) / DAY_MS);
    if (days < ASK_WAITING_DAYS) continue;
    const p = get(a.client_user_id, a.client_name);
    p.asksWaiting++;
    const was = oldestAsk.get(p.participantId);
    if (!was || days > was.days) oldestAsk.set(p.participantId, { scope: a.scope, days });
  }
  for (const n of input.lastNotes) {
    const p = people.get(n.client_user_id);
    if (p) p.lastNoteOn = ymd(n.last_on);
  }

  for (const p of people.values()) {
    if (!p.progressShared && assignedOutside.has(p.participantId)) p.assignedToYou = assignedOutside.get(p.participantId) === input.actorUserId;
    if (p.progressShared && !p.startedWork) {
      if (!p.lastActiveOn) p.flags.push({ flag: "never_started", reason: `Joined ${p.joinedOn ? shortDay(p.joinedOn) : "a while ago"} and has not started` });
      else {
        const quiet = Math.floor((nowMs - new Date(p.lastActiveOn + "T00:00:00Z").getTime()) / DAY_MS);
        if (quiet >= input.quietDays) p.flags.push({ flag: "quiet", reason: `No activity in ${quiet} days (last active ${shortDay(p.lastActiveOn)})` });
      }
    }
    if (p.overdueTasks) p.flags.push({ flag: "overdue_task", reason: `${p.overdueTasks} ${p.overdueTasks === 1 ? "task" : "tasks"} past due, the oldest due ${shortDay(oldestOverdue.get(p.participantId)!)}` });
    if (p.retentionDue.length) p.flags.push({ flag: "retention_due", reason: `${p.retentionDue.join(" and ")}-day check-in due` });
    const ask = oldestAsk.get(p.participantId);
    if (ask) p.flags.push({ flag: "ask_waiting", reason: `Ask to share ${ask.scope} waiting ${ask.days} days` });
    const joinedLongAgo = !p.joinedOn || nowMs - new Date(p.joinedOn + "T00:00:00Z").getTime() >= NOTE_STALE_DAYS * DAY_MS;
    if (!p.lastNoteOn && joinedLongAgo) p.flags.push({ flag: "no_recent_note", reason: "No case note on file yet" });
    else if (p.lastNoteOn && nowMs - new Date(p.lastNoteOn + "T00:00:00Z").getTime() >= NOTE_STALE_DAYS * DAY_MS) {
      p.flags.push({ flag: "no_recent_note", reason: `No case note since ${shortDay(p.lastNoteOn)}` });
    }
    if (input.seesAll && p.progressShared && !input.cohort.find((c) => c.userId === p.participantId)?.assignedStaffId) {
      p.flags.push({ flag: "unassigned", reason: "Not assigned to anyone" });
    }
  }

  const all = [...people.values()].sort((a, b) =>
    b.flags.length - a.flags.length || (a.lastActiveOn ?? "") .localeCompare(b.lastActiveOn ?? "") || (a.firstName ?? "").localeCompare(b.firstName ?? ""));
  const has = (f: StaleFlag) => all.filter((p) => p.flags.some((x) => x.flag === f)).length;
  return {
    asOf: today,
    quietDays: input.quietDays,
    reach: input.seesAll ? "all" : "assigned",
    people: all.slice(0, cap),
    counts: {
      people: all.length, flagged: all.filter((p) => p.flags.length).length, quiet: has("quiet"), neverStarted: has("never_started"),
      overdueTasks: has("overdue_task"), retentionDue: has("retention_due"), asksWaiting: has("ask_waiting"), noRecentNote: has("no_recent_note"),
      startedWork: all.filter((p) => p.startedWork).length,
    },
    more: all.length > cap,
  };
}

/** Everyone this staff member reaches, with stale flags and reasons. No note bodies, no wages. */
export async function getCaseloadDigest(actor: OrgActor, nowMs = Date.now()): Promise<CaseloadDigest | null> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.client.view_content")) return null;
  const seesAll = actor.capabilities.has("org.client.view_all");
  const hasFn = await hasStaffReachFunction();
  const reach = staffReachPredicate("n.client_user_id", hasFn);
  const [cohort, quietDays, tasks, outcomes, asks, notes] = await Promise.all([
    getPartnerCohort(actor.userId, { accessCodeId: actor.orgId, assignedToStaffId: seesAll ? undefined : actor.userId }),
    getQuietAfterDays(actor.orgId),
    listStaffTasks(actor),
    listOutcomes(actor),
    listSharingRequests(actor),
    // The date of each person's newest note. Never a body.
    runScoped<[{ client_user_id: string; last_on: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `SELECT n.client_user_id, max(n.occurred_at)::text AS last_on FROM case_note n
          WHERE n.access_code_id = $1::uuid AND ${reach} GROUP BY n.client_user_id`,
        [actor.orgId, seesAll, actor.userId]
      ),
    ]),
  ]);
  return buildCaseloadDigest({
    actorUserId: actor.userId, seesAll, quietDays,
    cohort: cohort.clients,
    tasks: tasks ?? [],
    outcomes: outcomes ?? [],
    asks: asks.ok ? asks.rows : [],
    lastNotes: notes[0],
  }, nowMs);
}

/* -------------------------------------------------- outcomes summary -- */

export interface PeriodOutcomes {
  from: string;
  to: string;
  /** Whose placements these are, in words the answer must repeat. */
  scope: "everyone in your organization you can see" | "people on your caseload";
  placementsStarted: number;
  bySource: { source: string; label: string; count: number }[];
  stillEmployed: number;
  ended: number;
  leftForBetter: number;
  /** Only marks where at least one placement in the period is old enough to have been asked. */
  retention: { dayMark: number; eligible: number; employed: number; notEmployed: number; unknown: number; notAskedYet: number; employedPercent: number | null }[];
  checksRecorded: number;
  enrollments: { enrolled: number; exited: number; completed: number } | null;
  referrals: { made: number; serviceDelivered: number } | null;
  /** Any figure under 10: say so beside it; rates on small numbers mislead. */
  smallNumbers: boolean;
  never: string;
}

/** Pure: the period's numbers from the placement rows, with the rules summarizeOutcomes already keeps. */
export function summarizeOutcomesForPeriod(rows: readonly Outcome[], from: string, to: string, scope: PeriodOutcomes["scope"], nowMs = Date.now()): PeriodOutcomes {
  const inPeriod = rows.filter((o) => o.end_reason !== "entered_in_error" && o.start_date >= from && o.start_date <= to);
  const s = summarizeOutcomes(inPeriod, nowMs);
  const checksRecorded = rows.filter((o) => o.end_reason !== "entered_in_error")
    .reduce((n, o) => n + o.checks.filter((k) => { const d = String(k.checked_at).slice(0, 10); return d >= from && d <= to; }).length, 0);
  const retention = s.retention.filter((r) => r.eligible > 0).map((r) => ({
    dayMark: r.dayMark, eligible: r.eligible, employed: r.employed, notEmployed: r.notEmployed, unknown: r.unknown, notAskedYet: r.notAskedYet,
    employedPercent: r.eligible ? Math.round((r.employed / r.eligible) * 100) : null,
  }));
  const figures = [s.placements, ...retention.map((r) => r.eligible)];
  return {
    from, to, scope,
    placementsStarted: s.placements,
    bySource: Object.entries(s.bySource).map(([source, count]) => ({ source, label: OUTCOME_SOURCE_LABELS[source as keyof typeof OUTCOME_SOURCE_LABELS] ?? source, count })),
    stillEmployed: s.stillEmployed, ended: s.ended, leftForBetter: s.leftForBetter,
    retention, checksRecorded,
    enrollments: null, referrals: null,
    smallNumbers: figures.some((n) => n > 0 && n < 10),
    never: "No wages, names or stories: numbers only, each from this read. Anything not here is not recorded here.",
  };
}

/** Default period: the last full calendar quarter before today. */
export function lastQuarter(nowMs = Date.now()): { from: string; to: string } {
  const d = new Date(nowMs);
  const q = Math.floor(d.getUTCMonth() / 3);
  const start = new Date(Date.UTC(d.getUTCFullYear(), (q - 1) * 3, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), q * 3, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/**
 * Placements, retention, enrollments and referrals for a period, over the
 * people this actor reaches. Needs org.insights.view or org.outcome.write: a
 * volunteer holds neither and gets null.
 */
export async function getOutcomesForPeriod(actor: OrgActor, period: { from?: string | null; to?: string | null }, nowMs = Date.now()): Promise<PeriodOutcomes | null> {
  if (actor.viaPlatformAdmin) return null;
  if (!actor.capabilities.has("org.insights.view") && !actor.capabilities.has("org.outcome.write")) return null;
  const fallback = lastQuarter(nowMs);
  let from = period.from && ISO_DAY.test(period.from) ? period.from : fallback.from;
  let to = period.to && ISO_DAY.test(period.to) ? period.to : fallback.to;
  if (from > to) [from, to] = [to, from];
  const rows = await listOutcomes(actor);
  if (!rows) return null;
  const seesAll = actor.capabilities.has("org.client.view_all");
  const out = summarizeOutcomesForPeriod(rows, from, to, seesAll ? "everyone in your organization you can see" : "people on your caseload", nowMs);
  const hasFn = await hasStaffReachFunction();
  if (await optionalTableExists("enrollment")) {
    try {
      const [r] = await runScoped<[{ enrolled: number; exited: number; completed: number }[]]>(scopeOf(actor), (sql) => [
        run(sql)(
          `SELECT count(*) FILTER (WHERE e.enrolled_on BETWEEN $4::date AND $5::date)::int AS enrolled,
                  count(*) FILTER (WHERE e.exited_on BETWEEN $4::date AND $5::date)::int AS exited,
                  count(*) FILTER (WHERE e.exited_on BETWEEN $4::date AND $5::date AND e.status = 'completed')::int AS completed
             FROM enrollment e WHERE e.access_code_id = $1::uuid AND ${staffReachPredicate("e.participant_user_id", hasFn)}`,
          [actor.orgId, seesAll, actor.userId, from, to]
        ),
      ]);
      out.enrollments = r[0] ?? null;
    } catch { out.enrollments = null; }
  }
  if (await optionalTableExists("referral")) {
    try {
      const [r] = await runScoped<[{ made: number; delivered: number }[]]>(scopeOf(actor), (sql) => [
        run(sql)(
          `SELECT count(*) FILTER (WHERE r.status <> 'draft' AND r.created_at::date BETWEEN $4::date AND $5::date)::int AS made,
                  count(*) FILTER (WHERE r.status = 'service_delivered' AND r.updated_at::date BETWEEN $4::date AND $5::date)::int AS delivered
             FROM referral r WHERE r.access_code_id = $1::uuid AND ${staffReachPredicate("r.participant_user_id", hasFn)}`,
          [actor.orgId, seesAll, actor.userId, from, to]
        ),
      ]);
      out.referrals = r[0] ? { made: r[0].made, serviceDelivered: r[0].delivered } : null;
    } catch { out.referrals = null; }
  }
  if ((out.enrollments && Object.values(out.enrollments).some((n) => n > 0 && n < 10)) || (out.referrals && Object.values(out.referrals).some((n) => n > 0 && n < 10))) out.smallNumbers = true;
  return out;
}

/* ---------------------------------------------------- open referrals -- */

export interface OpenReferral {
  id: string; participantId: string; firstName: string | null; toKind: string; toName: string; reason: string;
  status: string; dueOn: string | null; overdue: boolean; yours: boolean; madeOn: string | null;
}
export const OPEN_REFERRAL_STATUSES = ["draft", "sent", "accepted", "contacted"] as const;

/**
 * Open referrals (lane L5's referral table, migration 105) for people this
 * actor reaches. null when the table is not there yet. Reason text comes back
 * as written; the app's record gate runs before the model sees it.
 */
export async function listOpenReferralsForStaff(actor: OrgActor, nowMs = Date.now()): Promise<OpenReferral[] | null> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.client.view_content")) return null;
  if (!(await optionalTableExists("referral"))) return null;
  const hasFn = await hasStaffReachFunction();
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const [rows] = await runScoped<[{ id: string; participant_user_id: string; name: string | null; to_kind: string; to_name: string; reason: string | null; status: string; due_on: string | null; owner_staff_id: string | null; created_at: string }[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `SELECT r.id, r.participant_user_id, u.name, r.to_kind, r.to_name, r.reason, r.status, to_char(r.due_on, 'YYYY-MM-DD') AS due_on, r.owner_staff_id, r.created_at::text
         FROM referral r JOIN users u ON u.id = r.participant_user_id
        WHERE r.access_code_id = $1::uuid AND r.status = ANY($4::text[]) AND ${staffReachPredicate("r.participant_user_id", hasFn)}
        ORDER BY r.due_on NULLS LAST, r.created_at LIMIT 100`,
      [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, [...OPEN_REFERRAL_STATUSES]]
    ),
  ]);
  return rows.map((r) => ({
    id: r.id, participantId: r.participant_user_id, firstName: first(r.name), toKind: r.to_kind, toName: String(r.to_name ?? "").slice(0, 120),
    reason: String(r.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 300), status: r.status, dueOn: r.due_on,
    overdue: !!r.due_on && r.due_on < today, yours: r.owner_staff_id === actor.userId, madeOn: ymd(r.created_at),
  }));
}

/* ------------------------------------------------------ custom fields -- */

export interface CustomFieldRow { def: { key: string; label: string; type: string | null; sensitive: boolean | null; retired_at: string | null }; value: unknown }

/**
 * One participant's custom field values with their definitions (lane L4,
 * migration 104), for a person this actor reaches. null when the tables are
 * not there yet. The app decides what of this the model may see
 * (staff-ai-safety safeCustomFields: never a sensitive field).
 */
export async function getParticipantCustomFieldRows(actor: OrgActor, clientId: string): Promise<CustomFieldRow[] | null> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.client.view_content")) return null;
  if (!(await optionalTableExists("custom_field_def")) || !(await optionalTableExists("custom_field_value"))) return null;
  const hasFn = await hasStaffReachFunction();
  // Lane L4's column names are the SPEC's; if they differ, this read is "not available", never an error page.
  const [rows] = await runScoped<[{ key: string; label: string; type: string | null; sensitive: boolean | null; retired_at: string | null; value: unknown }[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `SELECT d.key, d.label, d.type, d.sensitive, d.retired_at::text, v.value
         FROM custom_field_def d JOIN custom_field_value v ON v.def_id = d.id
        WHERE d.access_code_id = $1::uuid AND v.access_code_id = $1::uuid AND d.entity = 'participant'
          AND v.entity_id = $4::uuid AND d.retired_at IS NULL AND d.sensitive IS FALSE
          AND EXISTS (SELECT 1 FROM access_code_redemption m WHERE m.user_id = $4::uuid AND m.access_code_id = $1::uuid)
          AND ${staffReachPredicate("$4::uuid", hasFn)}
        ORDER BY d.position NULLS LAST, d.label LIMIT 40`,
      [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, clientId]
    ),
  ]).catch(() => [null] as [null]);
  if (!rows) return null;
  return rows.map(({ value, ...def }) => ({ def, value }));
}

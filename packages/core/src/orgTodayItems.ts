/**
 * Today's items, built from rows already read (pure: no database, no clock).
 *
 * orgToday.ts decides WHAT may be read and writes the access log; this file
 * only turns those rows into sentences. Split out so the wording and the N6
 * rules can be tested with dated fixtures (CRM wave 2026-10-25, lane C1).
 *
 * N6 (B8 review R3), fixed here:
 *   - an application's item key carries the application id, so two
 *     applications with the same title and company never collide;
 *   - an application left at "interviewing" with no movement for 30 days, and
 *     no future date, leaves "Interviews coming up" and is listed under
 *     "Gone quiet" instead of sitting on Today forever;
 *   - follow-ups more than 14 days past their date collapse to one
 *     "Follow-ups overdue" line per person.
 * Every other sentence is unchanged, word for word.
 */

export const TODAY_SECTIONS = ["tasks", "retention", "interviews", "followups", "answered", "acknowledgement", "quiet", "never_started", "unassigned"] as const;
export type TodaySection = (typeof TODAY_SECTIONS)[number];
export const TODAY_SECTION_LABELS: Record<TodaySection, string> = {
  tasks: "Your tasks", retention: "Retention check-ins due", interviews: "Interviews coming up", followups: "Follow-ups due", answered: "They answered you",
  acknowledgement: "Waiting on an acknowledgement", quiet: "Gone quiet", never_started: "Never started", unassigned: "Not assigned to anyone",
};

/** An interview with no movement for this many days leaves "Interviews coming up". */
export const INTERVIEW_STALE_DAYS = 30;
/** A follow-up this many days past its date joins the one overdue line for that person. */
export const FOLLOWUP_OVERDUE_DAYS = 14;

export interface TodayItem {
  key: string;
  section: TodaySection;
  clientId: string | null;
  clientName: string | null;
  /** One sentence, already written. */
  reason: string;
  when: string | null;
  action: { label: string; href: string };
  taskId?: string;
}

export interface TodayTaskRow { id: string; title: string; due_on: string | null; client_user_id: string | null; client_name: string | null; owner_user_id: string | null; shared_with_participant: boolean; done_at: string | null }
export interface TodayOutcomeRow { id: string; client_user_id: string; client_name: string | null; employer: string; start_date: string; ended_on: string | null; due_marks: number[] }
export interface TodayAppRow { id: string; user_id: string; name: string | null; job_title: string | null; company: string | null; status: string; follow_up_at: string | null; status_updated_at?: string | null; updated_at?: string | null }
export interface TodayAnsweredRow { user_id: string; name: string | null; scope: string; status: string; answered_at: string }
export interface TodayAckRow { user_id: string; name: string | null }
export interface TodayCohortRow { userId: string; name: string | null; hired: boolean; lastActiveAt: string | null; joinedAt: string; assignedStaffId: string | null }
export interface TodayInvitedRow { userId: string; name: string | null; joinedAt: string; assignedStaffId: string | null }

export interface TodayInput {
  actorUserId: string;
  /** Sees the whole organization AND may assign (the "Not assigned" section). */
  canAssignAll: boolean;
  quietDays: number;
  tasks: TodayTaskRow[];
  outcomes: TodayOutcomeRow[];
  apps: TodayAppRow[];
  answered: TodayAnsweredRow[];
  awaiting: TodayAckRow[];
  cohort: TodayCohortRow[];
  invited: TodayInvitedRow[];
}

const DAY_MS = 86400000;
const day = (s: string) => new Date(s).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const first = (n: string | null) => (n ?? "").trim().split(/\s+/)[0] || "They";
const href = (id: string) => `/dashboard/clients/${id}`;
const ms = (s: string | null | undefined) => (s ? new Date(s).getTime() : NaN);

/** Last time an application moved: its status change, else its last edit. */
function lastMoved(a: TodayAppRow): number {
  const t = Math.max(...[ms(a.status_updated_at), ms(a.updated_at)].filter((n) => !Number.isNaN(n)));
  return Number.isFinite(t) ? t : NaN;
}

export function buildTodayItems(input: TodayInput, nowMs: number): TodayItem[] {
  const items: TodayItem[] = [];
  const today = new Date(nowMs).toISOString().slice(0, 10);

  for (const t of input.tasks) {
    if (t.done_at) continue;
    if (t.owner_user_id !== input.actorUserId) continue;
    const overdue = t.due_on && t.due_on < today;
    items.push({
      key: `task:${t.id}`, section: "tasks", clientId: t.client_user_id, clientName: t.client_name, taskId: t.id, when: t.due_on,
      reason: `${t.title}${t.due_on ? (overdue ? ` (was due ${day(t.due_on)})` : ` (due ${day(t.due_on)})`) : ""}${t.shared_with_participant ? ` · shared with ${first(t.client_name)}` : ""}`,
      action: t.client_user_id ? { label: `Open ${first(t.client_name)}`, href: href(t.client_user_id) } : { label: "Mark done", href: "#" },
    });
  }
  for (const o of input.outcomes) {
    if (o.due_marks.length === 0 || o.ended_on) continue;
    const mark = o.due_marks[0];
    items.push({ key: `ret:${o.id}:${mark}`, section: "retention", clientId: o.client_user_id, clientName: o.client_name, when: o.start_date,
      reason: `${first(o.client_name)} started at ${o.employer} ${mark}+ days ago. Time for the ${mark}-day check-in: still there?`,
      action: { label: "Record the check-in", href: href(o.client_user_id) } });
  }

  // Follow-ups long past their date, gathered per person (N6).
  const overdue = new Map<string, { name: string | null; rows: TodayAppRow[] }>();
  for (const a of input.apps) {
    const job = [a.job_title, a.company].filter(Boolean).join(" at ") || "a job";
    if (a.status === "interviewing") {
      const moved = lastMoved(a);
      const upcoming = !!a.follow_up_at && ms(a.follow_up_at) >= nowMs;
      if (!upcoming && !Number.isNaN(moved) && nowMs - moved >= INTERVIEW_STALE_DAYS * DAY_MS) {
        items.push({ key: `int-stale:${a.user_id}:${a.id}`, section: "quiet", clientId: a.user_id, clientName: a.name, when: a.status_updated_at ?? a.updated_at ?? null,
          reason: `${first(a.name)} marked ${job} as interviewing ${Math.floor((nowMs - moved) / DAY_MS)} days ago, and nothing has moved since. Worth asking how it went.`,
          action: { label: "Check in", href: href(a.user_id) } });
        continue;
      }
      items.push({ key: `int:${a.user_id}:${a.id}`, section: "interviews", clientId: a.user_id, clientName: a.name, when: a.follow_up_at,
        reason: `${first(a.name)} is interviewing for ${job}${a.follow_up_at ? `, next date ${day(a.follow_up_at)}` : ""}.`,
        action: { label: "Help them prepare", href: href(a.user_id) } });
    } else {
      if (a.follow_up_at && nowMs - ms(a.follow_up_at) > FOLLOWUP_OVERDUE_DAYS * DAY_MS) {
        const bucket = overdue.get(a.user_id) ?? { name: a.name, rows: [] };
        bucket.rows.push(a);
        overdue.set(a.user_id, bucket);
        continue;
      }
      items.push({ key: `fu:${a.user_id}:${a.id}`, section: "followups", clientId: a.user_id, clientName: a.name, when: a.follow_up_at,
        reason: `${first(a.name)} planned to follow up on ${job} by ${day(a.follow_up_at!)}.`,
        action: { label: "Check in", href: href(a.user_id) } });
    }
  }
  for (const [userId, b] of Array.from(overdue.entries())) {
    const oldest = [...b.rows].sort((x, y) => ms(x.follow_up_at) - ms(y.follow_up_at))[0];
    const job = [oldest.job_title, oldest.company].filter(Boolean).join(" at ") || "a job";
    items.push({ key: `fu-overdue:${userId}`, section: "followups", clientId: userId, clientName: b.name, when: oldest.follow_up_at,
      reason: b.rows.length === 1
        ? `Follow-up overdue: ${first(b.name)} planned to follow up on ${job} by ${day(oldest.follow_up_at!)}, more than two weeks ago.`
        : `Follow-ups overdue: ${first(b.name)} has ${b.rows.length} follow-ups more than two weeks past the dates they set. The oldest is ${job}, from ${day(oldest.follow_up_at!)}.`,
      action: { label: "Check in", href: href(userId) } });
  }

  for (const r of input.answered) {
    items.push({ key: `ans:${r.user_id}:${r.scope}`, section: "answered", clientId: r.user_id, clientName: r.name, when: r.answered_at,
      reason: r.status === "approved" ? `${first(r.name)} shared what you asked for (${r.scope}).` : `${first(r.name)} said not now to sharing their ${r.scope}. That is theirs to decide.`,
      action: { label: r.status === "approved" ? "Open it" : `Open ${first(r.name)}`, href: href(r.user_id) } });
  }
  for (const k of input.awaiting) {
    items.push({ key: `ack:${k.user_id}`, section: "acknowledgement", clientId: k.user_id, clientName: k.name, when: null,
      reason: `${first(k.name)} has not acknowledged what your program requires. Nothing is open until they do, and only they can.`,
      action: { label: "Talk it through", href: href(k.user_id) } });
  }

  // Someone who has STARTED WORK and stopped using a job-search tool is not a
  // concern, so they are left off this list -- though the rollup the assistant
  // and Insights share still counts them as not active. Deliberate, and noted.
  for (const c of input.cohort) {
    if (c.hired) continue;
    const last = c.lastActiveAt ? new Date(c.lastActiveAt).getTime() : 0;
    if (!last) {
      items.push({ key: `ns:${c.userId}`, section: "never_started", clientId: c.userId, clientName: c.name, when: c.joinedAt,
        reason: `${first(c.name)} joined and has not started. A first conversation usually does more than a reminder.`, action: { label: "Reach out", href: href(c.userId) } });
    } else if (nowMs - last >= input.quietDays * DAY_MS) {
      items.push({ key: `q:${c.userId}`, section: "quiet", clientId: c.userId, clientName: c.name, when: c.lastActiveAt,
        reason: `${first(c.name)} was last active ${Math.floor((nowMs - last) / DAY_MS)} days ago. Worth asking what is in the way.`, action: { label: "Check in", href: href(c.userId) } });
    }
    if (input.canAssignAll && !c.assignedStaffId) {
      items.push({ key: `un:${c.userId}`, section: "unassigned", clientId: c.userId, clientName: c.name, when: c.joinedAt,
        reason: `${first(c.name)} is not assigned to anyone, so they are on nobody's list.`, action: { label: "Assign them", href: "/dashboard/people" } });
    }
  }
  // People the organization invited who have not turned on sharing: they are
  // on nobody's list until someone is assigned, and assigning them needs no
  // shared content. Only the name and email the organization typed are used.
  if (input.canAssignAll) {
    for (const p of input.invited) {
      if (p.assignedStaffId) continue;
      items.push({ key: `un:${p.userId}`, section: "unassigned", clientId: p.userId, clientName: p.name, when: p.joinedAt,
        reason: `${first(p.name)} was invited by your organization and is not assigned to anyone. They have not turned on progress sharing, so you see only the name you entered.`,
        action: { label: "Assign them", href: "/dashboard/people#invited" } });
    }
  }
  return items;
}

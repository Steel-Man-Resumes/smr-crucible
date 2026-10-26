/**
 * One participant's timeline (lane L5): notes, corrections, tasks, asks to
 * share and their answers, placements, retention check-ins, program
 * enrollments, referrals and other recorded changes, newest first, in one feed.
 *
 * WHAT IT READS: only the organization's own records about the person. Nothing
 * the participant made (applications, resumes) is read here, so nothing is
 * written to their access log; the shared items stay behind their own logged
 * door in orgClientView.ts.
 *
 * REACH: the person must be in the actor's reach (the same rule as the page
 * header). Checked once as a gate and again in every branch, and the
 * restrictive policies (102, 105) repeat it in the database.
 *
 * NAMES: no participant name is ever written into an item (it is their page).
 * Staff names appear as the author of each item.
 *
 * Enrollments (migration 103) and the activity log (102) are read only when
 * their tables exist, so this works before and after those land.
 */
import { query, runScoped } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { scopeOf, run, reachParams, inReach, UUID_RE } from "./orgWorkflowSql";
import {
  TIMELINE_PAGE_SIZE, parseTimelineCursor, REFERRAL_STATUS_LABELS, isReferralStatus,
  type PersonTimelineItem, type TimelineType,
} from "./orgWorkflowShared";
import { END_REASON_LABELS, OUTCOME_SOURCE_LABELS } from "./orgOutcomes";

/** A raw branch row: the source and up to five short fields the wording is built from. */
export interface TimelineRow {
  key: string; type: TimelineType; at: string; src: string; actor_name: string | null;
  /** The same time to the microsecond, for the next-page cursor. */
  atx?: string;
  f1: string | null; f2: string | null; f3: string | null; f4: string | null; f5: string | null;
}

/* $1 org, $2 sees all, $3 actor, $4 person. Every branch names its participant in the WHERE and carries inReach. */
const P = "$4::uuid";
const BRANCHES: Record<TimelineType, string> = {
  note: `SELECT 'note:' || n.id AS key, 'note' AS type, n.occurred_at AS at, n.id::text AS src, au.name AS actor_name,
      n.kind AS f1, left(n.body, 280) AS f2, CASE WHEN n.drafted_by_assistant THEN 'yes' END AS f3, n.edited_at::text AS f4, NULL::text AS f5
    FROM case_note n LEFT JOIN users au ON au.id = n.author_user_id
   WHERE n.access_code_id = $1::uuid AND n.client_user_id = ${P}`,
  correction: `SELECT 'correction:' || v.id AS key, 'correction' AS type, v.replaced_at AS at, n.id::text AS src, au.name AS actor_name,
      v.kind AS f1, NULL::text AS f2, NULL::text AS f3, NULL::text AS f4, NULL::text AS f5
    FROM case_note_version v JOIN case_note n ON n.id = v.note_id AND n.access_code_id = v.access_code_id
    LEFT JOIN users au ON au.id::text = v.replaced_by
   WHERE v.access_code_id = $1::uuid AND n.client_user_id = ${P}`,
  task: `SELECT 'task:' || t.id AS key, 'task' AS type, t.created_at AS at, t.id::text AS src, cb.name AS actor_name,
      t.title AS f1, to_char(t.due_on, 'YYYY-MM-DD') AS f2, CASE WHEN t.shared_with_participant THEN 'yes' END AS f3,
      CASE WHEN t.cancelled_at IS NOT NULL THEN 'cancelled' WHEN t.done_at IS NOT NULL THEN 'done' ELSE 'open' END AS f4, t.source_kind AS f5
    FROM staff_task t LEFT JOIN users cb ON cb.id = t.created_by
   WHERE t.access_code_id = $1::uuid AND t.client_user_id = ${P}
  UNION ALL
  SELECT 'task:' || t.id || ':1', 'task', t.done_at, t.id::text, CASE WHEN t.done_by = t.client_user_id THEN NULL ELSE db.name END,
      t.title, NULL, CASE WHEN t.done_by = t.client_user_id THEN 'participant' END, 'done_event', NULL
    FROM staff_task t LEFT JOIN users db ON db.id = t.done_by
   WHERE t.access_code_id = $1::uuid AND t.client_user_id = ${P} AND t.done_at IS NOT NULL AND t.cancelled_at IS NULL`,
  ask: `SELECT 'ask:' || sr.id AS key, 'ask' AS type, sr.created_at AS at, sr.id::text AS src, rb.name AS actor_name,
      sr.scope AS f1, left(sr.reason, 200) AS f2, 'asked' AS f3, NULL::text AS f4, NULL::text AS f5
    FROM sharing_request sr LEFT JOIN users rb ON rb.id = sr.requested_by
   WHERE sr.access_code_id = $1::uuid AND sr.user_id = ${P}
  UNION ALL
  SELECT 'ask:' || sr.id || ':1', 'ask', sr.answered_at, sr.id::text, NULL, sr.scope, NULL, sr.status, NULL, NULL
    FROM sharing_request sr
   WHERE sr.access_code_id = $1::uuid AND sr.user_id = ${P} AND sr.answered_at IS NOT NULL AND sr.status IN ('approved', 'declined')`,
  outcome: `SELECT 'outcome:' || o.id AS key, 'outcome' AS type, o.created_at AS at, o.id::text AS src, cb.name AS actor_name,
      o.employer AS f1, o.job_title AS f2, to_char(o.start_date, 'YYYY-MM-DD') AS f3, o.source AS f4, 'recorded' AS f5
    FROM outcome_record o LEFT JOIN users cb ON cb.id = o.created_by
   WHERE o.access_code_id = $1::uuid AND o.client_user_id = ${P}
  UNION ALL
  SELECT 'outcome:' || o.id || ':1', 'outcome', o.ended_on::timestamptz, o.id::text, NULL, o.employer, NULL, to_char(o.ended_on, 'YYYY-MM-DD'), o.end_reason, 'ended'
    FROM outcome_record o
   WHERE o.access_code_id = $1::uuid AND o.client_user_id = ${P} AND o.ended_on IS NOT NULL
  UNION ALL
  -- Corrections to a placement (migration 102 outcome_correction): which
  -- fields changed and why, never the old or new values.
  SELECT 'outcomefix:' || c.id, 'outcome', c.corrected_at, o.id::text, cb.name, o.employer, NULL,
      left(c.reason, 200), (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(c.changed) k), 'corrected'
    FROM outcome_correction c JOIN outcome_record o ON o.id = c.outcome_id LEFT JOIN users cb ON cb.id = c.corrected_by
   WHERE c.access_code_id = $1::uuid AND c.client_user_id = ${P} AND c.kind = 'corrected'`,
  retention: `SELECT 'retention:' || k.id AS key, 'retention' AS type, k.checked_at AS at, o.id::text AS src, cb.name AS actor_name,
      k.day_mark::text AS f1, k.status AS f2, o.employer AS f3, left(k.correction_reason, 200) AS f4,
      CASE WHEN k.superseded_by IS NOT NULL THEN 'superseded' WHEN k.correction_reason IS NOT NULL THEN 'correction' END AS f5
    FROM retention_check k JOIN outcome_record o ON o.id = k.outcome_id AND o.access_code_id = k.access_code_id
    LEFT JOIN users cb ON cb.id = k.checked_by
   WHERE k.access_code_id = $1::uuid AND o.client_user_id = ${P}`,
  // Migration 103. Column names per the house SPEC (enrollment, org_unit).
  enrollment: `SELECT 'enrollment:' || e.id AS key, 'enrollment' AS type, e.created_at AS at, e.id::text AS src, cb.name AS actor_name,
      u.name AS f1, e.status AS f2, to_char(e.enrolled_on, 'YYYY-MM-DD') AS f3, to_char(e.exited_on, 'YYYY-MM-DD') AS f4, u.kind AS f5
    FROM enrollment e LEFT JOIN org_unit u ON u.id = e.org_unit_id LEFT JOIN users cb ON cb.id = e.created_by
   WHERE e.access_code_id = $1::uuid AND e.participant_user_id = ${P}`,
  referral: `SELECT 'referral:' || e.id AS key, 'referral' AS type, e.at AS at, e.referral_id::text AS src, au.name AS actor_name,
      r.to_name AS f1, e.from_status AS f2, e.to_status AS f3, left(e.status_reason, 200) AS f4, NULL::text AS f5
    FROM referral_event e JOIN referral r ON r.id = e.referral_id LEFT JOIN users au ON au.id = e.actor_user_id
   WHERE e.access_code_id = $1::uuid AND e.participant_user_id = ${P} AND (e.from_status IS NULL OR e.from_status IS DISTINCT FROM e.to_status)`,
  // Migration 102. What has no branch of its own: assignment, enrollment moves
  // (103), custom field changes (104). Summaries there are fixed words, never
  // note bodies, field values or record words.
  activity: `SELECT 'activity:' || a.id AS key, 'activity' AS type, a.at AS at, a.id::text AS src, au.name AS actor_name,
      a.entity AS f1, a.action AS f2, left(a.summary, 200) AS f3, NULL::text AS f4, NULL::text AS f5
    FROM org_activity a LEFT JOIN users au ON au.id = a.actor_user_id
   WHERE a.access_code_id = $1::uuid AND a.participant_user_id = ${P}
     AND a.entity NOT IN ('note', 'task', 'outcome', 'retention', 'referral', 'sharing')
     -- An enrollment's first row is its own branch; its later moves (status, staff, program id) are here.
     AND NOT (a.entity = 'enrollment' AND a.action = 'created')`,
};

/** Types whose tables may be missing (later migrations). */
export const OPTIONAL_TIMELINE_TABLES: Partial<Record<TimelineType, string[]>> = {
  enrollment: ["enrollment", "org_unit"],
  activity: ["org_activity"],
};

/**
 * The feed's SQL for these types. $5 cursor time or NULL, $6 cursor key, $7 limit + 1.
 * Each branch is wrapped so the person's reach is checked inside it, not only at the gate.
 */
export function timelineSql(types: readonly TimelineType[]): string {
  const parts = types.map((t) => `SELECT * FROM (${BRANCHES[t]}) b_${t} WHERE ${inReach(P)}`);
  return `SELECT key, type, at, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS atx, src, actor_name, f1, f2, f3, f4, f5 FROM (
    ${parts.join("\n    UNION ALL\n    ")}
  ) feed
  WHERE at IS NOT NULL AND ($5::timestamptz IS NULL OR (at, key) < ($5::timestamptz, $6::text))
  ORDER BY at DESC, key DESC
  LIMIT $7::int`;
}

let optionalKnown: { at: number; present: Set<string> } | null = null;
async function presentOptionalTables(): Promise<Set<string>> {
  if (optionalKnown && Date.now() - optionalKnown.at < 60_000) return optionalKnown.present;
  const names = Array.from(new Set(Object.values(OPTIONAL_TIMELINE_TABLES).flat()));
  try {
    const rows = await query<{ name: string }>(`SELECT n AS name FROM unnest($1::text[]) n WHERE to_regclass('public.' || n) IS NOT NULL`, [names]);
    optionalKnown = { at: Date.now(), present: new Set(rows.map((r) => r.name)) };
  } catch { optionalKnown = { at: Date.now(), present: new Set() }; }
  return optionalKnown.present;
}

/** Drop types whose tables are not there yet. Pure, for tests. */
export function availableTimelineTypes(types: readonly TimelineType[], present: ReadonlySet<string>): TimelineType[] {
  return types.filter((t) => (OPTIONAL_TIMELINE_TABLES[t] ?? []).every((name) => present.has(name)));
}

const day = (s: string | null) => (s ? new Date(s.length === 10 ? s + "T12:00:00Z" : s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
const NOTE_KIND_WORDS: Record<string, string> = { note: "Note", call: "Call", meeting: "Meeting", text: "Text", email: "Email", referral: "Referral note", draft: "Check-in draft" };
const SCOPE_WORDS: Record<string, string> = { applications: "their applications", resume: "their resumes", documents: "their cover letters" };
const RETENTION_STATUS_WORDS: Record<string, string> = { employed: "still working there", not_employed: "no longer there", unknown: "could not reach them" };
const CORRECTED_FIELD_WORDS: Record<string, string> = {
  employer: "employer", job_title: "job title", start_date: "start date", hourly_wage: "wage", hours_per_week: "hours", source: "how it is known",
  verification_method: "how it was confirmed", verified: "how it was confirmed", ended_on: "end date", end_reason: "end reason",
};
const ENROLLMENT_STATUS_WORDS: Record<string, string> = {
  referred: "Referred to", enrolled: "Enrolled in", active: "Active in", paused: "Paused in", completed: "Completed", exited: "Left", withdrawn: "Withdrew from",
};

/** Turn a branch row into the line staff read, and the link to its source. Pure, so the wording is tested. */
export function timelineItemFromRow(r: TimelineRow, clientId: string): PersonTimelineItem {
  const page = `/dashboard/clients/${clientId}`;
  const base = { key: r.key, type: r.type, at: new Date(r.at).toISOString(), actorName: r.actor_name, detail: null as string | null };
  switch (r.type) {
    case "note":
      return { ...base, title: `${NOTE_KIND_WORDS[r.f1 ?? ""] ?? "Note"}${r.f3 ? ", drafted with t.ROY" : ""}${r.f4 ? " (since corrected)" : ""}`,
        detail: r.f2, href: `${page}?tab=notes#note-${r.src}` };
    case "correction":
      return { ...base, title: "Note corrected. The earlier wording is kept with it.", href: `${page}?tab=notes#note-${r.src}` };
    case "task": {
      if (r.f4 === "done_event") return { ...base, title: `Task done${r.f3 === "participant" ? ", ticked off by them" : ""}: ${r.f1}`, href: `${page}?tab=tasks#task-${r.src}` };
      const state = r.f4 === "cancelled" ? " (cancelled)" : "";
      const made = r.f5 === "retention" ? "Check-in task made automatically" : "Task added";
      return { ...base, title: `${made}: ${r.f1}${r.f2 ? `, due ${day(r.f2)}` : ""}${state}`,
        detail: r.f3 ? "Shared with them, so they can tick it off." : null, href: `${page}?tab=tasks#task-${r.src}` };
    }
    case "ask": {
      const what = SCOPE_WORDS[r.f1 ?? ""] ?? "something";
      if (r.f3 === "asked") return { ...base, title: `Asked them to share ${what}`, detail: r.f2, href: `${page}?tab=shared` };
      return { ...base, title: r.f3 === "approved" ? `They shared ${what}` : `They said not now to sharing ${what}`, href: `${page}?tab=shared` };
    }
    case "outcome":
      if (r.f5 === "corrected") {
        const fields = (r.f4 ?? "").split(",").filter(Boolean).map((f) => CORRECTED_FIELD_WORDS[f] ?? "details").filter((v, i, a) => a.indexOf(v) === i);
        return { ...base, title: `Placement at ${r.f1} corrected${fields.length ? ` (${fields.join(", ")})` : ""}`, detail: r.f3 ? `Why: ${r.f3}` : null, href: `${page}?tab=outcomes#outcome-${r.src}` };
      }
      if (r.f5 === "ended") return { ...base, title: `Job at ${r.f1} ended${r.f3 ? ` ${day(r.f3)}` : ""}: ${END_REASON_LABELS[r.f4 as keyof typeof END_REASON_LABELS] ?? "reason not given"}`, href: `${page}?tab=outcomes#outcome-${r.src}` };
      return { ...base, title: `Placement recorded: ${[r.f2, r.f1].filter(Boolean).join(" at ")}${r.f3 ? `, started ${day(r.f3)}` : ""}`,
        detail: OUTCOME_SOURCE_LABELS[r.f4 as keyof typeof OUTCOME_SOURCE_LABELS] ?? null, href: `${page}?tab=outcomes#outcome-${r.src}` };
    case "retention": {
      // Migration 102: a correction is a new answer; the old one stays, marked.
      const answer = `${r.f1}-day check-in at ${r.f3}: ${RETENTION_STATUS_WORDS[r.f2 ?? ""] ?? r.f2}`;
      if (r.f5 === "correction") return { ...base, title: `Corrected the ${answer}`, detail: r.f4 ? `Why: ${r.f4}` : null, href: `${page}?tab=outcomes#outcome-${r.src}` };
      return { ...base, title: `${answer}${r.f5 === "superseded" ? " (since corrected)" : ""}`, href: `${page}?tab=outcomes#outcome-${r.src}` };
    }
    case "enrollment": {
      const verb = ENROLLMENT_STATUS_WORDS[r.f2 ?? ""] ?? "Program";
      return { ...base, title: `${verb} ${r.f1 ?? "a program"}${r.f3 ? ` (from ${day(r.f3)}${r.f4 ? ` to ${day(r.f4)}` : ""})` : ""}`, href: `${page}?tab=timeline#tl-${r.key.replace(/:/g, "-")}` };
    }
    case "referral": {
      const to = isReferralStatus(r.f3) ? REFERRAL_STATUS_LABELS[r.f3].toLowerCase() : r.f3;
      return { ...base, title: r.f2 == null ? `Referral to ${r.f1} made (${to})` : `Referral to ${r.f1}: ${to}`, detail: r.f4, href: `${page}?tab=referrals#referral-${r.src}` };
    }
    case "activity":
    default:
      return { ...base, title: r.f3 || "A change was recorded", href: `${page}?tab=timeline#tl-${r.key.replace(/:/g, "-")}` };
  }
}

export type TimelineResult =
  | { ok: true; items: PersonTimelineItem[]; next: string | null; types: TimelineType[] }
  | { ok: false; reason: "no_capability" | "platform_admin_view" | "not_in_reach_or_not_member" };

export async function getPersonTimeline(actor: OrgActor, clientId: string, opts: { types?: readonly TimelineType[]; cursor?: string | null; limit?: number } = {}): Promise<TimelineResult> {
  if (actor.viaPlatformAdmin) return { ok: false, reason: "platform_admin_view" };
  if (!actor.capabilities.has("org.client.view_content")) return { ok: false, reason: "no_capability" };
  if (!UUID_RE.test(clientId)) return { ok: false, reason: "not_in_reach_or_not_member" };
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? TIMELINE_PAGE_SIZE)));
  const cursor = parseTimelineCursor(opts.cursor ?? null);
  const types = availableTimelineTypes(opts.types?.length ? opts.types : (Object.keys(BRANCHES) as TimelineType[]), await presentOptionalTables());
  const params = [...reachParams(actor), clientId, cursor?.at ?? null, cursor?.key ?? "", limit + 1];
  const read = (ts: TimelineType[]) => runScoped<[{ ok: boolean }[], TimelineRow[]]>(scopeOf(actor), (sql) => [
    run(sql)(`SELECT ${inReach(P)} AS ok`, params.slice(0, 4)),
    ts.length ? run(sql)(timelineSql(ts), params) : run(sql)(`SELECT NULL WHERE false`, []),
  ]);
  let gate: { ok: boolean }[], rows: TimelineRow[];
  let used = types;
  try {
    [gate, rows] = await read(types);
  } catch (e) {
    // A later migration's table exists with columns other than the SPEC's: read the rest rather than nothing.
    used = types.filter((t) => !OPTIONAL_TIMELINE_TABLES[t]);
    if (used.length === types.length) throw e;
    [gate, rows] = await read(used);
  }
  if (!gate[0]?.ok) return { ok: false, reason: "not_in_reach_or_not_member" };
  const items = rows.slice(0, limit).map((r) => timelineItemFromRow(r, clientId));
  const last = rows.length > limit ? rows[limit - 1] : null;
  const next = last ? `${last.atx ?? new Date(last.at).toISOString()}|${last.key}` : null;
  return { ok: true, items, next, types: used };
}

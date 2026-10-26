/**
 * The organization activity log, in words (migration 102). Pure, so the
 * screen, the CSV and the tests say the same sentence, and so the browser can
 * import it without the database driver.
 *
 * WHAT A ROW CAN SAY. Its summary is written by a database trigger from fixed
 * words and allowlisted values only ("added a call note", "recorded the
 * 30-day check-in (still there)"): never a note body, a task title, an
 * employer, a typed reason or a record word. This module adds only names, and
 * a participant's name only by consent: the account's name when they share
 * progress with the organization, else the name the organization typed on an
 * invite, else none.
 */

/** Kinds of record a row can be about. The database CHECK holds the same list. */
export const ACTIVITY_ENTITIES = [
  "note", "task", "outcome", "retention", "assignment", "sharing", "invite", "staff", "org",
  "enrollment", "unit", "referral", "custom_field", "view",
] as const;
export type ActivityEntity = (typeof ACTIVITY_ENTITIES)[number];

export const ACTIVITY_ENTITY_LABELS: Record<ActivityEntity, string> = {
  note: "Case notes",
  task: "Tasks",
  outcome: "Placements",
  retention: "Check-ins after hire",
  assignment: "Caseload changes",
  sharing: "Sharing and asks",
  invite: "Invites",
  staff: "Team",
  org: "Organization",
  enrollment: "Enrollments",
  unit: "Programs and sites",
  referral: "Referrals",
  custom_field: "Custom fields",
  view: "Saved views",
};

export function isActivityEntity(v: unknown): v is ActivityEntity {
  return typeof v === "string" && (ACTIVITY_ENTITIES as readonly string[]).includes(v);
}

export interface ActivityRow {
  id: string;
  at: string;
  entity: string;
  action: string;
  summary: string;
  actor_user_id: string | null;
  actor_role: string | null;
  actor_name: string | null;
  participant_user_id: string | null;
  participant_name: string | null;
  staff_user_id: string | null;
  staff_name: string | null;
}

/** The person a row is about, by consent. */
export function activityPerson(row: Pick<ActivityRow, "participant_user_id" | "participant_name">): string | null {
  if (!row.participant_user_id) return null;
  const name = row.participant_name?.trim();
  return name || "a person who has not shared their name";
}

/** Who did it. A participant acting is named only by consent, like anywhere else. */
export function activityWho(row: Pick<ActivityRow, "actor_user_id" | "actor_role" | "actor_name" | "participant_user_id" | "participant_name">): string {
  if (!row.actor_user_id) return "Automatic";
  switch (row.actor_role) {
    case "owner":
    case "org_admin":
    case "staff":
      return row.actor_name?.trim() || "A team member";
    case "participant": {
      const name = row.actor_name?.trim()
        || (row.actor_user_id === row.participant_user_id ? row.participant_name?.trim() : "");
      return name || "The person";
    }
    case "platform_admin":
      return "Steel Man support";
    default:
      return "Someone outside the team";
  }
}

/** Put "for <person>" before the first parenthesis or ", due", or at the end. */
function withPerson(summary: string, person: string): string {
  if (/\bthem\b/.test(summary)) return summary.replace(/\bthem\b/, person);
  const cut = summary.search(/ \(|, due /);
  return cut === -1 ? `${summary} for ${person}` : `${summary.slice(0, cut)} for ${person}${summary.slice(cut)}`;
}

/**
 * One plain sentence, ending in a full stop. Examples:
 *   "Alma Reyes added a call note for Jordan."
 *   "Alma Reyes assigned Jordan to Sam Lee's caseload."
 *   "Jordan started sharing their resumes."
 */
export function activitySentence(row: ActivityRow): string {
  const who = activityWho(row);
  const person = activityPerson(row);
  const staff = row.staff_name?.trim() || "a team member";
  const actorIsPerson = !!row.actor_user_id && row.actor_user_id === row.participant_user_id;
  let what: string;
  if (row.entity === "assignment" && person) {
    what = row.action === "unassigned" ? `took ${person} off ${staff}'s caseload`
      : /moved/.test(row.summary) ? `moved ${person} to ${staff}'s caseload`
      : `assigned ${person} to ${staff}'s caseload`;
  } else if (row.entity === "staff") {
    what = `${row.summary}: ${staff}`;
  } else if (person && !actorIsPerson) {
    what = withPerson(row.summary, person);
  } else {
    what = row.summary;
  }
  return `${who} ${what}.`;
}

/** A date input value (YYYY-MM-DD) or null. */
export function activityDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T00:00:00Z");
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ActivityFilters {
  participantId: string | null;
  staffId: string | null;
  entity: ActivityEntity | null;
  /** Inclusive dates, in the organization's time zone. */
  from: string | null;
  to: string | null;
  /** Rows older than this id (paging). */
  before: string | null;
  limit: number;
}

/** Filters from a query string or a body. Anything malformed is dropped, never passed to SQL. */
export function activityFilters(input: Record<string, unknown>, maxLimit = 200): ActivityFilters {
  const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
  const before = typeof input.before === "string" && /^\d{1,18}$/.test(input.before) ? input.before : null;
  const limitRaw = Number(input.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), maxLimit) : Math.min(100, maxLimit);
  let from = activityDate(input.from), to = activityDate(input.to);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    participantId: id(input.participantId),
    staffId: id(input.staffId),
    entity: isActivityEntity(input.entity) ? input.entity : null,
    from, to, before, limit,
  };
}

/** A CSV cell: quoted, and a leading = + - @ neutralized so a spreadsheet never runs it as a formula. */
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export const ACTIVITY_CSV_HEADER = ["When (UTC)", "Who", "What happened", "Person", "Team member", "Kind", "Action"] as const;

export function activityCsv(rows: readonly ActivityRow[]): string {
  const lines = [ACTIVITY_CSV_HEADER.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([
      new Date(r.at).toISOString().replace("T", " ").slice(0, 19),
      activityWho(r),
      activitySentence(r),
      activityPerson(r) ?? "",
      r.staff_user_id ? r.staff_name ?? "" : "",
      isActivityEntity(r.entity) ? ACTIVITY_ENTITY_LABELS[r.entity] : r.entity,
      r.action.replace(/_/g, " "),
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

/**
 * Team talk, in words (staff side lane S4, migration 109). Pure and
 * browser-safe: the routes, the screens and the tests share one copy of the
 * kinds, labels, limits, paths and sentences.
 *
 * WHAT AN INBOX ITEM CAN SAY. Its summary is written by a database trigger
 * from fixed words ("mentioned you in a comment about them"); this module
 * only adds names, and a participant's name only by consent (the same rule as
 * the activity log). Never a comment body, a task title or a request's text.
 */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* --------------------------------------------------------------- comments -- */

export const COMMENT_MAX = 2000;
export const MENTION_MAX = 10;

/** Ids only, each once, at most MENTION_MAX, never the author. Anything else is dropped. */
export function normalizeMentions(input: unknown, authorId?: string | null): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== "string" || !UUID_PATTERN.test(v)) continue;
    const id = v.toLowerCase();
    if (authorId && id === authorId.toLowerCase()) continue;
    if (!out.includes(id)) out.push(id);
    if (out.length >= MENTION_MAX) break;
  }
  return out;
}

/** The body as saved, or the plain reason it cannot be. */
export function checkCommentBody(input: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const body = typeof input === "string" ? input.trim() : "";
  if (!body) return { ok: false, error: "Write a few words first." };
  if (body.length > COMMENT_MAX) return { ok: false, error: `Keep it under ${COMMENT_MAX} characters.` };
  return { ok: true, body };
}

/** Shown under every comment box. Comments are team talk; the record lives in case notes. */
export const COMMENT_CARE_LINE = "Only your team sees comments, never the person. Keep record details in case notes.";
/** Shown on the team board, which every teammate reads whatever their caseload (review N3). */
export const TEAM_THREAD_CARE_LINE = "Everyone on your team reads the team board. Do not name people here; talk about a person on their page.";

/** The plain message when a mention is refused (the database refuses it too). */
export function mentionRefusedLine(name: string | null | undefined, kind: "out_of_reach" | "not_team"): string {
  const who = name?.trim() || "That team member";
  return kind === "out_of_reach"
    ? `${who} cannot see this person, so they cannot be mentioned here. Ask an admin to add them first.`
    : `${who} is not on your team here.`;
}

/* ------------------------------------------------------------------ inbox -- */

export const INBOX_KINDS = ["mention", "reply", "task_assigned", "change_request", "change_answered", "note_review", "kudos", "handoff"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export const INBOX_KIND_LABELS: Record<InboxKind, string> = {
  mention: "Mentions",
  reply: "Replies",
  task_assigned: "Tasks for you",
  change_request: "Change requests",
  change_answered: "Answers to your requests",
  note_review: "Note reviews",
  kudos: "Kudos",
  handoff: "Handoffs",
};

/** The filter chips on the Inbox page, in the order staff think of them. */
export const INBOX_FILTERS: { key: string; label: string; kinds: InboxKind[] }[] = [
  { key: "all", label: "Everything", kinds: [...INBOX_KINDS] },
  { key: "talk", label: "Mentions and replies", kinds: ["mention", "reply"] },
  { key: "tasks", label: "Tasks for you", kinds: ["task_assigned"] },
  { key: "changes", label: "Change requests", kinds: ["change_request", "change_answered"] },
  { key: "reviews", label: "Note reviews", kinds: ["note_review"] },
];

export function isInboxKind(v: unknown): v is InboxKind {
  return typeof v === "string" && (INBOX_KINDS as readonly string[]).includes(v);
}

export interface InboxItemRow {
  id: string;
  kind: string;
  ref_table: string;
  ref_id: string;
  summary: string;
  created_at: string;
  read_at: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  participant_user_id: string | null;
  participant_name: string | null;
}

/** Where opening an item takes you. The page there checks reach again. */
export function inboxHref(row: Pick<InboxItemRow, "ref_table" | "ref_id" | "participant_user_id">): string {
  const p = row.participant_user_id && UUID_PATTERN.test(row.participant_user_id) ? row.participant_user_id : null;
  const ref = UUID_PATTERN.test(row.ref_id) ? row.ref_id : "";
  switch (row.ref_table) {
    case "team_comment":
      return p ? `/dashboard/clients/${p}?tab=team#comment-${ref}` : `/dashboard/inbox?view=team#comment-${ref}`;
    case "staff_task":
      return p ? `/dashboard/clients/${p}?tab=tasks#task-${ref}` : "/dashboard/today";
    case "org_change_request":
      return `/dashboard/change-requests#cr-${ref}`;
    case "staff_handoff":
      return p ? `/dashboard/clients/${p}?tab=tasks#handoff` : "/dashboard/inbox";
    case "case_note":
      return p ? `/dashboard/clients/${p}?tab=notes#note-${ref}` : "/dashboard/inbox";
    default:
      return "/dashboard/inbox";
  }
}

/** The person an item is about, by consent; never an empty gap. */
export function inboxPerson(row: Pick<InboxItemRow, "participant_user_id" | "participant_name">): string | null {
  if (!row.participant_user_id) return null;
  return row.participant_name?.trim() || "a person who has not shared their name";
}

/**
 * One sentence: "Alma Reyes mentioned you in a comment about Jordan."
 * The summary's "them" becomes the person, by consent.
 */
export function inboxSentence(row: Pick<InboxItemRow, "summary" | "actor_user_id" | "actor_name" | "participant_user_id" | "participant_name">): string {
  const who = row.actor_user_id ? row.actor_name?.trim() || "A team member" : "Someone who has left the team";
  const person = inboxPerson(row);
  const what = person ? row.summary.replace(/\bthem\b/, person) : row.summary;
  return `${who} ${what}.`;
}

/* -------------------------------------------------------- change requests -- */

export const CHANGE_REQUEST_KINDS = ["field", "layout", "view", "structure", "terminology", "policy", "other"] as const;
export type ChangeRequestKind = (typeof CHANGE_REQUEST_KINDS)[number];

export const CHANGE_REQUEST_KIND_LABELS: Record<ChangeRequestKind, string> = {
  field: "A field (add, rename or change one)",
  layout: "How a screen is laid out",
  view: "A shared view or list",
  structure: "Programs, sites or teams",
  terminology: "The words we use",
  policy: "What staff can change for themselves",
  other: "Something else",
};

export const CHANGE_REQUEST_STATUSES = ["open", "accepted", "declined", "done"] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  open: "Waiting for an answer",
  accepted: "Yes, it is coming",
  declined: "Not now",
  done: "Done",
};

/** The same path the database enforces (109 org_change_request_guard). */
export const CHANGE_REQUEST_TRANSITIONS: Record<ChangeRequestStatus, readonly ChangeRequestStatus[]> = {
  open: ["accepted", "declined", "done"],
  accepted: ["done", "declined"],
  declined: [],
  done: [],
};

export const CHANGE_REQUEST_ACTION_LABELS: Record<ChangeRequestStatus, string> = {
  open: "Reopen",
  accepted: "Say yes",
  declined: "Say no, with a reason",
  done: "Mark done",
};

export const CHANGE_TITLE_MIN = 3;
export const CHANGE_TITLE_MAX = 140;
export const CHANGE_BODY_MAX = 2000;

export function isChangeRequestKind(v: unknown): v is ChangeRequestKind {
  return typeof v === "string" && (CHANGE_REQUEST_KINDS as readonly string[]).includes(v);
}
export function isChangeRequestStatus(v: unknown): v is ChangeRequestStatus {
  return typeof v === "string" && (CHANGE_REQUEST_STATUSES as readonly string[]).includes(v);
}

/** A page path the request came from, or null. Only "/dashboard/..." in plain segments. */
export function changeRequestTarget(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().split(/[?#]/)[0].replace(/\/+$/, "");
  return /^\/dashboard(\/[a-z0-9-]+){0,4}$/.test(t) ? t : null;
}

export function checkChangeRequestDraft(input: { kind?: unknown; title?: unknown; body?: unknown }):
  { ok: true; kind: ChangeRequestKind; title: string; body: string | null } | { ok: false; error: string } {
  const kind = isChangeRequestKind(input.kind) ? input.kind : "other";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length < CHANGE_TITLE_MIN) return { ok: false, error: "Say in a line what you would like changed." };
  if (title.length > CHANGE_TITLE_MAX) return { ok: false, error: `Keep the first line under ${CHANGE_TITLE_MAX} characters. Put the rest below it.` };
  const body = typeof input.body === "string" && input.body.trim() ? input.body.trim() : null;
  if (body && body.length > CHANGE_BODY_MAX) return { ok: false, error: `Keep it under ${CHANGE_BODY_MAX} characters.` };
  return { ok: true, kind, title, body };
}

/**
 * Can a manager move a request from `from` to `to`, with this answer? A "no"
 * always needs words written for that no (`fresh`: the answer given now, not
 * one left from an earlier yes). The database checks the same (109 guard).
 */
export function checkChangeMove(from: ChangeRequestStatus, to: ChangeRequestStatus, answer: string | null | undefined, fresh = true): string | null {
  if (from === to) return null;
  if (!CHANGE_REQUEST_TRANSITIONS[from].includes(to)) return "That answer does not follow from where the request is.";
  if (to === "declined" && (!fresh || (answer ?? "").trim().length < 3)) return "Say why, so they know what to do next.";
  if ((answer ?? "").length > CHANGE_BODY_MAX) return `Keep the answer under ${CHANGE_BODY_MAX} characters.`;
  return null;
}

/** Shown on the request form. */
export const CHANGE_REQUEST_CARE_LINE = "The owner and admins read this. Leave out people's names and record details.";

/* ------------------------------------------------------------ note review -- */

export const NOTE_REVIEW_STATUSES = ["pending", "sent_back", "approved"] as const;
export type NoteReviewStatus = (typeof NOTE_REVIEW_STATUSES)[number];

export const NOTE_REVIEW_STATUS_LABELS: Record<NoteReviewStatus | "draft", string> = {
  draft: "Not sent for review yet",
  pending: "Waiting for review",
  sent_back: "Sent back with a comment",
  approved: "Approved and locked",
};

/** The database function answers with a word; staff read a sentence. */
export const NOTE_REVIEW_REASONS: Record<string, string> = {
  module_off: "Note review is not switched on for your organization.",
  not_found: "That note is not one you can see.",
  not_author: "Only the person who wrote a note sends it for review.",
  already_pending: "This note is already waiting for review.",
  approved: "This note was approved and is locked.",
  not_reviewer: "Only the owner or an admin reviews notes.",
  own_note: "Someone else reviews your own notes.",
  not_pending: "This note is not waiting for review.",
  needs_comment: "Say what to change, in a few words, so they can fix it.",
  refused: "That did not go through.",
};

export const NOTE_REVIEW_COMMENT_MAX = 1000;

/* ---------------------------------------------------- database messages -- */

/** Messages the 109 triggers raise, turned into plain sentences. Unknown errors get a general line. */
export function teamTalkErrorLine(message: string | null | undefined): string {
  const m = String(message ?? "");
  if (/mention_out_of_reach/.test(m)) return "A team member you mentioned cannot see this person. Ask an admin to add them first.";
  if (/mention_not_team/.test(m)) return "You can only mention people on your team.";
  if (/task_assign_out_of_reach/.test(m)) return "That team member cannot see this person, so the task cannot go to them.";
  if (/task_assign_not_team/.test(m)) return "A task can only go to someone on your team.";
  if (/task_assign_refused/.test(m)) return "Only the person who made a task, its owner, or someone who assigns work can hand it on.";
  if (/task_assign_closed/.test(m)) return "A finished or cancelled task stays where it is.";
  if (/task_assign_nobody/.test(m)) return "A task needs someone to own it.";
  if (/change_request_move/.test(m)) return "That answer does not follow from where the request is.";
  if (/change_request_needs_reason/.test(m)) return "Say why, so they know what to do next.";
  if (/ai_assist_owner_only/.test(m)) return "Only the owner turns t.ROY on or off for your organization.";
  if (/note_locked/.test(m)) return "An approved note is locked.";
  if (/note_pending/.test(m)) return "This note is waiting for review, so it cannot be changed right now.";
  if (/row-level security|not in your reach/.test(m)) return "That person is not on your caseload.";
  return "That did not save. Try again in a moment.";
}

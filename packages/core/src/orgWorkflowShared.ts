/**
 * Staff workflow (migration 105, house lane L5): the rules and words that both
 * the server and the browser need. No database here, so the participant page
 * can import it directly and the rules are tested without one.
 *
 *   - referrals: the closed-loop path, its words, default due dates, overdue
 *   - drafts: which fields may be autosaved
 *   - search: how a query is normalized, and why a person looks like a duplicate
 *   - timeline: the item types and their filter chips
 */

/* ------------------------------------------------------------------ referrals -- */

export const REFERRAL_STATUSES = ["draft", "sent", "accepted", "declined", "contacted", "service_delivered", "unable_to_contact", "closed"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

/**
 * The only moves a referral can make. MUST match smr_referral_next() in
 * migration 105 (a test reads the SQL and compares). "closed" is the end:
 * a new need is a new referral, so the history of the old one stays true.
 */
export const REFERRAL_TRANSITIONS: Record<ReferralStatus, readonly ReferralStatus[]> = {
  draft: ["sent", "closed"],
  sent: ["accepted", "declined", "contacted", "unable_to_contact", "closed"],
  accepted: ["contacted", "service_delivered", "unable_to_contact", "closed"],
  declined: ["sent", "closed"],
  contacted: ["service_delivered", "unable_to_contact", "closed"],
  unable_to_contact: ["contacted", "closed"],
  service_delivered: ["closed"],
  closed: [],
};

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  draft: "Draft, not sent",
  sent: "Sent",
  accepted: "They accepted it",
  declined: "They turned it down",
  contacted: "In touch with the person",
  service_delivered: "Help was given",
  unable_to_contact: "Could not reach the person",
  closed: "Closed",
};

/** The button words for moving TO a status. */
export const REFERRAL_ACTION_LABELS: Record<ReferralStatus, string> = {
  draft: "Back to draft",
  sent: "Mark sent",
  accepted: "They accepted",
  declined: "They turned it down",
  contacted: "They made contact",
  service_delivered: "Help was given",
  unable_to_contact: "Could not reach them",
  closed: "Close it",
};

export const REFERRAL_TO_KINDS = ["directory_resource", "partner_org", "other"] as const;
export type ReferralToKind = (typeof REFERRAL_TO_KINDS)[number];
export const REFERRAL_TO_KIND_LABELS: Record<ReferralToKind, string> = {
  directory_resource: "A listing in the help directory",
  partner_org: "A partner organization",
  other: "Somewhere else",
};

/** Days until the next look, per status: the receiving side has 2 to 3 business days to act, outreach about two weeks. */
export const REFERRAL_DEFAULT_DUE_DAYS: Record<ReferralStatus, number | null> = {
  draft: 2, sent: 3, accepted: 7, declined: 3, contacted: 14, service_delivered: 3, unable_to_contact: 7, closed: null,
};

export function isReferralStatus(v: unknown): v is ReferralStatus {
  return typeof v === "string" && (REFERRAL_STATUSES as readonly string[]).includes(v);
}

/** YYYY-MM-DD, `days` after `today` (a YYYY-MM-DD in the organization's day). */
export function addDays(today: string, days: number): string {
  const t = Date.parse(today + "T00:00:00Z") + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function defaultReferralDue(status: ReferralStatus, today: string): string | null {
  const d = REFERRAL_DEFAULT_DUE_DAYS[status];
  return d == null ? null : addDays(today, d);
}

/**
 * Whether a move needs a reason, in the same terms the database checks:
 * declined and could-not-reach always; closing only when help was never given.
 */
export function referralNeedsReason(to: ReferralStatus, delivered: boolean): boolean {
  return to === "declined" || to === "unable_to_contact" || (to === "closed" && !delivered);
}

export type ReferralMoveCheck = { ok: true } | { ok: false; error: string };

/** The friendly copy of the database's rules, checked before the write. */
export function checkReferralMove(input: {
  from: ReferralStatus; to: ReferralStatus; delivered: boolean; reason: string | null; toKind: ReferralToKind; consentOk: boolean;
}): ReferralMoveCheck {
  if (!REFERRAL_TRANSITIONS[input.from].includes(input.to)) {
    return { ok: false, error: input.from === "closed" ? "This referral is closed. Make a new one if there is a new need." : `A referral that is "${REFERRAL_STATUS_LABELS[input.from].toLowerCase()}" cannot move to "${REFERRAL_STATUS_LABELS[input.to].toLowerCase()}".` };
  }
  if (input.toKind === "partner_org" && !input.consentOk && input.to !== "closed") {
    return { ok: false, error: PARTNER_CONSENT_LINE };
  }
  if (referralNeedsReason(input.to, input.delivered) && (input.reason ?? "").trim().length < 2) {
    return { ok: false, error: input.to === "closed" ? "Say why it is closing without help given. That keeps the record honest." : "Add a few words on what happened." };
  }
  return { ok: true };
}

export const PARTNER_CONSENT_LINE =
  "This stays a draft. A referral to another organization goes out only after the person agrees to share their name with it, and that step is not built yet. You can still call or walk them over yourself, then record it as somewhere else.";

/** Past its date and still open. A closed referral is never overdue. */
export function isReferralOverdue(r: { status: string; due_on: string | null }, today: string): boolean {
  return r.status !== "closed" && !!r.due_on && r.due_on < today;
}

/* --------------------------------------------------------------------- drafts -- */

/** Fields that autosave. A kind not listed here is refused by the server. */
export const DRAFT_KINDS = ["note", "note_fix", "task", "ask_reason", "referral_reason", "outcome_note", "field"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/**
 * "note", or "note_fix:<note id>", or "field:<custom field key>". The same
 * shape the database checks (105 staff_draft.kind).
 */
export function draftKindOk(kind: unknown): kind is string {
  if (typeof kind !== "string" || !/^[a-z][a-z0-9_]{1,40}(:[a-z0-9_-]{1,60})?$/.test(kind)) return false;
  return (DRAFT_KINDS as readonly string[]).includes(kind.split(":")[0]);
}

export const DRAFT_MAX_CHARS = 20000;
/** Drafts nobody has touched in this long are removed when that person next saves one. */
export const DRAFT_KEEP_DAYS = 30;
/** How often the page saves while someone is typing. */
export const DRAFT_SAVE_EVERY_MS = 10_000;

/* --------------------------------------------------------------------- search -- */

/** Lowercase, single spaces, trimmed. Empty means "no query". */
export function normalizeSearch(q: unknown): string {
  return typeof q === "string" ? q.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120) : "";
}

/** Digits only, with a leading US 1 dropped from an 11-digit number. Matches smr_phone_digits(). */
export function phoneDigits(p: unknown): string {
  const d = typeof p === "string" ? p.replace(/[^0-9]/g, "") : "";
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/** A query has to say something before it is searched. */
export function searchable(q: string): boolean {
  return q.length >= 2 || phoneDigits(q).length >= 4;
}

export type DuplicateReason = "email" | "phone" | "name";
export const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
  email: "same email", phone: "same phone number", name: "same or very similar name",
};

/**
 * Why an existing person looks like the one being added. Email and phone are
 * exact (after normalizing); a name alone counts only when it is the same or
 * nearly so (score from smr_name_score, 1 = contains, trigram otherwise).
 */
export function duplicateReasons(
  candidate: { name: string | null; email: string | null; phoneDigits: string | null; nameScore: number },
  input: { name?: string | null; email?: string | null; phone?: string | null },
): DuplicateReason[] {
  const out: DuplicateReason[] = [];
  const email = normalizeSearch(input.email ?? "");
  if (email && candidate.email && normalizeSearch(candidate.email) === email) out.push("email");
  const phone = phoneDigits(input.phone ?? "");
  if (phone.length >= 7 && candidate.phoneDigits && candidate.phoneDigits === phone) out.push("phone");
  const name = normalizeSearch(input.name ?? "");
  if (name && candidate.name && (normalizeSearch(candidate.name) === name || (name.includes(" ") && candidate.nameScore >= 0.6))) out.push("name");
  return out;
}

/* ------------------------------------------------------------------- timeline -- */

export const TIMELINE_TYPES = ["note", "correction", "task", "ask", "outcome", "retention", "enrollment", "referral", "activity"] as const;
export type TimelineType = (typeof TIMELINE_TYPES)[number];

/** Filter chips: one per kind of work, in the order staff think of them. */
export const TIMELINE_CHIPS: { key: string; label: string; types: TimelineType[] }[] = [
  { key: "notes", label: "Notes", types: ["note", "correction"] },
  { key: "tasks", label: "Tasks", types: ["task"] },
  { key: "asks", label: "Asks to share", types: ["ask"] },
  { key: "outcomes", label: "Jobs and check-ins", types: ["outcome", "retention"] },
  { key: "referrals", label: "Referrals", types: ["referral"] },
  { key: "enrollments", label: "Programs", types: ["enrollment"] },
  { key: "activity", label: "Other changes", types: ["activity"] },
];

export interface PersonTimelineItem {
  /** "<type>:<source id>[:<n>]", unique in one timeline. */
  key: string;
  type: TimelineType;
  at: string;
  /** One line, already written. Never a note body: see `detail`. */
  title: string;
  /** A short excerpt the staff member already has the right to read (a note's first lines). */
  detail: string | null;
  actorName: string | null;
  /** Where the source lives on the person's page. */
  href: string;
}

export const TIMELINE_PAGE_SIZE = 40;

/** Parse a "types" query value into known types; empty means all. */
export function parseTimelineTypes(v: string | null | undefined): TimelineType[] {
  if (!v) return [...TIMELINE_TYPES];
  const picked = v.split(",").map((s) => s.trim()).filter((s): s is TimelineType => (TIMELINE_TYPES as readonly string[]).includes(s));
  return picked.length ? Array.from(new Set(picked)) : [...TIMELINE_TYPES];
}

/**
 * Cursor for the next page: the last item's time (to the microsecond, as the
 * database gave it) and its key. Opaque to the browser; validated on the way back.
 */
export function parseTimelineCursor(c: string | null | undefined): { at: string; key: string } | null {
  if (!c || c.length > 120) return null;
  const i = c.indexOf("|");
  if (i < 0) return null;
  const at = c.slice(0, i), key = c.slice(i + 1);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(at) || Number.isNaN(Date.parse(at))) return null;
  if (!/^[a-z_]+:[0-9a-f-]{1,36}(:\d{1,3})?$/.test(key)) return null;
  return { at, key };
}

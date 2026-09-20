/**
 * Staff workflow preferences: the PURE, client-safe half (types, allowlists,
 * normalizer). The database half is ./staffPrefs.
 *
 * RULES
 *  - Every option here is WIRED. A preference that changes nothing is a lie in
 *    a settings page; do not add one until the screen honors it.
 *  - A preference arranges a person's own screen. It never widens access.
 *  - Normalizing never throws: unknown keys are dropped, bad values fall back.
 *
 * RESOLUTION: built-in default  <-  organization default  <-  the person's own.
 */
export const CASELOAD_COLUMNS = ["stage", "nextStep", "applications", "lastActive", "staff", "status"] as const;
export type CaseloadColumn = (typeof CASELOAD_COLUMNS)[number];
export const CASELOAD_COLUMN_LABELS: Record<CaseloadColumn, string> = {
  stage: "Stage", nextStep: "Next step", applications: "Applications",
  lastActive: "Last active", staff: "Case manager", status: "Status",
};

export const CASELOAD_SORTS = ["needs_attention", "name", "last_active", "stage"] as const;
export type CaseloadSort = (typeof CASELOAD_SORTS)[number];
export const CASELOAD_SORT_LABELS: Record<CaseloadSort, string> = {
  needs_attention: "Who needs me first",
  name: "Name, A to Z",
  last_active: "Most recently active",
  stage: "Furthest along",
};

export const NOTE_KINDS = ["note", "meeting", "call", "text", "email", "referral"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  note: "Note", meeting: "Meeting", call: "Call", text: "Text", email: "Email", referral: "Referral",
};

export const CLIENT_TABS = ["notes", "screen", "applications", "resume", "documents", "last"] as const;
export type ClientTabPref = (typeof CLIENT_TABS)[number];
export const CLIENT_TAB_LABELS: Record<ClientTabPref, string> = {
  notes: "Your notes", screen: "Their screen (a map of what they see)", applications: "Applications", resume: "Resumes", documents: "Cover letters",
  last: "Whichever I had open last",
};

export const LANDINGS = ["today", "caseload"] as const;
export type Landing = (typeof LANDINGS)[number];
export const LANDING_LABELS: Record<Landing, string> = { today: "Today: who needs me and why", caseload: "Caseload: everyone, in a table" };

/** Kept here (not imported from orgToday) so this file stays safe for the browser. */
export const TODAY_SECTION_KEYS = ["tasks", "interviews", "followups", "answered", "acknowledgement", "quiet", "never_started", "unassigned"] as const;
export type TodaySectionKey = (typeof TODAY_SECTION_KEYS)[number];

export interface StaffPrefs {
  /** Where signing in lands. */
  landing: Landing;
  /** Today sections to HIDE (stored as hidden, so a new section shows by default). */
  todayHidden: TodaySectionKey[];
  caseloadSort: CaseloadSort;
  /** Columns to HIDE. Stored as hidden, so a column added later shows by default. */
  caseloadHidden: CaseloadColumn[];
  noteKind: NoteKind;
  /** Whether "let them see this note" starts ticked. */
  noteVisible: boolean;
  clientTab: ClientTabPref;
}

export const DEFAULT_STAFF_PREFS: StaffPrefs = {
  landing: "today",
  todayHidden: [],
  caseloadSort: "needs_attention",
  caseloadHidden: [],
  noteKind: "note",
  noteVisible: false,
  clientTab: "notes",
};

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;

/** Keep only known keys with valid values. The result is PARTIAL on purpose. */
export function normalizeStaffPrefs(raw: unknown): Partial<StaffPrefs> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<StaffPrefs> = {};
  const landing = oneOf(LANDINGS, r.landing);
  if (landing) out.landing = landing;
  if (Array.isArray(r.todayHidden)) out.todayHidden = Array.from(new Set(r.todayHidden.map((c) => oneOf(TODAY_SECTION_KEYS, c)).filter(Boolean))) as TodaySectionKey[];
  const sort = oneOf(CASELOAD_SORTS, r.caseloadSort);
  if (sort) out.caseloadSort = sort;
  if (Array.isArray(r.caseloadHidden)) {
    const hidden = Array.from(new Set(r.caseloadHidden.map((c) => oneOf(CASELOAD_COLUMNS, c)).filter(Boolean))) as CaseloadColumn[];
    out.caseloadHidden = hidden;
  }
  const kind = oneOf(NOTE_KINDS, r.noteKind);
  if (kind) out.noteKind = kind;
  if (typeof r.noteVisible === "boolean") out.noteVisible = r.noteVisible;
  const tab = oneOf(CLIENT_TABS, r.clientTab);
  if (tab) out.clientTab = tab;
  return out;
}

export function resolveStaffPrefs(orgDefaults: unknown, own: unknown): StaffPrefs {
  return { ...DEFAULT_STAFF_PREFS, ...normalizeStaffPrefs(orgDefaults), ...normalizeStaffPrefs(own) };
}

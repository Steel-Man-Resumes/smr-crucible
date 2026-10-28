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
 * RESOLUTION: built-in default  <-  organization default  <-  the person's own,
 * where "the person's own" first loses any choice the organization's
 * customization policy locks for their role (customizationPolicyShared,
 * migration 108). A locked choice stays stored and comes back if the policy
 * opens again.
 */
import { ROW_DENSITIES, normalizeViewLayouts, isLayoutColumnId, type RowDensity, type GridLayout } from "./viewLayoutShared";
import { ALL_ALLOWED, prefsUnderPolicy, type PolicyAllowed } from "./customizationPolicyShared";
export const CASELOAD_COLUMNS = ["stage", "nextStep", "applications", "lastActive", "staff", "status"] as const;
export type CaseloadColumn = (typeof CASELOAD_COLUMNS)[number];
export const CASELOAD_COLUMN_LABELS: Record<CaseloadColumn, string> = {
  stage: "Station", nextStep: "Next step", applications: "Applications",
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
export const TODAY_SECTION_KEYS = ["tasks", "retention", "referrals", "interviews", "interview_stalled", "followups", "answered", "acknowledgement", "quiet", "never_started", "unassigned"] as const;
export type TodaySectionKey = (typeof TODAY_SECTION_KEYS)[number];

export const CASELOAD_STATUSES = ["", "behind", "active", "steady", "hired"] as const;
export type CaseloadStatusFilter = (typeof CASELOAD_STATUSES)[number];
export const CASELOAD_STATUS_LABELS: Record<CaseloadStatusFilter, string> = { "": "Everyone", behind: "Gone quiet", active: "Active this week", steady: "Steady", hired: "Hired" };

/** A person's page tabs, in the built-in order (apps/consumer lib/org-person-view.ts PERSON_TABS; a test holds them equal). */
export const PERSON_TAB_KEYS = ["notes", "timeline", "team", "tasks", "referrals", "outcomes", "shared", "screen"] as const;
export type PersonTabKey = (typeof PERSON_TAB_KEYS)[number];

/** How People opens: the list (table) or the grid (spreadsheet). */
export const PEOPLE_MODES = ["list", "grid"] as const;
export type PeopleMode = (typeof PEOPLE_MODES)[number];

/** A named arrangement of the caseload: "My interviews", "Alma's quiet people". */
export interface SavedView { name: string; sort: CaseloadSort; status: CaseloadStatusFilter; staffId: string }
export const MAX_SAVED_VIEWS = 8;

export interface StaffPrefs {
  savedViews: SavedView[];
  /** Where signing in lands. */
  landing: Landing;
  /** Today sections to HIDE (stored as hidden, so a new section shows by default). */
  todayHidden: TodaySectionKey[];
  /** Today sections shown folded: the heading and its count, the rows one tap away. */
  todayCollapsed: TodaySectionKey[];
  caseloadSort: CaseloadSort;
  /** Columns to HIDE. Stored as hidden, so a column added later shows by default. */
  caseloadHidden: CaseloadColumn[];
  noteKind: NoteKind;
  /** Whether "let them see this note" starts ticked. */
  noteVisible: boolean;
  clientTab: ClientTabPref;
  /** Today's sections in this person's own order (the role's order fills in the rest). Empty = the role's order. */
  todayOrder: TodaySectionKey[];
  /** People columns, in order, when no view is chosen. null = the role's layout (minus caseloadHidden). */
  caseloadColumns: string[] | null;
  /** Which view People opens with: a view id, "none" for everyone with no view, null for the usual rule (last chosen, then the role's). */
  defaultView: string | null;
  /** Row height in the People grid. */
  density: RowDensity;
  /** A person's page tabs in this person's own order. Empty = the built-in order. */
  personTabs: PersonTabKey[];
  /** List or grid on People. */
  peopleMode: PeopleMode;
  /** This person's own grid look per view ("default" = no view chosen): widths, frozen, row height, summaries. */
  viewLayouts: Record<string, GridLayout>;
  /** t.ROY's quiet suggestions at pauses (lane S1). On unless turned off. */
  troySuggestions: boolean;
  /** Staff rewards and milestones (lane S6). Off unless the person turns it on (Troy 2026-10-27). */
  rewardsOn: boolean;
}

export const DEFAULT_STAFF_PREFS: StaffPrefs = {
  savedViews: [],
  landing: "today",
  todayHidden: [],
  todayCollapsed: [],
  caseloadSort: "needs_attention",
  caseloadHidden: [],
  noteKind: "note",
  noteVisible: false,
  clientTab: "notes",
  todayOrder: [],
  caseloadColumns: null,
  defaultView: null,
  density: "regular",
  personTabs: [],
  peopleMode: "list",
  viewLayouts: {},
  troySuggestions: true,
  rewardsOn: false,
};

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;

/** Keep only known keys with valid values. The result is PARTIAL on purpose. */
export function normalizeStaffPrefs(raw: unknown): Partial<StaffPrefs> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<StaffPrefs> = {};
  if (Array.isArray(r.savedViews)) {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    out.savedViews = r.savedViews
      .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
      .map((v) => ({
        name: String(v.name ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40),
        sort: oneOf(CASELOAD_SORTS, v.sort) ?? "needs_attention",
        status: oneOf(CASELOAD_STATUSES, v.status) ?? "",
        // A view can NAME a staff member to filter by. It cannot widen reach: the
        // rows come from the server already limited to what this person may see.
        staffId: typeof v.staffId === "string" && (UUID.test(v.staffId) || v.staffId === "__unassigned__") ? v.staffId : "",
      }))
      .filter((v) => v.name.length > 0)
      .slice(0, MAX_SAVED_VIEWS);
  }
  const landing = oneOf(LANDINGS, r.landing);
  if (landing) out.landing = landing;
  if (Array.isArray(r.todayHidden)) out.todayHidden = Array.from(new Set(r.todayHidden.map((c) => oneOf(TODAY_SECTION_KEYS, c)).filter(Boolean))) as TodaySectionKey[];
  if (Array.isArray(r.todayCollapsed)) out.todayCollapsed = Array.from(new Set(r.todayCollapsed.map((c) => oneOf(TODAY_SECTION_KEYS, c)).filter(Boolean))) as TodaySectionKey[];
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
  if (Array.isArray(r.todayOrder)) out.todayOrder = Array.from(new Set(r.todayOrder.map((c) => oneOf(TODAY_SECTION_KEYS, c)).filter(Boolean))) as TodaySectionKey[];
  if (r.caseloadColumns === null) out.caseloadColumns = null;
  else if (Array.isArray(r.caseloadColumns)) {
    out.caseloadColumns = Array.from(new Set(r.caseloadColumns.filter(isLayoutColumnId).filter((c) => c !== "name"))).slice(0, 30);
  }
  if (r.defaultView === null) out.defaultView = null;
  else if (typeof r.defaultView === "string" && (r.defaultView === "none" || VIEW_ID.test(r.defaultView))) out.defaultView = r.defaultView.toLowerCase();
  const density = oneOf(ROW_DENSITIES, r.density);
  if (density) out.density = density;
  if (Array.isArray(r.personTabs)) out.personTabs = Array.from(new Set(r.personTabs.map((c) => oneOf(PERSON_TAB_KEYS, c)).filter(Boolean))) as PersonTabKey[];
  const mode = oneOf(PEOPLE_MODES, r.peopleMode);
  if (mode) out.peopleMode = mode;
  if (r.viewLayouts && typeof r.viewLayouts === "object" && !Array.isArray(r.viewLayouts)) out.viewLayouts = normalizeViewLayouts(r.viewLayouts);
  if (typeof r.troySuggestions === "boolean") out.troySuggestions = r.troySuggestions;
  if (typeof r.rewardsOn === "boolean") out.rewardsOn = r.rewardsOn;
  return out;
}

const VIEW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the screens use. `allowed` is the customization policy for this
 * person's role (all allowed when omitted): a choice it locks falls back to
 * the organization's default, then the built-in one.
 */
export function resolveStaffPrefs(orgDefaults: unknown, own: unknown, allowed: PolicyAllowed = ALL_ALLOWED): StaffPrefs {
  return { ...DEFAULT_STAFF_PREFS, ...normalizeStaffPrefs(orgDefaults), ...prefsUnderPolicy(normalizeStaffPrefs(own), allowed) };
}

/** Typed accessors other lanes read (S1 suggestions, S6 rewards), with their defaults. */
export const staffSuggestionsOn = (p: Partial<StaffPrefs> | null | undefined): boolean => p?.troySuggestions !== false;
export const staffRewardsOn = (p: Partial<StaffPrefs> | null | undefined): boolean => p?.rewardsOn === true;

/**
 * Today's sections in this person's order: their order first (only sections
 * the role shows), then the rest in the role's order. A section added later
 * shows up, never vanishes.
 */
export function orderTodaySections<T extends { key: string }>(sections: readonly T[], own: readonly string[] | undefined): T[] {
  if (!own?.length) return [...sections];
  const byKey = new Map(sections.map((s) => [s.key, s]));
  const first = own.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!);
  const seen = new Set(first.map((s) => s.key));
  return [...first, ...sections.filter((s) => !seen.has(s.key))];
}

/** A person's page tabs in this person's order (same rule as Today). */
export function orderPersonTabs<T extends { key: string }>(tabs: readonly T[], own: readonly string[] | undefined): T[] {
  return orderTodaySections(tabs, own);
}

/**
 * What a write must change on the STORED prefs to go from `before` to
 * `after`: the keys to set (with their new values) and the keys to remove.
 * Writers apply only these (`(prefs - remove) || set`), never the whole
 * object from an earlier read.
 */
export function prefsDelta(before: Partial<StaffPrefs>, after: Partial<StaffPrefs>): { set: Partial<StaffPrefs>; remove: string[] } {
  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  for (const k of Object.keys(DEFAULT_STAFF_PREFS) as (keyof StaffPrefs)[]) {
    const a = before[k], b = after[k];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    if (b === undefined) remove.push(k); else set[k] = b;
  }
  return { set: set as Partial<StaffPrefs>, remove };
}

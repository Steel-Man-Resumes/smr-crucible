/**
 * Career lanes: the pure, client-safe half (no db import). Types, the allowed
 * values, and the validators the API routes and the lane screens share.
 *
 * A lane is one target path under one account (warehouse, kitchen, caregiving).
 * It holds its own resumes and letters and its own format and length setting.
 * The facts underneath stay in ONE place (the profile and the Forge output);
 * a lane never stores a copy of them. Work outside any named lane is the
 * "main" lane (lane_id NULL), which is where every existing account starts.
 *
 * Migration 073 enforces the same rules in the database: hybrid needs both
 * confirmed conditions, a dateless functional format is not a value at all,
 * and a resume can only sit in a lane its own owner holds.
 */

export const LANE_FORMATS = ["chronological", "hybrid"] as const;
export type LaneFormat = (typeof LANE_FORMATS)[number];

export const LANE_LENGTHS = ["auto", "one_page", "two_pages"] as const;
export type LaneLength = (typeof LANE_LENGTHS)[number];

/**
 * What a lane makes (migration 075). "resume": resumes and letters (every lane
 * before 075). "creative": an artist resume, a bio, the person's own statement
 * and a work-sample list, for one practice. A CV and a performer page come
 * later, each as one more value here and in career_lane_kind_check.
 */
export const LANE_KINDS = ["resume", "creative"] as const;
export type LaneKind = (typeof LANE_KINDS)[number];

/** The two-path plan: a realistic job now, and the dream. Null for everyone else. */
export const LANE_PATHS = ["realistic", "dream"] as const;
export type LanePath = (typeof LANE_PATHS)[number];

/** The lane tools that show a one-time introduction (lane_tool_intro.tool). */
export const LANE_TOOLS = ["tailor", "library"] as const;
export type LaneTool = (typeof LANE_TOOLS)[number];

/** lane_tool_intro.lane_key for work outside any named lane. */
export const MAIN_LANE_KEY = "main";

export const LANE_NAME_MAX = 60;
export const LANE_TARGET_MAX = 200;
/** A name made from a Forge target is kept shorter so it fits a phone switcher. */
export const LANE_NAME_FROM_TARGET_MAX = 40;
/** Most open lanes one person may hold. Generous; stops a loop, not a person. */
export const MAX_OPEN_LANES = 12;
/** Most lanes one person may ever make, archived ones included. Bringing one back is the way past it. */
export const MAX_TOTAL_LANES = 40;
/** Lane writes (create, settings, archive, tool notes) per account per day. */
export const LANE_WRITES_PER_DAY = 200;

export interface CareerLane {
  id: string;
  user_id: string;
  name: string;
  target_role: string | null;
  format: LaneFormat;
  hybrid_uneven_history: boolean;
  hybrid_field_change: boolean;
  length_pref: LaneLength;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  /** The lane made automatically from the first Forge resume. */
  is_first?: boolean;
  /** 075. Absent on rows read before 075 is applied; treat as "resume". */
  kind?: LaneKind;
  path?: LanePath | null;
  /** The other lane of a realistic/dream pair. */
  pair_lane_id?: string | null;
  /** Per-lane choices for a non-resume kind (see creativeLaneShared). Never facts. */
  kind_settings?: Record<string, unknown>;
  /** The pair's private plan card. Dream lane only. */
  pair_plan?: Record<string, unknown> | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function isLaneFormat(v: unknown): v is LaneFormat {
  return typeof v === "string" && (LANE_FORMATS as readonly string[]).includes(v);
}

export function isLaneLength(v: unknown): v is LaneLength {
  return typeof v === "string" && (LANE_LENGTHS as readonly string[]).includes(v);
}

export function isLaneKind(v: unknown): v is LaneKind {
  return typeof v === "string" && (LANE_KINDS as readonly string[]).includes(v);
}

export function isLanePath(v: unknown): v is LanePath {
  return typeof v === "string" && (LANE_PATHS as readonly string[]).includes(v);
}

/** A lane's kind, reading rows from before 075 as "resume". */
export function laneKindOf(lane: { kind?: unknown } | null | undefined): LaneKind {
  return isLaneKind(lane?.kind) ? lane.kind : "resume";
}

export function isLaneTool(v: unknown): v is LaneTool {
  return typeof v === "string" && (LANE_TOOLS as readonly string[]).includes(v);
}

/** The lane_tool_intro key for a lane id, or "main" for no lane. */
export function laneKey(laneId: string | null | undefined): string {
  return isUuid(laneId) ? laneId.toLowerCase() : MAIN_LANE_KEY;
}

/** Is this a valid lane_tool_intro key? */
export function isLaneKey(v: unknown): v is string {
  return v === MAIN_LANE_KEY || isUuid(v);
}

/** Trim, drop control characters, collapse runs of spaces, cap the length. */
function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return s ? s : null;
}

export function cleanLaneName(v: unknown): string | null {
  return cleanText(v, LANE_NAME_MAX);
}

export function cleanTargetRole(v: unknown): string | null {
  return cleanText(v, LANE_TARGET_MAX);
}

/**
 * The first lane's name, from the target the person gave in the Forge
 * ("Warehouse Associate"). Null when there is no target: the work then stays
 * in the main lane and nothing is named for them.
 */
export function laneNameFromTarget(target: unknown): string | null {
  const t = cleanText(target, 200);
  if (!t || t.toLowerCase() === "general") return null;
  if (t.length <= LANE_NAME_FROM_TARGET_MAX) return t;
  // Cut at a word boundary so the name never ends mid-word.
  const cut = t.slice(0, LANE_NAME_FROM_TARGET_MAX + 1);
  const atSpace = cut.lastIndexOf(" ");
  return (atSpace > 10 ? cut.slice(0, atSpace) : t.slice(0, LANE_NAME_FROM_TARGET_MAX)).trim();
}

/** Hybrid is offered only when BOTH conditions are confirmed by the person. */
export function hybridAllowed(unevenHistory: boolean, fieldChange: boolean): boolean {
  return unevenHistory === true && fieldChange === true;
}

/** What a create or update may carry. Every field optional on update. */
export interface LaneSettingsInput {
  name?: unknown;
  targetRole?: unknown;
  format?: unknown;
  hybridUnevenHistory?: unknown;
  hybridFieldChange?: unknown;
  lengthPref?: unknown;
  /** Create only: a lane's kind is set once (its documents depend on it). */
  kind?: unknown;
  /** "realistic", "dream", or null to clear. */
  path?: unknown;
}

/** The cleaned settings, as columns. */
export interface LaneSettings {
  name: string;
  target_role: string | null;
  format: LaneFormat;
  hybrid_uneven_history: boolean;
  hybrid_field_change: boolean;
  length_pref: LaneLength;
  kind: LaneKind;
  path: LanePath | null;
}

export type LaneSettingsError =
  | "name_required"
  | "bad_format"
  | "bad_length"
  | "hybrid_needs_both"
  | "bad_kind"
  | "kind_is_fixed"
  | "bad_path";

export type LaneSettingsResult =
  | { ok: true; value: LaneSettings }
  | { ok: false; error: LaneSettingsError };

const LANE_DEFAULTS: LaneSettings = {
  name: "",
  target_role: null,
  format: "chronological",
  hybrid_uneven_history: false,
  hybrid_field_change: false,
  length_pref: "auto",
  kind: "resume",
  path: null,
};

/**
 * Merge an input over the current settings (or the defaults for a new lane)
 * and check the result. A field not sent keeps its value; a field sent with a
 * bad value is refused rather than guessed. Turning off a hybrid condition
 * while the lane is hybrid is refused too: the person picks the dated format
 * first, so the page never silently changes shape under them.
 */
export function resolveLaneSettings(
  input: LaneSettingsInput,
  current?: (Omit<LaneSettings, "kind" | "path"> & { kind?: LaneKind; path?: LanePath | null }) | null
): LaneSettingsResult {
  const base: LaneSettings = current
    ? { ...LANE_DEFAULTS, ...current, kind: laneKindOf(current), path: isLanePath(current.path) ? current.path : null }
    : { ...LANE_DEFAULTS };
  const next: LaneSettings = { ...base };

  if (input.name !== undefined || !current) {
    const name = cleanLaneName(input.name);
    if (!name) return { ok: false, error: "name_required" };
    next.name = name;
  }
  if (input.targetRole !== undefined) next.target_role = cleanTargetRole(input.targetRole);
  if (input.format !== undefined) {
    if (!isLaneFormat(input.format)) return { ok: false, error: "bad_format" };
    next.format = input.format;
  }
  if (input.lengthPref !== undefined) {
    if (!isLaneLength(input.lengthPref)) return { ok: false, error: "bad_length" };
    next.length_pref = input.lengthPref;
  }
  if (input.kind !== undefined) {
    if (!isLaneKind(input.kind)) return { ok: false, error: "bad_kind" };
    // A lane's kind is set when it is made: its documents are built for it.
    if (current && input.kind !== laneKindOf(current)) return { ok: false, error: "kind_is_fixed" };
    next.kind = input.kind;
  }
  if (current) next.kind = laneKindOf(current);
  if (input.path !== undefined) {
    if (input.path !== null && !isLanePath(input.path)) return { ok: false, error: "bad_path" };
    next.path = input.path === null ? null : input.path;
  }
  if (input.hybridUnevenHistory !== undefined) next.hybrid_uneven_history = input.hybridUnevenHistory === true;
  if (input.hybridFieldChange !== undefined) next.hybrid_field_change = input.hybridFieldChange === true;

  // Format and length are resume settings; a creative lane keeps the dated default.
  if (next.kind !== "resume" && next.format !== "chronological") return { ok: false, error: "bad_format" };
  if (next.format === "hybrid" && !hybridAllowed(next.hybrid_uneven_history, next.hybrid_field_change)) {
    return { ok: false, error: "hybrid_needs_both" };
  }
  return { ok: true, value: next };
}

/**
 * Contact details reserved for fiction and documentation, so they cannot be a
 * real person's: a US number 555-0100 to 555-0199, or an email at
 * example.com/.org/.net or under .test, .example or .invalid. The same rule as
 * migration 074, kept here so it is tested and can be reused.
 */
const FICTIONAL_DOMAIN = "@([a-z0-9-]+\\.)*(example\\.(com|org|net)|[a-z0-9-]+\\.(test|example|invalid))";
const FICTIONAL_EMAIL_RE = new RegExp(`${FICTIONAL_DOMAIN}$`);
/** In free text: the address must END at the reserved name (jane@hr.test.com is real). */
const FICTIONAL_EMAIL_IN_TEXT_RE = new RegExp(`${FICTIONAL_DOMAIN}(?![a-z0-9-]|\\.[a-z0-9])`);
const FICTIONAL_PHONE_IN_TEXT_RE = /(?<![A-Za-z0-9_])555[-. ]01[0-9]{2}(?![A-Za-z0-9_])/;

export function isFictionalPhone(phone: unknown): boolean {
  // A phone stored as a JSON number reads the same as SQL's ->> text.
  if (typeof phone !== "string" && typeof phone !== "number") return false;
  return /^1?[0-9]{3}55501[0-9]{2}$/.test(String(phone).replace(/[^0-9]/g, ""));
}

export function isFictionalEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  return FICTIONAL_EMAIL_RE.test(email.trim().toLowerCase());
}

/** Would migration 074 mark this cover letter's text as an example? */
export function looksLikeExampleLetterText(text: unknown): boolean {
  if (typeof text !== "string") return false;
  return FICTIONAL_PHONE_IN_TEXT_RE.test(text) || FICTIONAL_EMAIL_IN_TEXT_RE.test(text.toLowerCase());
}

/** Would migration 074 mark this resume's content as an example? */
export function looksLikeExampleResume(content: unknown): boolean {
  const contact = (content as { contact?: { phone?: unknown; email?: unknown } } | null)?.contact;
  if (!contact || typeof contact !== "object") return false;
  return isFictionalPhone(contact.phone) || isFictionalEmail(contact.email);
}

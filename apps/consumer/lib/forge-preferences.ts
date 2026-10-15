/**
 * Work preferences for the Forge, and the stored-session migration that keeps
 * an in-progress run alive when the choices change.
 *
 * WIRE FORMAT (unchanged, on purpose)
 * `session.preferences` stays a Record<string, string>. Each multi-choice
 * answer is a comma-joined list of ids ("physical, outdoors"). The analyze and
 * generate-docs routes, the account sync (core forgeSession.ts) and the
 * Refinery all read that shape, so nothing server-side has to change when the
 * set of choices grows.
 *
 *   schedule     hours ids, then shift ids        "full-time, evenings"
 *   environment  where and how the work happens   "physical, outdoors"
 *   commute      how they get there, then how far "bus, walk, within-30"
 *   location     free text, "City, ST"
 *
 * The commute answer carries two things in one key (modes plus one distance
 * id) because the analyze prompt only reads `commute`. The mode ids and the
 * distance ids never overlap, so each side can be read back without a second key.
 *
 * VERSIONING
 * A stored run is stamped `_v` (STORED_SESSION_VERSION). A run with no stamp,
 * or an older one, is v1: it holds the original ids. migrateStoredSession maps
 * those ids onto the current ones the first time the run is loaded, so
 * somebody mid-run resumes with their answers intact.
 *
 * Pure functions only: no React, no storage, so the migration is unit tested.
 */

export const STORED_SESSION_VERSION = 2;

export interface PrefOption {
  id: string;
  label: string;
}

export const HOURS_OPTIONS: PrefOption[] = [
  { id: "full-time", label: "Full-time (35+ hours)" },
  { id: "part-time", label: "Part-time" },
  { id: "flexible", label: "Flexible or gig work" },
  { id: "any", label: "Open to anything" },
];

export const SHIFT_OPTIONS: PrefOption[] = [
  { id: "days", label: "Days" },
  { id: "evenings", label: "Evenings" },
  { id: "overnight", label: "Overnight" },
  { id: "weekends", label: "Weekends" },
];

export const ENVIRONMENT_OPTIONS: PrefOption[] = [
  { id: "physical", label: "Physical, hands-on" },
  { id: "outdoors", label: "Outdoors" },
  { id: "on-the-road", label: "On the road (driving, delivery)" },
  { id: "public", label: "With the public" },
  { id: "small-team", label: "With a small team" },
  { id: "on-my-own", label: "Mostly on my own" },
  { id: "office", label: "Office or desk" },
  { id: "remote", label: "Remote, from home" },
];

export const TRANSPORT_OPTIONS: PrefOption[] = [
  { id: "walk", label: "Walk" },
  { id: "bike", label: "Bike" },
  { id: "bus", label: "Bus or transit" },
  { id: "drive", label: "My own vehicle" },
  { id: "ride", label: "A ride from someone" },
];

/** One way, in minutes. Ordered nearest to farthest. */
export const DISTANCE_OPTIONS: PrefOption[] = [
  { id: "within-15", label: "Up to 15 minutes" },
  { id: "within-30", label: "Up to 30 minutes" },
  { id: "within-45", label: "Up to 45 minutes" },
  { id: "within-60", label: "Up to an hour" },
  { id: "further", label: "More than an hour is fine" },
];

const ids = (opts: PrefOption[]) => opts.map((o) => o.id);

/** Ids in a stored answer. Accepts the joined string, or an array from a hand-edited run. */
export function splitPref(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.map((v) => (typeof v === "string" ? v : ""))
    : typeof value === "string"
      ? value.split(",")
      : [];
  const out: string[] = [];
  for (const piece of raw) {
    const id = piece.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function joinPref(selected: string[]): string {
  return selected.join(", ");
}

/**
 * Tap handler for a multi-choice group.
 * - `exclusive`: ids that stand alone ("Open to anything" cannot sit beside
 *   "Part-time"). Picking one clears the rest of the group; picking anything
 *   else clears the exclusive ids.
 * - `single`: at most one id in the group (distance). Tapping the chosen one
 *   again clears it.
 * `group` is every id this group owns, so ids from a neighbouring group that
 * share the same stored answer are left alone.
 */
export function togglePreference(
  current: string[],
  id: string,
  group: string[],
  opts: { exclusive?: string[]; single?: boolean } = {}
): string[] {
  const has = current.includes(id);
  const others = current.filter((x) => !group.includes(x));
  const inGroup = current.filter((x) => group.includes(x));
  if (has) return [...others, ...inGroup.filter((x) => x !== id)];
  if (opts.single || opts.exclusive?.includes(id)) return [...others, id];
  return [...others, ...inGroup.filter((x) => !opts.exclusive?.includes(x)), id];
}

// Stored answers read back per question ----------------------------------------

export function readSchedule(value: unknown): { hours: string[]; shifts: string[] } {
  const all = splitPref(value);
  return {
    hours: all.filter((x) => ids(HOURS_OPTIONS).includes(x)),
    shifts: all.filter((x) => ids(SHIFT_OPTIONS).includes(x)),
  };
}

export function readCommute(value: unknown): { modes: string[]; distance: string | null } {
  const all = splitPref(value);
  return {
    modes: all.filter((x) => ids(TRANSPORT_OPTIONS).includes(x)),
    distance: all.find((x) => ids(DISTANCE_OPTIONS).includes(x)) ?? null,
  };
}

/** Stored order is stable: option order, not tap order, so a saved run reads the same every time. */
function inOptionOrder(selected: string[], options: PrefOption[]): string[] {
  return ids(options).filter((id) => selected.includes(id));
}

export function writeSchedule(hours: string[], shifts: string[]): string {
  return joinPref([...inOptionOrder(hours, HOURS_OPTIONS), ...inOptionOrder(shifts, SHIFT_OPTIONS)]);
}

export function writeEnvironment(selected: string[]): string {
  return joinPref(inOptionOrder(selected, ENVIRONMENT_OPTIONS));
}

export function writeCommute(modes: string[], distance: string | null): string {
  return joinPref([
    ...inOptionOrder(modes, TRANSPORT_OPTIONS),
    ...(distance && ids(DISTANCE_OPTIONS).includes(distance) ? [distance] : []),
  ]);
}

// Migration from the v1 ids -------------------------------------------------------

const LEGACY_ENVIRONMENT: Record<string, string> = { people: "public" };

/**
 * v1 commute ids to the modes and distance they stood for. "short-drive" is the
 * old demo spelling.
 *
 * A distance is inferred ONLY from an id that exists in v1 alone (the drive
 * ones). "walk" and "bus" are current ids too, so a run that already holds them
 * cannot be told apart from an old one: they map to themselves and never gain a
 * distance the person did not pick.
 */
const LEGACY_COMMUTE: Record<string, { mode: string; distance?: string }> = {
  walk: { mode: "walk" },
  bus: { mode: "bus" },
  "drive-short": { mode: "drive", distance: "within-30" },
  "short-drive": { mode: "drive", distance: "within-30" },
  "drive-long": { mode: "drive", distance: "further" },
  "long-drive": { mode: "drive", distance: "further" },
};

function farthest(distances: string[]): string | null {
  const order = ids(DISTANCE_OPTIONS);
  let best: string | null = null;
  for (const d of distances) {
    if (order.includes(d) && (best === null || order.indexOf(d) > order.indexOf(best))) best = d;
  }
  return best;
}

/** A stored answer worth migrating: the joined string, or an array. Anything else is left out, not turned into an empty answer. */
const usable = (v: unknown) => typeof v === "string" || Array.isArray(v);

/**
 * Bring a preferences object up to the current ids. Keys this module does not
 * own (location, workType from a carry code, anything a later feature adds) are
 * copied through untouched. Ids that are already current pass through, so the
 * function is safe to run on a v2 run and on a half-migrated one.
 */
export function migratePreferences(prefs: unknown): Record<string, string> {
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return {};
  const src = prefs as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "string") out[k] = v;
  }

  if (usable(src.schedule)) {
    const { hours, shifts } = readSchedule(src.schedule);
    out.schedule = writeSchedule(hours, shifts);
  }

  if (usable(src.environment)) {
    const mapped = splitPref(src.environment).map((id) => LEGACY_ENVIRONMENT[id] ?? id);
    out.environment = writeEnvironment(mapped);
  }

  if (usable(src.commute)) {
    const modes: string[] = [];
    const distances: string[] = [];
    for (const id of splitPref(src.commute)) {
      const legacy = LEGACY_COMMUTE[id];
      if (legacy) {
        modes.push(legacy.mode);
        if (legacy.distance) distances.push(legacy.distance);
      } else if (ids(DISTANCE_OPTIONS).includes(id)) {
        distances.push(id);
      } else {
        modes.push(id);
      }
    }
    out.commute = writeCommute(modes, farthest(distances));
  }

  return out;
}

/**
 * Bring a stored Forge run up to STORED_SESSION_VERSION.
 * Returns a new object; the input is never changed. Everything the page does
 * not know about (account stamps, carried-in data, resume work) is kept as is.
 * A stored value that is not an object is not a run, so it comes back empty.
 */
export function migrateStoredSession(stored: unknown): {
  session: Record<string, unknown>;
  migrated: boolean;
} {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { session: {}, migrated: false };
  }
  const src = stored as Record<string, unknown>;
  const version = typeof src._v === "number" ? src._v : 1;
  if (version >= STORED_SESSION_VERSION) return { session: { ...src }, migrated: false };

  const next: Record<string, unknown> = { ...src, _v: STORED_SESSION_VERSION };
  if (src.preferences !== undefined) next.preferences = migratePreferences(src.preferences);
  return { session: next, migrated: true };
}

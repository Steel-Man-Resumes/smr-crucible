/**
 * Career lanes in the Refinery: the copy the lane screens show and the small
 * pure helpers the routes and screens share. No imports from the server.
 *
 * A lane is one target path (warehouse, kitchen, caregiving). Each keeps its
 * own resumes and letters and its own format and length setting. The facts
 * underneath are one set, never asked for again per lane. "Main" is the work
 * outside any named lane (lane_id NULL), where every existing account starts.
 */

import type { LaneFormat, LaneLength, LaneSettingsError, LaneTool } from "@crucible/core/src/careerLaneShared";
import { isUuid, MAIN_LANE_KEY } from "@crucible/core/src/careerLaneShared";

/** What the screens hold for "which lane": a lane id, or "main". The Library also allows "all". */
export type LaneChoice = string; // uuid | "main"
export type LibraryLaneChoice = LaneChoice | "all";

export const MAIN_LANE_LABEL = "Main";

/** Per-browser memory of the lane the person last worked in, per account. A convenience only. */
export function activeLaneStorageKey(userId: string | null | undefined): string | null {
  return userId ? `smr_active_lane:${userId}` : null;
}

/** The event the lane screens send when the lane list or the active lane changes. */
export const LANES_CHANGED_EVENT = "lanes-changed";

/**
 * The lane a screen works in: the one the person picked in this browser when
 * it is still one of their open lanes ("main" counts as a pick); otherwise
 * the fallback the server gave (the open lane holding their newest resume);
 * otherwise main. Never a lane that is gone or archived.
 */
export function resolveActiveLane(remembered: unknown, openLaneIds: string[], fallback?: unknown): LaneChoice {
  if (remembered === MAIN_LANE_KEY) return MAIN_LANE_KEY;
  if (typeof remembered === "string" && isUuid(remembered) && openLaneIds.includes(remembered.toLowerCase())) return remembered.toLowerCase();
  if (typeof fallback === "string" && isUuid(fallback) && openLaneIds.includes(fallback.toLowerCase())) return fallback.toLowerCase();
  return MAIN_LANE_KEY;
}

/** ?laneId= for /api/artifacts: a lane id, "main", or nothing (every lane). */
export function laneFilterParam(choice: LibraryLaneChoice | null | undefined): string | null {
  if (choice === MAIN_LANE_KEY) return MAIN_LANE_KEY;
  if (typeof choice === "string" && isUuid(choice)) return choice.toLowerCase();
  return null;
}

/** The lane id to save new work under: null for main. */
export function laneIdForSave(choice: LaneChoice | null | undefined): string | null {
  return typeof choice === "string" && isUuid(choice) ? choice.toLowerCase() : null;
}

/** Server: read ?laneId= ("main" or a uuid). Anything else is ignored, never guessed. */
export function parseLaneIdParam(v: string | null): string | undefined {
  if (v === MAIN_LANE_KEY) return MAIN_LANE_KEY;
  if (v && isUuid(v)) return v.toLowerCase();
  return undefined;
}

/** Server: read ?examples= ("hide" | "only"). Absent keeps the old behaviour (everything). */
export function parseExamplesParam(v: string | null): "hide" | "only" | undefined {
  return v === "hide" || v === "only" ? v : undefined;
}

/** Server: a body's laneId. undefined = not sent; null = main; a uuid = that lane; "bad" = refuse. */
export function parseLaneIdBody(v: unknown): string | null | undefined | "bad" {
  if (v === undefined) return undefined;
  if (v === null || v === MAIN_LANE_KEY) return null;
  if (isUuid(v)) return v.toLowerCase();
  return "bad";
}

/**
 * The tailor's writer reads the lane's length choice. Only "one page" changes
 * anything: "let my history decide" and "up to two pages" are the writer's
 * standing rule (two pages only when the true history fills them, never more).
 * The hybrid layout is a renderer change still to come; until then the lane
 * stores the choice and the writer is not told a layout it cannot produce.
 */
export function laneWriterNote(lane: { length_pref?: unknown } | null | undefined): string {
  if (lane?.length_pref === "one_page") {
    return "\n\nLENGTH (the person's choice for this kind of work): one page. Lead with the strongest true lines and use fewer bullets on older jobs. Never drop a job, a date or a credential to make it fit, and never add anything.";
  }
  return "";
}

/* ------------------------------------------------------------------ copy -- */

export const FORMAT_COPY: Record<LaneFormat, { label: string; body: string }> = {
  chronological: {
    label: "Dates first",
    body: "Your jobs in order, newest first, with the years on each one. Employers and background checks look for dates, so this fits almost everyone.",
  },
  hybrid: {
    label: "Skills on top, dates kept",
    body: "A short list of your skills up top, then every job with its years and what you did there. Only when both boxes below are true for you.",
  },
};

/**
 * Hybrid is stored per lane and checked in the database, but nothing renders
 * it yet, so the screens do not offer it (house truth rule). This is all they
 * say about it until the renderer ships.
 */
export const HYBRID_COMING_COPY =
  "Hybrid layout is coming: a short skills list on top, then every job with its years. When it's ready, you'll pick it here.";

/** The format a lane's summary shows. A stored hybrid is not claimed as the page. */
export function formatSummaryLabel(format: LaneFormat): string {
  return format === "hybrid" ? "Hybrid saved for when it's ready" : FORMAT_COPY.chronological.label;
}

export const HYBRID_CONDITION_COPY = {
  uneven: "My work history is uneven. For example, long stretches between jobs.",
  fieldChange: "I'm moving into a new kind of work, and my skills carry over.",
};

export const NO_FUNCTIONAL_COPY =
  "Why not a skills-only page with no dates? A background check shows your dates anyway, and a page that hides them reads like you're hiding something. We don't build that one.";

export const LENGTH_COPY: Record<LaneLength, { label: string; body: string }> = {
  auto: {
    label: "Let my history decide",
    body: "One page, or two when your real history fills them. Never filler, never more than two.",
  },
  one_page: {
    label: "One page",
    body: "Your strongest lines lead. Nothing gets padded and nothing gets made up to fill space.",
  },
  two_pages: {
    label: "Up to two pages",
    body: "Two pages only when your history fills them. If it fits on one, it stays on one.",
  },
};

export const FACTS_CARRY_COPY = "Your facts carry over: same jobs, same dates. Only the aim changes.";

/** t.ROY's one line the first time a person opens a tool in a lane. */
export function laneIntroLine(tool: LaneTool, laneName: string | null): string {
  if (tool === "tailor") {
    return laneName
      ? `This is your ${laneName} lane. The Tailor aims your resume at one ${laneName} job at a time. Same facts, sharper aim.`
      : "The Tailor aims your resume at one job at a time. Want to aim at a second kind of work too? Start a new lane.";
  }
  return laneName
    ? `This is everything you made in your ${laneName} lane. Pick "All lanes" to see the rest.`
    : "Your Library keeps every resume and letter you made, sorted by lane.";
}

export const LANE_ERROR_COPY: Record<
  | LaneSettingsError
  | "duplicate_name"
  | "too_many"
  | "too_many_total"
  | "too_many_writes"
  | "not_found"
  | "failed"
  | "in_pair"
  | "has_plan"
  | "pair_refused",
  string
> = {
  name_required: "Give the lane a name.",
  bad_format: "Pick one of the two formats.",
  bad_length: "Pick one of the length choices.",
  bad_kind: "Pick a resume lane, a creative lane, a CV lane or a performer lane.",
  bad_cv_type: "Pick academic, teaching, clinical or international.",
  kind_is_fixed: "A lane keeps the kind it started with. Start a new lane for the other kind.",
  bad_path: "Pick realistic, dream, or neither.",
  in_pair: "This lane is paired. Unpair it first, then change its path.",
  has_plan: "This dream lane holds your plan card. Keep it as your dream lane, or pair it again.",
  pair_refused: "Those two lanes can't be paired. Each one has to be open and not in another pair.",
  hybrid_needs_both: "Skills on top needs both boxes checked. Otherwise dates first is the right call.",
  duplicate_name: "You already have a lane with that name.",
  too_many: "That's the most lanes at once. Archive one first.",
  too_many_total: "You've made a lot of lanes. Bring back an archived one instead.",
  too_many_writes: "That's a lot of lane changes for one day. Try again tomorrow.",
  not_found: "That lane isn't there anymore. Refresh the page.",
  failed: "That didn't save. Try again.",
};

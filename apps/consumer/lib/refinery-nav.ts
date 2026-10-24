/**
 * The Refinery nav as a game board (2026-10-23).
 *
 * One path of stations in the order the work happens, lit by the
 * server-owned progression (lib/progression-ui.ts). This module is pure data
 * and pure functions: it never awards, unlocks or decides access. The shell
 * asks the server's progress (stepForNav) and the tier gate for that.
 *
 * Ids are a shared contract with the tour and meter lanes. Each station's
 * wrapper carries `navId` (element id and data-tour). The legacy targets the
 * current guided tour still uses ride on the station's header link as
 * `legacyId`, so nothing that points at the old nav breaks.
 */
import type { ProgressStep, ProgressStepId } from "./progression-ui";
import type { UserTier } from "./useUserTier";
import type { OnboardingState } from "./useOnboarding";

export type StationId = "overview" | "find" | "tailor" | "plan" | "practice" | "apply" | "next";

export interface BoardLink {
  href: string;
  label: string;
  minTier: UserTier;
  minState: OnboardingState;
  requiresDisclosure?: boolean;
  /** Legacy guided-tour target kept on this link. */
  legacyId?: string;
}

export interface Station extends BoardLink {
  id: StationId;
  /** Contract id: element id and data-tour on the station wrapper. */
  navId: string;
  /** Short words under the label: what this part of the process is for. */
  blurb: string;
  /** Progression steps whose state this station shows, in order. */
  steps: readonly ProgressStepId[];
  /** Steps that make this station the current one (a superset of `steps`). */
  currentFor: readonly ProgressStepId[];
  children: BoardLink[];
}

const C = { minTier: "client", minState: "needs_profile" } as const;

export const STATIONS: readonly Station[] = [
  { id: "overview", navId: "refinery-nav-overview", href: "/dashboard", label: "Overview", blurb: "Where you are and what is next",
    minTier: "observer", minState: "needs_profile", steps: [], currentFor: [],
    children: [{ href: "/dashboard/progress", label: "Progress", minTier: "observer", minState: "needs_profile" }] },
  { id: "find", navId: "refinery-nav-find", legacyId: "refinery-nav-jobs", href: "/dashboard/jobs", label: "Find work", blurb: "Pick a real job worth going after",
    ...C, steps: ["direction"], currentFor: ["direction"],
    children: [
      { href: "/dashboard/jobs", label: "Jobs", ...C },
      { href: "/dashboard/paths", label: "Explore paths", ...C },
      { href: "/dashboard/employers", label: "Employers", ...C },
    ] },
  { id: "tailor", navId: "refinery-nav-tailor", legacyId: "refinery-nav-resumes", href: "/dashboard/vault", label: "Tailor and package", blurb: "Your resumes, fitted to the job",
    ...C, steps: ["foundation", "tailor"], currentFor: ["foundation", "tailor"],
    children: [
      { href: "/dashboard/master", label: "Master Draft", ...C },
      { href: "/dashboard/vault", label: "Resumes and versions", ...C },
      { href: "/dashboard/application-tailor", label: "Tailor for a job", minTier: "client", minState: "needs_resume" },
      { href: "/dashboard/creative", label: "Creative work", ...C },
      { href: "/dashboard/cv", label: "CV", ...C },
      { href: "/dashboard/performer", label: "Performer page", ...C },
    ] },
  { id: "plan", navId: "refinery-nav-plan", href: "/dashboard/disclosure", label: "Plan what to say", blurb: "Your record, in your own words",
    ...C, steps: [], currentFor: [],
    children: [
      { href: "/dashboard/disclosure", label: "Disclosure plan", ...C },
      { href: "/dashboard/documents", label: "Private records and documents", ...C },
    ] },
  { id: "practice", navId: "refinery-nav-practice", legacyId: "refinery-nav-interview", href: "/dashboard/interview", label: "Practice", blurb: "Interview practice when the time is right",
    ...C, steps: ["interview"], currentFor: ["interview"], children: [] },
  { id: "apply", navId: "refinery-nav-apply", legacyId: "refinery-nav-applications", href: "/dashboard/applications", label: "Apply and track", blurb: "Send it, then keep track",
    ...C, steps: ["apply"], currentFor: ["apply", "offer"], children: [] },
  { id: "next", navId: "refinery-nav-next", legacyId: "refinery-nav-support", href: "/dashboard/next", label: "What comes next", blurb: "School, money, health, the rest of life",
    ...C, steps: [], currentFor: [],
    children: [{ href: "/dashboard/resources", label: "Local help", ...C }] },
];

export const STATION_IDS: readonly StationId[] = STATIONS.map((s) => s.id);

export interface BoardGroup {
  id: "toolbox" | "you" | "program";
  label: string;
  /** Contract id on the group wrapper (none for the partner group). */
  navId?: string;
  items: BoardLink[];
}

/** Below the path. The toolbox grows: anything that is not a station goes here. */
export const BOARD_GROUPS: readonly BoardGroup[] = [
  { id: "toolbox", label: "Toolbox", navId: "refinery-nav-toolbox", items: [
    { href: "/dashboard/help", label: "Help and tour", minTier: "observer", minState: "needs_profile" },
    { href: "/dashboard/help?mode=idea", label: "Share an idea", minTier: "observer", minState: "needs_profile" },
    { href: "/dashboard/record-check", label: "Get your records", ...C },
    { href: "/dashboard/settings", label: "Settings", legacyId: "refinery-nav-settings", minTier: "observer", minState: "needs_profile" },
    { href: "/dashboard/admin", label: "Admin", minTier: "admin", minState: "needs_profile" },
    { href: "/dashboard/admin/access-requests", label: "Access requests", minTier: "admin", minState: "needs_profile" },
  ] },
  { id: "you", label: "You", navId: "refinery-nav-you", items: [
    { href: "/dashboard/settings#account", label: "Profile and contact details", minTier: "observer", minState: "needs_profile" },
    { href: "/dashboard/settings#privacy", label: "Sharing and privacy", minTier: "observer", minState: "needs_profile" },
    { href: "/dashboard/settings#data", label: "Export or delete my data", minTier: "observer", minState: "needs_profile" },
  ] },
  { id: "program", label: "Program", items: [
    { href: "/dashboard/partner", label: "Partner Dashboard", minTier: "partner", minState: "needs_profile" },
  ] },
];

/** Legacy guided-tour target -> the contract station or group id it now sits inside. */
export const LEGACY_NAV_ALIASES: Readonly<Record<string, string>> = {
  "refinery-nav-overview": "refinery-nav-overview",
  "refinery-nav-jobs": "refinery-nav-find",
  "refinery-nav-resumes": "refinery-nav-tailor",
  "refinery-nav-applications": "refinery-nav-apply",
  "refinery-nav-interview": "refinery-nav-practice",
  "refinery-nav-support": "refinery-nav-next",
  "refinery-nav-settings": "refinery-nav-toolbox",
};

/** Every contract id the nav ships (stations, groups, meter). */
export const BOARD_CONTRACT_IDS: readonly string[] = [
  ...STATIONS.map((s) => s.navId),
  "refinery-nav-toolbox", "refinery-nav-you", "refinery-meter",
];

/**
 * The lock copy, matched to progression-server.ts requestProgressionAccess:
 * an unlock request without `escalate` grants early access to the guided step
 * on the spot. Only extra AI actions, feedback and bug reports go to Troy's
 * review, so the nav promises an opening and nothing more.
 */
export const ASK_TROY_ACTION = "Ask t.ROY to open this early";
export const ASK_TROY_HINT = "He opens guided steps when you ask.";
export const ASK_TROY_LINE = `${ASK_TROY_ACTION}. ${ASK_TROY_HINT}`;

function pathOnly(href: string): string {
  return href.split(/[?#]/)[0];
}

/** Which station a page belongs to. Toolbox and You pages belong to none. */
export function stationForPath(pathname: string): StationId | null {
  const path = pathOnly(pathname);
  // Children first (a child of one station can share a prefix with another).
  for (const station of STATIONS) {
    if (station.children.some((child) => pathOnly(child.href) === path)) return station.id;
  }
  for (const station of STATIONS) {
    const home = pathOnly(station.href);
    if (path === home) return station.id;
    if (home !== "/dashboard" && path.startsWith(home + "/")) return station.id;
  }
  for (const station of STATIONS) {
    if (station.children.some((child) => { const c = pathOnly(child.href); return c !== "/dashboard" && path.startsWith(c + "/"); })) return station.id;
  }
  if (path === "/dashboard/interview-prep" || path.startsWith("/dashboard/interview-prep/")) return "practice";
  return null;
}

/** The station a progression step lives on. */
export function stationForStep(stepId: ProgressStepId): StationId {
  return STATIONS.find((s) => s.currentFor.includes(stepId))?.id ?? "overview";
}

export type StationTone = "completed" | "current" | "locked" | "early" | "open" | "plain";

export interface StationStatus {
  tone: StationTone;
  /** The step whose words show under the label, when the station has one. */
  step: ProgressStep | null;
  /** Lit as the server's current step. */
  current: boolean;
  completed: boolean;
}

/**
 * How a station reads on the board, from the server's steps alone. The
 * station shows its first unfinished step; it is complete only when every
 * step it carries is complete. With no progress data it is plain.
 */
export function stationStatus(station: Station, steps: readonly ProgressStep[] | null | undefined, currentStepId?: ProgressStepId | null): StationStatus {
  if (!steps || !steps.length) return { tone: "plain", step: null, current: false, completed: false };
  const own = station.steps.map((id) => steps.find((s) => s.id === id)).filter((s): s is ProgressStep => !!s);
  const current = !!currentStepId && station.currentFor.includes(currentStepId);
  if (!own.length) return { tone: current ? "current" : "plain", step: null, current, completed: false };
  const completed = own.every((s) => s.state === "completed");
  const step = own.find((s) => s.state !== "completed") ?? own[own.length - 1];
  const tone: StationTone = current && !completed ? "current"
    : completed ? "completed"
    : step.access === "locked" ? "locked"
    : step.access === "early" ? "early" : "open";
  return { tone, step, current, completed };
}

/**
 * The station shown open (children expanded): the one holding the page the
 * person is on, otherwise the server's current one.
 */
export function expandedStation(pathname: string, currentStepId?: ProgressStepId | null): StationId | null {
  return stationForPath(pathname) ?? (currentStepId ? stationForStep(currentStepId) : null);
}

/** The station the mobile strip lights and labels. Same rule; Overview when nothing else is known. */
export function stripCurrentStation(pathname: string, currentStepId?: ProgressStepId | null): StationId {
  return expandedStation(pathname, currentStepId) ?? "overview";
}

/**
 * Legacy seven-stage journey (packages/core journeyStages, stages 0-6) shown
 * on the board's vocabulary. Display mapping only; core data is unchanged and
 * no third vocabulary is added. Stage 4 (plan what to say) has no progression
 * step and maps to its own station.
 */
const JOURNEY_STAGE_TO_STEP: Readonly<Record<number, ProgressStepId | null>> = {
  0: null, 1: "foundation", 2: "direction", 3: "tailor", 4: null, 5: "interview", 6: "apply",
};
const JOURNEY_STAGE_TO_STATION: Readonly<Record<number, StationId>> = {
  0: "overview", 1: "tailor", 2: "find", 3: "tailor", 4: "plan", 5: "practice", 6: "apply",
};
export function progressStepForJourneyStage(stage: number): ProgressStepId | null {
  return JOURNEY_STAGE_TO_STEP[stage] ?? null;
}
export function stationForJourneyStage(stage: number): StationId {
  return JOURNEY_STAGE_TO_STATION[stage] ?? (stage > 6 ? "next" : "overview");
}

/** Shown only when the user's tier can ever reach the item (partner-only, admin-only hidden). */
export function boardShowsItem(item: Pick<BoardLink, "minTier">, userTier: UserTier): boolean {
  if (item.minTier === "admin" && userTier !== "admin") return false;
  if (item.minTier === "partner" && userTier !== "partner" && userTier !== "admin") return false;
  return true;
}

/** aria-current: the exact page, ignoring any hash on the link. */
export function linkIsCurrent(href: string, pathname: string): boolean {
  if (href.includes("#") || href.includes("?")) return false;
  return pathOnly(href) === pathOnly(pathname);
}

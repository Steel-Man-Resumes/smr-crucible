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
  /** Shown only while this server switch is on (lib/server-switch.ts via ServerSwitches). */
  requiresSwitch?: "recordStep";
}

export interface Station extends BoardLink {
  id: StationId;
  /** Contract id: element id and data-tour on the station wrapper. */
  navId: string;
  /** Short words under the label: what this part of the process is for. */
  blurb: string;
  /** One word for the mobile strip, where seven stations share a phone's width. */
  short: string;
  /** Progression steps whose state this station shows, in order. */
  steps: readonly ProgressStepId[];
  /** Steps that make this station the current one (a superset of `steps`). */
  currentFor: readonly ProgressStepId[];
  children: BoardLink[];
}

const C = { minTier: "client", minState: "needs_profile" } as const;

export const STATIONS: readonly Station[] = [
  { id: "overview", short: "Overview", navId: "refinery-nav-overview", href: "/dashboard", label: "Overview", blurb: "Where you are and what is next",
    minTier: "observer", minState: "needs_profile", steps: [], currentFor: [],
    children: [{ href: "/dashboard/progress", label: "Progress", minTier: "observer", minState: "needs_profile" }] },
  { id: "find", short: "Find", navId: "refinery-nav-find", legacyId: "refinery-nav-jobs", href: "/dashboard/jobs", label: "Find work", blurb: "Pick a real job worth going after",
    ...C, steps: ["direction"], currentFor: ["direction"],
    children: [
      { href: "/dashboard/jobs", label: "Jobs", ...C },
      { href: "/dashboard/paths", label: "Explore paths", ...C },
      { href: "/dashboard/employers", label: "Employers", ...C },
    ] },
  { id: "tailor", short: "Tailor", navId: "refinery-nav-tailor", legacyId: "refinery-nav-resumes", href: "/dashboard/vault", label: "Tailor and package", blurb: "Your resumes, fitted to the job",
    ...C, steps: ["foundation", "tailor"], currentFor: ["foundation", "tailor"],
    children: [
      { href: "/dashboard/master", label: "Master Draft", ...C },
      { href: "/dashboard/vault", label: "Resumes and versions", ...C },
      { href: "/dashboard/application-tailor", label: "Tailor for a job", minTier: "client", minState: "needs_resume" },
      { href: "/dashboard/creative", label: "Creative work", ...C },
      { href: "/dashboard/cv", label: "CV", ...C },
      { href: "/dashboard/performer", label: "Performer page", ...C },
    ] },
  { id: "plan", short: "Plan", navId: "refinery-nav-plan", href: "/dashboard/disclosure", label: "Plan what to say", blurb: "Your record, in your own words",
    ...C, steps: [], currentFor: [],
    children: [
      { href: "/dashboard/disclosure", label: "Disclosure plan", ...C },
      { href: "/dashboard/documents", label: "Private records and documents", ...C },
    ] },
  { id: "practice", short: "Practice", navId: "refinery-nav-practice", legacyId: "refinery-nav-interview", href: "/dashboard/interview", label: "Practice", blurb: "Interview practice when the time is right",
    ...C, steps: ["interview"], currentFor: ["interview"], children: [] },
  { id: "apply", short: "Apply", navId: "refinery-nav-apply", legacyId: "refinery-nav-applications", href: "/dashboard/applications", label: "Apply and track", blurb: "Send it, then keep track",
    ...C, steps: ["apply"], currentFor: ["apply", "offer"], children: [] },
  { id: "next", short: "Next", navId: "refinery-nav-next", legacyId: "refinery-nav-support", href: "/dashboard/next", label: "What comes next", blurb: "School, money, health, the rest of life",
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
    { href: "/dashboard/record-check", label: "Get your records", ...C, requiresSwitch: "recordStep" },
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
  /** The station carries more than one step, so its status line names the step. */
  named?: boolean;
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
  // Locked only when nothing on the station is open: a finished step (Tailor
  // and package's starting resume) keeps its links open even while the next
  // step there is locked.
  const allLocked = own.every((s) => s.access === "locked" && s.state !== "completed");
  const tone: StationTone = current && !completed ? "current"
    : completed ? "completed"
    : allLocked ? "locked"
    : step.access === "early" ? "early" : "open";
  return { tone, step, current, completed, named: own.length > 1 };
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

/** A switched-off step is never linked: its screen is a 404 until the switch is on. Default OFF. */
export function boardSwitchAllows(item: Pick<BoardLink, "requiresSwitch">, switches: { recordStep: boolean } | null | undefined): boolean {
  return !item.requiresSwitch || !!switches?.[item.requiresSwitch];
}

/** aria-current: the exact page, ignoring any hash on the link. */
export function linkIsCurrent(href: string, pathname: string): boolean {
  if (href.includes("#") || href.includes("?")) return false;
  return pathOnly(href) === pathOnly(pathname);
}

/* Admin mode */
/*
 * The platform admin's sidebar (house build 2026-10-26, L1). Shown when the
 * REAL signed-in account is a platform admin and no view-as is active
 * (adminSidebarShown). An admin never gets the participant career board as
 * their nav or their home: /dashboard is Operator home.
 */

export interface AdminNavItem {
  href: string;
  label: string;
  /** Contract id: data-nav-id and data-tour on the link. */
  navId: string;
  /** Lit for this exact path only (Evidence is /dashboard/admin, the parent of the others). */
  exact?: boolean;
}
export interface AdminNavGroup { label: string; items: AdminNavItem[] }

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    label: "Platform",
    items: [
      { href: "/dashboard", label: "Operator home", navId: "admin-nav-home", exact: true },
      { href: "/dashboard/admin/orgs", label: "Organizations", navId: "admin-nav-orgs" },
      { href: "/dashboard/admin/users", label: "People", navId: "admin-nav-people" },
      { href: "/dashboard/admin/access-requests", label: "Access requests", navId: "admin-nav-access" },
    ],
  },
  {
    label: "Products",
    items: [
      { href: "/dashboard/admin/premium", label: "Premium", navId: "admin-nav-premium" },
      { href: "/dashboard/admin/mini-forge", label: "Mini Forge", navId: "admin-nav-mini-forge" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/dashboard/admin/health", label: "Health", navId: "admin-nav-health" },
      { href: "/dashboard/admin/directory-coverage", label: "Coverage", navId: "admin-nav-coverage" },
      { href: "/dashboard/admin", label: "Evidence", navId: "admin-nav-evidence", exact: true },
    ],
  },
];

/**
 * Admin mode: the real account is a platform admin and nothing is being
 * viewed as someone else. Pure, so the rule is tested without rendering.
 * `role` is the RoleProvider payload (null while it loads: no admin nav yet).
 */
export function adminSidebarShown(role: { tier: string; impersonating: unknown } | null | undefined): boolean {
  return !!role && role.tier === "admin" && !role.impersonating;
}

/** Which admin item is lit. */
export function adminNavActive(item: Pick<AdminNavItem, "href" | "exact">, pathname: string): boolean {
  const path = pathOnly(pathname);
  if (item.exact) return path === item.href;
  return path === item.href || path.startsWith(item.href + "/");
}

/* Nav extension points */
/*
 * ONE LINE PER NEW SCREEN. Other lanes build screens (org structure, fields and
 * views, audit, referrals, timeline, AI); the boss wires each into the nav by
 * adding one entry here. Nothing else changes: the admin sidebar reads the
 * "admin" entries (adminNavWith), the staff sidebar reads the "org" entries
 * (orgNavWithExtensions in lib/org-nav.ts, via OrgSidebar).
 *
 *   surface  "admin": platform admin sidebar; "org": staff workspace sidebar
 *   group    an existing group label (admin: Platform, Products, System;
 *            org: Work, Records, Organization) or a new one, added at the end
 *   needs    org only: the capability the item needs (same as lib/org-nav.ts)
 *   module   org only: an org_profile.modules key (L3a); hidden when that
 *            module is switched off for the organization
 *   after    optional: the label of the item to place it after; else last
 *
 * Examples (commented until each screen merges):
 *   { surface: "org", group: "Organization", href: "/dashboard/structure", label: "Programs and sites", navId: "org-nav-structure", needs: "org.settings.manage" },
 *   { surface: "org", group: "Records", href: "/dashboard/audit", label: "Activity log", navId: "org-nav-audit", needs: "org.audit.view" },
 *   { surface: "org", group: "Work", href: "/dashboard/referrals", label: "Referrals", navId: "org-nav-referrals", module: "referrals", after: "Asks" },
 *   { surface: "admin", group: "System", href: "/dashboard/admin/ai-runs", label: "AI runs", navId: "admin-nav-ai-runs" },
 */
export interface NavExtension {
  surface: "admin" | "org";
  group: string;
  href: string;
  label: string;
  navId: string;
  needs?: string;
  module?: string;
  after?: string;
}

export const NAV_EXTENSIONS: readonly NavExtension[] = [
  // House L3b (102): the organization's activity log.
  { surface: "org", group: "Organization", href: "/dashboard/audit", label: "Activity log", navId: "org-nav-audit", needs: "org.audit.view" },
  // House L3a (103): the organization's programs, sites, teams and caseloads, and first-run setup.
  { surface: "org", group: "Organization", href: "/dashboard/structure", label: "Structure", navId: "org-nav-structure", needs: "org.cohort.view", after: "Team & access" },
  { surface: "org", group: "Organization", href: "/dashboard/setup", label: "Set up", navId: "org-nav-setup", needs: "org.settings.manage" },
  // House L4 (104): the org's own fields and per-role layouts. Anyone who sees
  // the caseload may open them read-only (so they know what a field means);
  // changes need org.settings.manage, checked by the routes and the database.
  { surface: "org", group: "Organization", href: "/dashboard/fields", label: "Fields", navId: "org-nav-fields", needs: "org.cohort.view", module: "custom_fields", after: "Structure" },
  { surface: "org", group: "Organization", href: "/dashboard/layouts", label: "Layouts", navId: "org-nav-layouts", needs: "org.cohort.view", after: "Fields" },
  // House L5 (105): find anyone you work with, and closed-loop referrals (off with the org's referrals module).
  { surface: "org", group: "Work", href: "/dashboard/search", label: "Find a person", navId: "org-nav-search", needs: "org.client.view_content", after: "People" },
  { surface: "org", group: "Work", href: "/dashboard/referrals", label: "Referrals", navId: "org-nav-referrals", needs: "org.client.view_content", module: "referrals", after: "Asks" },
];

/**
 * Merge extension entries into a list of groups. Pure. An entry whose `after`
 * names an item in its group goes right after it; otherwise last in the
 * group; a new group label becomes a new group at the end. A duplicate href
 * is ignored, so wiring the same screen twice cannot show it twice.
 */
export function mergeNavExtensions<I extends { href: string; label: string; navId?: string }>(
  groups: readonly { label: string; items: readonly I[] }[],
  extensions: readonly NavExtension[],
  toItem: (e: NavExtension) => I
): { label: string; items: I[] }[] {
  const out = groups.map((g) => ({ label: g.label, items: [...g.items] }));
  const seen = new Set(out.flatMap((g) => g.items.map((i) => i.href)));
  for (const e of extensions) {
    if (seen.has(e.href)) continue;
    seen.add(e.href);
    let group = out.find((g) => g.label === e.group);
    if (!group) { group = { label: e.group, items: [] }; out.push(group); }
    const at = e.after ? group.items.findIndex((i) => i.label === e.after) : -1;
    if (at >= 0) group.items.splice(at + 1, 0, toItem(e));
    else group.items.push(toItem(e));
  }
  return out;
}

/** The admin sidebar with its extension entries. */
export function adminNavWith(extensions: readonly NavExtension[] = NAV_EXTENSIONS): AdminNavGroup[] {
  return mergeNavExtensions(ADMIN_NAV, extensions.filter((e) => e.surface === "admin"), (e) => ({ href: e.href, label: e.label, navId: e.navId }));
}

/**
 * The staff sidebar's extension entries for one person: capability and module
 * gates applied. `modules` is the org's module switches (absent: all on).
 */
export function orgNavExtensionsFor(capabilities: readonly string[], modules?: Readonly<Record<string, boolean>> | null,
  extensions: readonly NavExtension[] = NAV_EXTENSIONS): NavExtension[] {
  return extensions.filter((e) => e.surface === "org"
    && (!e.needs || capabilities.includes(e.needs))
    && (!e.module || !modules || modules[e.module] !== false));
}

/**
 * Shared, client-safe definitions for t.ROY's hands.
 *
 * This module is pure data -- no server imports -- so both the server tool
 * factory (assistant-tools.ts) and the client executor (AssistantChat) read
 * the same page allowlist and spotlight-target registry. The model never
 * writes raw hrefs or CSS selectors; it picks from these names.
 */

/** Pages t.ROY may navigate to inside the Refinery (post-auth). */
export const REFINERY_PAGES: Record<string, string> = {
  start: "/start",
  dashboard: "/dashboard",
  creative: "/dashboard/creative",
  cv: "/dashboard/cv",
  performer: "/dashboard/performer",
  documents: "/dashboard/documents",
  master: "/dashboard/master",
  help: "/dashboard/help",
  jobs: "/dashboard/jobs",
  paths: "/dashboard/paths",
  applications: "/dashboard/applications",
  "application-tailor": "/dashboard/application-tailor",
  disclosure: "/dashboard/disclosure",
  interview: "/dashboard/interview",
  resources: "/dashboard/resources",
  next: "/dashboard/next",
  employers: "/dashboard/employers",
  vault: "/dashboard/vault",
  progress: "/dashboard/progress",
  settings: "/dashboard/settings",
};

/** Pages t.ROY may navigate to inside the Forge (pre-auth safe). */
export const FORGE_PAGES: Record<string, string> = {
  start: "/start",
  welcome: "/welcome",
  resume: "/resume",
  goals: "/goals",
  story: "/story",
  preferences: "/preferences",
  rush: "/rush",
};

/**
 * Spotlight targets -- every id here must exist in the DOM as a
 * data-tour="<id>" attribute. Descriptions are what the model reads when
 * choosing where to point.
 */
export const TOUR_TARGETS: Record<string, string> = {
  "nav-jobs": "Job Board link in the sidebar",
  "nav-applications": "Applications link in the sidebar",
  "nav-application-tailor": "Application Tailor link in the sidebar",
  "nav-disclosure": "Disclosure Planner link in the sidebar",
  "nav-interview": "Interview Practice link in the sidebar",
  "nav-resources": "Get support link in the sidebar",
  "jobs-search-role": "the role/keyword input on the Job Board",
  "jobs-search-button": "the search button on the Job Board",
  "jobs-first-result": "the first job card in the Job Board results",
  "jobs-tailor-button": "the Tailor My Resume button on the first job card",
  "tailor-target-job": "the target-job section at the top of the Application Tailor",
  "tailor-generate": "the generate button in the Application Tailor",
  "applications-list": "the list of tracked applications",
  // The Refinery path (nav stations, lib/refinery-nav.ts) and its groups.
  "refinery-nav-overview": "Station 1 on the path: Overview, where you are and what is next",
  "refinery-nav-find": "Station 2 on the path: Find work (jobs, paths, employers)",
  "refinery-nav-tailor": "Station 3 on the path: Tailor and package (resumes, tailoring, creative, CV)",
  "refinery-nav-plan": "Station 4 on the path: Plan what to say (disclosure plan, private records)",
  "refinery-nav-practice": "Station 5 on the path: Practice (interview practice)",
  "refinery-nav-apply": "Station 6 on the path: Apply and track",
  "refinery-nav-next": "Station 7 on the path: What comes next (school, money, health, local help)",
  "refinery-nav-toolbox": "the Toolbox group under the path (help, ideas, settings)",
  "refinery-nav-you": "the You group under the path (profile, sharing, export or delete data)",
  "refinery-meter": "the Steel Man meter at the foot of the path",
};

export interface TakeMeThereArgs {
  page: string;
  jobApplicationId?: string;
}

export interface HighlightElementArgs {
  target: string;
  note: string;
}

/** Resolve a tool "page" name to an href, or null if not allowlisted. */
export function resolveAssistantPage(
  page: string,
  jobApplicationId?: string,
  selection?: { laneId?: string | null; artifactId?: string; revisionId?: string }
): string | null {
  const href = REFINERY_PAGES[page] ?? FORGE_PAGES[page] ?? null;
  if (!href) return null;
  const query = new URLSearchParams();
  if (["application-tailor", "disclosure", "interview", "applications", "documents"].includes(page)) {
    if (jobApplicationId && /^[a-zA-Z0-9-]+$/.test(jobApplicationId)) query.set(page === "interview" ? "applicationId" : "job", jobApplicationId);
    if (selection?.laneId === null) query.set("laneId", "main");
    for (const field of ["laneId", "artifactId", "revisionId"] as const) {
      const value = selection?.[field];
      if (value && /^[a-zA-Z0-9-]+$/.test(value)) query.set(field, value);
    }
  }
  if (query.size) return `${href}?${query}`;
  return href;
}

/**
 * The Refinery's chat drawer lives in the /dashboard layout; every other page
 * with a drawer is in the Forge layout. A move between the two unmounts the
 * chat, so a reply t.ROY writes after take_me_there would land nowhere.
 */
export function isRefineryPath(path: string): boolean {
  const p = path.split(/[?#]/)[0];
  return p === "/dashboard" || p.startsWith("/dashboard/");
}

/** True when going from `fromPath` to `toHref` changes layouts (Forge <-> Refinery). */
export function crossesShell(fromPath: string, toHref: string): boolean {
  return isRefineryPath(fromPath) !== isRefineryPath(toHref);
}

/** A tool page name as a button label: "application-tailor" -> "Application tailor". */
export function pageLabel(page: string): string {
  const words = page.replace(/-/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "that page";
}

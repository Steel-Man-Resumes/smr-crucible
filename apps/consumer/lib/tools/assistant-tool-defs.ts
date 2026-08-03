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
  dashboard: "/dashboard",
  jobs: "/dashboard/jobs",
  applications: "/dashboard/applications",
  "application-tailor": "/dashboard/application-tailor",
  disclosure: "/dashboard/disclosure",
  interview: "/dashboard/interview",
  resources: "/dashboard/resources",
  employers: "/dashboard/employers",
  vault: "/dashboard/vault",
  progress: "/dashboard/progress",
  settings: "/dashboard/settings",
};

/** Pages t.ROY may navigate to inside the Forge (pre-auth safe). */
export const FORGE_PAGES: Record<string, string> = {
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
  "nav-resources": "Fair-Chance Lanes link in the sidebar",
  "jobs-search-role": "the role/keyword input on the Job Board",
  "jobs-search-button": "the search button on the Job Board",
  "jobs-first-result": "the first job card in the Job Board results",
  "jobs-tailor-button": "the Tailor My Resume button on the first job card",
  "tailor-target-job": "the target-job section at the top of the Application Tailor",
  "tailor-generate": "the generate button in the Application Tailor",
  "applications-list": "the list of tracked applications",
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
  jobApplicationId?: string
): string | null {
  const href = REFINERY_PAGES[page] ?? FORGE_PAGES[page] ?? null;
  if (!href) return null;
  if (
    jobApplicationId &&
    (page === "application-tailor" || page === "disclosure") &&
    /^[a-zA-Z0-9-]+$/.test(jobApplicationId)
  ) {
    return `${href}?job=${jobApplicationId}`;
  }
  return href;
}

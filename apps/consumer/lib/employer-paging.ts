/**
 * The employer board's paging rules (lane 3a Part 2, item 3; Troy: the data
 * stays his). A person searches and reads one page of about 25 at a time.
 * There is no bulk export for an individual and no "all" size: the page size
 * is fixed on the server, the page number is capped, and each account may
 * load EMPLOYER_PAGES_PER_DAY pages a day (a durable counter, the same one
 * the AI limits use). Plenty to browse and search; too few to copy the list.
 *
 * Pure (no I/O) so the rules are unit tested; the route wires the counter.
 */

import { EMPLOYER_QUERY_MAX, clampEmployerPage } from "@crucible/core/src/employer";

export const EMPLOYER_PAGES_ENDPOINT = "employers-page";
export const EMPLOYER_PAGES_PER_DAY = 120;

export interface EmployerQuery {
  q: string | null;
  industry: string | null;
  page: number;
}

/** Read ?q=, ?industry= and ?page= (0-based). Anything else, ?limit= included, is ignored. */
export function parseEmployerQuery(params: URLSearchParams): EmployerQuery {
  const text = (k: string) => {
    const v = (params.get(k) ?? "").replace(/\s+/g, " ").trim().slice(0, EMPLOYER_QUERY_MAX);
    return v || null;
  };
  const industry = text("industry");
  return {
    q: text("q"),
    industry: industry && industry.toLowerCase() !== "all" ? industry : null,
    page: clampEmployerPage(params.get("page")),
  };
}

/** May this account load another page today? `count` is the count after this request. */
export function employerPageAllowed(count: number): boolean {
  return count <= EMPLOYER_PAGES_PER_DAY;
}

export const EMPLOYER_PAGES_LIMIT_MESSAGE =
  "You've looked through a lot of employers today. Search for a name, a town or a kind of work, or come back tomorrow for more pages.";

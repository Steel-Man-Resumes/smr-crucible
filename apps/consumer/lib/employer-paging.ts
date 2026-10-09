/**
 * The employer board's paging rules (lane 3a Part 2, item 3; Troy: the data
 * stays his). A person searches and reads one page of about 25 at a time.
 * There is no bulk export for an individual and no "all" size: the page size
 * is fixed on the server, the page number is capped, and pages are counted
 * per account per day (a durable counter, the same one the AI limits use):
 * 20 for a person, 120 for partner, staff and admin tiers. Every network is
 * also held to EMPLOYER_PAGES_PER_DAY_NETWORK, so new accounts made from one
 * connection share one floor (security review 3a Part 2 r1, L2). A session
 * still owing its second step is not signed in here.
 *
 * Pure (no I/O) so the rules are unit tested; the route wires the counter.
 */

import { EMPLOYER_QUERY_MAX, clampEmployerPage } from "@crucible/core/src/employer";

export const EMPLOYER_PAGES_ENDPOINT = "employers-page";
/** Pages a day for a person (client tier). */
export const EMPLOYER_PAGES_PER_DAY = 20;
/** Pages a day for partner, staff and admin tiers (they look up for many people). */
export const EMPLOYER_PAGES_PER_DAY_TEAM = 120;
/** Pages a day from one network, whoever is signed in. */
export const EMPLOYER_PAGES_PER_DAY_NETWORK = 200;

/** The account's daily page limit by tier. Unknown tiers get the person's limit. */
export function employerPagesPerDay(tier: string | null | undefined): number {
  return tier === "partner" || tier === "admin" || tier === "unlimited" ? EMPLOYER_PAGES_PER_DAY_TEAM : EMPLOYER_PAGES_PER_DAY;
}

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

/** May this request load another page today? Counts are after this request. */
export function employerPageAllowed(account: number, network: number, tier?: string | null): boolean {
  return account <= employerPagesPerDay(tier) && network <= EMPLOYER_PAGES_PER_DAY_NETWORK;
}

export const EMPLOYER_PAGES_LIMIT_MESSAGE =
  "You've looked through a lot of employers today. Search for a name, a town or a kind of work, or come back tomorrow for more pages.";

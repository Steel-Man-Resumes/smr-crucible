import { defaultJobSearchFilters, readJobSearchFilters, type JobSearchFilters } from "@crucible/core/src/jobSearchFilters";
/** Explicit one-search broadening. Saved exclusions are separately reviewed, never silently undone. */
export function broadenJobSearch(filters: JobSearchFilters): JobSearchFilters {
  const current = readJobSearchFilters(filters);
  const next = defaultJobSearchFilters();
  next.radiusMiles.value = null; next.postedWithinDays.value = null;
  next.origin = current.origin;
  next.excludedEmployers = current.excludedEmployers;
  next.excludedKeywords = current.excludedKeywords;
  return next;
}

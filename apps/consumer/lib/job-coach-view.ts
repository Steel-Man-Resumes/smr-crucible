/**
 * What t.ROY's search_jobs tool sees for one card. The record mark is passed
 * with the place it was checked at and its reason, never as a bare true, so the
 * coach cannot say a Milwaukee opening was checked when only Germantown was.
 */
import type { EnrichedJob } from "./job-search-types";
export function coachJobView(j: EnrichedJob) {
  return {
    id: j.id, title: j.title, company: j.company, location: j.location, salary: j.salary,
    employmentType: j.employment_type, evidence: j.evidence, filterAssessment: j.filterAssessment, relevance: j.relevance,
    recordMark: j.second_chance
      ? { checkedAt: j.location, reason: j.fair_chance_reason }
      : j.marked_elsewhere
        ? { checkedAt: j.marked_elsewhere.town, notCheckedAt: j.location, reason: j.marked_elsewhere.reason }
        : null,
    ...(j.other_locations?.length ? { otherLocations: j.other_locations } : {}),
    posted: j.posted,
  };
}

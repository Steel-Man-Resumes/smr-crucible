import type { JobRelevance } from "./job-search-relevance";
import type { JobFilterAssessment, JobSearchEvidence, JobSearchFilters } from "@crucible/core/src/jobSearchFilters";
export interface JSearchJob {
  job_id: string; job_title: string; employer_name: string; employer_logo: string | null;
  job_city: string | null; job_state: string | null; job_country: string | null; job_description: string;
  job_min_salary: number | null; job_max_salary: number | null; job_salary_currency: string | null; job_salary_period: string | null;
  job_employment_type: string | null; job_posted_at_datetime_utc: string; job_is_remote: boolean | null; employer_website: string | null;
  job_apply_link?: string | null; job_google_link?: string | null;
  job_latitude?: number | null; job_longitude?: number | null; job_employment_types?: string[];
  job_apply_is_direct?: boolean | null; apply_options?: { apply_link?: string; is_direct?: boolean; publisher?: string }[];
  job_highlights?: { Qualifications?: string[]; Responsibilities?: string[]; Benefits?: string[] };
  source?: string; fetched_at?: string; salary_is_predicted?: boolean; employer_kind?: "direct" | "staffing" | null;
  source_fields?: Record<string, unknown>; source_variants?: { source: string; id: string; fields: Record<string, unknown> }[];
  /** Other copies of the same posting (other towns or providers), set by mergeJobs. */
  job_listings?: { place: string; placeId: string; city: string | null; state: string | null; title: string; apply_url: string | null; source: string; id: string }[];
}
export interface EnrichedJob {
  id: string; title: string; company: string; location: string; salary: string | null;
  description: string; full_description: string; requirements: string[]; benefits: string[];
  employment_type: string; posted: string; second_chance: boolean; fair_chance_reason: string | null;
  remote: boolean; apply_url: string | null; employer_website: string | null;
  /** Other places the same posting is listed. The card shows one card, not one per town. */
  other_locations?: string[];
  /** A record mark earned at another merged town, not at the place shown. second_chance stays false for it. */
  marked_elsewhere?: { town: string; reason: string };
  /** Every other copy merged into this card, each with its own place and apply link. */
  other_listings?: { place: string; apply_url: string | null; source: string }[];
  relevance?: JobRelevance;
  evidence?: JobSearchEvidence; filterAssessment?: JobFilterAssessment;
  source_fields?: Record<string, unknown>; source_variants?: JSearchJob["source_variants"];
}
export interface JobSearchSummary {
  loaded: number; matched: number; excluded: number; unknownIncluded: number;
  excludedBy: Record<string, number>; unknownBy: Record<string, number>;
  providerRequests: number; partial: boolean; fetchedAt: string;
  filters: JobSearchFilters; laneId: string | null;
  notices: string[];
  /** Listings dropped because none of the search words appear in title or description. */
  offTopic?: number;
  /** Kept below the main list: search words only in the description. */
  alsoFound?: number;
  /** Loaded listings removed by the person's own filters, job-fit choices or hidden employers (not off-topic drops). */
  removedByChoices?: number;
  /** Related terms searched alongside the person's own words. */
  relatedTerms?: string[];
}
/** Outage state of one live search, kept with a cached copy so a cache hit stays honest. */
export type ProviderOutage = "provider_unavailable" | "provider_rate_limited" | "provider_partial";
export interface SearchMetadata { providerRequests: number; notices: string[]; outage?: ProviderOutage | null; degraded?: boolean }
export interface JobSearchOutcome {
  jobs: EnrichedJob[]; fair_chance_info: string; source: string; error?: string;
  summary?: JobSearchSummary;
  metadata?: SearchMetadata;
}

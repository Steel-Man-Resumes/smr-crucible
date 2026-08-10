/**
 * Progress stat -> named server source (Phase 4.2).
 *
 * Every number the Progress page shows maps to a real, named server fact. This
 * table is the contract: the adversarial suite asserts each displayed stat has
 * a non-empty server source here, so a stat can never quietly go back to being
 * a localStorage-only guess.
 *
 * Sources:
 *   - "journey:<field>"  -> a metric on GET /api/user/journey snapshot.metrics
 *   - "context:<field>"  -> the server forge profile on GET /api/user/context
 *   - "applications:status" -> live job_application.status via GET /api/applications
 *
 * Deliberately DROPPED (no server source exists): "resume_bullets_written".
 * The 'bullet_written' event type is defined in PROGRESS_EVENT_TYPES but nothing
 * writes it, so the old "N bullets written" sub-line was a localStorage-only
 * number. It is omitted from the display rather than shown as a fake count.
 */

export const PROGRESS_STAT_SOURCES = {
  // Forge-derived counts -- the server forge profile, normalized client-side
  // with the same tested helpers the Forge output uses everywhere else.
  skills_identified: "context:forge.skills",
  career_paths: "context:forge.careerPaths",

  // Event-ledger counts -- user_progress_event, surfaced by the journey snapshot.
  resumes_built: "journey:resumesBuilt",
  disclosure_plans_created: "journey:disclosurePlansCreated",
  interviews_started: "journey:interviewsStarted",
  interviews_completed: "journey:interviewsCompleted",
  job_searches: "journey:jobSearches",
  resources_viewed: "journey:resourcesViewed",
  total_sessions: "journey:totalSessions",

  // Status-event ledger.
  applications_sent: "journey:applicationsSent",

  // Live pipeline, grouped from job_application.status (ownership-scoped route).
  pipeline_saved: "applications:status",
  pipeline_applied: "applications:status",
  pipeline_heard_back: "applications:status",
  pipeline_interviewing: "applications:status",
  pipeline_offered: "applications:status",
} as const;

export type ProgressStatKey = keyof typeof PROGRESS_STAT_SOURCES;

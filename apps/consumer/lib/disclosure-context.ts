/**
 * "The disclosure plan" as /api/user/context reports it (fix 2026-10-24).
 *
 * Only a plan that includes the record conversation is a disclosure_plan.
 * A hurdle plan without the record hurdle saves as hurdle_plan and is never
 * read here (lib/hurdles/plan.ts savedPlanType).
 *
 * Since B5 the planner stores no record words: a disclosure_plan it saves
 * holds the job, the date and the non-record hurdles, with script and
 * timing_advice null. Plans saved before B5 may hold a script. So the plan's
 * existence, job and date come from the newest disclosure_plan, and the
 * script and timing come from the newest one that actually holds a script.
 * A newer plan without stored words never hides the person's own saved words.
 */

export interface DisclosureRow {
  target_context: Record<string, any> | null;
  content: Record<string, any> | null;
  created_at: string;
}

export const LATEST_DISCLOSURE_PLAN_SQL = `SELECT target_context, content, created_at
     FROM refinery_artifact
     WHERE user_id = $1 AND artifact_type = 'disclosure_plan'
     ORDER BY created_at DESC LIMIT 1`;

export const LATEST_DISCLOSURE_SCRIPT_SQL = `SELECT target_context, content, created_at
     FROM refinery_artifact
     WHERE user_id = $1 AND artifact_type = 'disclosure_plan'
       AND jsonb_typeof(content->'script') = 'string' AND btrim(content->>'script') <> ''
     ORDER BY created_at DESC LIMIT 1`;

export interface DisclosurePlanContext {
  exists: boolean;
  targetJob?: string | null;
  scriptExcerpt?: string | null;
  timingAdvice?: string | null;
  /** When the plan that holds the script was saved (null when no saved plan holds one). */
  scriptSavedAt?: string | null;
  completedAt?: string;
}

function scriptOf(row: DisclosureRow | null): string | null {
  const s = row?.content?.script;
  return typeof s === "string" && s.trim() ? s : null;
}

export function disclosurePlanContext(latest: DisclosureRow | null, latestWithScript: DisclosureRow | null): DisclosurePlanContext {
  if (!latest) return { exists: false };
  const scripted = scriptOf(latest) ? latest : scriptOf(latestWithScript) ? latestWithScript : null;
  const timing = scripted?.content?.timing_advice;
  return {
    exists: true,
    targetJob: latest.target_context?.targetJob ?? latest.content?.targetJob ?? null,
    scriptExcerpt: scripted ? scriptOf(scripted)!.slice(0, 500) : null,
    timingAdvice: typeof timing === "string" && timing.trim() ? timing : null,
    scriptSavedAt: scripted ? scripted.created_at : null,
    completedAt: latest.created_at,
  };
}

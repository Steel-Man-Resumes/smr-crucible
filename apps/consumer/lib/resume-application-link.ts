/**
 * Link a tailored resume to its saved job on a later save, both ways.
 *
 * The first save of a tailored resume (POST /api/artifacts) links it to the
 * application through targetContext.applicationId. Before 10/23 the editor's
 * autosave could fire while the tailor was still generating, so the first
 * POST carried the empty draft and no application id; the generated content
 * then arrived by PATCH, and PATCH never linked anything. The application kept
 * resume_artifact_id null, the journey said "not tailored", and the ?job= link
 * offered to tailor (and spend) again.
 *
 * Every workspace save of a tailored resume carries content.jobPackage
 * .applicationId. On PATCH this fills the gaps only:
 * - job_application.resume_artifact_id, only when it is still NULL (an
 *   existing link, including "what did I send", is never replaced), only
 *   while the job is still 'saved' (an application already sent is left as
 *   it is: a resume attached after the fact would be recorded as what was
 *   sent; same rule as the multi-job tailor, tailor-batch-server.ts), and
 *   never to a hidden example resume (is_demo, the example rule);
 * - the artifact's target_context.applicationId, only when it is missing.
 * Both writes run AS the person and check ownership in SQL; a foreign or bogus
 * id touches zero rows. Only resumes reach the SQL (linkResumeOnUpdate checks
 * the type the server loaded); the SQL names no artifact type. It is a
 * write scoped to one id, not a resume listing, and it still keeps hidden
 * examples out (a.is_demo = false); example-rule.test.ts checks that.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LINK_APPLICATION_SQL = `UPDATE job_application SET resume_artifact_id = $1, updated_at = now()
     WHERE id = $2 AND user_id = $3 AND resume_artifact_id IS NULL AND status = 'saved'
       AND EXISTS (SELECT 1 FROM refinery_artifact a
                    WHERE a.id = $1 AND a.user_id = $3 AND a.is_demo = false)
     RETURNING id`;

export const LINK_ARTIFACT_CONTEXT_SQL = `UPDATE refinery_artifact
     SET target_context = COALESCE(target_context, '{}'::jsonb) || jsonb_build_object('applicationId', $2::text)
     WHERE id = $1 AND user_id = $3
       AND COALESCE(target_context->>'applicationId', '') = ''
       AND EXISTS (SELECT 1 FROM job_application j
                    WHERE j.id = $2::uuid AND j.user_id = $3 AND j.resume_artifact_id = $1)
     RETURNING id`;

/** The application id a workspace save names, or null. */
export function jobPackageApplicationId(content: unknown): string | null {
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const pkg = (content as { jobPackage?: unknown }).jobPackage;
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return null;
  const id = (pkg as { applicationId?: unknown }).applicationId;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

export interface LinkDeps {
  query: (userId: string, sql: string, params: unknown[]) => Promise<unknown[]>;
  snapshot?: (opts: { userId: string; applicationId: string; artifactId: string; content: Record<string, unknown> }) => Promise<unknown>;
  invalidate?: (userId: string) => Promise<unknown>;
}

/**
 * After a successful resume PATCH: fill a missing link. Returns true when the
 * application was newly linked. Never throws; a link failure must not fail the save.
 */
export async function linkResumeOnUpdate(
  userId: string,
  artifactId: string,
  artifactType: string,
  content: unknown,
  deps: LinkDeps
): Promise<boolean> {
  if (artifactType !== "resume") return false;
  const applicationId = jobPackageApplicationId(content);
  if (!applicationId || !UUID.test(artifactId)) return false;
  try {
    const linked = await deps.query(userId, LINK_APPLICATION_SQL, [artifactId, applicationId, userId]);
    // The context half runs either way: it only fills a missing id, and only
    // when the application already points at this resume.
    await deps.query(userId, LINK_ARTIFACT_CONTEXT_SQL, [artifactId, applicationId, userId]);
    if (linked.length === 0) return false;
    if (deps.snapshot) await deps.snapshot({ userId, applicationId, artifactId, content: content as Record<string, unknown> }).catch(() => {});
    if (deps.invalidate) await deps.invalidate(userId).catch(() => {});
    return true;
  } catch (err) {
    console.error("Resume application link error:", (err as Error)?.message || err);
    return false;
  }
}

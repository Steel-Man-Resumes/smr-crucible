/**
 * Tailor hand-offs that must never spend on arrival.
 *
 * Three doors lead into the Application Tailor with a job already chosen:
 * - `?job=<applicationId>` (Applications tracker, saved jobs, the lane header,
 *   the next-step card, "Next: tailor your resume for ..."),
 * - `?from=job` with the board listing in sessionStorage (Job Board button).
 *
 * Opening one of those used to run the tailor straight away: an AI action spent
 * on a page load, with no cost line. Now arriving only PICKS the job. This
 * module turns the arrival into a pending choice; the generator runs only when
 * the person presses "Tailor now". Nothing here calls the generator, so a test
 * can prove a page load never reaches it.
 */
/** The job the generator will be asked to tailor for. */
export interface TailorJob {
  title?: string;
  company?: string;
  description?: string;
  requirements?: string;
  location?: string;
  salary?: string;
  employment_type?: string;
  id?: string;
  jobListingUrl?: string;
  apply_url?: string | null;
  employer_website?: string | null;
  source?: string;
  jdSourceProvider?: string;
  jdSourceUrl?: string | null;
  jdFetchedAt?: string | null;
}

/** A job picked on arrival, waiting for the person's click. */
export interface PendingTailor {
  job: TailorJob;
  /** The saved application to link the resume to (null: the board job is saved on run). */
  applicationId: string | null;
  from: "saved" | "board";
}

export interface ApplyInfo { applyUrl: string | null; employerWebsite: string | null; applied: boolean }

export type JobHandoff =
  | { kind: "none" }
  /** Already tailored: open that resume. Opening spends nothing. */
  | { kind: "open"; artifactId: string; applicationId: string; applyInfo: ApplyInfo }
  /** Not tailored yet: show the job, the cost and a button. */
  | { kind: "confirm"; pending: PendingTailor; applyInfo: ApplyInfo };

type SavedApplication = {
  id: string; job_title?: string; company?: string; status?: string;
  resume_artifact_id?: string | null; apply_url?: string | null; employer_website?: string | null;
  jd_full_text?: string | null; jd_excerpt?: string | null; description?: string | null;
  location?: string | null; salary?: string | null; employment_type?: string | null; source_id?: string | null;
};

/** Decide what a `?job=<applicationId>` arrival does, from the person's own applications. */
export function jobHandoffFromApplications(appId: string | null, applications: unknown): JobHandoff {
  if (!appId) return { kind: "none" };
  const list = Array.isArray(applications) ? (applications as SavedApplication[]) : [];
  const app = list.find((a) => a && a.id === appId);
  if (!app) return { kind: "none" };
  const applyInfo: ApplyInfo = {
    applyUrl: app.apply_url || null,
    employerWebsite: app.employer_website || null,
    applied: app.status === "applied",
  };
  if (app.resume_artifact_id) return { kind: "open", artifactId: app.resume_artifact_id, applicationId: app.id, applyInfo };
  return {
    kind: "confirm",
    applyInfo,
    pending: {
      from: "saved",
      applicationId: app.id,
      job: {
        title: app.job_title || "",
        company: app.company || "",
        description: app.jd_full_text || app.jd_excerpt || app.description || undefined,
        location: app.location || undefined,
        salary: app.salary || undefined,
        employment_type: app.employment_type || undefined,
        id: app.source_id || undefined,
        apply_url: app.apply_url ?? null,
        employer_website: app.employer_website ?? null,
      },
    },
  };
}

/**
 * Load a `?job=` arrival. Reads the applications list only; it is given no
 * way to reach the generator.
 */
export async function loadJobHandoff(appId: string | null, fetcher: (url: string) => Promise<Response>): Promise<JobHandoff> {
  if (!appId) return { kind: "none" };
  const res = await fetcher("/api/applications");
  if (!res.ok) return { kind: "none" };
  const body = await res.json().catch(() => null);
  return jobHandoffFromApplications(appId, body?.applications);
}

/** Read the Job Board hand-off (sessionStorage text). Bad text picks nothing. */
export function boardHandoff(raw: string | null): PendingTailor | null {
  if (!raw) return null;
  try {
    const job = JSON.parse(raw);
    if (!job || typeof job !== "object" || Array.isArray(job)) return null;
    if (typeof job.title !== "string" || !job.title.trim()) return null;
    return { from: "board", applicationId: null, job: job as TailorJob };
  } catch {
    return null;
  }
}

/**
 * The honest cost line for one tailor. `remaining` undefined means the
 * allowance has not been read (or could not be): the line still says what it
 * costs and the server still enforces the limit.
 */
export function singleTailorCost(allowance: { remaining: number | null; blockedReason: string | null } | undefined): { line: string; canRun: boolean } {
  const what = "It makes a resume and a cover letter for this job.";
  if (!allowance) return { line: `Tailoring this job uses 1 AI action from your allowance. ${what}`, canRun: true };
  if (allowance.blockedReason) return { line: allowance.blockedReason, canRun: false };
  if (allowance.remaining === null) return { line: `Tailoring this job uses 1 AI action. ${what}`, canRun: true };
  const left = Math.max(0, Math.floor(allowance.remaining));
  if (left === 0) return { line: "Tailoring this job uses 1 AI action. You have no AI actions left today. Ask t.ROY through the progress bar for more, or come back after midnight UTC. This job stays saved.", canRun: false };
  return { line: `Tailoring this job uses 1 AI action from your allowance. You have ${left} left today. ${what}`, canRun: true };
}

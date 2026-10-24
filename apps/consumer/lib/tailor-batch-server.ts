/**
 * One job of a multi-job tailoring batch, on the server. Pure sequencing with
 * injected steps so it is unit-tested without a database or a model; the
 * route handler (lib/tailor-batch-route.ts) wires the steps.
 *
 * Order matters for cost honesty:
 *  1. Claim the job key on the server (migration 093, one row per user + key,
 *     taken atomically). A saved key returns its resume and runs nothing. A key
 *     another tab is running is refused (409), so two tabs cannot both charge.
 *     A key whose generation finished but whose save failed resumes from the
 *     stored (encrypted) result: the save is retried, the generator is not.
 *  2. The application row before the generator (a failed row write costs nothing).
 *  3. A deadline check, then the generator: its own admission per job (the
 *     career-package route's rate limit and beginAiOperation). A refusal or
 *     failure is not counted, and the claim is released for a retry.
 *  4. The save. A failed save stores the result with the claim; the next try
 *     saves it with no new AI action and nothing personal is left in the browser.
 *  5. An application already past "saved" (applied, interviewing...) is never
 *     re-pointed at the new resume: it is saved to the Library and the screen says so.
 */
import { MAX_BATCH_JOBS, type BatchTruth } from "./tailor-batch";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BatchJobRequest {
  batchId: string;
  index: number;
  size: number;
  job: {
    title: string; company: string; location?: string; salary?: string | null; employment_type?: string;
    description: string; requirements?: unknown; id?: string; apply_url?: string | null;
    employer_website?: string | null; source?: string; jdSourceProvider?: string; jdSourceUrl?: string | null;
  };
  /** Shared once per batch on the client: the generator's person context. */
  context: Record<string, unknown>;
  laneId: string | null;
  parentArtifactId?: string | null;
  /** A saved job the person picked: use this application, create none. */
  applicationId?: string | null;
}

export interface PendingResult { resume: unknown; coverLetter: string | null; truth: BatchTruth | null; tailoringNotes: string[] }

export type BatchJobResponse =
  | { ok: true; key: string; artifactId: string; applicationId: string | null; actionUsed: boolean; reused: boolean; truth: BatchTruth | null; tailoringNotes: string[]; linked: boolean; applicationStatus: string | null; letterSaved: boolean | null }
  | { ok: false; key: string; code: string; error: string; status: number; applicationId?: string | null; actionUsed: boolean };

export interface GenerateOutcome { ok: boolean; status: number; body: any }

export type ClaimResult =
  | { kind: "claimed"; attempts: number; applicationId?: string | null }
  | { kind: "pending"; pending: PendingResult; applicationId: string | null }
  | { kind: "saved"; artifactId: string; applicationId: string | null }
  | { kind: "busy" };

export interface BatchJobDeps {
  claim(key: string): Promise<ClaimResult>;
  release(key: string): Promise<void>;
  markGenerated(key: string, pending: PendingResult, applicationId: string): Promise<void>;
  markSaved(key: string, artifactId: string, applicationId: string | null): Promise<void>;
  /** A resume already saved under this key (a run killed between save and markSaved). */
  findSaved(key: string): Promise<string | null>;
  applicationStatus(applicationId: string): Promise<string | null>;
  saveApplication(job: BatchJobRequest["job"]): Promise<{ id: string; status: string } | null>;
  generate(payload: Record<string, unknown>): Promise<GenerateOutcome>;
  saveResume(input: { content: unknown; targetContext: Record<string, unknown>; laneId: string | null; parentArtifactId: string | null }): Promise<string | null>;
  saveCoverLetter(input: { text: string; targetContext: Record<string, unknown>; laneId: string | null }): Promise<boolean>;
  /** Milliseconds since this request started. */
  elapsedMs(): number;
}

/** The generator must start early enough to finish well inside the route's limit. */
export const GENERATOR_START_BUDGET_MS = 60_000;

export function parseBatchJobRequest(raw: unknown): { ok: true; value: BatchJobRequest } | { ok: false; code: string; error: string } {
  const bad = (code: string, error: string) => ({ ok: false as const, code, error });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("invalid_request", "This request could not be read.");
  const b = raw as Record<string, any>;
  if (typeof b.batchId !== "string" || !UUID.test(b.batchId)) return bad("invalid_batch", "This batch could not be read. Start it again from the job board.");
  if (!Number.isInteger(b.size) || b.size < 1 || b.size > MAX_BATCH_JOBS) return bad("batch_too_large", "A batch holds 1 to 3 jobs.");
  if (!Number.isInteger(b.index) || b.index < 0 || b.index >= b.size) return bad("invalid_batch", "This job is not part of the batch.");
  const job = b.job;
  if (!job || typeof job !== "object" || typeof job.title !== "string" || !job.title.trim() || typeof job.company !== "string" || !job.company.trim()) return bad("job_incomplete", "This job is missing a title or employer.");
  if (typeof job.description !== "string") return bad("job_incomplete", "This job has no posting text.");
  const context = b.context && typeof b.context === "object" && !Array.isArray(b.context) ? b.context : {};
  const laneId = b.laneId === undefined || b.laneId === null || b.laneId === "main" ? null : b.laneId;
  if (laneId !== null && (typeof laneId !== "string" || !UUID.test(laneId))) return bad("invalid_lane", "This lane could not be read.");
  const applicationId = typeof b.applicationId === "string" && UUID.test(b.applicationId) ? b.applicationId : null;
  const parentArtifactId = typeof b.parentArtifactId === "string" && UUID.test(b.parentArtifactId) ? b.parentArtifactId : null;
  return { ok: true, value: { batchId: b.batchId.toLowerCase(), index: b.index, size: b.size, job, context, laneId, applicationId, parentArtifactId } };
}

/** The generator's refusal, as a per-job code the screen can act on. */
export function generatorFailure(outcome: GenerateOutcome): { code: string; error: string } {
  const body = outcome.body && typeof outcome.body === "object" ? outcome.body : {};
  const message = typeof body.error === "string" && body.error ? body.error : "";
  if (typeof body.code === "string" && body.code) return { code: body.code, error: message || "This job did not run." };
  if (outcome.status === 429) return { code: "allowance_used", error: message || "Your AI allowance for today is used. This job did not run and used nothing." };
  if (outcome.status === 403) return { code: "tier_required", error: message || "This tool is not open on your account yet." };
  if (outcome.status === 401) return { code: "signed_out", error: "You were signed out. Sign in again and retry this job." };
  // A bad lane or base resume reference never fixes itself on retry.
  if (outcome.status === 400 || outcome.status === 404) return { code: "reload_needed", error: "Your lane or base resume changed since you started. It used no AI action. Reload this page, then retry." };
  return { code: "tailor_failed", error: "This job did not finish tailoring. It used no AI action. Your other jobs are safe. Retry this one." };
}

export function truthFromGenerator(body: any): BatchTruth | null {
  const g = body?.grounding;
  const flags: string[] = Array.isArray(g?.flags) ? g.flags.map((f: any) => (typeof f?.claim === "string" ? f.claim.trim() : "")).filter(Boolean).slice(0, 8) : [];
  return body?.finalizationBlocked || flags.length || g?.hasFabrication
    ? { blocked: !!body.finalizationBlocked, notice: typeof body.verificationNotice === "string" ? body.verificationNotice : "", flags }
    : null;
}

const LINKABLE_STATUS = "saved";

export async function runBatchJob(input: BatchJobRequest, deps: BatchJobDeps): Promise<BatchJobResponse> {
  const key = `${input.batchId}:${input.index}`;
  const claim = await deps.claim(key);
  if (claim.kind === "saved") {
    return { ok: true, key, artifactId: claim.artifactId, applicationId: claim.applicationId, actionUsed: false, reused: true, truth: null, tailoringNotes: [], linked: true, applicationStatus: null, letterSaved: null };
  }
  if (claim.kind === "busy") {
    return { ok: false, key, code: "in_progress", status: 409, error: "This job is already running in another tab or window. Wait a few minutes, then refresh. Nothing extra was used.", actionUsed: false };
  }

  // Taken over after a killed run: if its resume did land, finish the record, run nothing.
  if (claim.kind === "claimed" && claim.attempts > 1) {
    const landed = await deps.findSaved(key).catch(() => null);
    if (landed) {
      // The claim row's record wins; the browser's copy is only a fallback.
      const appId = claim.applicationId ?? input.applicationId ?? null;
      await deps.markSaved(key, landed, appId).catch(() => {});
      return { ok: true, key, artifactId: landed, applicationId: appId, actionUsed: false, reused: true, truth: null, tailoringNotes: [], linked: true, applicationStatus: null, letterSaved: null };
    }
  }

  const fail = async (code: string, status: number, error: string, extra: { applicationId?: string | null; actionUsed?: boolean; keepClaim?: boolean } = {}): Promise<BatchJobResponse> => {
    if (!extra.keepClaim) await deps.release(key).catch(() => {});
    return { ok: false, key, code, status, error, applicationId: extra.applicationId ?? null, actionUsed: !!extra.actionUsed };
  };

  let applicationId = claim.kind === "pending" ? claim.applicationId : input.applicationId ?? null;
  let applicationStatus: string | null = null;
  if (applicationId) {
    applicationStatus = await deps.applicationStatus(applicationId).catch(() => null);
    if (!applicationStatus) applicationId = null;
  }
  if (!applicationId) {
    let row: { id: string; status: string } | null = null;
    try { row = await deps.saveApplication(input.job); } catch { row = null; }
    if (!row) return fail("application_failed", 503, "The job could not be added to your applications. Nothing ran. Retry this one.");
    applicationId = row.id;
    applicationStatus = row.status;
  }

  let result: PendingResult;
  let actionUsed = false;
  if (claim.kind === "pending") {
    result = claim.pending;
  } else {
    if (deps.elapsedMs() > GENERATOR_START_BUDGET_MS) {
      return fail("out_of_time", 503, "This job ran short on time before tailoring started. It used no AI action. Retry this one.", { applicationId });
    }
    let outcome: GenerateOutcome;
    try {
      outcome = await deps.generate({
        ...input.context,
        job: { title: input.job.title, company: input.job.company, description: input.job.description, requirements: input.job.requirements },
        ...(input.laneId ? { laneId: input.laneId } : {}),
      });
    } catch {
      outcome = { ok: false, status: 500, body: null };
    }
    if (!outcome.ok || !outcome.body?.resume) {
      const failure = generatorFailure(outcome.ok ? { ...outcome, status: 500 } : outcome);
      return fail(failure.code, outcome.ok ? 502 : outcome.status, failure.error, { applicationId });
    }
    actionUsed = true;
    result = {
      resume: outcome.body.resume,
      coverLetter: typeof outcome.body.coverLetter === "string" && outcome.body.coverLetter ? outcome.body.coverLetter : null,
      truth: truthFromGenerator(outcome.body),
      tailoringNotes: Array.isArray(outcome.body.tailoringNotes) ? outcome.body.tailoringNotes.filter((n: unknown) => typeof n === "string").slice(0, 4) : [],
    };
  }

  const linked = applicationStatus === LINKABLE_STATUS;
  // batchTruth travels with the resume so the editor lists every flagged line (DEC-46).
  const targetContext: Record<string, unknown> = {
    targetJob: input.job.title, targetCompany: input.job.company, source: "job", batchKey: key, batchId: input.batchId,
    batchTruth: result.truth,
    ...(linked ? { applicationId } : { batchApplicationId: applicationId }),
  };
  let artifactId: string | null = null;
  try {
    artifactId = await deps.saveResume({ content: result.resume, targetContext, laneId: input.laneId, parentArtifactId: input.parentArtifactId ?? null });
  } catch { artifactId = null; }
  if (!artifactId) {
    let stored = false;
    try { await deps.markGenerated(key, result, applicationId); stored = true; } catch { stored = false; }
    return fail("save_failed", 503, stored
      ? "The resume was made but did not save. Retry saves it and uses no new AI action. We keep it encrypted for up to 7 days so a retry can save it, then delete it."
      : "The resume was made but did not save, and it could not be held for a retry. Wait a few minutes, then retry this one.",
      { applicationId, actionUsed, keepClaim: true });
  }
  let letterSaved: boolean | null = null;
  if (result.coverLetter) {
    letterSaved = await deps.saveCoverLetter({
      text: result.coverLetter,
      targetContext: { targetJob: input.job.title, targetCompany: input.job.company, source: "job", batchLetterKey: key, ...(linked ? { applicationId } : {}) },
      laneId: input.laneId,
    }).catch(() => false);
  }
  await deps.markSaved(key, artifactId, applicationId).catch(() => {});
  return { ok: true, key, artifactId, applicationId, actionUsed, reused: false, truth: result.truth, tailoringNotes: result.tailoringNotes, linked, applicationStatus, letterSaved };
}

/** Remaining count across the limits that count calls. null = no count limit applies. */
export function remainingActions(parts: Array<number | null | undefined>): number | null {
  const known = parts.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return known.length ? Math.max(0, Math.min(...known)) : null;
}

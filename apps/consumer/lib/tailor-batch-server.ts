/**
 * One job of a multi-job tailoring batch, on the server. Pure sequencing with
 * injected steps so it is unit-tested without a database or a model; the
 * route (app/api/tailor-batch/route.ts) wires the real steps.
 *
 * Order matters for cost honesty:
 *  1. Idempotency first: a key that already saved returns that resume and runs
 *     nothing (no AI action, no write, the saved resume is never overwritten).
 *  2. The application row before the generator (a failed row write costs nothing).
 *  3. The generator: its own admission per job (the career-package route's
 *     rate limit and beginAiOperation). A refusal or failure is not counted.
 *  4. Idempotency again (a parallel retry that already saved wins; no duplicate).
 *  5. The save. A failed save hands the finished result back so the client can
 *     retry the save only, without a second AI action.
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
  /** A finished generation whose save failed: save this, run no generator. */
  pendingSave?: { resume: unknown; coverLetter: string | null } | null;
}

export type BatchJobResponse =
  | { ok: true; key: string; artifactId: string; applicationId: string | null; actionUsed: boolean; reused: boolean; truth: BatchTruth | null; tailoringNotes: string[] }
  | { ok: false; key: string; code: string; error: string; status: number; applicationId?: string | null; actionUsed: boolean; pendingSave?: { resume: unknown; coverLetter: string | null } };

export interface GenerateOutcome { ok: boolean; status: number; body: any }

export interface BatchJobDeps {
  findSaved(key: string): Promise<{ artifactId: string; applicationId: string | null } | null>;
  ownsApplication(applicationId: string): Promise<boolean>;
  saveApplication(job: BatchJobRequest["job"]): Promise<string | null>;
  generate(payload: Record<string, unknown>): Promise<GenerateOutcome>;
  saveResume(input: { content: unknown; targetContext: Record<string, unknown>; laneId: string | null; parentArtifactId: string | null }): Promise<string | null>;
  saveCoverLetter(input: { text: string; targetContext: Record<string, unknown>; laneId: string | null }): Promise<void>;
}

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
  let pendingSave: BatchJobRequest["pendingSave"] = null;
  if (b.pendingSave && typeof b.pendingSave === "object") {
    pendingSave = { resume: b.pendingSave.resume, coverLetter: typeof b.pendingSave.coverLetter === "string" ? b.pendingSave.coverLetter : null };
  }
  return { ok: true, value: { batchId: b.batchId, index: b.index, size: b.size, job, context, laneId, applicationId, parentArtifactId, pendingSave } };
}

/** The generator's refusal, as a per-job code the screen can act on. */
export function generatorFailure(outcome: GenerateOutcome): { code: string; error: string } {
  const body = outcome.body && typeof outcome.body === "object" ? outcome.body : {};
  const message = typeof body.error === "string" && body.error ? body.error : "";
  if (typeof body.code === "string" && body.code) return { code: body.code, error: message || "This job did not run." };
  if (outcome.status === 429) return { code: "allowance_used", error: message || "Your AI allowance for today is used. This job did not run and used nothing." };
  if (outcome.status === 403) return { code: "tier_required", error: message || "This tool is not open on your account yet." };
  if (outcome.status === 401) return { code: "signed_out", error: "You were signed out. Sign in again and retry this job." };
  return { code: "tailor_failed", error: "This job did not finish tailoring. It used no AI action. Your other jobs are safe. Retry this one." };
}

export async function runBatchJob(input: BatchJobRequest, deps: BatchJobDeps): Promise<BatchJobResponse> {
  const key = `${input.batchId}:${input.index}`;
  const existing = await deps.findSaved(key);
  if (existing) return { ok: true, key, artifactId: existing.artifactId, applicationId: existing.applicationId, actionUsed: false, reused: true, truth: null, tailoringNotes: [] };

  let applicationId = input.applicationId ?? null;
  if (applicationId && !(await deps.ownsApplication(applicationId))) applicationId = null;
  if (!applicationId) {
    try { applicationId = await deps.saveApplication(input.job); } catch { applicationId = null; }
    if (!applicationId) return { ok: false, key, code: "application_failed", status: 503, error: "The job could not be added to your applications. Nothing ran. Retry this one.", actionUsed: false };
  }

  let resume: unknown;
  let coverLetter: string | null = null;
  let truth: BatchTruth | null = null;
  let tailoringNotes: string[] = [];
  let actionUsed = false;
  if (input.pendingSave && input.pendingSave.resume && typeof input.pendingSave.resume === "object") {
    resume = input.pendingSave.resume;
    coverLetter = input.pendingSave.coverLetter;
  } else {
    const outcome = await deps.generate({
      ...input.context,
      job: { title: input.job.title, company: input.job.company, description: input.job.description, requirements: input.job.requirements },
      ...(input.laneId ? { laneId: input.laneId } : {}),
    });
    if (!outcome.ok || !outcome.body?.resume) {
      const failure = generatorFailure(outcome.ok ? { ...outcome, status: 500 } : outcome);
      return { ok: false, key, ...failure, status: outcome.ok ? 502 : outcome.status, applicationId, actionUsed: false };
    }
    actionUsed = true;
    resume = outcome.body.resume;
    coverLetter = typeof outcome.body.coverLetter === "string" && outcome.body.coverLetter ? outcome.body.coverLetter : null;
    const g = outcome.body.grounding;
    const flags: string[] = Array.isArray(g?.flags) ? g.flags.map((f: any) => (typeof f?.claim === "string" ? f.claim.trim() : "")).filter(Boolean).slice(0, 8) : [];
    truth = outcome.body.finalizationBlocked || flags.length || g?.hasFabrication
      ? { blocked: !!outcome.body.finalizationBlocked, notice: typeof outcome.body.verificationNotice === "string" ? outcome.body.verificationNotice : "", flags }
      : null;
    tailoringNotes = Array.isArray(outcome.body.tailoringNotes) ? outcome.body.tailoringNotes.filter((n: unknown) => typeof n === "string").slice(0, 4) : [];
  }

  const raced = await deps.findSaved(key).catch(() => null);
  if (raced) return { ok: true, key, artifactId: raced.artifactId, applicationId: raced.applicationId, actionUsed, reused: true, truth, tailoringNotes };

  const targetContext = { targetJob: input.job.title, targetCompany: input.job.company, source: "job", applicationId, batchKey: key, batchId: input.batchId };
  let artifactId: string | null = null;
  try {
    artifactId = await deps.saveResume({ content: resume, targetContext, laneId: input.laneId, parentArtifactId: input.parentArtifactId ?? null });
  } catch { artifactId = null; }
  if (!artifactId) {
    return { ok: false, key, code: "save_failed", status: 503, error: "The resume was made but did not save. Retry saves it and uses no new AI action.", applicationId, actionUsed, pendingSave: { resume, coverLetter } };
  }
  if (coverLetter) {
    await deps.saveCoverLetter({ text: coverLetter, targetContext: { targetJob: input.job.title, targetCompany: input.job.company, source: "job", applicationId, batchKey: key }, laneId: input.laneId }).catch(() => {});
  }
  return { ok: true, key, artifactId, applicationId, actionUsed, reused: false, truth, tailoringNotes };
}

/** Remaining count across the limits that count calls. null = no count limit applies. */
export function remainingActions(parts: Array<number | null | undefined>): number | null {
  const known = parts.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return known.length ? Math.max(0, Math.min(...known)) : null;
}

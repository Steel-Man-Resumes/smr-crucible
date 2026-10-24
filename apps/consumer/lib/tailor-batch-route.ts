/**
 * The /api/tailor-batch handlers, built from injected pieces so the real
 * handler code is exercised by tests (lib/__tests__/tailor-batch-route.test.ts)
 * without Next, a database or a model. app/api/tailor-batch/route.ts wires the
 * real pieces: auth, the claim table (migration 093), the lane read, and the
 * existing applications, artifacts and career-package route handlers.
 *
 * Order of refusals on POST, all before any write or AI call:
 *  same origin -> signed in -> not impersonating -> the expected account header
 *  matches (a batch started by one person never writes into another's account)
 *  -> the request parses -> the lane is this person's open RESUME lane.
 */
import { parseBatchJobRequest, remainingActions, runBatchJob, type BatchJobDeps, type ClaimResult, type GenerateOutcome, type PendingResult } from "./tailor-batch-server";

export const TAILOR_BATCH_CONTEXT_KEYS = ["forgeOutput", "resumeText", "contact", "challenges", "criminalRecord", "approvedArtifactId"] as const;
export const NOT_READY_LINE = "Picking several jobs is not switched on yet. Tailor them one at a time for now.";
export const LANE_LINE = "This lane holds other work, not resumes. Switch to a resume lane on the job board, then pick your jobs again. Nothing was used.";

export interface ClaimStore {
  claim(key: string): Promise<ClaimResult>;
  release(key: string): Promise<void>;
  markGenerated(key: string, pending: PendingResult, applicationId: string): Promise<void>;
  markSaved(key: string, artifactId: string, applicationId: string | null): Promise<void>;
  findSaved(key: string): Promise<string | null>;
  /** Throws a "not ready" error when migration 093 is not applied. */
  ready(): Promise<void>;
}

export interface TailorBatchRouteDeps {
  session(): Promise<{ userId: string | null; impersonating: boolean; realUserId: string | null }>;
  sameOrigin(headers: Headers): boolean;
  /** "ok" for the person's open resume lane or main; otherwise why not. */
  laneKind(userId: string, laneId: string | null): Promise<"ok" | "not_found" | "not_resume">;
  claims(userId: string): ClaimStore;
  applicationStatus(userId: string, applicationId: string): Promise<string | null>;
  /** The existing route handlers, called as this same request. */
  inner: {
    applications(request: Request): Promise<Response>;
    artifacts(request: Request): Promise<Response>;
    generate(request: Request): Promise<Response>;
  };
  allowance(userId: string): Promise<{ remaining: number | null; blockedReason: string | null; locked: boolean }>;
  now(): number;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export function isNotReady(error: unknown) {
  return !!error && typeof error === "object" && (("code" in error && (error as { code?: unknown }).code === "42P01") || (error as Error).message === "tailor_batch_not_ready");
}

/** Call an existing route's handler as this same request (same cookies, same origin, same expected account). */
export function innerRequest(outer: Request, path: string, body: unknown) {
  const headers = new Headers({ "content-type": "application/json" });
  for (const name of ["cookie", "origin", "sec-fetch-site", "x-real-ip", "x-forwarded-for", "user-agent", "x-expected-account-id"]) {
    const value = outer.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Request(new URL(path, outer.url), { method: "POST", headers, body: JSON.stringify(body) });
}

export function createTailorBatchRoute(deps: TailorBatchRouteDeps) {
  async function owner(): Promise<{ userId: string } | { error: Response }> {
    const s = await deps.session();
    if (!s.userId) return { error: json({ ok: false, code: "signed_out", error: "Please sign in to tailor.", actionUsed: false }, 401) };
    // Viewing as another person never spends their allowance or writes their work.
    if (s.impersonating) return { error: json({ ok: false, code: "impersonation", error: "Batch tailoring is off while viewing as someone else.", actionUsed: false }, 403) };
    if (s.realUserId !== s.userId) return { error: json({ ok: false, code: "signed_out", error: "Please sign in again.", actionUsed: false }, 401) };
    return { userId: s.userId };
  }

  async function GET(request: Request): Promise<Response> {
    const who = await owner();
    if ("error" in who) return who.error;
    const userId = who.userId;
    try {
      const params = new URL(request.url).searchParams;
      // scope=single: the one-job "Tailor now" on the Tailor page. It uses no
      // batch claim and no batch lane rule, so only the allowance is read.
      if (params.get("scope") === "single") return json(await deps.allowance(userId));
      const rawLane = params.get("laneId");
      const laneId = !rawLane || rawLane === "main" ? null : rawLane;
      try { await deps.claims(userId).ready(); }
      catch (error) { if (isNotReady(error)) return json({ remaining: 0, blockedReason: NOT_READY_LINE, locked: false }); throw error; }
      if ((await deps.laneKind(userId, laneId)) !== "ok") return json({ remaining: 0, blockedReason: LANE_LINE, locked: false });
      return json(await deps.allowance(userId));
    } catch {
      return json({ code: "allowance_unavailable", error: "Your allowance could not be checked. Try again shortly." }, 503);
    }
  }

  async function POST(request: Request): Promise<Response> {
    const started = deps.now();
    if (!deps.sameOrigin(request.headers)) return json({ ok: false, code: "not_allowed", error: "Not allowed", actionUsed: false }, 403);
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 2_000_000) return json({ ok: false, code: "too_large", error: "Request too large", actionUsed: false }, 413);
    const who = await owner();
    if ("error" in who) return who.error;
    const userId = who.userId;
    // The batch belongs to the account that started it. Any other account
    // signed in since (another tab, a shared computer) is refused before any work.
    const expected = request.headers.get("x-expected-account-id");
    if (!expected || expected !== userId) {
      return json({ ok: false, code: "account_changed", error: "A different account is signed in now. Nothing was saved or used. Sign in as the person who picked these jobs, or pick them again.", actionUsed: false }, 409);
    }

    const raw = await request.json().catch(() => null);
    const parsed = parseBatchJobRequest(raw);
    if (!parsed.ok) return json({ ok: false, code: parsed.code, error: parsed.error, actionUsed: false }, 400);
    const input = parsed.value;
    const context: Record<string, unknown> = {};
    for (const key of TAILOR_BATCH_CONTEXT_KEYS) if (input.context[key] !== undefined) context[key] = input.context[key];
    input.context = context;
    const key = `${input.batchId}:${input.index}`;
    let heldKey: string | null = null;
    let claimStore: ClaimStore | null = null;

    try {
      const lane = await deps.laneKind(userId, input.laneId);
      if (lane !== "ok") return json({ ok: false, key, code: "invalid_lane", error: LANE_LINE, actionUsed: false }, 400);

      const claims = deps.claims(userId);
      claimStore = claims;
      const jobDeps: BatchJobDeps = {
        async claim(k) {
          const result = await claims.claim(k);
          // Taken by THIS request: an unexpected throw later must give it back.
          if (result.kind === "claimed" || result.kind === "pending") heldKey = k;
          return result;
        },
        release: k => claims.release(k),
        markGenerated: (k, p, a) => claims.markGenerated(k, p, a),
        markSaved: (k, a, app) => claims.markSaved(k, a, app),
        findSaved: k => claims.findSaved(k),
        applicationStatus: id => deps.applicationStatus(userId, id),
        elapsedMs: () => deps.now() - started,
        async saveApplication(job) {
          const response = await deps.inner.applications(innerRequest(request, "/api/applications", {
            job_title: job.title, company: job.company, location: job.location || "", salary: job.salary || "",
            description: job.description || "", employment_type: job.employment_type || "",
            source: job.source || "jsearch", source_id: job.id || "", apply_url: job.apply_url || null,
            employer_website: job.employer_website || null, jdFullText: job.description || "",
            jdSourceProvider: job.jdSourceProvider || job.source || "jsearch", jdSourceUrl: job.jdSourceUrl ?? job.apply_url ?? null,
            status: "saved",
          }));
          if (!response.ok) return null;
          const body = await response.json().catch(() => null);
          const app = body?.application;
          return typeof app?.id === "string" ? { id: app.id, status: typeof app.status === "string" ? app.status : "saved" } : null;
        },
        async generate(payload): Promise<GenerateOutcome> {
          const response = await deps.inner.generate(innerRequest(request, "/api/resume-generate-full", payload));
          const body = await response.json().catch(() => null);
          return { ok: response.ok, status: response.status, body };
        },
        async saveResume({ content, targetContext, laneId, parentArtifactId }) {
          const response = await deps.inner.artifacts(innerRequest(request, "/api/artifacts", {
            type: "resume", targetContext, content, scaffoldLevel: 1.0,
            ...(laneId ? { laneId } : {}), ...(parentArtifactId ? { parentArtifactId } : {}),
          }));
          if (!response.ok) return null;
          const body = await response.json().catch(() => null);
          return typeof body?.data?.id === "string" ? body.data.id : null;
        },
        async saveCoverLetter({ text, targetContext, laneId }) {
          const response = await deps.inner.artifacts(innerRequest(request, "/api/artifacts", {
            type: "cover_letter", targetContext, scaffoldLevel: 1.0,
            content: { text, targetJob: targetContext.targetJob, targetCompany: targetContext.targetCompany },
            ...(laneId ? { laneId } : {}),
          }));
          return response.ok;
        },
      };
      const result = await runBatchJob(input, jobDeps);
      return json(result, result.ok ? 200 : result.status);
    } catch (error) {
      // Never leave "running in another tab" behind for a request that crashed.
      if (heldKey && claimStore) await claimStore.release(heldKey).catch(() => {});
      if (isNotReady(error)) return json({ ok: false, key, code: "not_ready", error: NOT_READY_LINE, actionUsed: false }, 503);
      console.error("TAILOR_BATCH_JOB_FAILED", (error as Error)?.name || "error");
      return json({ ok: false, key, code: "unavailable", error: "This job could not run right now. Your other jobs are safe. Retry this one.", actionUsed: false }, 503);
    }
  }

  return { GET, POST };
}

export { remainingActions };

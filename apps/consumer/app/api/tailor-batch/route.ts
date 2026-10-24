/**
 * Multi-job tailoring, one job per request (so one slow job never times out
 * the others, and a failure on job 2 never touches job 1).
 *
 * GET  -> { remaining, blockedReason, locked } : the up-front allowance check
 *         for the whole batch (count limits only; spending limits can still
 *         stop a job, and a job that does not run uses nothing).
 * POST -> one job: { batchId, index, size, job, context, laneId, ... } ->
 *         per-job result with an error code (lib/tailor-batch-server.ts).
 *
 * No new write path and no new admission path: the job's application row, its
 * resume and cover letter, and the generator itself go through the existing
 * routes' own handlers (applications, artifacts, resume-generate-full), so
 * every validation, lane check, application link, snapshot and AI admission
 * (rate limit + beginAiOperation per job) is the one already in production.
 * The idempotency read uses the scoped, example-free listing only.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { effectiveAuth } from "@/lib/effective-auth";
import { getOne, getOneAsUser, getUserDailyLimit, listArtifacts } from "@crucible/core";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { parseBatchJobRequest, runBatchJob, remainingActions, type BatchJobDeps } from "@/lib/tailor-batch-server";
import { progressionAllowance, progressionLegacyBonus, checkProgressionTool } from "@/lib/progression-server";
import { readToolPolicy } from "@/lib/ai-operation-server";
import { POST as generateCareerPackage } from "@/app/api/resume-generate-full/route";
import { POST as saveApplicationRoute } from "@/app/api/applications/route";
import { POST as saveArtifactRoute } from "@/app/api/artifacts/route";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// The generator's tool: counted per call under this name (withRateLimit endpoint).
const GENERATOR = "resume-full";
// Only these person-context fields are forwarded to the generator.
const CONTEXT_KEYS = ["forgeOutput", "resumeText", "contact", "challenges", "criminalRecord", "approvedArtifactId"] as const;

async function signedInOwner() {
  const session = await effectiveAuth();
  const userId: string | undefined = session?.user?.id;
  if (!userId) return { error: NextResponse.json({ code: "signed_out", error: "Please sign in to tailor." }, { status: 401 }) };
  // Viewing as another person never spends their allowance or writes their work.
  if (session.impersonation) return { error: NextResponse.json({ code: "impersonation", error: "Batch tailoring is off while viewing as someone else." }, { status: 403 }) };
  const real = await auth();
  if (real?.user?.id !== userId) return { error: NextResponse.json({ code: "signed_out", error: "Please sign in again." }, { status: 401 }) };
  return { userId };
}

export async function GET() {
  const owner = await signedInOwner();
  if ("error" in owner) return owner.error;
  const userId = owner.userId;
  try {
    const locked = await checkProgressionTool(userId, GENERATOR);
    if (locked) {
      const body = await locked.json().catch(() => ({}));
      return NextResponse.json({ remaining: 0, blockedReason: body.error || "Tailoring is not open yet.", locked: true }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const [allow, limit, bonus, policy, used] = await Promise.all([
      progressionAllowance(userId),
      getUserDailyLimit(userId),
      progressionLegacyBonus(userId),
      readToolPolicy(userId, GENERATOR),
      // ai_usage is the per-tool daily counter the rate limit increments (not a protected table).
      getOne<{ call_count: number }>(`SELECT call_count FROM ai_usage WHERE user_id = $1 AND endpoint = $2 AND usage_date = CURRENT_DATE`, [userId, GENERATOR]),
    ]);
    if (policy?.disabled) return NextResponse.json({ remaining: 0, blockedReason: "This tool is paused. Your saved work is still available.", locked: false }, { headers: { "Cache-Control": "private, no-store" } });
    let policyLeft: number | null = null;
    if (policy?.daily_calls != null) {
      const ran = await getOneAsUser<{ n: number }>(userId, `SELECT count(*)::int AS n FROM ai_operation WHERE user_id = $1 AND workflow = $2 AND status <> 'failed' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, [userId, GENERATOR]);
      policyLeft = policy.daily_calls - (ran?.n ?? 0);
    }
    const progression = allow.account.existing ? null : allow.base + allow.bonus - allow.used;
    const legacy = limit === 0 ? null : limit + bonus - (used?.call_count ?? 0);
    return NextResponse.json(
      { remaining: remainingActions([progression, legacy, policyLeft]), blockedReason: allow.blockedReason ?? null, locked: false },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ code: "allowance_unavailable", error: "Your allowance could not be checked. Try again shortly." }, { status: 503 });
  }
}

/** Call an existing route's handler as this same request (same cookies, same origin). */
function innerRequest(outer: Request, path: string, body: unknown) {
  const headers = new Headers({ "content-type": "application/json" });
  for (const name of ["cookie", "origin", "sec-fetch-site", "x-real-ip", "x-forwarded-for", "user-agent"]) {
    const value = outer.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Request(new URL(path, outer.url), { method: "POST", headers, body: JSON.stringify(body) });
}

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ code: "not_allowed", error: "Not allowed" }, { status: 403 });
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 2_000_000) return NextResponse.json({ code: "too_large", error: "Request too large" }, { status: 413 });
  const owner = await signedInOwner();
  if ("error" in owner) return owner.error;
  const userId = owner.userId;

  const raw = await request.json().catch(() => null);
  const parsed = parseBatchJobRequest(raw);
  if (!parsed.ok) return NextResponse.json({ ok: false, code: parsed.code, error: parsed.error, actionUsed: false }, { status: 400 });
  const input = parsed.value;
  const context: Record<string, unknown> = {};
  for (const key of CONTEXT_KEYS) if (input.context[key] !== undefined) context[key] = input.context[key];
  input.context = context;

  const deps: BatchJobDeps = {
    async findSaved(key) {
      // Through the shared example-free listing (core listArtifacts, scoped as
      // the person). A batch's resumes are among the newest, so 100 covers it.
      const rows = await listArtifacts(userId, { type: "resume", limit: 100, examples: "hide" });
      const hit = rows.find(row => (row.target_context as Record<string, unknown> | null)?.batchKey === key);
      if (!hit) return null;
      const applicationId = (hit.target_context as Record<string, unknown>).applicationId;
      return { artifactId: hit.id, applicationId: typeof applicationId === "string" ? applicationId : null };
    },
    async ownsApplication(applicationId) {
      const row = await getOneAsUser<{ id: string }>(userId, `SELECT id FROM job_application WHERE id = $1 AND user_id = $2`, [applicationId, userId]);
      return !!row;
    },
    async saveApplication(job) {
      const response = await saveApplicationRoute(innerRequest(request, "/api/applications", {
        job_title: job.title, company: job.company, location: job.location || "", salary: job.salary || "",
        description: job.description || "", employment_type: job.employment_type || "",
        source: job.source || "jsearch", source_id: job.id || "", apply_url: job.apply_url || null,
        employer_website: job.employer_website || null, jdFullText: job.description || "",
        jdSourceProvider: job.jdSourceProvider || job.source || "jsearch", jdSourceUrl: job.jdSourceUrl ?? job.apply_url ?? null,
        status: "saved",
      }));
      if (!response.ok) return null;
      const body = await response.json().catch(() => null);
      return typeof body?.application?.id === "string" ? body.application.id : null;
    },
    async generate(payload) {
      const response = await generateCareerPackage(innerRequest(request, "/api/resume-generate-full", payload));
      const body = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, body };
    },
    async saveResume({ content, targetContext, laneId, parentArtifactId }) {
      const response = await saveArtifactRoute(innerRequest(request, "/api/artifacts", {
        type: "resume", targetContext, content, scaffoldLevel: 1.0,
        ...(laneId ? { laneId } : {}), ...(parentArtifactId ? { parentArtifactId } : {}),
      }));
      if (!response.ok) return null;
      const body = await response.json().catch(() => null);
      return typeof body?.data?.id === "string" ? body.data.id : null;
    },
    async saveCoverLetter({ text, targetContext, laneId }) {
      await saveArtifactRoute(innerRequest(request, "/api/artifacts", {
        type: "cover_letter", targetContext, scaffoldLevel: 1.0,
        content: { text, targetJob: targetContext.targetJob, targetCompany: targetContext.targetCompany },
        ...(laneId ? { laneId } : {}),
      }));
    },
  };

  try {
    const result = await runBatchJob(input, deps);
    if (result.ok) return NextResponse.json(result, { status: 200 });
    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error("TAILOR_BATCH_JOB_FAILED", (error as Error)?.name || "error");
    return NextResponse.json({ ok: false, key: `${input.batchId}:${input.index}`, code: "unavailable", error: "This job could not run right now. Your other jobs are safe. Retry this one.", actionUsed: false }, { status: 503 });
  }
}

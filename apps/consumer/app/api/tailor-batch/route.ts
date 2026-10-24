/**
 * Multi-job tailoring, one job per request (so one slow job never times out
 * the others, and a failure on job 2 never touches job 1).
 *
 * GET  ?laneId= -> { remaining, blockedReason, locked } : the up-front check
 *         for the whole batch (count limits, lane kind, feature readiness).
 * POST -> one job -> per-job result with an error code.
 *
 * The handler logic lives in lib/tailor-batch-route.ts (tested there); this
 * file wires the real pieces. No new write path for documents and no new
 * admission path: the application row, the resume and cover letter, and the
 * generator go through the existing routes' own handlers, so validation, lane
 * checks, links, snapshots and AI admission (rate limit + beginAiOperation per
 * job) are the ones already in use. The job claim (migration 093) and every
 * other read use the scoped helpers only.
 */
import { auth } from "@/auth";
import { effectiveAuth } from "@/lib/effective-auth";
import { getOne, getOneAsUser, queryAsUser, getUserDailyLimit, getOpenLane, laneKindOf, encryptJSON, decryptJSON } from "@crucible/core";
import type { EncryptedPayload } from "@crucible/core/src/crypto";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { createTailorBatchRoute, type ClaimStore } from "@/lib/tailor-batch-route";
import { remainingActions, type PendingResult } from "@/lib/tailor-batch-server";
import { progressionAllowance, progressionLegacyBonus, checkProgressionTool } from "@/lib/progression-server";
import { readToolPolicy } from "@/lib/ai-operation-server";
import { POST as generateCareerPackage } from "@/app/api/resume-generate-full/route";
import { POST as saveApplicationRoute } from "@/app/api/applications/route";
import { POST as saveArtifactRoute } from "@/app/api/artifacts/route";

export const runtime = "nodejs";
// The generator can take up to about two minutes on its own. The whole job
// (claim, application, generator, saves) gets more than twice that, and the
// generator may only START in the first minute (GENERATOR_START_BUDGET_MS).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// The generator's tool: counted per call under this name (withRateLimit endpoint).
const GENERATOR = "resume-full";
// A running claim older than this belongs to a request the platform already ended.
const STALE_CLAIM = "6 minutes";

function claimStore(userId: string): ClaimStore {
  const aad = (key: string) => `${userId}:tailor-batch:${key}`;
  return {
    async ready() {
      await queryAsUser(userId, "SELECT 1 FROM tailor_batch_claim WHERE user_id = $1 LIMIT 1", [userId]);
    },
    async claim(key) {
      // One atomic statement: a new key is inserted; an existing key is taken
      // over only when its last try failed, its result is waiting to be saved,
      // or its request is long gone. Anything else is running elsewhere.
      const rows = await queryAsUser<{ attempts: number; pending_encrypted: EncryptedPayload | null; application_id: string | null }>(userId,
        `INSERT INTO tailor_batch_claim (user_id, batch_key) VALUES ($1, $2)
         ON CONFLICT (user_id, batch_key) DO UPDATE
           SET status = 'running', attempts = LEAST(tailor_batch_claim.attempts + 1, 50), claimed_at = now(), finished_at = NULL
           WHERE tailor_batch_claim.status IN ('failed', 'generated')
              OR (tailor_batch_claim.status = 'running' AND tailor_batch_claim.claimed_at < now() - interval '${STALE_CLAIM}')
         RETURNING attempts, pending_encrypted, application_id`, [userId, key]);
      const row = rows[0];
      if (row) {
        if (row.pending_encrypted) {
          try { return { kind: "pending", pending: decryptJSON<PendingResult>(row.pending_encrypted, aad(key)), applicationId: row.application_id }; }
          catch { /* An unreadable result is dropped; the job runs again. */ }
        }
        return { kind: "claimed", attempts: row.attempts, applicationId: row.application_id };
      }
      const held = await getOneAsUser<{ status: string; artifact_id: string | null; application_id: string | null }>(userId,
        "SELECT status, artifact_id, application_id FROM tailor_batch_claim WHERE user_id = $1 AND batch_key = $2", [userId, key]);
      if (held?.status === "saved" && held.artifact_id) return { kind: "saved", artifactId: held.artifact_id, applicationId: held.application_id };
      return { kind: "busy" };
    },
    async release(key) {
      await queryAsUser(userId, "UPDATE tailor_batch_claim SET status = 'failed', finished_at = now() WHERE user_id = $1 AND batch_key = $2 AND status = 'running'", [userId, key]);
    },
    async markGenerated(key, pending, applicationId) {
      const payload = JSON.stringify(encryptJSON(pending, aad(key)));
      if (payload.length > 1_000_000) throw new Error("pending_too_large");
      await queryAsUser(userId, "UPDATE tailor_batch_claim SET status = 'generated', pending_encrypted = $3::jsonb, application_id = $4 WHERE user_id = $1 AND batch_key = $2", [userId, key, payload, applicationId]);
    },
    async markSaved(key, artifactId, applicationId) {
      await queryAsUser(userId, "UPDATE tailor_batch_claim SET status = 'saved', artifact_id = $3, application_id = $4, pending_encrypted = NULL, finished_at = now() WHERE user_id = $1 AND batch_key = $2", [userId, key, artifactId, applicationId]);
    },
    async findSaved(key) {
      // Only batch resumes carry batchKey (cover letters carry batchLetterKey).
      const row = await getOneAsUser<{ id: string }>(userId,
        "SELECT id FROM refinery_artifact WHERE user_id = $1 AND is_demo IS NOT TRUE AND target_context->>'batchKey' = $2 ORDER BY created_at ASC LIMIT 1", [userId, key]);
      return row?.id ?? null;
    },
  };
}

const handlers = createTailorBatchRoute({
  async session() {
    const session = await effectiveAuth();
    const real = await auth();
    return { userId: session?.user?.id ?? null, impersonating: !!session?.impersonation, realUserId: real?.user?.id ?? null };
  },
  sameOrigin: headers => isSameOriginJsonPost(headers),
  async laneKind(userId, laneId) {
    if (!laneId) return "ok";
    const lane = await getOpenLane(userId, laneId);
    if (!lane) return "not_found";
    return laneKindOf(lane) === "resume" ? "ok" : "not_resume";
  },
  claims: claimStore,
  async applicationStatus(userId, applicationId) {
    const row = await getOneAsUser<{ status: string }>(userId, "SELECT status FROM job_application WHERE id = $1 AND user_id = $2", [applicationId, userId]);
    return row?.status ?? null;
  },
  inner: { applications: saveApplicationRoute, artifacts: saveArtifactRoute, generate: generateCareerPackage },
  async allowance(userId) {
    const locked = await checkProgressionTool(userId, GENERATOR);
    if (locked) {
      const body = await locked.json().catch(() => ({}));
      return { remaining: 0, blockedReason: body.error || "Tailoring is not open yet.", locked: true };
    }
    const [allow, limit, bonus, policy, used] = await Promise.all([
      progressionAllowance(userId),
      getUserDailyLimit(userId),
      progressionLegacyBonus(userId),
      readToolPolicy(userId, GENERATOR),
      // ai_usage is the per-tool daily counter the rate limit increments (not a protected table).
      getOne<{ call_count: number }>(`SELECT call_count FROM ai_usage WHERE user_id = $1 AND endpoint = $2 AND usage_date = CURRENT_DATE`, [userId, GENERATOR]),
    ]);
    if (policy?.disabled) return { remaining: 0, blockedReason: "This tool is paused. Your saved work is still available.", locked: false };
    let policyLeft: number | null = null;
    if (policy?.daily_calls != null) {
      const ran = await getOneAsUser<{ n: number }>(userId, `SELECT count(*)::int AS n FROM ai_operation WHERE user_id = $1 AND workflow = $2 AND status <> 'failed' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, [userId, GENERATOR]);
      policyLeft = policy.daily_calls - (ran?.n ?? 0);
    }
    const progression = allow.account.existing ? null : allow.base + allow.bonus - allow.used;
    const legacy = limit === 0 ? null : limit + bonus - (used?.call_count ?? 0);
    return { remaining: remainingActions([progression, legacy, policyLeft]), blockedReason: allow.blockedReason ?? null, locked: false };
  },
  now: () => Date.now(),
});

export const GET = handlers.GET;
export const POST = handlers.POST;

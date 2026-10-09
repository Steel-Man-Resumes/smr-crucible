/**
 * Real dependencies for the record check handlers (server only). The tests
 * use fakes; this is the one place the handlers meet auth, the database, the
 * AI provider and the logs.
 */

import { cookies } from "next/headers";
import { auth } from "@/auth";
import { callAI } from "@/lib/ai-call";
import { MODEL_DEEP } from "@/lib/ai/models";
import { isMockEnabled } from "@/lib/mock-ai";
import { IMPERSONATE_COOKIE } from "@/lib/impersonation";
import { MOCK_RECORD_CHECK_REPLY } from "./mock";
import type { RecordCheckDeps } from "./handler";

const LAYER = "record_check" as const;
// Same ranking as withRateLimit: lower is more privileged; client is the floor.
const TIER_RANK: Record<string, number> = { admin: 0, unlimited: 1, partner: 2, client: 3, default: 3, observer: 4 };

export function realRecordCheckDeps(): RecordCheckDeps {
  return {
    userId: async () => {
      const session = await auth();
      return session?.user?.id ?? null;
    },
    // Fails closed: any impersonation cookie at all means staff may be acting
    // as the person (assist or view mode). A participant never carries one.
    actingForSomeoneElse: async () => {
      const store = await cookies();
      return !!store.get(IMPERSONATE_COOKIE)?.value;
    },
    tierAllowed: async (userId) => {
      const { getUserTier } = await import("@crucible/core");
      const tier = await getUserTier(userId);
      return (TIER_RANK[tier] ?? 4) <= TIER_RANK.client;
    },
    consentStatus: async (userId) => {
      const { getOne } = await import("@crucible/core");
      const row = await getOne<{ status: string; consent_text_version: string; granted_at: string }>(
        `SELECT status, consent_text_version, granted_at FROM consumer_consent WHERE user_id = $1 AND consent_layer = $2`,
        [userId, LAYER]
      );
      return {
        granted: row?.status === "granted",
        version: row?.consent_text_version ?? null,
        grantedAt: row?.status === "granted" ? String(row.granted_at) : null,
      };
    },
    grantConsent: async (userId, version) => {
      const { grantConsent } = await import("@crucible/core");
      const rec = await grantConsent(userId, LAYER, version, { screen: "record_check" }, { collectionMethod: "record_check_screen" });
      return { grantedAt: String(rec.granted_at) };
    },
    revokeAndDeleteAll: async (userId) => {
      const { revokeRecordCheckConsent } = await import("@crucible/core");
      const r = await revokeRecordCheckConsent(userId);
      return { deleted: r.deleted };
    },
    store: {
      save: async ({ userId, state, picks, typed, consentVersion }) => {
        const { saveRecordCheck } = await import("@crucible/core");
        const r = await saveRecordCheck({ userId, state, picks, typed, consentVersion });
        return r.ok ? { ok: true as const, id: r.id, createdAt: r.createdAt } : r;
      },
      list: async (userId) => {
        const { listRecordCheckSummaries } = await import("@crucible/core");
        return listRecordCheckSummaries(userId);
      },
      get: async (userId, id) => {
        const { getRecordCheck } = await import("@crucible/core");
        return getRecordCheck(userId, id);
      },
      deleteOne: async (userId, id) => {
        const { deleteRecordCheck } = await import("@crucible/core");
        return deleteRecordCheck(userId, id);
      },
    },
    // Claude only, no OpenAI fallback: the consent names one provider. The
    // signal carries the 20-second timeout and a revoke on this instance.
    callModel: (system, user, userId, signal) =>
      callAI(
        system,
        [{ role: "user", content: user }],
        600,
        MODEL_DEEP,
        { userId, endpoint: "record-check", anthropicOnly: true },
        signal
      ),
    mock: isMockEnabled(),
    mockReply: MOCK_RECORD_CHECK_REPLY,
    logDecision: async ({ userId, summary }) => {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        userId,
        contextPage: "record-check",
        modelProvider: "anthropic",
        modelId: MODEL_DEEP,
        // Fingerprint input: the step name only. No state, nothing typed.
        input: "record-check",
        explanation: "Built a record check checklist in the consented step. Counts only.",
        outputSummary: { type: "record_check", ...summary },
      });
    },
    logError: (where, label) => {
      console.error(`[record-check] ${where}: ${label}`);
    },
  };
}

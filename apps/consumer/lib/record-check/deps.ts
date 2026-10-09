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
    revokeConsent: async (userId) => {
      const { revokeConsent } = await import("@crucible/core");
      await revokeConsent(userId, LAYER, { collectionMethod: "record_check_screen" });
    },
    store: {
      save: async ({ userId, state, job, checklist, offense }) => {
        const { saveRecordCheck } = await import("@crucible/core");
        const r = await saveRecordCheck({ userId, state, job, checklist, offense });
        return { id: r.id, createdAt: r.createdAt };
      },
      list: async (userId) => {
        const { listRecordChecks } = await import("@crucible/core");
        return listRecordChecks(userId);
      },
      deleteOne: async (userId, id) => {
        const { deleteRecordCheck } = await import("@crucible/core");
        return deleteRecordCheck(userId, id);
      },
      deleteAll: async (userId) => {
        const { deleteAllRecordChecks } = await import("@crucible/core");
        return deleteAllRecordChecks(userId);
      },
    },
    // Claude only, no OpenAI fallback: the consent names one provider.
    callModel: (system, user, userId) =>
      callAI(system, [{ role: "user", content: user }], 1400, MODEL_DEEP, {
        userId,
        endpoint: "record-check",
        anthropicOnly: true,
      }),
    mock: isMockEnabled(),
    mockReply: MOCK_RECORD_CHECK_REPLY,
    logDecision: async ({ userId, state, summary }) => {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        userId,
        contextPage: "record-check",
        modelProvider: "anthropic",
        modelId: MODEL_DEEP,
        // Fingerprint input: the step and the state code only. Nothing typed.
        input: `record-check|${state}`,
        explanation: "Built a record check checklist in the consented step. No typed text is kept in this log.",
        outputSummary: { type: "record_check", state, ...summary },
      });
    },
    logError: (where, label) => {
      console.error(`[record-check] ${where}: ${label}`);
    },
  };
}

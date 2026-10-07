/**
 * Second check API: a model from a different family than the writer reads the
 * page against the person's own words and flags lines those words do not
 * back. Server only. Off by default (SECOND_CHECK_ENABLED). The work and
 * every gate are in lib/second-check-handler.ts; this file wires the real
 * database, auth, provider and usage ledger.
 */

import { auth } from "@/auth";
import {
  FORGE_IP_LIMITS,
  incrementIpUsage,
  query,
  releaseEndpointSlot,
  reserveEndpointSlot,
  usageDayUtc,
} from "@crucible/core";
import { secondCheckProviderFromEnv } from "@crucible/core/src/secondCheck";
import { getClientIp } from "@/lib/auth-rate-limit";
import { computeCostUsd, recordTokenUsage } from "@/lib/ai-usage-log";
import { handleSecondCheckPost, SECOND_CHECK_ENDPOINT, type SecondCheckDeps } from "@/lib/second-check-handler";

export const runtime = "nodejs";
export const maxDuration = 30;

const deps: SecondCheckDeps = {
  env: process.env,
  provider: () => {
    const got = secondCheckProviderFromEnv(process.env);
    return got.provider;
  },
  userIdOf: async () => (await auth())?.user?.id ?? null,
  ipOf: getClientIp,
  spentTodayUsd: async () => {
    const rows = await query<{ usd: string | null }>(
      `SELECT COALESCE(SUM(cost_usd), 0)::text AS usd FROM ai_token_usage
        WHERE endpoint = $1 AND created_at >= $2::timestamptz`,
      [SECOND_CHECK_ENDPOINT, `${usageDayUtc()}T00:00:00Z`]
    );
    const usd = Number(rows[0]?.usd ?? 0);
    if (!Number.isFinite(usd)) throw new Error("unreadable spend");
    return usd;
  },
  // Characters / 3 over-counts tokens for English text, so the estimate stays high.
  estimateUsd: (model, inputChars, maxOutputTokens) =>
    computeCostUsd(model, { inputTokens: Math.ceil(inputChars / 3) + 1_000, outputTokens: maxOutputTokens }),
  reserveAccount: async (userId, cap) => (await reserveEndpointSlot(userId, SECOND_CHECK_ENDPOINT, cap)).ok,
  releaseAccount: (userId) => releaseEndpointSlot(userId, SECOND_CHECK_ENDPOINT),
  reserveIp: async (ip) => (await incrementIpUsage(ip, SECOND_CHECK_ENDPOINT)) <= (FORGE_IP_LIMITS[SECOND_CHECK_ENDPOINT] ?? 5),
  recordUsage: (provider, model, usage, userId) =>
    recordTokenUsage(provider, model, usage, { userId, endpoint: SECOND_CHECK_ENDPOINT }),
};

export async function POST(request: Request) {
  return handleSecondCheckPost(request, deps);
}

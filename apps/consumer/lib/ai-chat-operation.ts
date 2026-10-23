import { beginAiOperation } from './ai-operation-server';
import { withAiOperation } from './ai-operation-context';
import { recordTokenUsage } from './ai-usage-log';
import { getUserDailyLimit, incrementUserUsage, refundUserUsage } from '@crucible/core';
import { progressionLegacyBonus } from '@/lib/progression-server';

interface ChatOperationOptions {
  rateLimitMessage?: string | (() => Promise<string>);
}

/** Reserve legacy quota at the provider boundary, then keep the operation open
 * through stream callbacks. A failed or denied operation gives that slot back. */
export async function beginChatOperation(userId: string | null, endpoint: string, model: string, options: ChatOperationOptions = {}) {
  let operation: Awaited<ReturnType<typeof beginAiOperation>> | null = null;
  let response: Response | undefined;
  let quotaHeld = false;
  let failed = false;
  let providerAttempted = false;
  let settled: Promise<void> | null = null;
  const refund = async () => {
    if (!quotaHeld || !userId) return;
    quotaHeld = false;
    await refundUserUsage(userId, endpoint);
  };
  try {
    if (userId) {
      const limit = await getUserDailyLimit(userId);
      const bonus = limit === 0 ? 0 : await progressionLegacyBonus(userId);
      const count = await incrementUserUsage(userId, endpoint);
      quotaHeld = true;
      if (limit !== 0 && count > limit + bonus) {
        await refund();
        const message = typeof options.rateLimitMessage === 'function' ? await options.rateLimitMessage() : options.rateLimitMessage;
        response = Response.json({ error: message || "Your daily chat allowance is used. Your saved work is still available." }, { status: 429 });
      } else {
        const admission = { userId, endpoint, legacyOverage: limit !== 0 && count > limit };
        operation = await beginAiOperation(admission);
        response = operation.response;
        if (response) await refund();
      }
    }
  } catch {
    try { await refund(); } catch { console.error('CHAT_QUOTA_REFUND_FAILED'); }
    response = Response.json({ error: "Chat access could not be checked. Try again shortly. Your saved work is still available." }, { status: 503 });
  }
  const run = <T>(callback: () => T): T => operation
    ? withAiOperation(operation.context, callback) : callback();
  const settle = (failure: boolean, missingUsage = false) => {
    if (settled) return settled;
    failed = failure || !!operation?.context.failed;
    settled = run(async () => {
      try {
        if (missingUsage) await recordTokenUsage('anthropic', model, { inputTokens: 0, outputTokens: 0 },
          { userId, endpoint, usageMissing: true, outcome: 'failed' });
        await operation?.finish(failed ? 'failed' : 'succeeded');
      }
      finally { if (failed) await refund(); }
    });
    return settled;
  };
  return {
    response,
    run,
    markProviderAttempted: () => {
      providerAttempted = true;
      if (operation) Object.assign(operation.context, { providerAttempted: true });
    },
    finish: () => settle(failed || !!operation?.context.failed),
    // settle installs its promise before awaiting writes, so duplicate error
    // callbacks cannot double-record missing usage or refund another slot.
    fail: () => settle(true, providerAttempted),
  };
}

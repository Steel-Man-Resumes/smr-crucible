/**
 * Exact AI token accounting (server-side only).
 *
 * Every AI call records real provider-reported token counts plus a computed
 * cost into ai_token_usage. Recording is fire-and-forget: a logging failure
 * must never break the user-facing call.
 *
 * Prices are USD per MILLION tokens (checked 2026-08-02 against Anthropic's
 * published pricing and OpenAI's). Cache reads bill at ~0.1x input, cache
 * writes at 1.25x input (Anthropic).
 */

interface ModelPrice {
  input: number;
  output: number;
}

const PRICES: Record<string, ModelPrice> = {
  // Anthropic (per MTok)
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  // OpenAI (per MTok)
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

function priceFor(model: string): ModelPrice {
  if (PRICES[model]) return PRICES[model];
  // Prefix match tolerates dated/suffixed model ids
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  if (key) return PRICES[key];
  // Unknown model: assume Sonnet-tier so costs are never silently zero
  return { input: 3, output: 15 };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface AiCallMeta {
  userId?: string | null;
  endpoint?: string;
}

export function computeCostUsd(model: string, usage: TokenUsage): number {
  const p = priceFor(model);
  const cacheWrite = usage.cacheCreationInputTokens || 0;
  const cacheRead = usage.cacheReadInputTokens || 0;
  const cost =
    (usage.inputTokens / 1_000_000) * p.input +
    (usage.outputTokens / 1_000_000) * p.output +
    (cacheWrite / 1_000_000) * p.input * 1.25 +
    (cacheRead / 1_000_000) * p.input * 0.1;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Fire-and-forget: never throws, never blocks the caller. */
export function recordTokenUsage(
  provider: string,
  model: string,
  usage: TokenUsage,
  meta?: AiCallMeta
): void {
  void (async () => {
    try {
      const { query } = await import("@crucible/core");
      await query(
        `INSERT INTO ai_token_usage
           (user_id, endpoint, provider, model, input_tokens, output_tokens,
            cache_creation_input_tokens, cache_read_input_tokens, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          meta?.userId || null,
          meta?.endpoint || "unknown",
          provider,
          model,
          usage.inputTokens || 0,
          usage.outputTokens || 0,
          usage.cacheCreationInputTokens || 0,
          usage.cacheReadInputTokens || 0,
          computeCostUsd(model, usage),
        ]
      );
    } catch (err) {
      console.error("ai_token_usage insert failed:", err);
    }
  })();
}

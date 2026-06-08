/**
 * Tiered AI model selection -- the single source of truth for which Claude model
 * each surface uses.
 *
 * Troy's doctrine (2026-06-08): use AIs intelligently. Match model power to the
 * stakes of the task, not one model everywhere.
 *
 *   DEEP  -> highest reasoning. High-stakes, one-shot synthesis where quality
 *            changes a real outcome: full career narrative, disclosure plan,
 *            tailored resume generation. Latency is acceptable here.
 *   CHAT  -> live t.ROY coaching. Fast + strong, streams in real time. The
 *            high-frequency surface; it has to feel like texting.
 *   FAST  -> mechanical work: extraction, classification, simplification,
 *            Mini Forge. Cheapest/fastest; reasoning depth is not the bottleneck.
 *
 * Pricing (per 1M tokens, input / output) for cost-awareness:
 *   Opus 4.8   $5 / $25      Sonnet 4.6   $3 / $15      Haiku 4.5   $1 / $5
 *
 * Use the exact model aliases below -- do NOT append date suffixes.
 */

export const MODEL_DEEP = "claude-opus-4-8";
export const MODEL_CHAT = "claude-sonnet-4-6";
export const MODEL_FAST = "claude-haiku-4-5";

/** OpenAI resilience fallbacks (Anthropic-primary failover doctrine, 2026-06-07). */
export const FALLBACK_DEEP = "gpt-4o";
export const FALLBACK_CHAT = "gpt-4o";
export const FALLBACK_FAST = "gpt-4o-mini";

export type ModelTier = "deep" | "chat" | "fast";

/** Resolve a tier to its primary Claude model id. */
export function modelForTier(tier: ModelTier): string {
  switch (tier) {
    case "deep":
      return MODEL_DEEP;
    case "fast":
      return MODEL_FAST;
    case "chat":
    default:
      return MODEL_CHAT;
  }
}

/**
 * Phase 7.7 -- the AI headshot generation gate.
 *
 * Generation is a PAID image API call. It stays OFF until Troy picks a provider
 * and confirms per-image spend. This helper is the single source of truth for
 * whether the feature is on: it returns true ONLY when both an explicit feature
 * flag AND a provider key are present in the environment. The generate route
 * returns 501 (and does NOT touch the daily cap) whenever this is false, and the
 * settings UI shows a plain "not available yet" note instead of a broken button.
 *
 * DOCTRINE: even when enabled, a generated headshot is retained alongside the
 * original (never overwrites it) and is NEVER auto-added to a resume.
 */

export interface HeadshotGenStatus {
  enabled: boolean;
  /** Small, non-secret hint for the UI. Never leaks the key itself. */
  reason: "ok" | "flag_off" | "no_provider_key";
}

/**
 * True only when generation is fully configured. Requires:
 *   HEADSHOT_GEN_ENABLED === "true"  -- the explicit on switch, and
 *   a provider key present           -- currently OPENAI_API_KEY (gpt-image-1),
 *                                       the intended first provider.
 * Either one missing keeps the feature off, and the generate route returns 501
 * before any paid API call. The route reads this to decide whether to run.
 */
export function isHeadshotGenEnabled(): boolean {
  return headshotGenStatus().enabled;
}

export function headshotGenStatus(): HeadshotGenStatus {
  const flagOn = process.env.HEADSHOT_GEN_ENABLED === "true";
  if (!flagOn) return { enabled: false, reason: "flag_off" };
  const hasKey = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
  if (!hasKey) return { enabled: false, reason: "no_provider_key" };
  return { enabled: true, reason: "ok" };
}

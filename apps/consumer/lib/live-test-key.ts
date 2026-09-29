/**
 * Live test calls (2026-09-28). The team has to be able to run real Forge calls
 * against a preview or production deployment without spending the anonymous
 * per-IP allowance that job seekers depend on.
 *
 * A request that carries LIVE_TEST_HEADER with a value equal to the
 * FORGE_TEST_KEY environment variable draws from its own bucket instead of the
 * caller's IP bucket. The bucket is bounded per endpoint per day, so a leaked
 * key buys a small, fixed number of calls, never unlimited use. With
 * FORGE_TEST_KEY unset (or too short to be a real secret) the feature is off.
 * The key itself is never logged.
 */

export const LIVE_TEST_HEADER = "x-smr-test-key";

/** Usage-table bucket for live test calls, kept apart from every real IP. */
export const LIVE_TEST_BUCKET = "test:live";

/** Per endpoint, per day. */
export const LIVE_TEST_DAILY_LIMIT = 60;

/** Shorter than this and the configured key is treated as unset. */
export const LIVE_TEST_MIN_KEY_LENGTH = 32;

/**
 * True only when a key is configured, it is long enough, the caller sent one,
 * and the two match. Each missing input returns false on its own line, so no
 * missing value can slip past the comparison. Constant-time over the configured
 * key's length so response timing does not reveal how much of a guess matched.
 */
export function liveTestKeyAllowed(
  given: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (typeof expected !== "string") return false;
  if (expected.length < LIVE_TEST_MIN_KEY_LENGTH) return false;
  if (typeof given !== "string" || given.length === 0) return false;
  let diff = given.length === expected.length ? 0 : 1;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i % given.length);
  }
  return diff === 0;
}

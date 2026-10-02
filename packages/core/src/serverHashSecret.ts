/**
 * The server secret that keys every one-way fingerprint we store: the per-IP
 * usage counts in ai_usage and the input fingerprint in decision_log.
 *
 * A plain hash of a short value (an IPv4 address, a bare job title) can be
 * reversed by hashing guesses until one matches. An HMAC keyed with this
 * secret cannot be checked without it, so a leaked table gives nothing back.
 *
 * IP_HASH_SECRET when set, else AUTH_SECRET. In production with neither set it
 * throws rather than fall back to a value anyone can read in this public repo.
 * Outside production a fixed development value keeps local runs and tests
 * working.
 *
 * Pure (no database import) so the callers' hashing can be tested on its own.
 */
export function serverHashSecret(purpose: string): string {
  const s = process.env.IP_HASH_SECRET || process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`IP_HASH_SECRET or AUTH_SECRET must be set to ${purpose}`);
  }
  return "dev-only-usage-key-secret";
}

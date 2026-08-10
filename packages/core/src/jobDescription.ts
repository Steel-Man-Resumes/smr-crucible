/**
 * Phase 3.2: job-description snapshot builder.
 *
 * A saved job_application stores the JD exactly as it was at save time, with
 * provenance, so every downstream consumer (fit-check 3.4, interview auto-fill,
 * reopened-job tailoring) reads ONE canonical snapshot instead of re-deriving a
 * different JD per flow. The stored text is bounded HIGH (JD_STORE_MAX) and
 * truncation is SHOWN (jd_truncated), never silent. jd_hash is the sha256 of
 * the STORED (post-bound) text -- the key a cached fit-check / interview result
 * binds to, alongside the resume revision hash.
 *
 * Pure and unit-testable: no DB, no env, no clock. The route supplies
 * fetchedAt; this module only normalizes and hashes.
 */

import { createHash } from "node:crypto";

// Bound high enough for ordinary long postings (a dense JD is a few thousand
// chars; 24k covers benefits + legal boilerplate). Beyond this we truncate and
// set jd_truncated so the UI can say "snapshot trimmed" rather than pretend.
export const JD_STORE_MAX = 24000;

// Display excerpt length. ~300 chars is one glanceable paragraph.
export const JD_EXCERPT_MAX = 300;

export interface JdSnapshotInput {
  /** The fullest JD text available (pasted, fetched, or full_description). */
  fullText?: string | null;
  /** Fallback text to build the excerpt from when fullText is empty. */
  excerptSource?: string | null;
  sourceUrl?: string | null;
  provider?: string | null;
  /** ISO timestamp of when the JD was fetched, if it came from a fetch. */
  fetchedAt?: string | null;
}

export interface JdSnapshot {
  jd_full_text: string | null;
  jd_excerpt: string | null;
  jd_source_url: string | null;
  jd_source_provider: string | null;
  jd_fetched_at: string | null;
  jd_hash: string | null;
  jd_truncated: boolean;
}

/** The seven jd_* columns, in a fixed order. Documented so the applications
 *  route (and any other writer) inserts exactly these keys. */
export const JD_SNAPSHOT_COLUMNS = [
  "jd_full_text",
  "jd_excerpt",
  "jd_source_url",
  "jd_source_provider",
  "jd_fetched_at",
  "jd_hash",
  "jd_truncated",
] as const;

function normalize(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

/** sha256 of the exact stored text. Deterministic; same text -> same hash,
 *  any change -> different hash. */
function hashStored(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function buildExcerpt(source: string): string {
  if (source.length <= JD_EXCERPT_MAX) return source;
  return source.slice(0, JD_EXCERPT_MAX);
}

/**
 * Build the snapshot columns from the best available JD.
 *
 * - fullText is normalized and bounded to JD_STORE_MAX; jd_truncated is true
 *   only when the bound actually cut characters.
 * - The excerpt is drawn from the (bounded) fullText when present, else from
 *   excerptSource, capped at JD_EXCERPT_MAX.
 * - jd_hash is the sha256 of the STORED text (post-bound), so it matches what a
 *   consumer reads back byte-for-byte.
 * - Empty/undefined fullText yields null text/hash/excerpt (no crash), while
 *   provider/url/fetchedAt still pass through (they can be known without text).
 */
export function buildJdSnapshot(input: JdSnapshotInput): JdSnapshot {
  const rawFull = normalize(input.fullText);
  let storedFull: string | null = null;
  let truncated = false;

  if (rawFull.length > 0) {
    if (rawFull.length > JD_STORE_MAX) {
      storedFull = rawFull.slice(0, JD_STORE_MAX);
      truncated = true;
    } else {
      storedFull = rawFull;
    }
  }

  const excerptSource = storedFull ?? normalize(input.excerptSource);
  const excerpt = excerptSource.length > 0 ? buildExcerpt(excerptSource) : null;

  const sourceUrl = normalize(input.sourceUrl) || null;
  const provider = normalize(input.provider) || null;
  const fetchedAt = normalize(input.fetchedAt) || null;

  return {
    jd_full_text: storedFull,
    jd_excerpt: excerpt,
    jd_source_url: sourceUrl,
    jd_source_provider: provider,
    jd_fetched_at: fetchedAt,
    jd_hash: storedFull ? hashStored(storedFull) : null,
    jd_truncated: truncated,
  };
}

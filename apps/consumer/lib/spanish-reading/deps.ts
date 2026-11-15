/**
 * The real dependencies of the Spanish reading route (lane D1). The handler
 * (handler.ts) takes these as arguments so tests can replace every one.
 *
 * No migration: the cache is this server process's memory, and the per-version
 * count is read from the usage ledger that already exists (ai_token_usage).
 */
import { auth } from "@/auth";
import { getArtifact, queryAsUser } from "@crucible/core";
import { callAI } from "@/lib/ai-call";
import { MODEL_FAST } from "@/lib/ai/models";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { spanishReadingOn } from "@/lib/server-switch";
import { formatResumeDownload, migrateLegacyResume } from "@/components/resume/resumeModel";
import { laneDPrefix, READING_ENDPOINT, type CachedReading, type ReadingDeps } from "./handler";

/** Best-effort, per process, bounded. A cold or different instance simply has no entry. */
const CACHE_MAX = 200;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: CachedReading }>();

export function readingCacheGet(userId: string, hash: string, now = Date.now()): CachedReading | null {
  const key = `${userId}:${hash}`;
  const entry = cache.get(key);
  if (!entry) return null;
  if (now - entry.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  // Refresh recency: a Map iterates in insertion order, so re-insert.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

export function readingCachePut(userId: string, hash: string, value: CachedReading, now = Date.now()): void {
  const key = `${userId}:${hash}`;
  cache.delete(key);
  cache.set(key, { at: now, value });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function resetReadingCache(): void { cache.clear(); }

function resumeTextFrom(content: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = content as any;
  const doc = c?.formatVersion === 2 || c?.formatVersion === 3 ? c : migrateLegacyResume(c ?? {});
  // The employer-facing text: private notes and justice-sensitive content are already removed.
  return formatResumeDownload(doc);
}

export function realReadingDeps(): ReadingDeps {
  return {
    switchOn: () => spanishReadingOn(),
    sameOrigin: (headers) => isSameOriginJsonPost(headers),
    userId: async () => (await auth())?.user?.id ?? null,
    loadResumeText: async (userId, artifactId) => {
      // Ownership-scoped (WHERE id AND user_id, under the person's row-level security): a foreign id reads as not found.
      const artifact = await getArtifact(artifactId, userId);
      if (!artifact || artifact.artifact_type !== "resume") return { kind: "not_found" };
      return { kind: "ok", text: resumeTextFrom(artifact.content) };
    },
    cacheGet: (userId, hash) => readingCacheGet(userId, hash),
    cachePut: (userId, hash, value) => readingCachePut(userId, hash, value),
    callsUsed: async (userId, hash) => {
      const rows = await queryAsUser<{ n: number }>(
        userId,
        `SELECT count(*)::int AS n FROM ai_token_usage
         WHERE user_id = $1 AND endpoint = $2 AND outcome = 'succeeded' AND event_key LIKE $3`,
        [userId, READING_ENDPOINT, `${laneDPrefix(hash)}%`]
      );
      return Number(rows[0]?.n ?? 0);
    },
    translate: (input) =>
      callAI(input.system, [{ role: "user", content: input.user }], input.maxTokens, MODEL_FAST, {
        userId: input.userId,
        endpoint: READING_ENDPOINT,
        eventKey: input.eventKey,
        // One provider, no fallback: the resume goes to Anthropic only, and the cost measured is one model's.
        anthropicOnly: true,
        temperature: input.temperature,
      }),
  };
}

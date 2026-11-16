/**
 * POST /api/resume/spanish-reading, the logic (lane D1).
 *
 * "Lectura en español de tu currículum": a faithful Spanish reading of one of
 * the person's OWN saved English resumes, so they can check the English against
 * what they meant. It is not a resume, it is not exportable, and it never
 * replaces the English.
 *
 * Every dependency is injected (deps.ts holds the real ones), so the tests run
 * the whole flow without a database, a session or a model.
 *
 * What the browser may send: one field, artifactId. Never text. The server
 * loads the resume itself, under the person's own row-level-security access
 * (getArtifact: id AND user_id), so another person's id reads as not found.
 * Only the resume text goes to the model; vault documents, record facts,
 * evidence and notes are never read here.
 *
 * Nothing in this file logs resume text or the reading. The usage log counts
 * tokens and cost only.
 *
 * LIMIT AND CACHE, with no migration (the report says what a table would add):
 *   - A "version" is the SHA-256 of the resume text. Edit the resume and it is a
 *     new version.
 *   - At most LANE_D_CALLS_PER_VERSION model calls per version, counted from the
 *     existing usage ledger (ai_token_usage, event_key "lane-d:<hash>:<id>").
 *   - The finished reading is cached per version in this server process (best
 *     effort; a cold instance or another server may not have it) and by the page.
 *   - Over the limit: a plain 429 with code reading_limit and no model call.
 *     The page shows a Spanish line: edit the resume for a fresh reading (a
 *     changed text is a new version). The progress-bar AI-bonus request does
 *     NOT raise this limit, so the page offers no request button.
 */
import { createHash, randomUUID } from "node:crypto";
import { checkFaithfulness } from "./faithfulness";
import { buildReadingPrompt, normalizeResumeText, READING_MAX_CHARS } from "./prompt";

/** Lane D (Spanish work) may spend at most this many model calls on one resume version. The owner set the ceiling low, with a way to ask for more (2026-11-15). Lane D1 uses 1 in the normal path. */
export const LANE_D_CALLS_PER_VERSION = 2;
/** The ledger endpoint name. Registered in lib/ai-operation-policy.ts so the owner can cap it per day. */
export const READING_ENDPOINT = "spanish-reading";
/** Haiku 4.5 reads a resume of a few thousand tokens and answers in about as many. */
export const READING_MAX_OUTPUT_TOKENS = 4000;
/** Low, so the same resume reads the same way twice. */
export const READING_TEMPERATURE = 0.2;

export type ResumeLoad =
  | { kind: "ok"; text: string }
  | { kind: "not_found" };

export interface CachedReading {
  reading: string;
  missing: string[];
}

export interface TranslateInput {
  userId: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  /** Unique per call; starts with laneDPrefix(hash) so the ledger can count calls per version. */
  eventKey: string;
}

export interface ReadingDeps {
  switchOn(): boolean;
  sameOrigin(headers: Headers): boolean;
  /** The signed-in person, or null. */
  userId(): Promise<string | null>;
  /** The person's OWN resume text (artifact type resume), or not_found. */
  loadResumeText(userId: string, artifactId: string): Promise<ResumeLoad>;
  cacheGet(userId: string, hash: string): CachedReading | null;
  cachePut(userId: string, hash: string, value: CachedReading): void;
  /** Model calls already made on this version, from the usage ledger. */
  callsUsed(userId: string, hash: string): Promise<number>;
  /** One model call. Returns the model's text. Throws on failure. */
  translate(input: TranslateInput): Promise<string>;
}

export const laneDPrefix = (hash: string) => `lane-d:${hash}:`;

/** The version of a resume: a hash of its text. */
export function resumeVersion(text: string): string {
  return createHash("sha256").update(normalizeResumeText(text), "utf8").digest("hex");
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Requests for the same person and version that are already running share one model call (a double click never pays twice). */
const inflight = new Map<string, Promise<{ cached: CachedReading } | { error: Response }>>();

export async function handleSpanishReading(request: Request, deps: ReadingDeps): Promise<Response> {
  // Off means the route does not exist: same answer as an unknown route, before anything else runs.
  if (!deps.switchOn()) return json({ error: "Not found" }, 404);

  if (!deps.sameOrigin(request.headers)) return json({ error: "Not allowed" }, 403);

  const userId = await deps.userId();
  if (!userId) return json({ error: "Please sign in to use this feature." }, 401);

  const length = request.headers.get("content-length");
  if (length && parseInt(length, 10) > 2_000) return json({ error: "Request too large" }, 413);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
  // Exactly one field. The browser never sends text and never decides anything but which of its own resumes.
  const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
  const artifactId = (body as { artifactId?: unknown } | null)?.artifactId;
  if (keys.length !== 1 || keys[0] !== "artifactId" || typeof artifactId !== "string" || !UUID.test(artifactId)) {
    return json({ error: "Bad request" }, 400);
  }

  const loaded = await deps.loadResumeText(userId, artifactId);
  if (loaded.kind !== "ok") return json({ error: "Not found" }, 404);
  const text = normalizeResumeText(loaded.text);
  if (!text) return json({ error: "This resume has no text yet." }, 422);
  if (text.length > READING_MAX_CHARS) return json({ error: "This resume is too long for a reading." }, 413);

  const hash = resumeVersion(text);
  const hit = deps.cacheGet(userId, hash);
  if (hit) return json({ reading: hit.reading, missing: hit.missing, cached: true });

  const flightKey = `${userId}:${hash}`;
  let flight = inflight.get(flightKey);
  if (!flight) {
    flight = (async () => {
      // Another request may have finished while this one waited its turn.
      const late = deps.cacheGet(userId, hash);
      if (late) return { cached: late };
      const used = await deps.callsUsed(userId, hash);
      if (used >= LANE_D_CALLS_PER_VERSION) {
        return { error: json({ code: "reading_limit", error: "This resume has used its Spanish readings.", limit: LANE_D_CALLS_PER_VERSION }, 429) };
      }
      const prompt = buildReadingPrompt(text);
      let raw: string;
      try {
        raw = await deps.translate({
          userId,
          system: prompt.system,
          user: prompt.user,
          maxTokens: READING_MAX_OUTPUT_TOKENS,
          temperature: READING_TEMPERATURE,
          eventKey: laneDPrefix(hash) + randomUUID(),
        });
      } catch {
        // Fixed message only: a provider error can carry request text.
        return { error: json({ code: "reading_failed", error: "The reading could not be made. Your resume is unchanged." }, 502) };
      }
      const reading = raw.trim();
      if (!reading) return { error: json({ code: "reading_failed", error: "The reading could not be made. Your resume is unchanged." }, 502) };
      const verdict = checkFaithfulness(text, reading);
      const value: CachedReading = { reading, missing: verdict.missing };
      deps.cachePut(userId, hash, value);
      return { cached: value };
    })().finally(() => { inflight.delete(flightKey); });
    inflight.set(flightKey, flight);
  }
  const result = await flight;
  if ("error" in result) return result.error.clone();
  return json({ reading: result.cached.reading, missing: result.cached.missing, cached: false });
}

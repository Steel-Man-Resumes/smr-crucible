/**
 * The person's handoff read, with a failure kept apart from "nothing new"
 * (demo review 2026-10-28). Before this, GET /api/handoffs answered 200 []
 * on any failure and the page turned every HTTP or network error into [], so
 * a broken read looked exactly like a quiet week. Pure and fetch-injectable,
 * so it is unit tested without a browser.
 */

/** The plain error code GET /api/handoffs returns with a 503. */
export const HANDOFFS_UNAVAILABLE = "handoffs_unavailable";

/** What the person sees when the read fails. Empty keeps its own words. */
export const HANDOFFS_LOAD_FAILED = "Could not load what your case manager sent. Try again.";
export const HANDOFFS_RETRY = "Retry";
export const HANDOFFS_EMPTY = "Nothing new from your case manager in the last 30 days.";

export type HandoffsLoad<T> = { ok: true; handoffs: T[] } | { ok: false };

/** One read of /api/handoffs: the list on a 200 with a list in it, a failure on anything else. */
export async function loadMyHandoffs<T>(f: (url: string, init?: RequestInit) => Promise<Response> = fetch): Promise<HandoffsLoad<T>> {
  try {
    const r = await f("/api/handoffs", { cache: "no-store" });
    if (!r.ok) return { ok: false };
    const d = (await r.json().catch(() => null)) as { handoffs?: unknown } | null;
    return Array.isArray(d?.handoffs) ? { ok: true, handoffs: d!.handoffs as T[] } : { ok: false };
  } catch {
    return { ok: false };
  }
}

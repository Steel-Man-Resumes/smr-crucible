/**
 * The words a Settings control shows when a save does not land, pure part.
 *
 * Settings routes answer a refused save with { error } and a 403 (lib/
 * settings-guard.ts: read only while viewing, "only the person can change
 * this" for consent, and so on). The controls used to check res.ok and stop,
 * so an operator's click did nothing and said nothing, or the page showed a
 * change the server had refused. Every control now shows the route's words
 * beside itself and keeps (or puts back) the saved state.
 */

export const SAVE_ERROR_FALLBACK = 'Could not save. Try again.';

/** The route's error line when it is a short plain string; otherwise the fallback. */
export function saveErrorWords(body: unknown, fallback = SAVE_ERROR_FALLBACK): string {
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  return typeof error === 'string' && error.trim() && error.length < 300 ? error.trim() : fallback;
}

/** Read a failed response's words without throwing; a body that is not JSON gets the fallback. */
export async function readSaveError(res: Response, fallback = SAVE_ERROR_FALLBACK): Promise<string> {
  const body = await res.json().catch(() => null);
  return saveErrorWords(body, fallback);
}

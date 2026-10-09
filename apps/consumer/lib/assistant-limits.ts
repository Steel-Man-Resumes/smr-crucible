/**
 * Size limits on t.ROY's chat for a caller who is not signed in (security
 * review 3a r1, L4). Once the Forge wall is up, /api/assistant is the only AI
 * route open signed out, so its input is bounded: the request must say its
 * size, and the messages together stay under SIGNED_OUT_MAX_MESSAGE_CHARS.
 * Signed in, the account limits and the 1 MB request cap apply as before.
 */
export const SIGNED_OUT_MAX_MESSAGE_CHARS = 40_000;

/** Total characters a thread sends (text content and text parts). */
export function messageChars(messages: Array<Record<string, unknown>>): number {
  let n = 0;
  for (const m of messages) {
    if (typeof m.content === "string") n += m.content.length;
    if (Array.isArray(m.parts)) {
      for (const p of m.parts as Array<Record<string, unknown>>) {
        if (p && typeof p.text === "string") n += p.text.length;
      }
    }
  }
  return n;
}

/** null when fine; otherwise the HTTP status to refuse with. */
export function signedOutAssistantRefusal(
  contentLength: string | null,
  messages: Array<Record<string, unknown>>
): 411 | 413 | null {
  if (contentLength === null) return 411;
  if (messageChars(messages) > SIGNED_OUT_MAX_MESSAGE_CHARS) return 413;
  return null;
}

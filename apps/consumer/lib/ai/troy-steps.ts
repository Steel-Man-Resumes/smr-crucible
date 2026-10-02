/**
 * Step budgets for t.ROY chat, shared by the browser hook (lib/use-assistant)
 * and the routes (/api/assistant, /api/coach). No server imports: the browser
 * bundle loads this file.
 *
 * SERVER: steps one request may take (streamText maxSteps).
 * CLIENT: steps one assistant turn may take in the browser (useChat maxSteps).
 * When a request ends on a tool call (a browser tool like take_me_there, or a
 * server tool on the last allowed step), useChat sends the tool result back so
 * the model can answer. It counts steps on the assistant message, keeps
 * counting across those re-sends, and stops re-sending once the highest tool
 * step reaches CLIENT. The routes mirror that count (firstStepIndex) so a turn
 * that ends on a tool call with no re-send coming still gets a closing line.
 */

export const TROY_SERVER_MAX_STEPS = 4;
export const TROY_CLIENT_MAX_STEPS = 4;

/**
 * The browser's index for the first step of the response to this request.
 * Mirrors @ai-sdk/ui-utils processChatResponse: a re-send continues the last
 * assistant message at 1 + its highest tool step; a new user turn starts at 0.
 */
export function firstStepIndex(messages: ReadonlyArray<Record<string, unknown>>): number {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return 0;
  const invocations = Array.isArray(last.toolInvocations) ? last.toolInvocations : [];
  let max = 0;
  for (const invocation of invocations) {
    const step = (invocation as { step?: unknown } | null)?.step;
    if (typeof step === "number" && Number.isFinite(step)) max = Math.max(max, step);
  }
  return 1 + max;
}

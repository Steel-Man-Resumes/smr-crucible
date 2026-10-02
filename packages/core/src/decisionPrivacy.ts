/**
 * What a decision_log row may hold when no account is behind the call.
 *
 * The Forge promises: "Without an account, we keep none of your words." Many
 * routes write their explanation from what the visitor typed (a target job, a
 * company, a search location), and a summary can carry text too. So for a row
 * with no user id:
 * - explanation is a fixed line,
 * - output_summary keeps only numbers and true/false values (counts, lengths,
 *   flags) and drops every string, list and object,
 * - context_page is kept only if it looks like a page id, and session_id only
 *   if it looks like an id or timestamp (both arrive from the browser).
 * The model, provider, timing, token count and the input's one-way hash are
 * kept as they are. Signed-in rows are stored unchanged.
 *
 * Pure (no database import) so it can be tested on its own.
 */

export const ANONYMOUS_EXPLANATION = "No account: no note kept.";

const PAGE_ID = /^[a-z0-9][a-z0-9/_-]{0,63}$/i;
const SESSION_ID = /^[A-Za-z0-9:._-]{1,64}$/;

export interface DecisionTextFields {
  sessionId: string | null;
  contextPage: string;
  explanation: string;
  outputSummary: Record<string, unknown>;
}

export function decisionFieldsForStorage(params: {
  userId?: string | null;
  sessionId?: string | null;
  contextPage: string;
  explanation: string;
  outputSummary?: Record<string, unknown>;
}): DecisionTextFields {
  const summary = params.outputSummary ?? {};
  const sessionId = params.sessionId ?? null;
  if (params.userId) {
    return { sessionId, contextPage: params.contextPage, explanation: params.explanation, outputSummary: summary };
  }
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(summary)) {
    if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean") {
      kept[key] = value;
    }
  }
  return {
    sessionId: sessionId && SESSION_ID.test(sessionId) ? sessionId : null,
    contextPage: PAGE_ID.test(params.contextPage) ? params.contextPage : "unknown",
    explanation: ANONYMOUS_EXPLANATION,
    outputSummary: kept,
  };
}

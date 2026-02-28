/**
 * Decision logging for AI observability.
 * Every AI recommendation is logged with:
 * - explanation (required — the AI must explain itself)
 * - input hash (not raw input — privacy)
 * - model version
 * - context page
 *
 * Per WS5: "If we cannot explain why we recommended something,
 * we should not have recommended it."
 */

import { createHash } from "crypto";
import { insert, query } from "./db";

export interface DecisionLogEntry {
  id: string;
  user_id: string | null;
  session_id: string | null;
  ts: string;
  context_page: string;
  model_provider: string;
  model_id: string;
  input_hash: string;
  explanation: string;
  output_summary: Record<string, unknown>;
  token_count: number | null;
  latency_ms: number | null;
  user_action: "accepted" | "rejected" | "ignored" | "modified" | null;
}

/**
 * Hash input for privacy-preserving audit trail.
 * We log the hash, not the raw input.
 */
function hashInput(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Log an AI decision. Required after every AI recommendation.
 */
export async function logDecision(params: {
  userId?: string | null;
  sessionId?: string | null;
  contextPage: string;
  modelProvider: string;
  modelId: string;
  input: string;
  explanation: string;
  outputSummary?: Record<string, unknown>;
  tokenCount?: number | null;
  latencyMs?: number | null;
}): Promise<DecisionLogEntry> {
  return insert<DecisionLogEntry>("decision_log", {
    user_id: params.userId ?? null,
    session_id: params.sessionId ?? null,
    context_page: params.contextPage,
    model_provider: params.modelProvider,
    model_id: params.modelId,
    input_hash: hashInput(params.input),
    explanation: params.explanation,
    output_summary: params.outputSummary ?? {},
    token_count: params.tokenCount ?? null,
    latency_ms: params.latencyMs ?? null,
  });
}

/**
 * Record user's response to an AI recommendation.
 */
export async function recordUserAction(
  decisionId: string,
  action: "accepted" | "rejected" | "ignored" | "modified"
): Promise<void> {
  await query(
    `UPDATE decision_log SET user_action = $1 WHERE id = $2`,
    [action, decisionId]
  );
}

/**
 * Get decision history for a user (for transparency/audit display).
 */
export async function getUserDecisions(
  userId: string,
  limit: number = 50
): Promise<DecisionLogEntry[]> {
  return query<DecisionLogEntry>(
    `SELECT * FROM decision_log WHERE user_id = $1 ORDER BY ts DESC LIMIT $2`,
    [userId, limit]
  );
}

/**
 * Get decision history for an anonymous session.
 */
export async function getSessionDecisions(
  sessionId: string,
  limit: number = 50
): Promise<DecisionLogEntry[]> {
  return query<DecisionLogEntry>(
    `SELECT * FROM decision_log WHERE session_id = $1 ORDER BY ts DESC LIMIT $2`,
    [sessionId, limit]
  );
}

/**
 * Decision logging for AI observability.
 * Most AI steps are logged with (resume parsing, fact checks and what is said in
 * voice practice are not; a voice session's start is):
 * - explanation (required — the AI must explain itself)
 * - a keyed fingerprint of the input, never the input itself (hashDecisionInput)
 * - model version
 * - context page
 *
 * Per WS5: "If we cannot explain why we recommended something,
 * we should not have recommended it."
 */

import { createHmac } from "crypto";
import { insert, query } from "./db";
import { decisionFieldsForStorage } from "./decisionPrivacy";
import { serverHashSecret } from "./serverHashSecret";

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
 * Prefix on every keyed input fingerprint, so these rows are told apart from
 * older rows that hold the unkeyed 16-character hash.
 */
export const DECISION_INPUT_HASH_PREFIX = "h1:";

/**
 * The value stored in decision_log.input_hash. Never the input: an HMAC-SHA256
 * keyed with the server secret (the same one that keys the per-IP usage
 * counts), over a message marked for this use ("decision|<input>") so it
 * differs from any value the same secret makes for another use, cut to 32 hex
 * characters behind DECISION_INPUT_HASH_PREFIX.
 *
 * Why keyed: the old value was sha256(input) cut to 16 characters, and a short
 * input such as a bare job title could be found by hashing guesses until one
 * matched. Without the server secret a guess cannot be checked.
 *
 * No day salt: the same input gives the same fingerprint over time, so an
 * audit can still see that two steps ran on the same input. Nothing in the app
 * reads this value back; rows written before this change keep their old value.
 */
export function hashDecisionInput(
  input: string,
  secret: string = serverHashSecret("fingerprint AI decision inputs")
): string {
  const mac = createHmac("sha256", secret).update(`decision|${input}`).digest("hex");
  return DECISION_INPUT_HASH_PREFIX + mac.slice(0, 32);
}

/**
 * A short label safe to keep in the log: a fixed-vocabulary value such as an
 * interview type or intake topic passes through; anything else (free text a
 * person typed or a client sent) becomes "other".
 */
export function logLabel(value: unknown, fallback = "other"): string {
  return typeof value === "string" && /^[a-z0-9_-]{1,40}$/i.test(value) ? value : fallback;
}

/**
 * Log an AI decision. Most AI steps call this after they run (resume parsing
 * and fact checks do not yet; voice practice logs only the session start).
 *
 * userId is REQUIRED (null for an anonymous Forge visitor) so every call site
 * decides it: "delete my data" removes rows by user_id, and a row logged
 * without it would outlive the person's delete.
 *
 * explanation and outputSummary are stored as plain text. Never put words the
 * person typed in them (target job, company, location, role, record details):
 * counts, booleans, ids and fixed labels only. The input is stored only as a
 * keyed fingerprint (hashDecisionInput).
 * As a second guard, decisionFieldsForStorage strips anything a visitor could
 * have typed from rows with no user id (the Forge's "we keep none of your words").
 */
export async function logDecision(params: {
  userId: string | null;
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
  const stored = decisionFieldsForStorage(params);
  return insert<DecisionLogEntry>("decision_log", {
    user_id: params.userId ?? null,
    session_id: stored.sessionId,
    context_page: stored.contextPage,
    model_provider: params.modelProvider,
    model_id: params.modelId,
    input_hash: hashDecisionInput(params.input),
    explanation: stored.explanation,
    output_summary: stored.outputSummary,
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

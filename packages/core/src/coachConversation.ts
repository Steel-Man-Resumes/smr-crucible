/**
 * Coach conversation persistence (master plan Section 5).
 *
 * Stored in coach_conversation (migration 016). The last N messages are loaded
 * live; older turns are summarized into context_digest (regenerated when the
 * count exceeds the window -- digest generation is layered on later).
 *
 * Privacy: this content is NEVER exposed to partner dashboards.
 */

import { query } from "./db";

export type CoachRole = "user" | "assistant" | "system";

export interface CoachMessage {
  role: CoachRole;
  content: string;
}

/** Last `limit` messages for a user, in chronological order (oldest first). */
export async function loadCoachHistory(
  userId: string,
  limit = 50
): Promise<CoachMessage[]> {
  const rows = await query<{ role: string; content: string }>(
    `SELECT role, content
       FROM coach_conversation
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows
    .reverse()
    .map((r) => ({ role: r.role as CoachRole, content: r.content }));
}

export async function appendCoachMessage(
  userId: string,
  role: CoachRole,
  content: string
): Promise<void> {
  await query(
    `INSERT INTO coach_conversation (user_id, role, content) VALUES ($1, $2, $3)`,
    [userId, role, content]
  );
}

/** Count of stored coach messages for a user (used to decide when to digest). */
export async function countCoachMessages(userId: string): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM coach_conversation WHERE user_id = $1`,
    [userId]
  );
  return parseInt(rows[0]?.n ?? "0", 10);
}

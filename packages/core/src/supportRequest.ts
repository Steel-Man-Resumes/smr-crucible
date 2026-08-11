/**
 * Support requests -- the Phase 8 Help & Feedback store (db-backed helpers).
 *
 * This module EVOLVES the single support_request table (migration 025 + 040).
 * There is no parallel "help" or "feedback" table: every Help-center mode, the
 * t.ROY "file that for me" intake, and the old "Message Troy" box all write the
 * same row. The DB row is the source of truth; the notify email is best-effort
 * and carries no sensitive content.
 *
 * The PURE helpers (category validation, status display mapping, sensitive-topic
 * classifier, digest formatter) live in ./supportRequestShared so client
 * components can import them without pulling in the db driver. This module
 * re-exports all of that and adds the db reads/writes.
 */

import { query, getOne, insert } from "./db";
import {
  buildSupportDigestText,
  isValidSupportCategory,
  isValidSupportStatus,
  type SupportCategory,
  type SupportDigestRow,
  type SupportStatus,
} from "./supportRequestShared";

export * from "./supportRequestShared";

// ── DB row shape ─────────────────────────────────────────────────────────────

export interface SupportRequestRow {
  id: string;
  user_id: string | null;
  email: string | null;
  category: string | null;
  message: string;
  thread_excerpt: string | null;
  page: string | null;
  context: Record<string, unknown>;
  status: string;
  admin_reply: string | null;
  created_at: string;
  replied_at: string | null;
  seen_at: string | null;
  fixed_at: string | null;
}

export interface SupportContext {
  page?: string | null;
  tier?: string | null;
  decisionIds?: string[];
  filedByAssistant?: boolean;
  [key: string]: unknown;
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Create a support request. New rows default to status 'received'. context is
 * the OPT-IN, server-derived debug blob (empty object when the user opted out).
 */
export async function createSupportRequest(params: {
  userId: string | null;
  email: string | null;
  category: SupportCategory;
  message: string;
  page?: string | null;
  context?: SupportContext | null;
  threadExcerpt?: string | null;
}): Promise<SupportRequestRow> {
  return insert<SupportRequestRow>("support_request", {
    user_id: params.userId,
    email: params.email,
    category: params.category,
    message: params.message,
    thread_excerpt: params.threadExcerpt ?? null,
    page: params.page ?? null,
    context: JSON.stringify(params.context ?? {}),
    status: "received",
  });
}

/**
 * Reply to a request. Sets admin_reply + replied_at and moves status to
 * 'replied'. The reply surfaces in the user's Help center (listUserSupportRequests).
 */
export async function replyToSupportRequest(
  id: string,
  adminReply: string
): Promise<void> {
  await query(
    `UPDATE support_request
        SET admin_reply = $2, replied_at = now(), status = 'replied'
      WHERE id = $1`,
    [id, adminReply]
  );
}

/**
 * Transition a request's status. 'seen' stamps seen_at, 'fixed' stamps
 * fixed_at, 'replied' stamps replied_at -- only when not already set, so a
 * repeated transition does not overwrite the first timestamp.
 */
export async function setSupportStatus(
  id: string,
  status: SupportStatus
): Promise<void> {
  if (!isValidSupportStatus(status)) return;
  const stampCol =
    status === "seen"
      ? "seen_at"
      : status === "fixed"
        ? "fixed_at"
        : status === "replied"
          ? "replied_at"
          : null;
  if (stampCol) {
    await query(
      `UPDATE support_request
          SET status = $2, ${stampCol} = COALESCE(${stampCol}, now())
        WHERE id = $1`,
      [id, status]
    );
  } else {
    await query(`UPDATE support_request SET status = $2 WHERE id = $1`, [id, status]);
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** The user's own submissions, newest first, for the Help center history. */
export async function listUserSupportRequests(
  userId: string,
  limit = 50
): Promise<
  Array<{
    id: string;
    category: string | null;
    message: string;
    status: string;
    admin_reply: string | null;
    created_at: string;
    replied_at: string | null;
  }>
> {
  return query(
    `SELECT id, category, message, status, admin_reply, created_at, replied_at
       FROM support_request
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
}

/** How many times this user has filed feedback ("you have helped improve N times"). */
export async function countUserSupportRequests(userId: string): Promise<number> {
  const row = await getOne<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM support_request WHERE user_id = $1`,
    [userId]
  );
  return Number(row?.n ?? 0);
}

/** How many of the user's replies they have not seen yet (small unread badge). */
export async function countUserUnseenReplies(userId: string): Promise<number> {
  const row = await getOne<{ n: string }>(
    `SELECT COUNT(*)::int AS n
       FROM support_request
      WHERE user_id = $1 AND admin_reply IS NOT NULL AND status = 'replied'`,
    [userId]
  );
  return Number(row?.n ?? 0);
}

/** Admin inbox list, filtered, joined to the user's name. */
export async function adminListSupportRequests(opts: {
  status?: string;
  category?: string;
  limit?: number;
}): Promise<Array<SupportRequestRow & { user_name: string | null }>> {
  const conds: string[] = [];
  const args: unknown[] = [];
  if (opts.status && isValidSupportStatus(opts.status)) {
    args.push(opts.status);
    conds.push(`sr.status = $${args.length}`);
  }
  if (opts.category && isValidSupportCategory(opts.category)) {
    args.push(opts.category);
    conds.push(`sr.category = $${args.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  args.push(Math.min(Math.max(opts.limit ?? 100, 1), 500));
  return query(
    `SELECT sr.id, sr.user_id, sr.email, sr.category, sr.message, sr.thread_excerpt,
            sr.page, sr.context, sr.status, sr.admin_reply, sr.created_at,
            sr.replied_at, sr.seen_at, sr.fixed_at, u.name AS user_name
       FROM support_request sr
       LEFT JOIN users u ON u.id = sr.user_id
       ${where}
      ORDER BY sr.created_at DESC
      LIMIT $${args.length}`,
    args
  );
}

/** Read the rows and format the on-demand digest (admin command, no cron). */
export async function buildSupportDigest(): Promise<string> {
  const rows = await query<SupportDigestRow>(
    `SELECT status, category, created_at FROM support_request`
  );
  return buildSupportDigestText(rows);
}

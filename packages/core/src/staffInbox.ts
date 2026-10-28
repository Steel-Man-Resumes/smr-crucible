/**
 * The staff inbox (lane S4, migration 109): one person's mentions, replies,
 * tasks given to them, change requests and their answers, and notes to review.
 *
 * OWNER-ONLY. Every read and write names the actor as the recipient, and the
 * database policy says the same (staff_inbox_item_select / _update), plus the
 * restrictive reach rule: an item about a person disappears the moment the
 * recipient no longer reaches them. Items are written only by the 109
 * triggers; the app can mark them read or unread, nothing else.
 *
 * WHAT IT SAYS. Fixed words from the trigger, the actor's name, and the
 * person's name by consent (the activity log's rule). Never a body.
 */
import { runScoped } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { scopeOf, run, consentName } from "./orgWorkflowSql";
import { INBOX_FILTERS, UUID_PATTERN, inboxHref, inboxSentence, type InboxItemRow, type InboxKind } from "./teamTalkShared";

const canUse = (a: OrgActor) => !a.viaPlatformAdmin;

export interface InboxItem extends InboxItemRow {
  sentence: string;
  href: string;
}

export interface InboxPage { items: InboxItem[]; unread: number; next: string | null }

/** $1 org, $2 me, $3 kinds, $4 unread only, $5 before (created_at), $6 limit. Exported for the database test. */
export const LIST_INBOX_SQL = `SELECT i.id, i.kind, i.ref_table, i.ref_id, i.summary, i.created_at, i.read_at,
    i.actor_user_id, au.name AS actor_name, i.participant_user_id,
    CASE WHEN i.participant_user_id IS NULL THEN NULL ELSE ${consentName("i.participant_user_id")} END AS participant_name
  FROM staff_inbox_item i LEFT JOIN users au ON au.id = i.actor_user_id
 WHERE i.access_code_id = $1::uuid AND i.recipient_user_id = $2::uuid
   AND i.kind = ANY ($3::text[])
   AND (NOT $4::boolean OR i.read_at IS NULL)
   AND ($5::timestamptz IS NULL OR i.created_at < $5::timestamptz)
 ORDER BY i.created_at DESC, i.id DESC
 LIMIT $6::int`;

export const UNREAD_COUNT_SQL = `SELECT count(*)::int AS n FROM staff_inbox_item i
 WHERE i.access_code_id = $1::uuid AND i.recipient_user_id = $2::uuid AND i.read_at IS NULL`;

export function inboxFilterKinds(key: string | null | undefined): InboxKind[] {
  return (INBOX_FILTERS.find((f) => f.key === key) ?? INBOX_FILTERS[0]).kinds;
}

export async function listInbox(actor: OrgActor, opts: { filter?: string | null; unreadOnly?: boolean; before?: string | null; limit?: number } = {}): Promise<InboxPage | null> {
  if (!canUse(actor)) return null;
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 50)));
  const before = opts.before && !Number.isNaN(Date.parse(opts.before)) && /^\d{4}-\d{2}-\d{2}T/.test(opts.before) ? opts.before : null;
  const [rows, count] = await runScoped<[InboxItemRow[], { n: number }[]]>(scopeOf(actor), (sql) => [
    run(sql)(LIST_INBOX_SQL, [actor.orgId, actor.userId, inboxFilterKinds(opts.filter), !!opts.unreadOnly, before, limit + 1]),
    run(sql)(UNREAD_COUNT_SQL, [actor.orgId, actor.userId]),
  ]);
  const items = rows.slice(0, limit).map((r) => ({ ...r, sentence: inboxSentence(r), href: inboxHref(r) }));
  const last = rows.length > limit ? rows[limit - 1] : null;
  return { items, unread: count[0]?.n ?? 0, next: last ? new Date(last.created_at).toISOString() : null };
}

/** The number on the nav. Zero (never an error) when 109 is not applied yet. */
export async function inboxUnreadCount(actor: OrgActor): Promise<number> {
  if (!canUse(actor)) return 0;
  try {
    const [rows] = await runScoped<[{ n: number }[]]>(scopeOf(actor), (sql) => [run(sql)(UNREAD_COUNT_SQL, [actor.orgId, actor.userId])]);
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** $1 org, $2 me, $3 all, $4 read (else unread), $5 ids. Exported for the database test. */
export const MARK_INBOX_SQL = `UPDATE staff_inbox_item i SET read_at = CASE WHEN $4::boolean THEN now() ELSE NULL END
  WHERE i.access_code_id = $1::uuid AND i.recipient_user_id = $2::uuid
    AND ($3::boolean OR i.id = ANY ($5::uuid[]))
    AND (CASE WHEN $4::boolean THEN i.read_at IS NULL ELSE i.read_at IS NOT NULL END)
    -- Marking unread: never when a newer unread item for the same thing exists
    -- (staff_inbox_item_once allows one unread per recipient, kind and source).
    AND ($4::boolean OR NOT EXISTS (
          SELECT 1 FROM staff_inbox_item n
           WHERE n.recipient_user_id = i.recipient_user_id AND n.kind = i.kind AND n.ref_id = i.ref_id
             AND n.read_at IS NULL AND n.id <> i.id))
  RETURNING i.id`;

/** Mark some (ids) or all of my items read, or some unread. Returns how many changed. Real failures throw. */
export async function markInbox(actor: OrgActor, input: { ids?: unknown; all?: boolean; read: boolean }): Promise<number | null> {
  if (!canUse(actor)) return null;
  const ids = Array.isArray(input.ids) ? input.ids.filter((v): v is string => typeof v === "string" && UUID_PATTERN.test(v)).slice(0, 200) : [];
  if (!input.all && ids.length === 0) return 0;
  if (input.all && !input.read) return 0;
  const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      MARK_INBOX_SQL,
      [actor.orgId, actor.userId, !!input.all, input.read, ids]
    ),
  ]);
  return rows.length;
}

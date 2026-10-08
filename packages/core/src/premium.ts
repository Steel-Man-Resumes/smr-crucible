/**
 * Premium tools by entitlement, never by payment (migration 078).
 *
 * Troy's rule: individuals never pay. Three tools are premium: local
 * resources, interview coaching and one-click apply. One opens for a person
 * when:
 *   - they are a platform admin (they run the place), or
 *   - they belong to a sponsoring organization: an active, unexpired access
 *     code they redeemed (the existing org model), or
 *   - Troy granted it from the admin side (premium_grant: a reason, an
 *     optional end date, revocable).
 *
 * THE ALLOWLIST IS THE LOAD-BEARING PROPERTY, as in authz/capabilities.ts. A
 * tool name that is not in PREMIUM_TOOLS does not exist. What is read from the
 * database is filtered against it, so a stale or tampered row can never open
 * something the code does not define.
 *
 * Nothing here knows a price, and nothing here sends email.
 */

import { getOne, runAsUser, queryAsUser } from "./db";
import { isPlatformAdmin } from "./userTier";

export const PREMIUM_TOOLS = ["resources", "interview_coaching", "one_click_apply"] as const;
export type PremiumTool = (typeof PREMIUM_TOOLS)[number];

const TOOL_SET: ReadonlySet<string> = new Set(PREMIUM_TOOLS);
export function isPremiumTool(v: unknown): v is PremiumTool {
  return typeof v === "string" && TOOL_SET.has(v);
}

/** How a tool came to be open, in the order checked. */
export type PremiumSource = "admin" | "organization" | "grant";

export interface PremiumGrantRow {
  tools: unknown;
  ends_at: string | Date | null;
  revoked_at?: string | Date | null;
}

export interface PremiumAccess {
  /** The tools open to this person, in PREMIUM_TOOLS order. */
  open: PremiumTool[];
  /** Why each open tool is open. */
  via: Partial<Record<PremiumTool, PremiumSource>>;
  orgMember: boolean;
  /** The latest end date among live grants that set one (ISO), or null. */
  grantEndsAt: string | null;
  /** The person's open "Ask SMR for access" request, if any. */
  openRequest: { tool: PremiumTool; createdAt: string } | null;
}

function toTime(v: string | Date | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/** A grant that counts right now: not revoked, not past its end date. */
export function grantIsLive(g: PremiumGrantRow, now: number = Date.now()): boolean {
  if (toTime(g.revoked_at ?? null) !== null) return false;
  const ends = toTime(g.ends_at);
  return ends === null || ends > now;
}

/** The tools a grant names, filtered against the allowlist (never trusted as stored). */
export function grantTools(g: PremiumGrantRow): PremiumTool[] {
  const list = Array.isArray(g.tools) ? g.tools : [];
  return PREMIUM_TOOLS.filter((t) => list.includes(t));
}

/** Pure: who gets what, from the facts. Tested without a database. */
export function resolvePremiumAccess(input: {
  isAdmin: boolean;
  orgMember: boolean;
  grants: PremiumGrantRow[];
  openRequest?: { tool: unknown; created_at: string | Date } | null;
  now?: number;
}): PremiumAccess {
  const now = input.now ?? Date.now();
  const via: Partial<Record<PremiumTool, PremiumSource>> = {};
  let grantEndsAt: number | null = null;
  for (const t of PREMIUM_TOOLS) {
    if (input.isAdmin) via[t] = "admin";
    else if (input.orgMember) via[t] = "organization";
  }
  for (const g of input.grants) {
    if (!grantIsLive(g, now)) continue;
    const ends = toTime(g.ends_at);
    if (ends !== null && (grantEndsAt === null || ends > grantEndsAt)) grantEndsAt = ends;
    for (const t of grantTools(g)) if (!via[t]) via[t] = "grant";
  }
  const req = input.openRequest;
  const reqTime = req ? toTime(req.created_at) : null;
  return {
    open: PREMIUM_TOOLS.filter((t) => !!via[t]),
    via,
    orgMember: input.orgMember,
    grantEndsAt: grantEndsAt === null ? null : new Date(grantEndsAt).toISOString(),
    openRequest:
      req && isPremiumTool(req.tool) && reqTime !== null
        ? { tool: req.tool, createdAt: new Date(reqTime).toISOString() }
        : null,
  };
}

/** Postgres "relation does not exist": 078 is not applied on this database yet. */
export function isMissingTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "42P01";
}

const ORG_MEMBER_SQL = `SELECT EXISTS (
     SELECT 1 FROM access_code_redemption acr
       JOIN access_code ac ON ac.id = acr.access_code_id
      WHERE acr.user_id = $1
        AND ac.is_active = true
        AND (ac.expires_at IS NULL OR ac.expires_at > now())
   ) AS member`;

const LIVE_GRANTS_SQL = `SELECT tools, ends_at, revoked_at FROM premium_grant
   WHERE user_id = $1 AND revoked_at IS NULL AND (ends_at IS NULL OR ends_at > now())`;

const OPEN_REQUEST_SQL = `SELECT tool, created_at FROM premium_access_request
   WHERE user_id = $1 AND status = 'open' LIMIT 1`;

/**
 * This person's premium access, read AS the person (their own rows only).
 * Throws { premiumNotReady: true } when 078 is not applied yet, so the caller
 * can decide; any other database error propagates.
 */
export async function getPremiumAccess(userId: string): Promise<PremiumAccess> {
  const isAdmin = await isPlatformAdmin(userId);
  let rows: unknown[][];
  try {
    rows = await runAsUser<unknown[][]>(userId, (c) => {
      const run = c as unknown as (s: string, p?: unknown[]) => unknown;
      return [run(ORG_MEMBER_SQL, [userId]), run(LIVE_GRANTS_SQL, [userId]), run(OPEN_REQUEST_SQL, [userId])];
    });
  } catch (e) {
    if (isMissingTable(e)) throw Object.assign(new Error("premium tables missing"), { premiumNotReady: true });
    throw e;
  }
  const member = (rows[0] as Array<{ member: boolean }>)[0]?.member === true;
  return resolvePremiumAccess({
    isAdmin,
    orgMember: member,
    grants: (rows[1] ?? []) as PremiumGrantRow[],
    openRequest: ((rows[2] ?? []) as Array<{ tool: unknown; created_at: string }>)[0] ?? null,
  });
}

// ---- "Ask SMR for access" -----------------------------------------------------

export const PREMIUM_NOTE_MAX = 500;

/**
 * File the person's request, written AS the person (the policy admits only
 * their own open row). One open request per person: asking again returns the
 * one already open. No email is sent; Troy sees it in admin.
 */
export async function requestPremiumAccess(
  userId: string,
  tool: PremiumTool,
  note: string | null
): Promise<{ created: boolean }> {
  if (!isPremiumTool(tool)) throw new Error("unknown premium tool");
  const clean = note ? note.replace(/\s+/g, " ").trim().slice(0, PREMIUM_NOTE_MAX) : null;
  const rows = await queryAsUser<{ id: string }>(
    userId,
    `INSERT INTO premium_access_request (user_id, tool, note)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) WHERE status = 'open' DO NOTHING
     RETURNING id`,
    [userId, tool, clean || null]
  );
  return { created: rows.length > 0 };
}

// ---- admin ---------------------------------------------------------------------
// Every admin call runs AS the admin: the 078 policies admit platform admins
// only, and name them on the row (granted_by, revoked_by, handled_by).

export interface AdminPremiumRequest {
  id: string;
  user_id: string;
  email: string | null;
  name: string | null;
  tool: PremiumTool;
  note: string | null;
  created_at: string;
}

export interface AdminPremiumGrant {
  id: string;
  user_id: string;
  email: string | null;
  name: string | null;
  tools: PremiumTool[];
  reason: string;
  ends_at: string | null;
  granted_at: string;
}

export async function adminListPremium(adminId: string): Promise<{
  requests: AdminPremiumRequest[];
  grants: AdminPremiumGrant[];
}> {
  const [requests, grants] = await runAsUser<unknown[][]>(adminId, (c) => {
    const run = c as unknown as (s: string, p?: unknown[]) => unknown;
    return [
      run(
        `SELECT r.id, r.user_id, u.email, u.name, r.tool, r.note, r.created_at
           FROM premium_access_request r LEFT JOIN users u ON u.id = r.user_id
          WHERE r.status = 'open' ORDER BY r.created_at ASC LIMIT 200`
      ),
      run(
        `SELECT g.id, g.user_id, u.email, u.name, g.tools, g.reason, g.ends_at, g.granted_at
           FROM premium_grant g LEFT JOIN users u ON u.id = g.user_id
          WHERE g.revoked_at IS NULL AND (g.ends_at IS NULL OR g.ends_at > now())
          ORDER BY g.granted_at DESC LIMIT 200`
      ),
    ];
  });
  return {
    requests: ((requests ?? []) as AdminPremiumRequest[]).filter((r) => isPremiumTool(r.tool)),
    grants: ((grants ?? []) as Array<AdminPremiumGrant & { tools: unknown }>).map((g) => ({
      ...g,
      tools: grantTools(g as PremiumGrantRow),
    })),
  };
}

export interface GrantInput {
  userId: string;
  tools: PremiumTool[];
  reason: string;
  endsAt: string | null;
  requestId: string | null;
}

/** Validate an admin's grant form. Returns the clean input or a plain reason. */
export function checkGrantInput(raw: {
  userId?: unknown;
  tools?: unknown;
  reason?: unknown;
  endsAt?: unknown;
  requestId?: unknown;
}, now: number = Date.now()): { ok: true; value: GrantInput } | { ok: false; error: string } {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof raw.userId !== "string" || !uuid.test(raw.userId)) return { ok: false, error: "Pick a person." };
  const tools = Array.isArray(raw.tools) ? PREMIUM_TOOLS.filter((t) => (raw.tools as unknown[]).includes(t)) : [];
  if (tools.length === 0) return { ok: false, error: "Pick at least one tool." };
  const reason = typeof raw.reason === "string" ? raw.reason.replace(/\s+/g, " ").trim() : "";
  if (reason.length < 3 || reason.length > 500) return { ok: false, error: "Write a reason (3 to 500 characters)." };
  let endsAt: string | null = null;
  if (raw.endsAt !== undefined && raw.endsAt !== null && raw.endsAt !== "") {
    const t = typeof raw.endsAt === "string" ? Date.parse(raw.endsAt) : NaN;
    if (!Number.isFinite(t)) return { ok: false, error: "That end date is not a date." };
    if (t <= now) return { ok: false, error: "The end date has to be in the future." };
    endsAt = new Date(t).toISOString();
  }
  const requestId = typeof raw.requestId === "string" && uuid.test(raw.requestId) ? raw.requestId : null;
  return { ok: true, value: { userId: raw.userId, tools, reason, endsAt, requestId } };
}

/** Grant, and close the request it answers, in one transaction, as the admin. */
export async function adminGrantPremium(adminId: string, g: GrantInput): Promise<{ id: string }> {
  const out = await runAsUser<unknown[][]>(adminId, (c) => {
    const run = c as unknown as (s: string, p?: unknown[]) => unknown;
    const list: unknown[] = [
      run(
        `INSERT INTO premium_grant (user_id, tools, reason, ends_at, granted_by, request_id)
         VALUES ($1, $2::text[], $3, $4, $5, $6) RETURNING id`,
        [g.userId, g.tools, g.reason, g.endsAt, adminId, g.requestId]
      ),
    ];
    if (g.requestId) {
      list.push(
        run(
          `UPDATE premium_access_request SET status = 'granted', handled_at = now(), handled_by = $2
            WHERE id = $1 AND user_id = $3 AND status = 'open'`,
          [g.requestId, adminId, g.userId]
        )
      );
    }
    return list;
  });
  const row = ((out[0] ?? []) as Array<{ id: string }>)[0];
  if (!row) throw new Error("grant not written");
  return row;
}

export async function adminRevokeGrant(adminId: string, grantId: string): Promise<boolean> {
  const rows = await queryAsUser<{ id: string }>(
    adminId,
    `UPDATE premium_grant SET revoked_at = now(), revoked_by = $2
      WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
    [grantId, adminId]
  );
  return rows.length > 0;
}

export async function adminDeclineRequest(adminId: string, requestId: string): Promise<boolean> {
  const rows = await queryAsUser<{ id: string }>(
    adminId,
    `UPDATE premium_access_request SET status = 'declined', handled_at = now(), handled_by = $2
      WHERE id = $1 AND status = 'open' RETURNING id`,
    [requestId, adminId]
  );
  return rows.length > 0;
}

/** Find a person by email for the grant form (admin only; the caller checks). */
export async function adminFindUserByEmail(email: string): Promise<{ id: string; email: string; name: string | null } | null> {
  const e = email.trim().toLowerCase();
  if (!e || e.length > 320) return null;
  return getOne<{ id: string; email: string; name: string | null }>(
    `SELECT id, email, name FROM users WHERE lower(email) = $1 LIMIT 1`,
    [e]
  );
}

/** The person's own premium rows, for "Export my data". */
export async function exportPremiumRows(userId: string): Promise<{ grants: unknown[]; requests: unknown[] }> {
  try {
    const [grants, requests] = await Promise.all([
      queryAsUser(userId, `SELECT tools, reason, ends_at, granted_at, revoked_at FROM premium_grant WHERE user_id = $1 ORDER BY granted_at DESC`, [userId]),
      queryAsUser(userId, `SELECT tool, note, status, created_at, handled_at FROM premium_access_request WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    ]);
    return { grants, requests };
  } catch (e) {
    if (isMissingTable(e)) return { grants: [], requests: [] };
    throw e;
  }
}

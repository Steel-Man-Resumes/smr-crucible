/**
 * The premium server gate (server only). Kept apart from lib/premium.ts,
 * which client components import: a client bundle must never reach
 * @crucible/core (it pulls in node:crypto and the database driver).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  isSponsoredTool,
  premiumGateOn,
  premiumLockedMessage,
  premiumUnavailableMessage,
  textPracticeAllowanceMessage,
  TEXT_PRACTICE_SESSIONS_PER_DAY,
  type PremiumToolId,
} from "./premium";

type AccessReader = (userId: string) => Promise<{ open: readonly string[] }>;

let warnedNotReady = false;
function warnNotReady() {
  if (warnedNotReady) return;
  warnedNotReady = true;
  console.warn("[premium] PREMIUM_GATE is on but migration 079 is not applied; sponsored tools are shut until it is.");
}

function isNotReady(e: unknown): boolean {
  return !!(e as { premiumNotReady?: boolean } | null)?.premiumNotReady;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Server gate for a premium route. Returns null when the tool is open, or the
 * response to send:
 *   - a tool that is free with an account (lib/premium.ts, the split): open;
 *   - gate off (the default): open, nothing read;
 *   - gate on, entitlement found: open;
 *   - gate on, no entitlement: 403 "premium_locked" (how to get it, no price);
 *   - gate on, entitlement storage missing (079 not applied): 503
 *     "premium_unavailable". FAILS CLOSED (Codex review A8): a switch that
 *     was deliberately turned on never turns into free access because a
 *     table is missing.
 * Any other database error propagates to the route's own handling.
 */
export async function checkPremium(
  userId: string,
  tool: PremiumToolId,
  read?: AccessReader,
  gateRaw?: string | null
): Promise<Response | null> {
  if (!isSponsoredTool(tool)) return null;
  if (!premiumGateOn(gateRaw === undefined ? undefined : gateRaw)) return null;
  const reader = read ?? (await import("@crucible/core")).getPremiumAccess;
  try {
    const access = await reader(userId);
    if (access.open.includes(tool)) return null;
  } catch (e) {
    if (isNotReady(e)) {
      warnNotReady();
      return json({ error: premiumUnavailableMessage(tool), code: "premium_unavailable", tool }, 503);
    }
    throw e;
  }
  return json({ error: premiumLockedMessage(tool), code: "premium_locked", tool }, 403);
}

/** The usage rows behind the text practice allowance (left out of displayed AI usage, core NON_AI_USAGE_ENDPOINTS). */
export const TEXT_PRACTICE_ENDPOINT = "interview-text-session";
export const TEXT_PRACTICE_TURN_ENDPOINT = "interview-text-turn";

/**
 * Turns one practice interview can take: five answers, the wrap-up, and room
 * to spare. With the daily session allowance this sets a daily turn ceiling
 * for an unsponsored person, so reusing one session id all day gains nothing.
 */
export const TEXT_PRACTICE_TURNS_PER_SESSION = 8;

/*
 * A SERVER-ISSUED PRACTICE SESSION ID (Phase 5 review L1). The first call of
 * a practice interview gets a signed id back: the account, the day (UTC) and
 * a random part, sealed with an HMAC of AUTH_SECRET. Later turns send it
 * back. Any call without a valid id for this account and this day counts as a
 * new session, whatever its message history says and whether or not it is
 * the wrap-up ("endInterview"). The id holds no words and is not stored.
 */
function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function hmac(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signPracticeSession(userId: string, now: number, secret: string, nonce?: string): string {
  const n = nonce ?? randomBytes(12).toString("base64url");
  const day = utcDay(now);
  return `${day}.${n}.${hmac(secret, `practice|${userId}|${day}|${n}`)}`;
}

export function verifyPracticeSession(token: unknown, userId: string, now: number, secret: string): boolean {
  if (typeof token !== "string" || token.length > 200) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [day, n, mac] = parts;
  if (day !== utcDay(now) || !/^[A-Za-z0-9_-]{8,40}$/.test(n)) return false;
  const want = hmac(secret, `practice|${userId}|${day}|${n}`);
  if (want.length !== mac.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(mac));
}

/** The body field the page sends the id back in. */
export function practiceSessionFrom(body: unknown): unknown {
  return body && typeof body === "object" ? (body as { practiceSession?: unknown }).practiceSession : undefined;
}

export interface TextPracticeVerdict {
  /** The 429 to send, or null to go ahead. */
  refuse: Response | null;
  /** A new session id to hand back with the reply (only when a session was counted). */
  session?: string;
}

/**
 * The daily text practice allowance (the split: some interview practice is
 * free with an account). Applies only while the gate is on, and only to a
 * person without sponsored interview coaching.
 *   - no valid session id: a new session is counted (and a new id issued);
 *   - every turn also counts toward the daily turn ceiling.
 *
 * Entitlement storage missing: the person is treated as unsponsored, so the
 * free allowance still works and nothing extra opens (A8).
 */
export async function checkTextPracticeAllowance(
  userId: string,
  body: unknown,
  deps: {
    gateRaw?: string | null;
    read?: AccessReader;
    increment?: (userId: string, endpoint: string) => Promise<number>;
    limit?: number;
    secret?: string | null;
    now?: number;
  } = {}
): Promise<TextPracticeVerdict> {
  if (!premiumGateOn(deps.gateRaw === undefined ? undefined : deps.gateRaw)) return { refuse: null };
  const core = deps.read && deps.increment ? null : await import("@crucible/core");
  const read = deps.read ?? core!.getPremiumAccess;
  const increment = deps.increment ?? core!.incrementUserUsage;
  let sponsored = false;
  try {
    sponsored = (await read(userId)).open.includes("interview_coaching");
  } catch (e) {
    if (isNotReady(e)) warnNotReady();
    else console.error("[premium] access read failed for the practice allowance:", (e as { code?: string })?.code || "error");
    sponsored = false;
  }
  if (sponsored) return { refuse: null };

  const limit = deps.limit ?? TEXT_PRACTICE_SESSIONS_PER_DAY;
  const now = deps.now ?? Date.now();
  const secret = deps.secret === undefined ? process.env.AUTH_SECRET ?? null : deps.secret;
  const used = () => json({ error: textPracticeAllowanceMessage(limit), code: "practice_allowance_used", limit }, 429);

  // Without a secret no id can be checked: every call counts as a session.
  const continuing = !!secret && verifyPracticeSession(practiceSessionFrom(body), userId, now, secret);
  let session: string | undefined;
  if (!continuing) {
    const count = await increment(userId, TEXT_PRACTICE_ENDPOINT);
    if (count > limit) return { refuse: used() };
    if (secret) session = signPracticeSession(userId, now, secret);
  }
  const turns = await increment(userId, TEXT_PRACTICE_TURN_ENDPOINT);
  if (turns > limit * TEXT_PRACTICE_TURNS_PER_SESSION) return { refuse: used() };
  return { refuse: null, session };
}

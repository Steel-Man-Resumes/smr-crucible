/**
 * The premium server gate (server only). Kept apart from lib/premium.ts,
 * which client components import: a client bundle must never reach
 * @crucible/core (it pulls in node:crypto and the database driver).
 */

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

/** The usage row that counts text practice sessions (one per practice interview). */
export const TEXT_PRACTICE_ENDPOINT = "interview-text-session";

/**
 * Is this call to /api/interview-practice the start of a new practice
 * interview? The page builds the interviewer's opening line itself, so the
 * first call is the one carrying the person's first answer. Anything that
 * cannot be read counts as a start (the safe side for an allowance). This is
 * a usage allowance, not a security boundary: the ordinary per-day AI limit
 * on the route caps every call either way.
 */
export function isTextPracticeStart(body: unknown): boolean {
  const b = body as { messages?: unknown; endInterview?: unknown } | null;
  if (!b || typeof b !== "object") return true;
  if (b.endInterview === true) return false;
  if (!Array.isArray(b.messages)) return true;
  const answers = b.messages.filter(
    (m) => !!m && typeof m === "object" && (m as { role?: unknown }).role === "user"
  ).length;
  return answers <= 1;
}

/**
 * The daily text practice allowance (the split: some interview practice is
 * free with an account). Applies only while the gate is on, only to a person
 * without sponsored interview coaching, and only counts the start of a
 * session. Returns null to go ahead, or the 429 to send.
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
  } = {}
): Promise<Response | null> {
  if (!premiumGateOn(deps.gateRaw === undefined ? undefined : deps.gateRaw)) return null;
  if (!isTextPracticeStart(body)) return null;
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
  if (sponsored) return null;
  const limit = deps.limit ?? TEXT_PRACTICE_SESSIONS_PER_DAY;
  const count = await increment(userId, TEXT_PRACTICE_ENDPOINT);
  if (count <= limit) return null;
  return json({ error: textPracticeAllowanceMessage(limit), code: "practice_allowance_used", limit }, 429);
}

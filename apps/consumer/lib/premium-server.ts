/**
 * The premium server gate (server only). Kept apart from lib/premium.ts,
 * which client components import: a client bundle must never reach
 * @crucible/core (it pulls in node:crypto and the database driver).
 */

import { premiumGateOn, premiumLockedMessage, type PremiumToolId } from "./premium";

let warnedNotReady = false;

/**
 * Server gate for a premium route. Returns null when the tool is open, or the
 * 403 response to send. Migration 079 not applied yet: open (the tools
 * worked that way before), with one warning per process. Any other database
 * error propagates to the route's own handling.
 */
export async function checkPremium(
  userId: string,
  tool: PremiumToolId,
  read?: (userId: string) => Promise<{ open: readonly string[] }>,
  gateRaw?: string | null
): Promise<Response | null> {
  if (!premiumGateOn(gateRaw === undefined ? undefined : gateRaw)) return null;
  const reader = read ?? (await import("@crucible/core")).getPremiumAccess;
  try {
    const access = await reader(userId);
    if (access.open.includes(tool)) return null;
  } catch (e) {
    if ((e as { premiumNotReady?: boolean } | null)?.premiumNotReady) {
      if (!warnedNotReady) {
        warnedNotReady = true;
        console.warn("[premium] migration 079 is not applied; premium tools are open until it is.");
      }
      return null;
    }
    throw e;
  }
  return new Response(
    JSON.stringify({ error: premiumLockedMessage(tool), code: "premium_locked", tool }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}

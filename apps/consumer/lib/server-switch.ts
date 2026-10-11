/**
 * Server switches read at run time (not NEXT_PUBLIC_, so a change takes
 * effect on the next request after the owner changes the setting, and the
 * browser never decides).
 *
 * Only "on" (any case, spaces around) is on. Unset, "off" or anything else is
 * off, and an unreadable value also fails the release check
 * (lib/release-check.mjs), so a typo is loud at build time and safe at run time.
 */

export function serverSwitchOn(raw: string | undefined | null): boolean {
  return (raw ?? "").trim().toLowerCase() === "on";
}

/**
 * THE RECORD CHECK (D11) STAYS OFF UNTIL ITS PUBLIC COPY SHIPS (Codex review
 * A10; Troy 2026-10-10). Off by default. While off, every route of that step
 * answers 404, its screen is a 404, the entry card on the disclosure planner
 * is hidden, and t.ROY does not point anyone to it. Turn it on only on the day
 * the privacy page, partner FAQ, site and funder answers ship with the same
 * wording (docs/SHIP-DAY-GATES.md).
 */
export const RECORD_CHECK_ENABLED_ENV = "RECORD_CHECK_ENABLED";

export function recordStepOn(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): boolean {
  return serverSwitchOn(env[RECORD_CHECK_ENABLED_ENV]);
}

/** The answer every route of a switched-off step gives: the same as a route that does not exist. */
export function switchedOffResponse(): Response {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

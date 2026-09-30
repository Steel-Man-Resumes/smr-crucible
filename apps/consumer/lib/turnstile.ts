/**
 * Server-side Cloudflare Turnstile check, same rollout rules as signup
 * (app/api/auth/register):
 *
 * - TURNSTILE_SECRET_KEY unset -> "off": no check (dark build).
 * - Token missing -> "missing". Callers block it only when TURNSTILE_ENFORCE=1,
 *   so a silently broken widget never kills a real person's request.
 * - siteverify says no -> "failed" (always block).
 * - siteverify unreachable -> "unreachable" (allow: a shield, not a gate).
 */

export type TurnstileOutcome = "off" | "ok" | "missing" | "failed" | "unreachable";

export async function checkTurnstile(token: unknown, remoteIp?: string): Promise<TurnstileOutcome> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return "off";
  if (typeof token !== "string" || !token) return "missing";
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        ...(remoteIp && remoteIp !== "unknown" ? { remoteip: remoteIp } : {}),
      }),
    });
    const outcome = (await res.json()) as { success?: boolean };
    return outcome.success ? "ok" : "failed";
  } catch {
    return "unreachable";
  }
}

/** True when the outcome should stop the request. */
export function turnstileBlocks(outcome: TurnstileOutcome): boolean {
  if (outcome === "failed") return true;
  if (outcome === "missing") return process.env.TURNSTILE_ENFORCE === "1";
  return false;
}

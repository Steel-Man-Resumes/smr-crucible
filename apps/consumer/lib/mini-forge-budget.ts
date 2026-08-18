/**
 * Mini Forge spend ceiling.
 *
 * The kiosk/tablet path is unauthenticated by design (justice-impacted users on
 * facility tablets have no account yet), so per-user limits cannot apply and an
 * in-memory limiter is useless across Vercel serverless instances / cold starts.
 * This is the hard spend control: a DB-backed rolling-24h cap on real Mini Forge
 * AI calls. It counts actual ai_token_usage rows (endpoint = 'mini-forge'), so it
 * survives cold starts and reflects true spend, not per-instance memory.
 *
 * Sizing: the default clears a busy facility day comfortably while capping a
 * runaway loop or bot flood. Tune with MINI_FORGE_DAILY_CAP.
 *
 * Precision note: recordTokenUsage writes its row AFTER the call returns, so a
 * burst of concurrent calls can momentarily overshoot the cap by roughly the
 * in-flight count before their rows land. This bounds TOTAL spend (the point);
 * it is not an exact per-call gate. Session creation is separately per-IP
 * throttled (auth-rate-limit) so a single source cannot generate that burst.
 */

import { query } from "@crucible/core";

/** Thrown when the rolling-24h Mini Forge AI-call cap is reached. Callers render
 *  an honest "at capacity" state rather than looping the wait screen or spending. */
export class MiniForgeCapacityError extends Error {
  constructor() {
    super("MINI_FORGE_AT_CAPACITY");
    this.name = "MiniForgeCapacityError";
  }
}

const DEFAULT_DAILY_CAP = 300;

export function miniForgeDailyCap(): number {
  const raw = Number(process.env.MINI_FORGE_DAILY_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_CAP;
}

/**
 * Throws MiniForgeCapacityError when the rolling-24h cap is reached. A DB blip
 * on the COUNT must not hard-block the kiosk for real users, so a query failure
 * is logged and allowed through -- the cap is a spend backstop, not an auth gate.
 */
export async function assertMiniForgeBudget(): Promise<void> {
  const cap = miniForgeDailyCap();
  let used = 0;
  try {
    const rows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ai_token_usage
        WHERE endpoint = 'mini-forge'
          AND created_at > NOW() - INTERVAL '24 hours'`
    );
    used = Number(rows[0]?.n ?? 0);
  } catch (err) {
    console.error("[mini-forge-budget] cap check failed; allowing this call:", err);
    return;
  }
  if (used >= cap) throw new MiniForgeCapacityError();
}

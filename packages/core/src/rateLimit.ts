/**
 * Rate limiting for consumer AI endpoints.
 * Per-user (Refinery) and per-IP (Forge) daily counters.
 * Stored in ai_usage table with atomic upsert.
 */

import { createHmac } from "crypto";
import { query, getOne, getOneAsUser } from "./db";
import { HEADSHOT_GENERATE_ENDPOINT, HEADSHOT_DAILY_CAP } from "./avatarAssetShared";
import { serverHashSecret } from "./serverHashSecret";

export const DEFAULT_DAILY_LIMIT = 30;

/**
 * Per-endpoint HARD daily ceilings for authenticated users. Unlike the tier
 * daily limit (getUserDailyLimit), a hard cap here applies to EVERY user
 * regardless of tier -- including admin/unlimited -- because the endpoint is
 * an expensive paid operation that must never be spammed. An endpoint absent
 * from this map is governed solely by the tier limit (existing behavior).
 *
 * headshot_generate: AI headshot generation is a real paid image call, capped
 * at a few per day even for unlimited-tier accounts.
 */
export const USER_ENDPOINT_HARD_CAPS: Record<string, number> = {
  [HEADSHOT_GENERATE_ENDPOINT]: HEADSHOT_DAILY_CAP,
};

export const FORGE_IP_LIMITS: Record<string, number> = {
  analyze: 5,
  parse: 10,
  assistant: 20,
  "rush-resume": 5,
  "generate-docs": 5,
  // The bullet workshop is the most call-intensive pre-auth surface: a
  // suggest_tools per modal open + a write_bullet per generation, so a single
  // user building one resume easily makes 20-40 calls. It needs a far higher
  // per-IP/day ceiling than the one-shot endpoints. NOTE: this is per-IP, so
  // shared IPs (reentry-program labs, libraries) share it -- raise it further
  // for those contexts if users report being cut off.
  "forge-resume-assist": 100,
  // Deterministic docx build (no AI cost) -- generous cap, bounded so the
  // public route can't be used as a free compute endpoint.
  "forge-download": 100,
  // Page count and on-screen page from the layout model (pure compute, no AI).
  // The page asks once per change of text, so it needs a roomy cap.
  "resume-layout": 400,
  // "Email me my package" sends mail from SMR's domain to a typed address.
  // A person needs one or two sends; the route also caps per recipient.
  "email-package": 5,
  // The second check (a different model family reads the page against the
  // person's words). A paid call; one or two runs per resume. Off unless
  // SECOND_CHECK_ENABLED, and also held by a daily dollar cap.
  "second-check": 5,
  // The free checker's file upload: text extraction (and OCR for a scan or a
  // photo), no AI call, nothing stored. OCR is CPU heavy, so it is bounded.
  "check-extract": 30,
  // The public "get listed" form for organizations (stores a request).
  "org-listing": 5,
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

/**
 * Check if a user has remaining AI calls for today.
 */
export async function checkUserRateLimit(
  userId: string,
  endpoint: string
): Promise<RateLimitResult> {
  const tierLimit = await getUserDailyLimit(userId);

  // A hard per-endpoint cap (if any) applies to every user, even unlimited-tier
  // accounts (tierLimit === 0). It is a ceiling: the effective limit is the
  // smaller of the tier limit and the hard cap, treating 0 (unlimited) as
  // "no tier ceiling" so the hard cap alone governs.
  const hardCap = USER_ENDPOINT_HARD_CAPS[endpoint];
  const limit =
    hardCap === undefined
      ? tierLimit
      : tierLimit === 0
        ? hardCap
        : Math.min(tierLimit, hardCap);

  const row = await getOne<{ call_count: number }>(
    `SELECT call_count FROM ai_usage
     WHERE user_id = $1 AND endpoint = $2 AND usage_date = CURRENT_DATE`,
    [userId, endpoint]
  );

  const used = row?.call_count ?? 0;
  // limit 0 means unlimited (admin/unlimited tier)
  const allowed = limit === 0 || used < limit;
  const remaining = limit === 0 ? 999999 : Math.max(0, limit - used);

  return { allowed, remaining, limit };
}

/**
 * Check if an IP has remaining AI calls for today.
 */
export async function checkIpRateLimit(
  ip: string,
  endpoint: string
): Promise<RateLimitResult> {
  const limit = FORGE_IP_LIMITS[endpoint] ?? 10;
  const day = usageDayUtc();

  const row = await getOne<{ call_count: number }>(
    `SELECT call_count FROM ai_usage
     WHERE ip_address = $1 AND endpoint = $2 AND usage_date = $3::date`,
    [hashUsageKey(ip, day), endpoint, day]
  );

  const used = row?.call_count ?? 0;
  const allowed = used < limit;
  const remaining = Math.max(0, limit - used);

  return { allowed, remaining, limit };
}

/**
 * Atomic increment for user-based usage. Returns the new count.
 */
export async function incrementUserUsage(
  userId: string,
  endpoint: string
): Promise<number> {
  const row = await getOne<{ call_count: number }>(
    `INSERT INTO ai_usage (user_id, endpoint, usage_date, call_count)
     VALUES ($1, $2, CURRENT_DATE, 1)
     ON CONFLICT (user_id, endpoint, usage_date)
     DO UPDATE SET call_count = ai_usage.call_count + 1, updated_at = now()
     RETURNING call_count`,
    [userId, endpoint]
  );
  return row?.call_count ?? 1;
}

/**
 * Give back one call counted for a user today (never below zero). For a call
 * the account allowed but a shared limit (a network, an organization's seat
 * pool) refused: the person's own allowance is not spent on it.
 */
export async function refundUserUsage(userId: string, endpoint: string): Promise<void> {
  await query(
    `UPDATE ai_usage SET call_count = GREATEST(call_count - 1, 0), updated_at = now()
      WHERE user_id = $1 AND endpoint = $2 AND usage_date = CURRENT_DATE`,
    [userId, endpoint]
  );
}

/**
 * Pure cap decision for a reserved slot: the increment RETURNING count is within
 * the cap iff it is <= cap. Extracted so the ok/count sequence is unit-testable
 * without a DB (see rateLimit.test.ts): counts 1,2,3 against cap 3 are ok, the
 * 4th (count 4) is not.
 */
export function slotWithinCap(count: number, cap: number): boolean {
  return count <= cap;
}

/**
 * ATOMIC reserve-a-slot for a hard-capped, PAID endpoint (fixes the TOCTOU where
 * a separate check-then-increment let N concurrent callers each read used < cap
 * before any increment and blow past a paid ceiling).
 *
 * This is a SINGLE atomic statement: the upsert increments call_count and RETURNs
 * the post-increment value, so concurrent callers are serialized by the row lock
 * and each receives a DISTINCT count (1, 2, 3, ...). Only the first `cap` callers
 * get ok:true; every caller past the cap gets ok:false and MUST NOT make the paid
 * call. The extra increment for a rejected caller is harmless -- they are capped
 * out anyway, and the counter simply reads a little past the cap for the day.
 *
 * Matches incrementUserUsage's table/columns/usage_date handling exactly; the
 * only addition is returning the ok verdict alongside the count.
 */
export async function reserveEndpointSlot(
  userId: string,
  endpoint: string,
  cap: number
): Promise<{ ok: boolean; count: number }> {
  const row = await getOne<{ call_count: number }>(
    `INSERT INTO ai_usage (user_id, endpoint, usage_date, call_count)
     VALUES ($1, $2, CURRENT_DATE, 1)
     ON CONFLICT (user_id, endpoint, usage_date)
     DO UPDATE SET call_count = ai_usage.call_count + 1, updated_at = now()
     RETURNING call_count`,
    [userId, endpoint]
  );
  const count = row?.call_count ?? 1;
  return { ok: slotWithinCap(count, cap), count };
}

/**
 * Refund a slot previously taken by reserveEndpointSlot, for when the paid
 * operation FAILED -- a failed attempt must not cost the user one of their few
 * daily slots. Atomic decrement with a floor of 0 (GREATEST); a no-op if there is
 * no row for today. Call ONLY on a failure path after a successful reserve, never
 * after a success (that would hand back a slot the user actually consumed).
 */
export async function releaseEndpointSlot(
  userId: string,
  endpoint: string
): Promise<void> {
  await getOne(
    `UPDATE ai_usage
        SET call_count = GREATEST(call_count - 1, 0), updated_at = now()
      WHERE user_id = $1 AND endpoint = $2 AND usage_date = CURRENT_DATE
      RETURNING call_count`,
    [userId, endpoint]
  );
}

/** Prefix on every stored key, so hashed rows are told apart from old raw IPs. */
export const USAGE_KEY_HASH_PREFIX = "h1:";

/** How long ai_usage rows are kept before the retention cron deletes them. */
export const AI_USAGE_RETENTION_DAYS = 30;

/** Today's date in UTC as YYYY-MM-DD: the usage_date and the hash's day salt. */
export function usageDayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The shared server secret (see serverHashSecret) that keys the usage hash. */
function usageKeySecret(): string {
  return serverHashSecret("count anonymous usage");
}

/**
 * The value stored in ai_usage.ip_address. Never the raw key: an HMAC keyed
 * with a server secret (a plain hash of an IPv4 address can be reversed by
 * trying all of them) and salted with the day, so the same address gives a
 * different value each day and rows cannot be linked across days. Same input
 * on the same day gives the same value, which is all a daily counter needs.
 *
 * Used for every key that goes through the per-IP counter (IPs, partner-code
 * buckets, hashed email recipients, the live-test bucket).
 */
export function hashUsageKey(key: string, day: string, secret: string = usageKeySecret()): string {
  const mac = createHmac("sha256", secret).update(`ai_usage|${day}|${key}`).digest("hex");
  return USAGE_KEY_HASH_PREFIX + mac.slice(0, 40);
}

/**
 * Atomic increment for IP-based usage. Returns the new count. The IP (or other
 * key) is stored only as hashUsageKey(); see that function.
 */
export async function incrementIpUsage(
  ip: string,
  endpoint: string
): Promise<number> {
  const day = usageDayUtc();
  const row = await getOne<{ call_count: number }>(
    `INSERT INTO ai_usage (ip_address, endpoint, usage_date, call_count)
     VALUES ($1, $2, $3::date, 1)
     ON CONFLICT (ip_address, endpoint, usage_date)
     DO UPDATE SET call_count = ai_usage.call_count + 1, updated_at = now()
     RETURNING call_count`,
    [hashUsageKey(ip, day), endpoint, day]
  );
  return row?.call_count ?? 1;
}

/**
 * Retention: delete usage rows older than AI_USAGE_RETENTION_DAYS, and any
 * per-IP row from before today still holding a raw (pre-hash) value. Daily
 * limits only ever read today's rows, so nothing that enforces a limit is
 * lost. Returns how many rows went.
 */
export async function purgeOldAiUsage(): Promise<{ expired: number; rawIp: number }> {
  const expired = await query<{ id: string }>(
    `DELETE FROM ai_usage
      WHERE usage_date < CURRENT_DATE - $1::int
      RETURNING id`,
    [AI_USAGE_RETENTION_DAYS]
  );
  const rawIp = await query<{ id: string }>(
    `DELETE FROM ai_usage
      WHERE ip_address IS NOT NULL
        AND ip_address NOT LIKE $1
        AND usage_date < CURRENT_DATE
      RETURNING id`,
    [USAGE_KEY_HASH_PREFIX + "%"]
  );
  return { expired: expired.length, rawIp: rawIp.length };
}

/**
 * Resolve the daily limit for a user based on their redeemed access codes.
 * Highest tier wins: unlimited > partner > default. (Codes cannot be admin.)
 */
export async function getUserDailyLimit(userId: string): Promise<number> {
  // Read AS the person: this runs before every AI call, and an unscoped read
  // under row-level security finds no codes, which does not fail -- it hands a
  // paying cohort the anonymous allowance and then asks them for a code.
  const row = await getOneAsUser<{ tier: string; daily_limit: number | null }>(
    userId,
    `SELECT ac.tier, ac.daily_limit
     FROM access_code_redemption acr
     JOIN access_code ac ON ac.id = acr.access_code_id
     WHERE acr.user_id = $1
       AND ac.is_active = true
       AND (ac.expires_at IS NULL OR ac.expires_at > now())
     ORDER BY
       CASE ac.tier
         WHEN 'unlimited' THEN 1
         WHEN 'partner' THEN 2
         WHEN 'client' THEN 3
       END
     LIMIT 1`,
    [userId]
  );

  if (!row) {
    // ORG STAFF AND OWNERS NEVER REDEEM A CODE -- they are attached to the
    // organization through org_staff or by owning it -- so this lookup found
    // nothing and handed a working case manager the anonymous job-seeker
    // allowance, then told them to "enter a partner code". Their allowance
    // comes from the organization they work for.
    return (await getOrgMemberDailyLimit(userId)) ?? DEFAULT_DAILY_LIMIT;
  }
  if (row.tier === "unlimited") return 0; // 0 = unlimited
  // 'partner' and 'client' codes both carry their minted daily_limit
  return row.daily_limit ?? 200;
}

/** Staff work a caseload all day; the floor is a working day, not a trial. */
export const ORG_MEMBER_DAILY_FLOOR = 200;

/**
 * Daily limit for somebody who belongs to an organization, or null if they do
 * not. Resolved through resolveOrgActor so the membership rules (owner wins,
 * org_staff read as the user under row-level security) live in one place.
 */
export async function getOrgMemberDailyLimit(userId: string): Promise<number | null> {
  const { resolveOrgActor } = await import("./authz/resolveOrgActor");
  const actor = await resolveOrgActor(userId).catch(() => null);
  if (!actor) return null;
  const code = await getOne<{ tier: string; daily_limit: number | null }>(
    `SELECT tier, daily_limit FROM access_code WHERE id = $1`,
    [actor.orgId]
  );
  if (!code) return ORG_MEMBER_DAILY_FLOOR;
  if (code.tier === "unlimited") return 0; // 0 = unlimited
  return Math.max(code.daily_limit ?? ORG_MEMBER_DAILY_FLOOR, ORG_MEMBER_DAILY_FLOOR);
}

/**
 * Get total AI usage for a user today (across all AI endpoints).
 *
 * Non-AI counters that piggy-back on the ai_usage table (e.g. the vault's
 * "vault_upload" per-day upload ceiling, Phase 6.2) are EXCLUDED here: this
 * number is surfaced to the user via /api/usage as their AI calls used/remaining,
 * and a justice-impacted client must never see saving a document to their vault
 * as burning their AI allowance. The exclusion is display-only -- per-endpoint
 * enforcement (incrementUserUsage vs getUserDailyLimit) is unaffected, and real
 * AI endpoints are untouched.
 *
 * Phase 7.7: photo UPLOADS (endpoint "headshot_upload") are likewise excluded --
 * saving a photo is not an AI call. That endpoint is NOT prefixed "vault_", so it
 * needs its own explicit exclusion clause here. AI headshot GENERATION
 * ("headshot_generate") IS a real AI call and is deliberately NOT excluded, so it
 * DOES count toward the displayed AI usage.
 */
export async function getUserDailyUsage(userId: string): Promise<number> {
  const row = await getOne<{ total: string }>(
    `SELECT COALESCE(SUM(call_count), 0) as total
     FROM ai_usage
     WHERE user_id = $1 AND usage_date = CURRENT_DATE
       AND endpoint NOT LIKE 'vault_%'
       AND endpoint <> 'headshot_upload'`,
    [userId]
  );
  return parseInt(row?.total ?? "0", 10);
}

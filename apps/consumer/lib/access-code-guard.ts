/**
 * Access codes are seat keys (R3 B2, R4 D9/D10). Anyone signed in can try one,
 * so trying is rate limited, every refusal reads the same, and new codes are
 * random unless Troy deliberately picks one.
 */
import type { RateLimitConfig } from "./auth-rate-limit";
import { ORG_CODE_SHAPE, generateOrgCode } from "@crucible/core/src/orgCode";

/**
 * The one answer to any code that did not work: unknown, closed, expired,
 * full, already used, malformed, or too many tries. One message, so the route
 * never says which codes exist.
 */
export const CODE_REFUSAL = "That code did not work. Check it with the organization that gave it to you.";

/**
 * The only shape a person may type or carry in a cookie: what the mint route
 * makes. The hub codes contain "-" and are reachable only through the
 * secret-gated hub-unlock route (security review 1, BL-3). Defined once, in
 * core (orgCode.ts), with the one random generator.
 */
export const CODE_SHAPE = ORG_CODE_SHAPE;

/** Code tries (redeem and the "what does it require" check share them). */
export const CODE_ATTEMPT_LIMITS = {
  perUser: { maxRequests: 20, windowMs: 3_600_000 } as RateLimitConfig,
  perIp: { maxRequests: 60, windowMs: 3_600_000 } as RateLimitConfig,
};

/**
 * Cookie codes (lib/code-attribution.ts) have their OWN per-account budget,
 * so a stale cookie never uses up the tries a person needs to type a real
 * code (review 2, N-13), and each cookie code is tried at most once an hour
 * per account. The per-IP budget is shared with typed codes (SF-1).
 */
export const COOKIE_CODE_LIMITS = {
  perUser: { maxRequests: 5, windowMs: 3_600_000 } as RateLimitConfig,
  perUserCode: { maxRequests: 1, windowMs: 3_600_000 } as RateLimitConfig,
};

export function cookieAttemptLimits(ip: string, userId: string, code: string) {
  return [
    { key: `code:cookie:user:${userId}:${code}`, config: COOKIE_CODE_LIMITS.perUserCode },
    { key: `code:cookie:user:${userId}`, config: COOKIE_CODE_LIMITS.perUser },
    { key: `code:try:ip:${ip}`, config: CODE_ATTEMPT_LIMITS.perIp },
  ];
}

export function codeAttemptLimits(ip: string, userId: string) {
  return [
    { key: `code:try:user:${userId}`, config: CODE_ATTEMPT_LIMITS.perUser },
    { key: `code:try:ip:${ip}`, config: CODE_ATTEMPT_LIMITS.perIp },
  ];
}

/**
 * Which code to mint. No code asked for: a random one. A chosen code is kept
 * only with an explicit confirm (Troy, from the admin page), and still has to
 * be 4 to 20 uppercase letters and digits.
 */
export function mintCodeChoice(body: { code?: unknown; confirmChosenCode?: unknown }):
  | { ok: true; code: string; chosen: boolean }
  | { ok: false; error: string } {
  const raw = typeof body.code === "string" ? body.code.trim() : "";
  if (!raw) return { ok: true, code: generateOrgCode(), chosen: false };
  if (body.confirmChosenCode !== true) {
    return { ok: false, error: "A chosen code is easier to guess. Leave it empty for a random one, or confirm that you want this one." };
  }
  if (!CODE_SHAPE.test(raw)) return { ok: false, error: "code must be 4-20 uppercase alphanumeric characters" };
  return { ok: true, code: raw, chosen: true };
}

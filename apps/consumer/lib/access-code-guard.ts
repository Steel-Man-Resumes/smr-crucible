/**
 * Access codes are seat keys (R3 B2, R4 D9/D10). Anyone signed in can try one,
 * so trying is rate limited, every refusal reads the same, and new codes are
 * random unless Troy deliberately picks one.
 */
import { randomInt } from "node:crypto";
import type { RateLimitConfig } from "./auth-rate-limit";

/**
 * The one answer to any code that did not work: unknown, closed, expired,
 * full, already used, malformed, or too many tries. One message, so the route
 * never says which codes exist.
 */
export const CODE_REFUSAL = "That code did not work. Check it with the organization that gave it to you.";

/**
 * The only shape a person may type or carry in a cookie: what the mint route
 * makes. The hub codes contain "-" and are reachable only through the
 * secret-gated hub-unlock route (security review 1, BL-3).
 */
export const CODE_SHAPE = /^[A-Z0-9]{4,20}$/;

/** Code tries (redeem and the "what does it require" check share them). */
export const CODE_ATTEMPT_LIMITS = {
  perUser: { maxRequests: 20, windowMs: 3_600_000 } as RateLimitConfig,
  perIp: { maxRequests: 60, windowMs: 3_600_000 } as RateLimitConfig,
};

export function codeAttemptLimits(ip: string, userId: string) {
  return [
    { key: `code:try:user:${userId}`, config: CODE_ATTEMPT_LIMITS.perUser },
    { key: `code:try:ip:${ip}`, config: CODE_ATTEMPT_LIMITS.perIp },
  ];
}

/** No 0/O, 1/I/L: a code gets read out loud and copied from paper. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const RANDOM_CODE_LENGTH = 12;

/** A random code: 12 characters from 31, about 59 bits. */
export function generateSeatCode(length = RANDOM_CODE_LENGTH, pick: (n: number) => number = randomInt): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[pick(CODE_ALPHABET.length)];
  return out;
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
  if (!raw) return { ok: true, code: generateSeatCode(), chosen: false };
  if (body.confirmChosenCode !== true) {
    return { ok: false, error: "A chosen code is easier to guess. Leave it empty for a random one, or confirm that you want this one." };
  }
  if (!CODE_SHAPE.test(raw)) return { ok: false, error: "code must be 4-20 uppercase alphanumeric characters" };
  return { ok: true, code: raw, chosen: true };
}

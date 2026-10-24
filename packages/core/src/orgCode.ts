/**
 * The ONE random organization-code generator (B7 + B8 merge, 2026-10-23).
 * Used by the admin mint route (apps/consumer) and by orgAdmin's create and
 * rotate actions (B8). Codes are seat keys anyone signed in can try, so they
 * are random by default.
 *
 * Alphabet: no 0/O, 1/I/L. A code gets read out loud and copied from paper.
 * 31 characters, 12 long: about 59 bits. Unbiased: rejection sampling.
 *
 * MERGE NOTE (B8 orgAdmin.ts): B8 defined generateOrgCode, ORG_CODE_ALPHABET
 * and ORG_CODE_LENGTH in orgAdmin.ts with a 32-character alphabet (with L).
 * On merge, delete those three from orgAdmin.ts and import them from here,
 * so index.ts exports each name once.
 */
import { randomBytes } from "node:crypto";

export const ORG_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ORG_CODE_LENGTH = 12;

/** What a person may type or carry in a cookie, and what mint makes. */
export const ORG_CODE_SHAPE = /^[A-Z0-9]{4,20}$/;

export function generateOrgCode(length = ORG_CODE_LENGTH, bytes: (n: number) => Buffer = randomBytes): string {
  const n = ORG_CODE_ALPHABET.length;
  const limit = 256 - (256 % n); // 248 for 31: bytes at or above it are dropped
  let out = "";
  while (out.length < length) {
    for (const b of bytes(length * 2)) {
      if (b >= limit) continue;
      out += ORG_CODE_ALPHABET[b % n];
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * Seats, the database's way (smr_redeem_code, 048/096): null = no limit; any
 * number, 0 included, is a cap, so 0 means no seats left. Every app check
 * uses this, never a truthiness test.
 */
export function seatsFull(maxRedemptions: number | null | undefined, timesRedeemed: number): boolean {
  return maxRedemptions !== null && maxRedemptions !== undefined && Number(timesRedeemed) >= Number(maxRedemptions);
}

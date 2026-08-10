/**
 * TOTP two-factor (RFC 6238) implemented on Node crypto -- no third-party dep,
 * so it works cleanly in the Node runtime (API routes + the Credentials
 * authorize step) and never gets dragged into the edge middleware bundle.
 *
 * Import this only from Node-runtime code (API routes, or a dynamic import
 * inside authorize). Never statically import it into edge middleware.
 */
import crypto from "crypto";
import QRCode from "qrcode";
// Import the crypto submodule directly (NOT the "@crucible/core" barrel) --
// the barrel's index.ts re-exports every module including ones that pull in
// Node-only APIs unrelated to encryption. This file is dynamically
// imported from auth.ts, whose module graph is also evaluated for the edge
// middleware bundle; pulling in the whole barrel dragged an incompatible
// module into that edge bundle and broke the build (webpack: "node:crypto"
// unhandled scheme, via refineryArtifact.js). A direct submodule import
// keeps this file's dependency surface to just what it needs.
import { encryptString, decryptString, type EncryptedPayload } from "@crucible/core/dist/crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP = 30; // seconds
const ISSUER = "Steel Man Resumes";

/** Base32 (RFC 4648, no padding) secret, ~32 chars from 20 random bytes. */
export function generateSecret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes);
  let bits = "";
  for (let i = 0; i < buf.length; i++) bits += buf[i].toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += B32[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) bits += B32.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

/** Current 6-digit token -- used in tests and to derive verification. */
export function generateToken(secret: string, when = Date.now()): string {
  return hotp(secret, Math.floor(when / 1000 / STEP));
}

/** Verify a token with a +/- 1 step window for clock drift. */
export function verifyToken(token: string, secret: string, when = Date.now()): boolean {
  const t = (token || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(t) || !secret) return false;
  const counter = Math.floor(when / 1000 / STEP);
  for (const w of [-1, 0, 1]) {
    const candidate = hotp(secret, counter + w);
    const a = Buffer.from(candidate);
    const b = Buffer.from(t);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, account: string, issuer = ISSUER): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: String(STEP),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export async function qrDataUrl(otpauth: string): Promise<string> {
  return QRCode.toDataURL(otpauth, { margin: 1, width: 220 });
}

/**
 * Phase 1C: TOTP secret encryption-at-rest (AES-256-GCM, migration 037).
 * New user_two_factor rows store `secret` as ciphertext with
 * secret_iv/secret_tag/secret_key_version populated. AAD binds the
 * ciphertext to the owning user + purpose so it can't be swapped between
 * accounts even if the DB row is copied.
 */
export interface TwoFactorSecretRow {
  secret: string;
  secret_iv: string | null;
  secret_tag: string | null;
  secret_key_version: string | null;
}

function totpAad(userId: string): string {
  return `${userId}:totp`;
}

export function encryptTotpSecret(secret: string, userId: string): EncryptedPayload {
  return encryptString(secret, totpAad(userId));
}

/**
 * Resolve the plaintext TOTP secret from a user_two_factor row.
 *
 * Backfill-on-next-use: rows written before this migration have
 * secret_iv/secret_tag/secret_key_version NULL -- `secret` is still
 * plaintext for those, so this falls back to returning it as-is rather than
 * locking existing 2FA users out. Callers that hold write access to the row
 * (auth.ts's password-login path) opportunistically re-encrypt and persist
 * it right after a successful verify, so a legacy row is migrated to
 * ciphertext the first time its owner actually signs in -- no forced
 * re-enrollment, no maintenance job needed.
 */
export function resolveTotpSecret(row: TwoFactorSecretRow, userId: string): string {
  if (!row.secret_iv || !row.secret_tag || !row.secret_key_version) {
    return row.secret; // legacy plaintext row
  }
  return decryptString(
    {
      ciphertext: row.secret,
      iv: row.secret_iv,
      tag: row.secret_tag,
      keyVersion: row.secret_key_version,
    },
    totpAad(userId)
  );
}

/** One-time backup codes (shown once, stored hashed). Format: xxxxx-xxxxx. */
export function generateBackupCodes(n = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const raw = crypto.randomBytes(5).toString("hex"); // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

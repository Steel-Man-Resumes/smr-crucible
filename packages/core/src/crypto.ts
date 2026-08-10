/**
 * Phase 1C: AES-256-GCM envelope encryption keyed by DOCUMENT_ENCRYPTION_KEY.
 *
 * This is the platform primitive for anything that needs to be encrypted at
 * rest: the TOTP-secret hardening in this same phase, secureObject.ts (the
 * Phase 6 vault / Phase 5 transcripts+recordings / Phase 7 headshots
 * platform), and any future column-level encryption.
 *
 * Key format: DOCUMENT_ENCRYPTION_KEY holds either "v1:<material>" or a bare
 * <material> string (treated as v1). <material> may be base64 (what
 * `openssl rand -base64 32` produces -- this is what's in
 * apps/consumer/.env.local today) or 64-char hex; either way it MUST decode
 * to exactly 32 bytes (AES-256).
 *
 * Parsing is lazy -- done inside encrypt/decrypt calls, never at module
 * load -- so a missing or malformed key can never crash a build or an
 * unrelated request. It only throws when something actually tries to
 * encrypt or decrypt.
 *
 * IV: a random 12 bytes per call (the GCM-recommended size). AAD: a
 * caller-supplied binding string (e.g. `${userId}:${purpose}`) mixed into
 * the auth tag -- decrypt fails closed if the AAD doesn't match what was
 * used to encrypt, so a stored ciphertext can't be silently replayed under
 * a different owner or purpose.
 *
 * Key rotation: only "v1" is resolvable today (the single key in
 * DOCUMENT_ENCRYPTION_KEY). A future rotation would introduce
 * DOCUMENT_ENCRYPTION_KEY_V2 etc. and extend getKeyBytes()'s lookup --
 * every stored payload already carries its own keyVersion, so old
 * ciphertext stays decryptable without a backfill.
 */
// Bare "crypto" specifier (not "node:crypto") -- Next's edge/webpack module
// resolution understands the former via its Node builtin polyfill map but
// throws an UnhandledSchemeError on the "node:" prefixed form when this
// module ends up analyzed for an edge bundle (see lib/two-factor.ts, which
// is dynamically imported from apps/consumer/auth.ts).
import crypto from "crypto";

export const DEFAULT_KEY_VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
  keyVersion: string;
}

function splitVersionedEnv(raw: string): { version: string; material: string } {
  const trimmed = raw.trim();
  const m = /^([a-zA-Z0-9]+):(.+)$/.exec(trimmed);
  if (m) return { version: m[1], material: m[2] };
  return { version: DEFAULT_KEY_VERSION, material: trimmed };
}

function decodeKeyMaterial(raw: string): Buffer {
  const trimmed = raw.trim();
  // 64 hex chars decodes to 32 bytes; anything else is treated as base64
  // (a 32-byte key base64-encodes to 44 chars including padding).
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  return Buffer.from(trimmed, "base64");
}

/** The key version currently configured in the environment (does not
 *  validate key length -- call encrypt/decrypt for that). */
export function currentKeyVersion(): string {
  const env = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!env) return DEFAULT_KEY_VERSION;
  return splitVersionedEnv(env).version;
}

function getKeyBytes(requestedVersion: string): Buffer {
  const env = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!env) {
    throw new Error(
      "DOCUMENT_ENCRYPTION_KEY is not set -- cannot encrypt or decrypt. Set it in the environment (see apps/consumer/.env.local)."
    );
  }

  const { version: configuredVersion, material } = splitVersionedEnv(env);
  if (requestedVersion !== configuredVersion) {
    throw new Error(
      `No key material available for key version "${requestedVersion}" (the configured DOCUMENT_ENCRYPTION_KEY is version "${configuredVersion}").`
    );
  }

  const keyBytes = decodeKeyMaterial(material);
  if (keyBytes.length !== KEY_BYTES) {
    throw new Error(
      `DOCUMENT_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (AES-256); got ${keyBytes.length}. Expected base64 (44 chars incl. padding) or 64-char hex, optionally prefixed "v1:".`
    );
  }
  return keyBytes;
}

/** Encrypt a Buffer with AES-256-GCM. The binary-safe primitive underneath
 *  encryptString/encryptJSON and secureObject.ts's file encryption. */
export function encryptBuffer(plaintext: Buffer, aad: string): EncryptedPayload {
  const keyVersion = currentKeyVersion();
  const key = getKeyBytes(keyVersion);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    keyVersion,
  };
}

/** Decrypt a payload produced by encryptBuffer. Throws if the AAD doesn't
 *  match, the ciphertext/tag was tampered with, or the key version isn't
 *  resolvable -- GCM auth-tag verification happens inside decipher.final(). */
export function decryptBuffer(payload: EncryptedPayload, aad: string): Buffer {
  const key = getKeyBytes(payload.keyVersion);
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptString(plaintext: string, aad: string): EncryptedPayload {
  return encryptBuffer(Buffer.from(plaintext, "utf8"), aad);
}

export function decryptString(payload: EncryptedPayload, aad: string): string {
  return decryptBuffer(payload, aad).toString("utf8");
}

export function encryptJSON(value: unknown, aad: string): EncryptedPayload {
  return encryptString(JSON.stringify(value), aad);
}

export function decryptJSON<T = unknown>(payload: EncryptedPayload, aad: string): T {
  return JSON.parse(decryptString(payload, aad)) as T;
}

/**
 * Phase 7.7 avatar photo path -- shared, PURE constants + helpers. No db/pg/aws
 * imports, so this is safe to import from a client bundle (the settings avatar
 * section) and from server routes alike (deep import:
 * @crucible/core/src/avatarAssetShared).
 *
 * DOCTRINE: the illustrated avatar stays the default (zero PII). A photo is
 * optional, encrypted at rest, owner-only, and NEVER auto-added to a resume.
 * Headshots only -- this is not a general image store.
 */

export type AvatarAssetKind = "original_photo" | "generated_headshot";

export const AVATAR_ASSET_KINDS: readonly AvatarAssetKind[] = [
  "original_photo",
  "generated_headshot",
] as const;

const AVATAR_ASSET_KIND_SET = new Set<string>(AVATAR_ASSET_KINDS);

export function isAvatarAssetKind(value: unknown): value is AvatarAssetKind {
  return typeof value === "string" && AVATAR_ASSET_KIND_SET.has(value);
}

/**
 * 8 MB. The client crops + compresses to a small square (max ~512px) before
 * upload, so a real headshot lands far under this; this is a generous
 * anti-abuse ceiling for the raw pre-compression case, not the expected size.
 */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * Headshots only. The client crops to a square and exports jpeg/png/webp, so
 * no HEIC on the server (browsers do not hand back HEIC from a <canvas> export,
 * and we do not want a server-side HEIC decoder). Deliberately NOT the broad
 * vault allowlist -- no PDF, no gif, no office docs.
 */
export const AVATAR_MIME_ALLOWLIST: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const AVATAR_MIME_SET = new Set<string>(AVATAR_MIME_ALLOWLIST);

/** Normalize a raw Content-Type ("image/jpeg; charset=..") to its bare type. */
export function normalizeAvatarMime(mime: string | null | undefined): string {
  if (!mime) return "";
  return mime.split(";")[0].trim().toLowerCase();
}

export function isAllowedAvatarMime(mime: string | null | undefined): boolean {
  return AVATAR_MIME_SET.has(normalizeAvatarMime(mime));
}

/**
 * Content-sniff the leading bytes of an image upload and return the detected
 * MIME, or null when the bytes match no allowlisted signature. Defense in depth:
 * the route must NOT trust the client-declared Content-Type alone. Covers the
 * three allowlisted image formats (jpeg, png, webp), all of which have stable
 * magic numbers.
 */
export function sniffAvatarMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  // RIFF container: "RIFF"...."WEBP" -> webp
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Full server-side accept decision for an avatar upload, given the client
 * declared MIME and the actual leading bytes. The declared MIME must be on the
 * allowlist AND the sniffed signature must agree with it (an attacker cannot
 * label non-image bytes as image/png). Every allowlisted format has a reliable
 * magic number, so there is no sniff-exempt case here (unlike the vault).
 */
export function decideAvatarMime(
  declaredMime: string | null | undefined,
  bytes: Uint8Array
): { ok: true; mime: string } | { ok: false; reason: string } {
  const declared = normalizeAvatarMime(declaredMime);
  if (!AVATAR_MIME_SET.has(declared)) {
    return { ok: false, reason: "unsupported_type" };
  }
  const sniffed = sniffAvatarMime(bytes);
  if (!sniffed) {
    return { ok: false, reason: "content_type_unrecognized" };
  }
  if (sniffed !== declared) {
    return { ok: false, reason: "content_type_mismatch" };
  }
  return { ok: true, mime: declared };
}

/**
 * Hard daily cap on AI headshot GENERATION -- a real paid image call. This is a
 * per-endpoint enforced ceiling (endpoint "headshot_generate"), distinct from a
 * photo UPLOAD which is not an AI call. Small on purpose: generation is expensive
 * and rarely needed more than a couple of times.
 */
export const HEADSHOT_DAILY_CAP = 3;

/** The rate-limit endpoint name for headshot generation. NOT prefixed
 *  "vault_"/"headshot_upload", so it DOES count toward the AI-usage display. */
export const HEADSHOT_GENERATE_ENDPOINT = "headshot_generate";

/** The counter name for photo uploads (not an AI call). Excluded from the
 *  AI-usage display -- see getUserDailyUsage in rateLimit.ts. */
export const HEADSHOT_UPLOAD_ENDPOINT = "headshot_upload";

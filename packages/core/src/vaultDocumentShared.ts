/**
 * Phase 6.2 vault -- shared, PURE constants + helpers. No db/pg/aws imports, so
 * this is safe to import from a client bundle (the vault page) and from server
 * routes alike (deep import: @crucible/core/src/vaultDocumentShared).
 *
 * DOCTRINE: the vault is the user's lifelong document HOME -- guidance, not
 * gatekeeping. It is NOT a secrets vault: no passwords, no Social Security card,
 * no bank logins. The UI copy must say so plainly. This population is
 * justice-impacted; copy stays plain, blunt, and dignified.
 */

export type VaultCategory =
  | "id"
  | "certificate"
  | "reference_letter"
  | "record"
  | "note"
  | "other";

export interface VaultCategoryDef {
  key: VaultCategory;
  label: string;
  help: string;
}

/** The six categories, in display order. Mirrors the CHECK constraint in
 *  migration 042 -- keep the two in sync. */
export const VAULT_CATEGORIES: VaultCategoryDef[] = [
  {
    key: "id",
    label: "Government or personal ID",
    help: "A photo of your state ID, birth certificate, or Social Security card copy you keep for your own records.",
  },
  {
    key: "certificate",
    label: "Certificates and credentials",
    help: "Trade certificates, OSHA cards, CDL, forklift, food handler, diplomas, program completion.",
  },
  {
    key: "reference_letter",
    label: "Reference letters",
    help: "Letters from employers, case managers, mentors, or program staff who will speak for you.",
  },
  {
    key: "record",
    label: "Records and legal documents",
    help: "Court paperwork, release documents, parole or probation letters, expungement records.",
  },
  {
    key: "note",
    label: "Notes to yourself",
    help: "A written note you want to keep -- a phone number, a plan, a reminder.",
  },
  {
    key: "other",
    label: "Anything else",
    help: "Any document that matters to you and does not fit the categories above.",
  },
];

const VAULT_CATEGORY_KEYS = new Set<string>(VAULT_CATEGORIES.map((c) => c.key));

export function isVaultCategory(value: unknown): value is VaultCategory {
  return typeof value === "string" && VAULT_CATEGORY_KEYS.has(value);
}

export function vaultCategoryLabel(key: string): string {
  return VAULT_CATEGORIES.find((c) => c.key === key)?.label ?? "Anything else";
}

/** 25 MB. A phone photo of a certificate or a multi-page PDF fits well under
 *  this; it is a real ceiling that keeps a single upload from being abused. */
export const MAX_VAULT_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Real document MIME types a justice-impacted user actually uploads: a phone
 * photo of an ID/certificate (jpeg/png/heic/webp/gif), a scanned or emailed PDF,
 * a Word doc from a case manager, or a plain-text note. Deliberately NOT a
 * general file store -- no zips, executables, or arbitrary binaries.
 */
export const VAULT_MIME_ALLOWLIST: readonly string[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "text/plain",
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
] as const;

const VAULT_MIME_SET = new Set<string>(VAULT_MIME_ALLOWLIST);

/** Normalize a raw Content-Type ("image/jpeg; charset=..") to its bare type. */
export function normalizeMime(mime: string | null | undefined): string {
  if (!mime) return "";
  return mime.split(";")[0].trim().toLowerCase();
}

export function isAllowedVaultMime(mime: string | null | undefined): boolean {
  return VAULT_MIME_SET.has(normalizeMime(mime));
}

/** A conservative filename extension for an allowed MIME, used when building a
 *  safe download/zip name. Falls back to "bin". */
export function extensionForMime(mime: string): string {
  switch (normalizeMime(mime)) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "text/plain":
      return "txt";
    case "application/msword":
      return "doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    default:
      return "bin";
  }
}

/**
 * Content-sniff the leading bytes and return a detected MIME, or null when the
 * bytes match no allowlisted signature. This is defense-in-depth: the route
 * must NOT trust the client-declared Content-Type alone. Text/plain, .doc, and
 * .docx have no single reliable magic number a browser upload guarantees, so
 * they are handled by the caller (declared-mime allowlist) rather than sniffed
 * here -- this function focuses on the binary formats with stable signatures.
 *
 * Returns the sniffed MIME for: pdf, png, jpeg, gif, webp, heic/heif.
 */
export function sniffVaultMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length < 4) return null;
  // PDF: "%PDF"
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    return "application/pdf";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF: "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return "image/gif";
  }
  // RIFF container: "RIFF"...."WEBP" -> webp
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  // ISO-BMFF (HEIC/HEIF): bytes 4-7 = "ftyp", brand at 8-11 in the heic/heif/mif1 family.
  if (
    b.length >= 12 &&
    b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70
  ) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
    if (["heic", "heix", "heif", "mif1", "hevc", "msf1"].includes(brand)) {
      return "image/heic";
    }
  }
  return null;
}

/**
 * The full server-side accept decision for an upload, given the client-declared
 * MIME and the actual leading bytes. Rules:
 *  - The declared MIME must be on the allowlist.
 *  - For binary formats we can sniff, the sniffed signature must agree with the
 *    declared type's family (an attacker cannot label a .exe as image/png and
 *    slip real PNG-labeled non-PNG bytes through).
 *  - text/plain, .doc, .docx are accepted on the declared MIME alone (no
 *    reliable universal magic number), which is acceptable: they are inert
 *    document types and the bytes are stored encrypted, never executed.
 */
export function decideVaultMime(
  declaredMime: string | null | undefined,
  bytes: Uint8Array
): { ok: true; mime: string } | { ok: false; reason: string } {
  const declared = normalizeMime(declaredMime);
  if (!VAULT_MIME_SET.has(declared)) {
    return { ok: false, reason: "unsupported_type" };
  }
  const sniffed = sniffVaultMime(bytes);
  // Types with no reliable signature: trust the declared allowlisted type.
  const SNIFF_EXEMPT = new Set([
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]);
  if (SNIFF_EXEMPT.has(declared)) {
    return { ok: true, mime: declared };
  }
  if (!sniffed) {
    return { ok: false, reason: "content_type_unrecognized" };
  }
  // heic and heif normalize to the same signature family; treat as agreeing.
  const declaredFamily = declared === "image/heif" ? "image/heic" : declared;
  const sniffedFamily = sniffed === "image/heif" ? "image/heic" : sniffed;
  if (declaredFamily !== sniffedFamily) {
    return { ok: false, reason: "content_type_mismatch" };
  }
  return { ok: true, mime: declared };
}

/** Build a filesystem/zip-safe filename from a user label + mime. Never trusts
 *  the label for path traversal -- strips separators and control chars. */
export function safeVaultFilename(label: string, mime: string, fallbackName?: string | null): string {
  const raw = label || fallbackName || "document";
  const base = raw
    .replace(/[\\/:*?"<>| -]/g, " ")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .trim()
    .slice(0, 120) || "document";
  const ext = extensionForMime(mime);
  if (base.toLowerCase().endsWith("." + ext)) return base;
  return `${base}.${ext}`;
}

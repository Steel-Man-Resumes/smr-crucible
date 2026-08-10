/**
 * Slugged resume/cover-letter filenames (Phase 2.6, 2026-08-10).
 *
 * Replaces the hardcoded "My_Resume_SteelMan.docx" downloads with a real,
 * human-meaningful name derived from who the document is for and what it targets:
 *
 *   First-Last--Lane--Company--Role.docx
 *   First-Last-CoverLetter--Lane--Company--Role.docx
 *
 * Absent segments (no lane/company/role) collapse cleanly -- never a doubled
 * "--" separator, never a trailing separator. Windows-forbidden characters and
 * control characters are stripped, whitespace collapses to a single hyphen, and
 * the whole name is capped so it never trips a filesystem length limit.
 *
 * Pure + unit-tested (adversarial suite).
 */

export interface ResumeFilenameParts {
  firstName?: string | null;
  lastName?: string | null;
  lane?: string | null;
  company?: string | null;
  role?: string | null;
  kind?: "resume" | "cover_letter";
  /** File extension without the dot (default "docx"). */
  ext?: string;
  /** Collision suffix, e.g. 2 -> "-2". Only applied when > 1. */
  collision?: number;
}

const MAX_BASE_LEN = 120;

/**
 * Clean a single name SEGMENT. First strips Windows-forbidden characters
 * (< > : " / \ | ? *) and ASCII control chars, then turns every remaining run
 * of non-alphanumerics (spaces, commas, dots, ampersands) into a single hyphen
 * and trims stray hyphens. Applied per-segment so the intentional "--"
 * separators between segments always survive.
 */
function cleanSegment(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  const forbidden = new RegExp("[<>:\"/\\\\|?*\\u0000-\\u001f]", "g");
  return value
    .replace(forbidden, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildResumeFilename(parts: ResumeFilenameParts): string {
  const kind = parts.kind === "cover_letter" ? "cover_letter" : "resume";
  const ext = (typeof parts.ext === "string" && parts.ext.trim()
    ? parts.ext.trim().replace(/^\./, "")
    : "docx"
  ).toLowerCase();

  const first = cleanSegment(parts.firstName);
  const last = cleanSegment(parts.lastName);
  const nameParts = [first, last].filter(Boolean);

  // Name block. When no name is known, fall back to a kind label (never a bare
  // "document"). The cover-letter variant carries a "-CoverLetter" infix.
  let nameSeg = nameParts.join("-");
  if (!nameSeg) {
    nameSeg = kind === "cover_letter" ? "CoverLetter" : "Resume";
  } else if (kind === "cover_letter") {
    nameSeg = `${nameSeg}-CoverLetter`;
  }

  const targetSegs = [
    cleanSegment(parts.lane),
    cleanSegment(parts.company),
    cleanSegment(parts.role),
  ].filter(Boolean);

  let base = [nameSeg, ...targetSegs].join("--");
  if (base.length > MAX_BASE_LEN) base = base.slice(0, MAX_BASE_LEN).replace(/-+$/, "");

  const collision =
    typeof parts.collision === "number" && parts.collision > 1
      ? `-${Math.floor(parts.collision)}`
      : "";

  return `${base}${collision}.${ext}`;
}

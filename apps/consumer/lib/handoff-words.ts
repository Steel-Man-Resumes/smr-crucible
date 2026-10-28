/**
 * Words the handoff screens share (staff pass S5), on both sides. Pure, so
 * they are tested and the staff and participant screens never drift.
 */

/** Band words staff and participants can repeat. Never "checked" for B or C. */
export function bandLine(kind: "employer" | "resource", band: string | null | undefined): string {
  if (kind === "employer") return band === "A" ? "Has the hiring mark" : band === "B" ? "Reported hiring evidence, below the mark" : "Hiring evidence not shown";
  return band === "A" ? "Checked" : band === "B" ? "Listed, not yet checked by us" : band === "C" ? "Found in a public list, unconfirmed" : "Not checked";
}

/** "Oct 27, 2026" from an ISO day or time; empty for nothing. */
export function dayWords(s: string | null | undefined): string {
  if (!s) return "";
  const d = new Date(s.length === 10 ? `${s}T12:00:00Z` : s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
}

/** The access-log line for a connections read, for lib/access-log-words.ts (boss wiring). */
export const CONNECTIONS_LOG_WORDS = "looked over what you share to find employers and job help that fit you";

/**
 * Words the handoff screens share (staff pass S5), on both sides. Pure, so
 * they are tested and the staff and participant screens never drift.
 */

/** Band words staff and participants can repeat. Never "checked" for B or C. */
export function bandLine(kind: "employer" | "resource", band: string | null | undefined): string {
  if (kind === "employer") return band === "A" ? "Has the hiring mark" : band === "B" ? "Reported hiring evidence, below the mark" : "Hiring evidence not shown";
  return band === "A" ? "Checked" : band === "B" ? "Listed, not yet checked by us" : band === "C" ? "Found in a public list, unconfirmed" : "Not checked";
}

/**
 * "Oct 27, 2026" for a calendar day (a checked date, a due date). The day as
 * stored, never shifted by a time zone: "2026-10-22" and
 * "2026-10-22 00:00:00+00" are both Oct 22.
 */
export function dayWords(s: string | null | undefined): string {
  if (!s) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  const d = new Date(m ? `${m[1]}T12:00:00Z` : s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
}

/**
 * "Oct 28, 2026" for a moment (when a handoff was sent), in the viewer's own
 * time zone, the same way the Inbox shows times. A handoff sent at 8:35 PM
 * Mountain on Oct 28 reads Oct 28, not the UTC date Oct 29. timeZone is for
 * tests; the screens leave it out.
 */
export function whenWords(s: string | null | undefined, timeZone?: string): string {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dayWords(s);
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...(timeZone ? { timeZone } : {}) }) : "";
}

/**
 * The standing of a listing with its date, said once. "Checked Oct 22, 2026"
 * (never "Checked, checked Oct 22"); B and C say when the source was
 * reviewed, never that we checked it.
 */
export function evidenceWords(kind: "employer" | "resource", band: string | null | undefined, date: string | null | undefined): string {
  const line = bandLine(kind, band);
  const when = dayWords(date);
  if (!when) return line;
  if (kind === "employer") return `${line}, checked ${when}`; // the date its hiring evidence was checked, as the Directory says

  return band === "A" ? `Checked ${when}` : `${line}, source reviewed ${when}`;
}

/** The access-log line for a connections read, for lib/access-log-words.ts (boss wiring). */
export const CONNECTIONS_LOG_WORDS = "looked over what you share to find employers and job help that fit you";

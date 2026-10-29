/**
 * One calendar day for a stored time, in a named time zone (demo fix T2,
 * 2026-10-28).
 *
 * THE BUG THIS ENDS. Staff t.ROY's reads cut dates with String(s).slice(0, 10).
 * The database driver hands back timestamptz values as Date objects, and
 * String(date) is "Thu Oct 29 2026 02:14:00 GMT+0000", so t.ROY said "last
 * active Thu Oct 29" while the person's card (local time) said Oct 28: one
 * evening's activity, read in UTC on the server and in the viewer's zone on
 * the card. Every staff tool read now goes through localDay with the
 * organization's own time zone (org_profile.timezone), so t.ROY and the card
 * agree for anyone working in the organization's zone.
 *
 * Rules:
 *   - a plain date ("2026-10-28") is already a day: returned as is;
 *   - a Date, or a string with a time, is placed in the time zone given;
 *   - no time zone given: the UTC day (the old behavior for ISO strings);
 *   - a zone the runtime does not know falls back to DEFAULT_LOCAL_TIME_ZONE;
 *   - nothing usable: null, never a guessed day.
 */

/** The build's default organization zone (org_profile.timezone defaults to it, migration 103). */
export const DEFAULT_LOCAL_TIME_ZONE = "America/Chicago";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, f);
  }
  return f;
}

/** A Date from a stored value: Date, ISO string, or Postgres text ("2026-10-29 02:14:00+00"). */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  if (typeof value === "string") {
    // Postgres ::text form: space for T, and a bare "+00" offset.
    const iso = value.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** YYYY-MM-DD of `value` in `timeZone` (UTC when no zone is given). */
export function localDay(value: unknown, timeZone?: string | null): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && DATE_ONLY.test(value.trim())) return value.trim();
  const d = toDate(value);
  if (!d) return null;
  if (!timeZone) return d.toISOString().slice(0, 10);
  let parts: Intl.DateTimeFormatPart[];
  try { parts = formatterFor(timeZone).formatToParts(d); }
  catch { parts = formatterFor(DEFAULT_LOCAL_TIME_ZONE).formatToParts(d); }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

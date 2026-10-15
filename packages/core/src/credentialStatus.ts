/**
 * A credential's status, read strictly (review round 4).
 *
 * One status family at a time: live (current, active, valid, renewed,
 * expires), dead (expired, lapsed), in progress, or completed. A year may go
 * with it, and it is never in the future unless it says when something
 * expires ("expires 2027", "valid until 2027"). Contradictions ("current
 * expired", "completed in progress") and loose words ("through", "passed",
 * "finished the class", "good for") are never a status.
 */

export type StatusFamily = "live" | "dead" | "progress" | "completed";

const FAMILY_RE: Array<[RegExp, StatusFamily]> = [
  [/\b(?:current|currently|active|valid|renewed|expires|expiring)\b/gi, "live"],
  [/\b(?:expired|lapsed)\b/gi, "dead"],
  [/\bin progress\b/gi, "progress"],
  [/\b(?:completed|complete)\b/gi, "completed"],
];
const YEAR_RE = /\b(19[5-9]\d|20[0-4]\d)\b/g;
// A year after one of these says when something ends, so it may be in the future.
const FUTURE_OK_BEFORE = /\b(?:expires|expiring|until|through|due|good until|valid until|valid through)\s*(?:in\s+)?$/i;

export interface StatusRead {
  families: Set<StatusFamily>;
  years: number[];
  /** A year later than this year that does not say when something ends. */
  futureYear: boolean;
}

/** The status families and years in a text. */
export function readStatus(text: string, now = new Date()): StatusRead {
  const t = text || "";
  const families = new Set<StatusFamily>();
  for (const [re, fam] of FAMILY_RE) if (new RegExp(re.source, "i").test(t)) families.add(fam);
  // "in progress" also contains nothing else; "expires" is live only when not "expired".
  const years: number[] = [];
  let futureYear = false;
  for (const m of t.matchAll(YEAR_RE)) {
    const y = Number(m[1]);
    years.push(y);
    if (y > now.getFullYear() && !FUTURE_OK_BEFORE.test(t.slice(0, m.index))) futureYear = true;
  }
  return { families, years, futureYear };
}

// The year-or-status box: only these words, so a non-answer never passes.
const WHEN_ALLOWED = new Set([
  "current", "currently", "active", "valid", "renewed", "expires", "expiring", "expired", "lapsed", "in", "progress",
  "completed", "complete", "since", "until", "through", "due", "good", "got", "earned", "it", "on", "and", "still",
  "as", "of", "year", "january", "february", "march", "april", "may", "june", "july", "august", "september",
  "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov",
  "dec", "spring", "summer", "fall", "winter", "the", "back", "is", "to", "from",
]);

/**
 * True when the year-or-status box holds exactly one real status, maybe with
 * a year: current/active, expired/lapsed, in progress, or completed. A year
 * alone is fine. No contradictions, no future year (unless it is when it
 * expires), and nothing that is not a status.
 */
export function isStrictCredentialWhen(when: string, now = new Date()): boolean {
  const t = (when || "").toLowerCase().trim();
  if (!t) return false;
  for (const tok of t.match(/[a-z]+|\d+/g) ?? []) {
    if (/^\d+$/.test(tok)) {
      if (!/^(?:19[5-9]\d|20[0-4]\d)$/.test(tok)) return false;
      continue;
    }
    if (!WHEN_ALLOWED.has(tok)) return false;
  }
  const r = readStatus(t, now);
  if (r.futureYear) return false;
  if (r.families.size > 1) return false;
  // One status, with at most two years: one year, a range ("2019-2021",
  // "2019 to 2021"), or a year got or renewed plus when it expires
  // ("renewed 2024, expires 2027").
  if (r.years.length > 2) return false;
  if (r.years.length === 2) {
    const [a, b] = r.years;
    const range = /^\s*(?:from\s+)?(?:19|20)\d{2}\s*(?:-|to)\s*(?:19|20)\d{2}\s*$/.test(t.replace(/[\u2013\u2014]/g, "-"));
    const expiry = new RegExp(`\\b(?:expires|expiring|until|through|due)\\s*(?:in\\s+)?${b}\\b`).test(t);
    if (!(a <= b && a <= now.getFullYear() && (range ? b <= now.getFullYear() : expiry))) return false;
  }
  // "valid until 2019, current": an end date already past is not a live status.
  const endYear = t.match(/\b(?:until|through|expires|expiring|due)\s*(?:in\s+)?(19[5-9]\d|20[0-4]\d)\b/);
  if (endYear && Number(endYear[1]) < now.getFullYear() && r.families.has("live")) return false;
  if (r.families.size === 0 && r.years.length === 0) return false;
  // "through", "until", "due" need a year after them to mean anything.
  if (/\b(?:through|until|due)\b/.test(t) && r.years.length === 0) return false;
  return true;
}

/**
 * Round 5: no status is ever read from a free-text answer. A status on the
 * page comes only from the person's confirmation (the year-or-status box).
 * Kept so older callers still load; it never settles anything.
 */
export function answerGivesStatusFor(_answer: string, _pageContext: string, _now = new Date()): boolean {
  return false;
}

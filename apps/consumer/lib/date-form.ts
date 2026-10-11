/**
 * Dates stay in the form the person gave them (Phase 6, lane S2; Troy
 * 2026-10-11: "8/2021" stays "8/2021").
 *
 * A live writer run turned "8/2021 - 12/2022" into "2021 - 2022". The writer
 * prompt says not to; this is the deterministic backstop. On the job and
 * education lines of the written resume, a date range whose years match one
 * of the person's own ranges, and whose months are missing or the same months
 * in another form, is put back exactly as the person wrote it. A range whose
 * months differ from the person's is a changed date, not a form; it is left
 * for the checks that ask the person. Ambiguous matches (two of the person's
 * ranges with the same years) are left alone.
 *
 * Pure: no I/O.
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?`;
const ONE = String.raw`(?:(?:${MONTH}\s+|\d{1,2}\/(?:\d{1,2}\/)?)?(?:19|20)\d{2})`;
const END = String.raw`(?:${ONE}|Present|Current|Now)`;
const RANGE_RE = new RegExp(String.raw`(?<![\w/])(${ONE})\s*(?:[-\u2012-\u2015]|to)\s*(${END})(?![\w/])`, "gi");

interface DatePoint {
  year: string;
  month: number | null;
}

function point(s: string): DatePoint {
  const t = s.trim();
  if (/^(?:present|current|now)$/i.test(t)) return { year: "present", month: null };
  const year = (t.match(/(?:19|20)\d{2}/) ?? [""])[0];
  const num = t.match(/^(\d{1,2})\//);
  if (num) {
    const m = Number(num[1]);
    return { year, month: m >= 1 && m <= 12 ? m : null };
  }
  const name = t.match(/^([A-Za-z]{3})/);
  if (name) {
    const i = MONTHS.indexOf(name[1].toLowerCase());
    return { year, month: i >= 0 ? i + 1 : null };
  }
  return { year, month: null };
}

interface SourceRange {
  text: string;
  start: DatePoint;
  end: DatePoint;
}

function rangesIn(text: string): Array<SourceRange & { index: number; length: number }> {
  const out: Array<SourceRange & { index: number; length: number }> = [];
  for (const m of text.matchAll(new RegExp(RANGE_RE.source, "gi"))) {
    out.push({
      // The person's dates, with a plain spaced hyphen between them (no long dash on the page).
      text: `${m[1].trim()} - ${m[2].trim()}`,
      start: point(m[1]),
      end: point(m[2]),
      index: m.index ?? 0,
      length: m[0].length,
    });
  }
  return out;
}

const yearsKey = (r: { start: DatePoint; end: DatePoint }) => `${r.start.year}|${r.end.year}`;
const monthsAgree = (page: DatePoint, theirs: DatePoint) => page.month === null || page.month === theirs.month;

/** A job, school or date line: it carries "|" or is a date line by itself. Bullets and sentences are left alone. */
function isDatedHeader(line: string): boolean {
  const t = line.trim();
  if (!t || /^[-*\u2022]/.test(t)) return false;
  if (t.includes("|")) return true;
  return new RegExp(String.raw`^(?:[A-Za-z .'-]+,\s*[A-Za-z]{2,}\.?[,\s]+)?${ONE}\s*(?:[-\u2012-\u2015]|to)\s*${END}$`, "i").test(t);
}

// ---- which entry a range belongs to (review M2) ---------------------------------------
// A range is put back only on the written line of the SAME entry: the same title and
// employer, or the same school. Years alone never decide (two jobs in the same years).

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
const PLACE_PART_RE = /^[A-Za-z .'-]+,\s*[A-Za-z]{2,}\.?$/;

/** The names on an entry line: its "|" parts that are not dates or a "City, ST" place. */
function entryNames(line: string): string[] {
  const noDates = line.replace(new RegExp(RANGE_RE.source, "gi"), " ");
  return noDates
    .split("|")
    .map((p) => p.trim().replace(/^[-*\u2022]\s*/, ""))
    .filter((p) => /[A-Za-z]{2,}/.test(p) && !PLACE_PART_RE.test(p))
    .map(squash)
    .filter(Boolean);
}

/** Each line with the entry text it belongs to: itself, or for a dates-only line the line above it. */
function entryLines(text: string): Array<{ line: string; entry: string }> {
  const ls = text.split("\n");
  return ls.map((line, i) => {
    const t = line.trim();
    const datesOnly = !!t && !t.includes("|") && isDatedHeader(t);
    let above = "";
    if (datesOnly) for (let k = i - 1; k >= 0; k--) if (ls[k].trim()) { above = ls[k].trim(); break; }
    return { line, entry: datesOnly ? above : t };
  });
}

/**
 * Put the person's own date form back on the written resume's job and school
 * lines. Returns the text and how many ranges were put back.
 */
export function restoreDateForms(output: string, source: string): { text: string; restored: number } {
  if (!output || !source) return { text: output, restored: 0 };
  // Every dated entry of theirs: its names and its ranges (year-only ones too).
  const theirs: Array<{ names: string[]; range: SourceRange }> = [];
  for (const { line, entry } of entryLines(source)) {
    const names = entryNames(entry);
    for (const r of rangesIn(line)) theirs.push({ names, range: r });
  }
  if (!theirs.some((t) => t.range.start.month !== null || t.range.end.month !== null)) return { text: output, restored: 0 };
  let restored = 0;
  const lines = entryLines(output).map(({ line, entry }) => {
    if (!isDatedHeader(line)) return line;
    const names = entryNames(entry);
    if (!names.length) return line;
    let out = "";
    let last = 0;
    for (const r of rangesIn(line)) {
      out += line.slice(last, r.index);
      last = r.index + r.length;
      // Their entries with every one of this line's names, and the same years.
      const same = theirs.filter(
        (t) => t.names.length > 0 && names.every((n) => t.names.some((m) => m === n || m.includes(n) || n.includes(m))) && yearsKey(t.range) === yearsKey(r)
      );
      const forms = Array.from(new Set(same.map((t) => t.range.text)));
      const pick = forms.length === 1 ? same[0].range : null;
      if (pick && pick.text !== r.text && (pick.start.month !== null || pick.end.month !== null) && monthsAgree(r.start, pick.start) && monthsAgree(r.end, pick.end)) {
        out += pick.text;
        restored++;
      } else {
        out += line.slice(r.index, r.index + r.length);
      }
    }
    return out + line.slice(last);
  });
  return { text: lines.join("\n"), restored };
}

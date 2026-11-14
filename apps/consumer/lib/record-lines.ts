import { ES_RECORD_SOURCE } from "@crucible/core/src/recordLexicon";
/**
 * Record lines in a person's own resume text (Forge).
 *
 * Steel Man's default keeps the record off the page: the person brings it up in
 * person, at the right time. What changed (truth fix): the lines held back are no
 * longer deleted silently. The Forge output page lists exactly what was left off
 * and lets the person put it back as written (keepInsideLines), the same way Rush
 * keeps what the person wrote.
 */

// English and Spanish (Spanish version, 2026-11-12): a person's own words come in
// either language, and the record stays off the page in both. Unaccented
// spellings are listed too (people type "carcel" and "prision").
const RECORD_LINE_RE = new RegExp(String.raw`[^\n.]*\b(?:prison|jail|incarcerat(?:ed|ion)?|correctional|inmate|probation|parole|sentence[ds]?|conviction[s]?|convicted|detained|lockup|behind\s+bars|reentry|re-entry|justice[- ]involved|justice[- ]impacted|felon[y]?|c[a\u00e1]rcel|prisi[o\u00f3]n|encarcelad[oa]s?|encarcelamiento|correccional(?:es)?|penitenciar[i\u00ed]a[s]?|penal\s+(?:estatal|federal)|reclus[oa]s?|recluido|libertad\s+(?:condicional|vigilada|supervisada)|condenad[oa]s?|sentenciad[oa]s?|antecedentes\s+penales|reinserci[o\u00f3]n|delito\s+grave|${ES_RECORD_SOURCE})\b[^.\n]*`, "gi");
const RECORD_PHRASE_RE = /(?:during|while|following|after)\s+(?:a\s+)?(?:period\s+of\s+)?(?:incarceration|imprisonment|detention|confinement)[^.\n]*/gi;

// A line that starts a job, school or credential entry: it carries a year.
const ENTRY_HEADER_RE = /\b(?:19|20)\d{2}\b/;

export const hasRecordWords = (line: string) => {
  RECORD_LINE_RE.lastIndex = 0;
  RECORD_PHRASE_RE.lastIndex = 0;
  return RECORD_LINE_RE.test(line) || RECORD_PHRASE_RE.test(line);
};

/**
 * Hold back record lines, by ENTRY, not by line. When an entry's header names a
 * facility (or anything else on the record list), the whole entry goes: header
 * and every duty line under it. Removing only the header used to leave its duty
 * lines loose in the source, and the writer then attached them to a different
 * employer (found on a preview run: inside kitchen duties printed under a
 * restaurant job). Inside other entries, only the matching lines go.
 */
export function withholdRecordLines(text: string | undefined, keep: boolean): { kept: string; withheld: string[] } {
  const src = (text || "").replace(/\n{3,}/g, "\n\n").trim();
  if (keep || !src) return { kept: src, withheld: [] };

  // Group lines into entries: a blank line or a dated header starts a new one.
  const lines = src.split("\n");
  const entries: string[][] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (!line.trim() || (ENTRY_HEADER_RE.test(line) && cur.length)) {
      if (cur.length) entries.push(cur);
      cur = line.trim() ? [line] : [];
      if (!line.trim()) entries.push([""]);
      continue;
    }
    cur.push(line);
  }
  if (cur.length) entries.push(cur);

  const withheld: string[] = [];
  const keptLines: string[] = [];
  for (const entry of entries) {
    const head = entry[0];
    if (head && ENTRY_HEADER_RE.test(head) && hasRecordWords(head)) {
      const rest = entry.length - 1;
      withheld.push(rest > 0 ? `${head.trim()} (and the ${rest} ${rest === 1 ? "line" : "lines"} under it)` : head.trim());
      continue;
    }
    for (const line of entry) {
      if (line && hasRecordWords(line)) {
        const cleaned = line.replace(RECORD_PHRASE_RE, "").replace(RECORD_LINE_RE, "").trim();
        withheld.push(line.trim());
        if (cleaned && /[a-z]/i.test(cleaned)) keptLines.push(cleaned);
        continue;
      }
      keptLines.push(line);
    }
  }
  const kept = keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { kept, withheld: [...new Set(withheld)].slice(0, 20).map((w) => w.slice(0, 200)) };
}

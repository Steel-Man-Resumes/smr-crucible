/**
 * Record lines in a person's own resume text (Forge).
 *
 * Steel Man's default keeps the record off the page: the person brings it up in
 * person, at the right time. What changed (truth fix): the lines held back are no
 * longer deleted silently. The Forge output page lists exactly what was left off
 * and lets the person put it back as written (keepInsideLines), the same way Rush
 * keeps what the person wrote.
 */

const RECORD_LINE_RE = /[^\n.]*\b(?:prison|jail|incarcerat(?:ed|ion)?|correctional|inmate|probation|parole|sentence[ds]?|conviction[s]?|convicted|detained|lockup|behind\s+bars|reentry|re-entry|justice[- ]involved|justice[- ]impacted|felon[y]?)\b[^.\n]*/gi;
const RECORD_PHRASE_RE = /(?:during|while|following|after)\s+(?:a\s+)?(?:period\s+of\s+)?(?:incarceration|imprisonment|detention|confinement)[^.\n]*/gi;

export function withholdRecordLines(text: string | undefined, keep: boolean): { kept: string; withheld: string[] } {
  const src = (text || "").replace(/\n{3,}/g, "\n\n").trim();
  if (keep || !src) return { kept: src, withheld: [] };
  const withheld: string[] = [];
  const grab = (m: string) => {
    const t = m.trim();
    if (t && !withheld.includes(t)) withheld.push(t);
    return "";
  };
  const kept = src
    .replace(RECORD_PHRASE_RE, grab)
    .replace(RECORD_LINE_RE, grab)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { kept, withheld: withheld.slice(0, 20).map((w) => w.slice(0, 200)) };
}

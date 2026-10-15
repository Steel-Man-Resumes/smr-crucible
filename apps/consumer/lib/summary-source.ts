/**
 * The parsed summary is kept only when it really appears in the uploaded text.
 * The parser is told to copy it word for word; this is the check that it did.
 * Whitespace and letter case are ignored, nothing else.
 */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function summaryInSource(summary: unknown, source: string | undefined): summary is string {
  if (typeof summary !== "string" || !summary.trim() || !source) return false;
  return norm(source).includes(norm(summary));
}

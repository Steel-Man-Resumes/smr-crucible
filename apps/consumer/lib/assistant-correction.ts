/** Exact, bounded replacement. No guessed matches or whole-document rewrite. */
export function applyExactCorrection(text: string, before: unknown, after: unknown): string | null {
  if (typeof before !== "string" || typeof after !== "string" || !before || before.length > 2000 || after.length > 2000 || before === after) return null;
  if (text.split(before).length !== 2) return null;
  const next = text.replace(before, () => after);
  return next.trim() ? next : null;
}

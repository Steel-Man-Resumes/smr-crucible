/**
 * A tablet intake that skipped a question sends an empty list. That is not the
 * person taking an answer back, so the import passes undefined and the saved
 * account value is kept (saveForgeSession clears only on an explicit empty).
 */
export function nonEmptyList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return items.length > 0 ? items : undefined;
}

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

/**
 * Wrong-PIN tries allowed per tablet code per day at the import confirm step
 * (shared-computer review, Mini Forge path 5). A 4-digit PIN has 10,000
 * values; five tries a day keeps guessing pointless.
 */
export const MINI_FORGE_PIN_TRIES = 5;
export const MINI_FORGE_PIN_ENDPOINT = "mini-forge-pin";

/**
 * Postgres needs a timestamp it can parse. The Neon driver hands created_at
 * back as a Date, and Date#toString() is rejected with 22007. ISO 8601 is what
 * the other saveForgeSession caller sends. Unparseable -> undefined -> now.
 */
export function toIsoTimestamp(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

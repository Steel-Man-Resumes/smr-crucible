/**
 * The pure half of the quiet threshold: safe for the browser and for prompt
 * builders, with no database import.
 */
export const DEFAULT_QUIET_AFTER_DAYS = 14;

/**
 * "two weeks" when it is two weeks, so the staff assistant's prompt and checker
 * read EXACTLY as they did when they were tuned against production; "N days" otherwise.
 */
export function quietSpan(days: number): string {
  return days === 14 ? "two weeks" : days === 7 ? "a week" : `${days} days`;
}

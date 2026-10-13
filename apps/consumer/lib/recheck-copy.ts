/**
 * The re-check words (Phase 5 R1, review r3 M-1). Client-safe: the finish
 * page, the Refinery and the server's open item all read them from here.
 */

/** The server's open item when a version's writer's receipt is missing or not accepted. */
export const RECEIPT_OPEN_ITEM =
  "Fix before you send: we need to re-check this version before it can be finished. Open it on the finish page and tap Check it again.";

/** The badge and card copy. */
export const RECHECK_LINE = "We need to re-check this version before it can be finished.";

/** Where the Refinery (and R2's "Check and finish") sends the person: the finish page, which runs the check. */
export const RECHECK_HREF = "/output?from=refinery&check=1";

/** True when a version's open items include the re-check item. */
export function needsRecheck(openItems: unknown): boolean {
  return Array.isArray(openItems) && openItems.some((i) => typeof i === "string" && (i.startsWith("Fix before you send: we need to re-check this version") || i.startsWith("Fix before you send: run the truth check again")));
}

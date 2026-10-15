/**
 * Client-safe half of lib/email-package-auto.ts: the result shape and the one
 * line the finish page shows ("We sent it to you@example.com.").
 */

export type AutoResult =
  | { sent: true; to: string; revision?: number }
  | { sent: false; reason: "delivery_pending" | "delivery_unknown" | "no_resume" | "not_found" | "draft" | "off" | "unproven" | "no_address" | "not_configured" | "already" | "already_today" | "settling" | "limit" | "failed"; to?: string; retryInMs?: number };

/** Results a retry can fix (the page shows a Try again button). */
export function autoResultRetryable(r: AutoResult | null): boolean {
  return !!r && !r.sent && (r.reason === "failed" || r.reason === "not_configured" || r.reason === "not_found");
}

/** No real proof of the address on record yet: offered, never sent (security review 3a Part 2 r1, M2). */
export const UNPROVEN_LINE = "Want it by email? Confirm your address first.";

/** The one line the finish page shows. */
export function autoResultLine(r: AutoResult | null): string | null {
  if (!r) return null;
  if (r.sent) return `We sent it to ${r.to}.`;
  if (r.reason === "already") return r.to ? `We sent it to ${r.to}.` : "We already emailed you this resume.";
  if (r.reason === "already_today") return "We already emailed this resume today. Your download is right here.";
  if (r.reason === "delivery_pending") return "Your package delivery is being checked. Try again shortly.";
  if (r.reason === "delivery_unknown") return "Delivery could not be confirmed. Check your inbox or download your files here.";
  if (r.reason === "settling") return "Your finished package is queued. You can close this page; delivery will be retried if needed.";
  if (r.reason === "unproven") return UNPROVEN_LINE;
  if (r.reason === "limit") return "Your address already got its package today. Your download is right here.";
  if (r.reason === "failed") return "We couldn't email it just now. Your download is right here.";
  if (r.reason === "not_configured") return "Email isn't working here right now. Your download is right here.";
  // Phase 5 R1 (review A5): a server draft is said, never left blank.
  if (r.reason === "draft") return "Not emailed yet: our check says this version still has something to fix. Your list is on this page.";
  if (r.reason === "not_found") return "We couldn't find this version in your account yet. Your download is right here.";
  return null;
}

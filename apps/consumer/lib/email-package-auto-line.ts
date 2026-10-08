/**
 * Client-safe half of lib/email-package-auto.ts: the result shape and the one
 * line the finish page shows ("We sent it to you@example.com.").
 */

export type AutoResult =
  | { sent: true; to: string }
  | { sent: false; reason: "no_resume" | "draft" | "off" | "unproven" | "no_address" | "not_configured" | "already" | "limit" | "failed"; to?: string };

/** The one line the finish page shows. */
export function autoResultLine(r: AutoResult | null): string | null {
  if (!r) return null;
  if (r.sent) return `We sent it to ${r.to}.`;
  if (r.reason === "already") return r.to ? `We sent it to ${r.to}.` : "We already emailed you this resume.";
  if (r.reason === "unproven") return "We'll email your finished resume once your email address is confirmed. Sign in with an email link once to confirm it.";
  if (r.reason === "limit") return "Your address already got its package today. Your download is right here.";
  if (r.reason === "failed") return "We couldn't email it just now. Your download is right here.";
  if (r.reason === "not_configured") return "Email isn't working here right now. Your download is right here.";
  return null;
}

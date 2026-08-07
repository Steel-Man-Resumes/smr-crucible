/**
 * GA4 -- thin acquisition tracking for the Forge/Refinery (Troy approved 2026-08-07).
 *
 * DELIBERATELY THIN: justice-impacted users type sensitive narrative in this app,
 * so NO deep product events ever go to Google. Only three acquisition-attribution
 * events fire: forge_started, forge_completed, refinery_signup. Everything else
 * stays out of Google's hands.
 *
 * Property: Steel Man Resumes (549068234), measurement G-0FFVQ6SQ0L. Forge/refinery
 * are subdomains of steelmanresumes.com and roll into that ONE property, segmented by
 * hostname -- do not create a new property. Measurement IDs are public by design, so
 * the id is a safe hardcoded fallback; NEXT_PUBLIC_GA_ID overrides it (e.g. to silence
 * GA on preview deploys). Excluded from /mini-forge/* by AnalyticsWrapper.
 */

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || "G-0FFVQ6SQ0L";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/** Fire a GA4 event if gtag is loaded. No-op server-side or before load. */
export function trackGA(name: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  if (typeof window.gtag !== "function") return;
  window.gtag("event", name, params || {});
}

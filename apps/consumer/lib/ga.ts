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

import { isAnalyticsExcluded } from "./analytics-exclusions";

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || "G-0FFVQ6SQ0L";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/** Preview and development traffic must not enter production acquisition data. */
export function isProductionAnalyticsHost(hostname: string): boolean {
  return hostname === "forge.steelmanresumes.com" || hostname === "refinery.steelmanresumes.com";
}

/** True means queued to gtag, not delivered or accepted by Google. */
export function trackGA(name: string, params?: Record<string, unknown>): boolean {
  if (typeof window === "undefined") return false;
  if (!isProductionAnalyticsHost(window.location.hostname)) return false;
  if (isAnalyticsExcluded(window.location.pathname)) return false;
  if ((window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]) return false;
  if (typeof window.gtag !== "function") return false;
  window.gtag("event", name, params || {});
  return true;
}

/** Mark only after queueing. A missing tag can be retried when its script is ready. */
export function trackAcquisitionOnce(
  name: "forge_started" | "forge_completed",
  params: Record<string, unknown>,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const key = `ga_${name}`;
    if (window.sessionStorage.getItem(key)) return false;
    if (!trackGA(name, params)) return false;
    window.sessionStorage.setItem(key, "1");
    return true;
  } catch {
    // Storage can be unavailable. Never break the participant's page.
    return false;
  }
}

"use client";

/**
 * Conditional analytics -- skips /mini-forge/* routes per tablet spec
 * ("No third-party scripts"), skips sensitive practice/storage routes
 * (disclosure, interview, vault, documents) until per-user analytics consent
 * exists, and skips /access, whose URL carries a partner code and the
 * invited person's name. Covers all three trackers: Vercel Analytics, Speed
 * Insights, GA4.
 *
 * Unmounting is not enough on its own. Once gtag has loaded, GA4's enhanced
 * measurement records a page view on every in-app (history) navigation,
 * including to an excluded page, and Speed Insights keeps reporting from the
 * open tab. So:
 *  - GA's documented opt-out flag (`ga-disable-<id>`) is set during render,
 *    which in the App Router happens before the URL changes, so the history
 *    page view for an excluded page is never sent;
 *  - Vercel beforeSend drops events for excluded paths and strips every query
 *    string, so codes or names in a URL never leave the browser.
 */

import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { GoogleAnalytics } from "./GoogleAnalytics";
import { GA_ID } from "@/lib/ga";

const EXCLUDED_PREFIXES = [
  "/mini-forge",
  "/dashboard/disclosure",
  "/dashboard/interview",
  "/dashboard/vault",
  "/dashboard/documents",
  "/access",
];

export function isAnalyticsExcluded(pathname: string): boolean {
  return EXCLUDED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?")
  );
}

/** Vercel beforeSend: drop excluded pages, never send a query string. */
export function scrubVercelEvent<T extends { url: string }>(event: T): T | null {
  try {
    const u = new URL(event.url);
    if (isAnalyticsExcluded(u.pathname)) return null;
    u.search = "";
    u.hash = "";
    return { ...event, url: u.toString() };
  } catch {
    return null;
  }
}

function setGaDisabled(disabled: boolean) {
  if (typeof window === "undefined" || !GA_ID) return;
  (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = disabled;
}

export function AnalyticsWrapper() {
  const pathname = usePathname() || "";
  const excluded = isAnalyticsExcluded(pathname);
  // Deliberately during render, not in an effect: effects run after the
  // router has already pushed the new URL, which is when GA sends.
  setGaDisabled(excluded);
  if (excluded) return null;
  return (
    <>
      <Analytics beforeSend={scrubVercelEvent} />
      <SpeedInsights beforeSend={scrubVercelEvent} />
      <GoogleAnalytics />
    </>
  );
}

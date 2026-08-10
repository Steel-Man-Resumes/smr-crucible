"use client";

/**
 * Conditional analytics -- skips /mini-forge/* routes per tablet spec
 * ("No third-party scripts"), and skips sensitive practice/storage routes
 * (disclosure, interview, vault) until per-user analytics consent exists.
 * Covers all three trackers: Vercel Analytics, Speed Insights, GA4.
 */

import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { GoogleAnalytics } from "./GoogleAnalytics";

const EXCLUDED_PREFIXES = [
  "/mini-forge",
  "/dashboard/disclosure",
  "/dashboard/interview",
  "/dashboard/vault",
];

export function AnalyticsWrapper() {
  const pathname = usePathname();
  if (EXCLUDED_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  return (
    <>
      <Analytics />
      <SpeedInsights />
      <GoogleAnalytics />
    </>
  );
}

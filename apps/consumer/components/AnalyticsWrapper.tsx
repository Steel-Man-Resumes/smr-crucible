"use client";

/**
 * Conditional analytics -- skips /mini-forge/* routes per tablet spec
 * ("No third-party scripts").
 */

import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

export function AnalyticsWrapper() {
  const pathname = usePathname();
  if (pathname.startsWith("/mini-forge")) return null;
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}

"use client";

/**
 * GoogleAnalytics -- loads the gtag base and fires the two pathname-driven
 * acquisition events. The third (refinery_signup) fires from the register
 * success handler. Mounted inside AnalyticsWrapper, so it inherits the
 * /mini-forge/* exclusion automatically. See lib/ga.ts for the doctrine.
 */

import Script from "next/script";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { GA_ID, isProductionAnalyticsHost, trackAcquisitionOnce } from "@/lib/ga";

// Forge-flow routes (route group (forge) adds nothing to the URL). /output is
// handled separately as the completion event; /mini-forge is excluded upstream.
const FORGE_ROUTES = [
  "/intro", "/start", "/welcome", "/resume", "/goals", "/story",
  "/preferences", "/processing", "/overview", "/rush",
];

export function GoogleAnalytics() {
  const pathname = usePathname();

  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setEnabled(isProductionAnalyticsHost(window.location.hostname));
  }, []);

  useEffect(() => {
    if (!enabled || !ready || !pathname) return;
    if (pathname === "/output") {
      trackAcquisitionOnce("forge_completed", { page_slug: "output" });
      return;
    }
    const entry = FORGE_ROUTES.find((r) => pathname === r || pathname.startsWith(r + "/"));
    if (entry) {
      // Only the known route name, never a dynamic path segment or user input.
      trackAcquisitionOnce("forge_started", { entry: entry.slice(1) });
    }
  }, [pathname, enabled, ready]);

  if (!GA_ID || !enabled) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive" onReady={() => setReady(true)}>
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
      </Script>
    </>
  );
}

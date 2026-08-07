"use client";

/**
 * GoogleAnalytics -- loads the gtag base and fires the two pathname-driven
 * acquisition events. The third (refinery_signup) fires from the register
 * success handler. Mounted inside AnalyticsWrapper, so it inherits the
 * /mini-forge/* exclusion automatically. See lib/ga.ts for the doctrine.
 */

import Script from "next/script";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { GA_ID, trackGA } from "@/lib/ga";

// Forge-flow routes (route group (forge) adds nothing to the URL). /output is
// handled separately as the completion event; /mini-forge is excluded upstream.
const FORGE_ROUTES = [
  "/intro", "/welcome", "/resume", "/goals", "/story",
  "/preferences", "/processing", "/overview", "/rush",
];

export function GoogleAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    try {
      if (pathname === "/output") {
        if (!sessionStorage.getItem("ga_forge_completed")) {
          sessionStorage.setItem("ga_forge_completed", "1");
          trackGA("forge_completed", { page_slug: "output" });
        }
        return;
      }
      if (FORGE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"))) {
        if (!sessionStorage.getItem("ga_forge_started")) {
          sessionStorage.setItem("ga_forge_started", "1");
          trackGA("forge_started", { entry: pathname.replace(/^\//, "") });
        }
      }
    } catch {
      // sessionStorage can throw in locked-down browsers -- never break the page.
    }
  }, [pathname]);

  if (!GA_ID) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
      </Script>
    </>
  );
}

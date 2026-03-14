"use client";

/**
 * Tour Layout
 *
 * Wraps the tour with TourProvider + TourOverlay.
 * Loads demo data into Forge session so real pages show Jordan's data.
 */

import { useEffect, useState, type ReactNode } from "react";
import { TourProvider } from "@/components/tour/TourProvider";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { DEMO_SESSION, DEMO_OUTPUT } from "@/lib/demo-data";

export default function TourLayout({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  // Load demo data into localStorage so real pages render Jordan's data
  useEffect(() => {
    try {
      const demoSession = {
        ...DEMO_SESSION,
        forgeOutput: DEMO_OUTPUT,
        isDemo: true,
        _synced: true, // Prevent DB sync
      };
      localStorage.setItem("forge_session", JSON.stringify(demoSession));
      localStorage.setItem("forge_audience", "partner");
    } catch {}
    setReady(true);
  }, []);

  if (!ready) return null;

  return (
    <TourProvider>
      {children}
      <TourOverlay />
    </TourProvider>
  );
}

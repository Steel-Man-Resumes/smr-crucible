"use client";

/**
 * Tour Entry Point
 *
 * Sets tour flag in localStorage, loads demo data,
 * then either shows the landing page or navigates to stop 1.
 */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { DEMO_SESSION, DEMO_OUTPUT } from "@/lib/demo-data";
import { TOUR_STOPS } from "@/lib/tour-stops";

export default function TourEntryPage() {
  const router = useRouter();

  const startTour = useCallback(() => {
    // Load demo data so real pages render with Jordan's data
    try {
      const demoSession = {
        ...DEMO_SESSION,
        forgeOutput: DEMO_OUTPUT,
        isDemo: true,
        _synced: true,
      };
      localStorage.setItem("forge_session", JSON.stringify(demoSession));
      localStorage.setItem("forge_audience", "partner");
    } catch {}

    // Activate tour
    localStorage.setItem("tour_active", "true");
    localStorage.setItem("tour_index", "0");

    // Navigate to first stop
    router.push(TOUR_STOPS[0].page);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fdf8f0] px-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#2c2418] mb-2">
            Steel Man Resumes
          </h1>
          <p className="text-sm text-[#8c7e6e]">Interactive Product Tour</p>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-[#e0cebc] mb-6 text-left">
          <h2 className="font-bold text-[#2c2418] mb-4">
            What you&apos;ll see
          </h2>
          <div className="space-y-3">
            <TourSection
              label="The Forge"
              description="Free career analysis. 6 steps. AI finds skills, matches careers, connects to resources."
              steps="6 stops"
            />
            <TourSection
              label="The Refinery"
              description="8 tools for the long game. Resume builder, job board, disclosure planner, interview practice, and more."
              steps="8 stops"
            />
          </div>
        </div>

        <div className="bg-[#f4f7f4] rounded-xl px-4 py-3 border border-[#c2d1c0] mb-6 text-left">
          <p className="text-xs text-[#557553] leading-relaxed">
            <span className="font-medium">Controls:</span> Arrow keys or
            buttons to navigate. Press E to explore freely at any stop.
            M to minimize the guide. Esc to exit.
          </p>
        </div>

        <button
          onClick={startTour}
          className="w-full px-6 py-4 bg-[#557553] text-white rounded-xl font-medium text-lg hover:bg-[#668564] transition-colors"
        >
          Start the Tour
        </button>

        <p className="text-xs text-[#8c7e6e] mt-4">
          Takes about 5 minutes. Uses sample data — nothing is saved.
        </p>
      </div>
    </div>
  );
}

function TourSection({
  label,
  description,
  steps,
}: {
  label: string;
  description: string;
  steps: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="w-1 rounded-full bg-[#557553] flex-shrink-0" />
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-[#2c2418]">{label}</span>
          <span className="text-[10px] text-[#8c7e6e]">{steps}</span>
        </div>
        <p className="text-xs text-[#8c7e6e] leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

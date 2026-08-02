"use client";

import { usePathname } from "next/navigation";
import type { OnboardingState } from "@/lib/useOnboarding";

const SKIP_PREFIXES = ["/dashboard/settings", "/dashboard/admin", "/dashboard/partner"];

const STAGES: Record<string, { progress: number; activeStep: number; next: string }> = {
  needs_profile: {
    progress: 25,
    activeStep: 1,
    next: "Complete your profile to unlock the full Refinery.",
  },
  needs_resume: {
    progress: 50,
    activeStep: 2,
    next: "Find a job and build your targeted resume to unlock all tools.",
  },
  full_access: {
    progress: 75,
    activeStep: 3,
    next: "Practice your disclosure and interview prep -- every rep builds confidence.",
  },
};

const STEP_LABELS = ["Forge", "Profile", "Resume", "Practice"];

interface Props {
  state: OnboardingState;
}

export function JourneyProgressBanner({ state }: Props) {
  const pathname = usePathname();

  if (state === "loading") return null;
  if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  const stage = STAGES[state];
  if (!stage) return null;

  return (
    <div className="mb-6 bg-t-panel border border-t-line px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold text-t-phos-dim uppercasest">
          Your Refinery Journey
        </span>
        <span className="text-xs font-semibold text-t-amber-bright">
          {stage.progress}% complete
        </span>
      </div>

      {/* Bar */}
      <div className="h-1.5 bg-t-line overflow-hidden mb-3">
        <div
          className="h-full bg-t-amber transition-all duration-700"
          style={{ width: `${stage.progress}%` }}
        />
      </div>

      {/* Steps */}
      <div className="flex justify-between mb-2 px-1">
        {STEP_LABELS.map((label, i) => {
          const done = i < stage.activeStep;
          const active = i === stage.activeStep;
          return (
            <div key={label} className="flex flex-col items-center gap-0.5 flex-1">
              <div
                className={`w-5 h-5 border text-[9px] font-bold flex items-center justify-center transition-colors ${
                  done
                    ? "bg-t-amber border-t-amber text-white"
                    : active
                      ? "bg-t-panel-2 border-t-amber text-t-amber-bright"
                      : "bg-t-panel border-t-line text-t-bone-dim"
                }`}
              >
                {done ? (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path
                      d="M1 3.5l2.5 2.5L8 1"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-[9px] text-center leading-tight ${
                  done
                    ? "text-t-amber-bright font-medium"
                    : active
                      ? "text-t-white font-semibold"
                      : "text-t-bone-dim"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <p className="font-body text-[11px] text-t-bone-dim text-center">{stage.next}</p>
    </div>
  );
}

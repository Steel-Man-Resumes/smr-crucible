"use client";

/**
 * JourneyProgressBanner -- one quiet line on the tool pages that says which of
 * the six steps you are on and what comes next.
 *
 * It uses the same step names and the same next-step engine as the dashboard
 * (StageProgressBar + NextStepCard), so the two never disagree. The old version
 * had its own percent bar and its own four step names ("Forge, Profile, Resume,
 * Practice"), which read as a second, different answer. The dashboard home does
 * not show this line: it already has the full step list and the next-step card.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { OnboardingState } from "@/lib/useOnboarding";
import { useUserTier } from "@/lib/useUserTier";
import { NEXT_STEP_CHANGED_EVENT } from "@/lib/guidedTour";
import {
  JOURNEY_STAGES,
  JOURNEY_STEP_COUNT,
  arcStageForNextStep,
  stepPositionLabel,
} from "@crucible/core/src/journeyStages";

const SKIP_PREFIXES = ["/dashboard/settings", "/dashboard/admin", "/dashboard/partner"];

interface NextStepLite {
  stage: number;
  action: string;
  href: string;
  reason?: string;
}

interface Props {
  state: OnboardingState;
}

export function JourneyProgressBanner({ state }: Props) {
  const pathname = usePathname();
  const tier = useUserTier();
  const [next, setNext] = useState<NextStepLite | null>(null);

  const hidden =
    state === "loading" ||
    tier !== "client" ||
    pathname === "/dashboard" ||
    SKIP_PREFIXES.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (hidden || state === "needs_profile") return;
    let cancelled = false;
    function load() {
      fetch("/api/next-step", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!cancelled && j?.data) setNext(j.data as NextStepLite);
        })
        .catch(() => {});
    }
    load();
    window.addEventListener(NEXT_STEP_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(NEXT_STEP_CHANGED_EVENT, load);
    };
  }, [hidden, state, pathname]);

  if (hidden) return null;

  // Profile not saved yet: nothing else is open, so say that plainly.
  if (state === "needs_profile") {
    return (
      <Strip
        position="Before step 1"
        label="Save your profile"
        href="/dashboard"
        cta="Finish your profile"
      />
    );
  }

  if (!next) return null;

  const arc = next.stage === 0 ? 0 : arcStageForNextStep(next);
  const inArc = arc >= 1 && arc <= JOURNEY_STEP_COUNT;
  return (
    <Strip
      position={stepPositionLabel(arc)}
      label={inArc ? JOURNEY_STAGES[arc].short : next.action}
      href={next.href}
      cta={next.action}
    />
  );
}

function Strip({
  position,
  label,
  href,
  cta,
}: {
  position: string;
  label: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2 border border-t-line bg-t-panel px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-t-white">
        <span className="font-term text-[11px] font-semibold uppercase text-t-bone-dim">
          {position}
        </span>
        <span className="ml-2 font-semibold">{label}</span>
      </p>
      <Link
        href={href}
        className="t-focus inline-flex items-center text-sm font-semibold text-t-amber-bright hover:underline"
      >
        {cta === label ? "Go to this step" : `Next: ${cta}`}
      </Link>
    </div>
  );
}

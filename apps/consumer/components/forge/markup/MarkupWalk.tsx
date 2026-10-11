"use client";

/**
 * While the writer works on the finish page: the person's own page with
 * t.ROY walking it top to bottom, marking each weak line with one plain line
 * of why (the same walk as "Building your story", lib/showstopper-tour.ts).
 * The marks come from checks run in this browser on the text the person gave;
 * nothing is sent anywhere for them.
 */

import type { ResumeTour } from "@/lib/showstopper-tour";
import { OldPageTour } from "@/components/forge/showstopper/OldPageTour";
import { TroyArrival } from "@/components/forge/showstopper/TroyArrival";

export function MarkupWalk({ tour, reduced }: { tour: ResumeTour; reduced: boolean | null }) {
  const intro = tour.steps.length
    ? "While I write your new page, here's what I'm fixing on this one, top to bottom."
    : "I read your page top to bottom while I write.";
  return (
    <div className="mt-6 border border-t-line bg-t-panel p-4 sm:p-6" data-testid="markup-walk">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-8 lg:gap-y-5">
        <div className="flex items-center gap-3 lg:col-start-2 lg:row-start-1 lg:items-start">
          <TroyArrival size={48} reduced={reduced} />
          <div className="lg:pt-3">
            <p className="text-base leading-relaxed text-t-white">
              <span className="sr-only">t.ROY says: </span>
              {intro}
            </p>
            <p className="mt-1 flex items-center gap-2 text-xs text-t-phos-dim" role="status">
              <span aria-hidden="true" className={`inline-block h-2 w-2 bg-t-amber ${reduced === false ? "animate-pulse" : ""}`} />
              Writing your new page now.
            </p>
          </div>
        </div>
        <OldPageTour tour={tour} reduced={reduced} />
      </div>
    </div>
  );
}

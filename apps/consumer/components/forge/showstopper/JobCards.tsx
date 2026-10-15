"use client";

/**
 * No page was brought in (the person typed their jobs), so there is no
 * "before" to mark up. Show the jobs they entered, as they entered them.
 */

import type { JobCard } from "@/lib/showstopper-tour";

export function JobCards({ jobs }: { jobs: JobCard[] }) {
  return (
    <section aria-label="The jobs you gave me" className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
      <h2 className="mb-2 font-term text-xs uppercase tracking-wider text-t-amber-bright">The jobs you gave me</h2>
      <ul className="space-y-2">
        {jobs.map((j, i) => (
          <li key={i} className="border border-t-line bg-t-panel px-4 py-3">
            <p className="text-base font-semibold text-t-white">{j.title || j.company}</p>
            {j.title && j.company && <p className="text-sm text-t-bone-dim">{j.company}</p>}
            <p className="mt-1 font-term text-xs text-t-bone-dim">{j.dates || "No dates given yet"}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

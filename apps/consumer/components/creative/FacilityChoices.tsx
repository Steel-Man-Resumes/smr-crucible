"use client";

/**
 * This lane's choice for each entry whose title or place names a facility:
 * the true title, just the venue, or leave it off. ONE choice per entry per
 * lane, read by every page on the lane (artist resume, bio, work samples,
 * plain text). A work has no venue, so a work offers the true title or leave
 * it off. Nothing is ever renamed or softened.
 */

import { TITLE_MODES, yearsOf, type PracticeEntry, type TitleMode } from "@crucible/core/src/practiceRecordShared";
import type { CreativeKindSettings } from "@crucible/core/src/creativeLaneShared";
import { TITLE_MODE_COPY, TITLE_MODE_WHY } from "@/lib/creative";

export function FacilityChoices({
  entries,
  settings,
  onSettings,
  only,
}: {
  entries: PracticeEntry[];
  settings: CreativeKindSettings;
  onSettings: (patch: Partial<CreativeKindSettings>) => Promise<boolean>;
  /** Limit to works ("works") or everything but works ("pages"). */
  only?: "works" | "pages";
}) {
  const facility = entries.filter((e) => e.names_facility && (only === "works" ? e.section === "work" : only === "pages" ? e.section !== "work" : true));
  if (!facility.length) return null;
  return (
    <section className="border border-t-line bg-t-panel p-4 space-y-3" data-testid="title-modes">
      <h3 className="text-sm font-semibold uppercase text-t-phos">On this lane</h3>
      <p className="text-sm text-t-phos-dim">{TITLE_MODE_WHY}</p>
      {facility.map((e) => {
        const cur = settings.titleModes?.[e.id];
        const modes: TitleMode[] = e.section === "work" ? ["true_title", "leave_out"] : [...TITLE_MODES];
        return (
          <fieldset key={e.id} className="border border-t-line p-3">
            <legend className="px-1 text-sm text-t-white">
              <span className="font-mono text-xs text-t-phos mr-2">{yearsOf(e)}</span>
              {e.title}
            </legend>
            <div className={`grid gap-2 ${modes.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              {modes.map((m) => (
                <label key={m} className={`flex gap-2 border p-2 cursor-pointer ${cur === m ? "border-t-amber" : "border-t-line"}`}>
                  <input
                    type="radio"
                    name={`mode-${e.id}`}
                    value={m}
                    checked={cur === m}
                    data-testid={`title-mode-${m}`}
                    onChange={() => onSettings({ titleModes: { ...(settings.titleModes ?? {}), [e.id]: m } })}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-t-white">{TITLE_MODE_COPY[m].label}</span>
                    <span className="block text-xs text-t-phos-dim">{TITLE_MODE_COPY[m].body}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      <p className="text-xs text-t-phos-dim">One choice per entry. Every page on this lane follows it.</p>
    </section>
  );
}

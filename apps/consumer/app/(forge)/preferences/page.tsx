"use client";

/**
 * Page 5: Work Preferences
 *
 * Contextual to all prior input (resume data, goals, story).
 * Only shows relevant options. Not a generic checklist.
 * Adapts based on location, barriers, goals.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useForgeSession } from "@/lib/forge-context";
import { DEMO_SESSION } from "@/lib/demo-data";
import { getOpusMessage } from "@/lib/opus-messages";
import { FlowPage, GhostGuide } from "@crucible/consumer-ui";
import ForgeAccumulator from "@/components/ForgeAccumulator";
import {
  HOURS_OPTIONS,
  SHIFT_OPTIONS,
  ENVIRONMENT_OPTIONS,
  TRANSPORT_OPTIONS,
  DISTANCE_OPTIONS,
  type PrefOption,
  migratePreferences,
  readSchedule,
  readCommute,
  splitPref,
  togglePreference,
  writeSchedule,
  writeEnvironment,
  writeCommute,
} from "@/lib/forge-preferences";

const idsOf = (opts: PrefOption[]) => opts.map((o) => o.id);

/**
 * A wrapping row of tap targets. Finer choices (8 environments, 4 shifts, 5
 * ways to get to work) would make a tall stack of full-width cards on a phone,
 * so these sit side by side and wrap. Same selected look as the other Forge
 * option cards.
 */
function ChoiceChips({
  label,
  options,
  selected,
  onToggle,
  disabled,
}: {
  label: string;
  options: PrefOption[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onToggle(o.id)}
            className={`t-focus min-h-touch rounded-[6px] border px-4 py-2 text-left text-base transition-all ${
              on
                ? "border-[#4f6b57] bg-[#e3ede5] font-medium text-t-white"
                : "border-t-line bg-t-panel text-t-white hover:border-t-line-strong hover:bg-t-panel-2"
            } ${disabled ? "cursor-default" : ""}`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[3px] border ${
                  on ? "border-[#4f6b57] bg-[#4f6b57]" : "border-t-line-strong bg-white"
                }`}
              >
                {on && <Check size={13} strokeWidth={2.4} className="text-white" aria-hidden="true" />}
              </span>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Question({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-1 font-medium text-t-white">{title}</h3>
      {hint && <p className="mb-3 text-sm text-t-phos-dim">{hint}</p>}
      {!hint && <div className="mb-2" />}
      {children}
    </div>
  );
}

export default function PreferencesPage() {
  const router = useRouter();
  const { session, updateSession } = useForgeSession();
  const isDemo = session.isDemo === true;
  const audience = session.audience || "client";

  // Track page visit
  useEffect(() => {
    updateSession({
      pagesVisited: Array.from(new Set([...(session.pagesVisited || []), "preferences"])),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Every answer is stored as a comma-joined list of ids (lib/forge-preferences.ts).
  // Demo sample answers and any run saved before the current choices go through
  // the same migration the stored session does, so old ids still show as picked.
  const prefs = migratePreferences(isDemo ? DEMO_SESSION.preferences || {} : session.preferences || {});
  const initialSchedule = readSchedule(prefs.schedule);
  const initialCommute = readCommute(prefs.commute);
  const [hours, setHours] = useState<string[]>(initialSchedule.hours);
  const [shifts, setShifts] = useState<string[]>(initialSchedule.shifts);
  const [environment, setEnvironment] = useState<string[]>(splitPref(prefs.environment));
  const [modes, setModes] = useState<string[]>(initialCommute.modes);
  const [distance, setDistance] = useState<string | null>(initialCommute.distance);
  const [location, setLocation] = useState(prefs.location || "");

  function handleContinue() {
    if (isDemo) {
      updateSession({
        preferences: DEMO_SESSION.preferences,
        lastPageVisited: "preferences",
      });
    } else {
      updateSession({
        // Spread first: keys this page does not own (for example a work type
        // brought across from a facility tablet) must survive.
        preferences: {
          ...(session.preferences || {}),
          schedule: writeSchedule(hours, shifts),
          environment: writeEnvironment(environment),
          commute: writeCommute(modes, distance),
          location,
        },
        lastPageVisited: "preferences",
      });
    }
    router.push("/processing");
  }

  return (
    <FlowPage
      title="A few quick preferences"
      subtitle="This helps us find the right fit. You can change any of these later."
      actionLabel={isDemo ? "Next" : "Continue"}
      onAction={handleContinue}
      showBack
      onBack={() => router.push("/story")}
    >
      <GhostGuide
        message={getOpusMessage("preferences", audience, isDemo)}
        pageId="preferences"
      />

      {!isDemo && <ForgeAccumulator />}

      {isDemo && (
        <div className="bg-t-panel-2 px-4 py-3 mb-4 border border-t-amber">
          <p className="text-sm text-t-amber-bright font-medium">
            Demo mode: sample preferences pre-selected
          </p>
        </div>
      )}
      <div className="space-y-8">
        {/* Schedule: hours first, then the shifts that work. Both optional. */}
        <Question
          title="What schedule works for you?"
          hint="Pick every one that fits."
        >
          <div className="space-y-4">
            <ChoiceChips
              label="Hours"
              options={HOURS_OPTIONS}
              selected={hours}
              disabled={isDemo}
              onToggle={(id) =>
                setHours((prev) =>
                  togglePreference(prev, id, idsOf(HOURS_OPTIONS), { exclusive: ["any"] })
                )
              }
            />
            <div>
              <p className="mb-2 text-sm text-t-phos-dim">
                Any shifts you can or can&apos;t work? Skip this if it doesn&apos;t matter.
              </p>
              <ChoiceChips
                label="Shifts"
                options={SHIFT_OPTIONS}
                selected={shifts}
                disabled={isDemo}
                onToggle={(id) =>
                  setShifts((prev) => togglePreference(prev, id, idsOf(SHIFT_OPTIONS)))
                }
              />
            </div>
          </div>
        </Question>

        {/* Environment */}
        <Question
          title="Where and how do you want to work?"
          hint="Pick as many as fit. Skip it if you're open to anything."
        >
          <ChoiceChips
            label="Work environment"
            options={ENVIRONMENT_OPTIONS}
            selected={environment}
            disabled={isDemo}
            onToggle={(id) =>
              setEnvironment((prev) => togglePreference(prev, id, idsOf(ENVIRONMENT_OPTIONS)))
            }
          />
        </Question>

        {/* Getting to work: how, then how far. */}
        <Question
          title="How do you get to work, and how far can you go each day?"
          hint="Pick every way you can get there."
        >
          <div className="space-y-4">
            <ChoiceChips
              label="Ways to get to work"
              options={TRANSPORT_OPTIONS}
              selected={modes}
              disabled={isDemo}
              onToggle={(id) =>
                setModes((prev) => togglePreference(prev, id, idsOf(TRANSPORT_OPTIONS)))
              }
            />
            <div>
              <p className="mb-2 text-sm text-t-phos-dim">
                About how long can the trip be, one way?
              </p>
              <ChoiceChips
                label="One-way travel time"
                options={DISTANCE_OPTIONS}
                selected={distance ? [distance] : []}
                disabled={isDemo}
                onToggle={(id) =>
                  setDistance((prev) => (prev === id ? null : id))
                }
              />
            </div>
          </div>
        </Question>

        {/* Location. Seam for the city/state/ZIP picker (not built yet): swap this
            input for a picker that still writes the same "City, ST" string into
            `location`. The analyze route reads the state from the trailing ", ST". */}
        <div>
          <label
            htmlFor="location-input"
            className="font-medium text-t-white block mb-2"
          >
            Where are you located?{" "}
            <span className="font-normal text-t-phos-dim text-sm">(optional)</span>
          </label>
          <input
            id="location-input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g., Milwaukee, WI or just a zip code"
            className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
          />
        </div>
      </div>
    </FlowPage>
  );
}

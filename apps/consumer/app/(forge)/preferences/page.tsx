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
import { useForgeSession } from "@/lib/forge-context";
import { DEMO_SESSION } from "@/lib/demo-data";
import { getOpusMessage } from "@/lib/opus-messages";
import { FlowPage, CardSelect, GhostGuide } from "@crucible/consumer-ui";
import ForgeAccumulator from "@/components/ForgeAccumulator";

const SCHEDULE_OPTIONS = [
  { id: "full-time", label: "Full-time", description: "35+ hours per week" },
  { id: "part-time", label: "Part-time", description: "Under 35 hours" },
  {
    id: "flexible",
    label: "Flexible / gig work",
    description: "Set my own hours",
  },
  { id: "any", label: "Open to anything", description: "Whatever gets me started" },
];

const ENVIRONMENT_OPTIONS = [
  { id: "physical", label: "Physical / hands-on", description: "Warehouse, construction, trades" },
  { id: "office", label: "Office / desk work", description: "Computer, phones, admin" },
  { id: "people", label: "Working with people", description: "Retail, food service, healthcare" },
  { id: "remote", label: "Remote / from home", description: "If available" },
];

const COMMUTE_OPTIONS = [
  { id: "walk", label: "Walking distance" },
  { id: "bus", label: "Bus or public transit" },
  { id: "drive-short", label: "Short drive (under 30 min)" },
  { id: "drive-long", label: "Willing to commute further" },
];

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

  const demoPrefs = DEMO_SESSION.preferences || {};
  const prefs = isDemo ? demoPrefs : (session.preferences || {});
  // Multi-select: people are often open to more than one schedule/environment.
  // Stored as comma-joined strings to stay compatible with existing sessions.
  const splitPref = (v?: string) =>
    (v || "").split(", ").map((s) => s.trim()).filter(Boolean);
  const [schedule, setSchedule] = useState<string[]>(splitPref(prefs.schedule));
  const [environment, setEnvironment] = useState<string[]>(
    splitPref(prefs.environment)
  );
  const [commute, setCommute] = useState<string[]>(splitPref(prefs.commute));
  const [location, setLocation] = useState(prefs.location || "");

  const toggle =
    (setter: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) =>
      setter((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );

  function handleContinue() {
    if (isDemo) {
      updateSession({
        preferences: DEMO_SESSION.preferences,
        lastPageVisited: "preferences",
      });
    } else {
      updateSession({
        preferences: {
          schedule: schedule.join(", "),
          environment: environment.join(", "),
          commute: commute.join(", "),
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
            Demo mode — sample preferences pre-selected
          </p>
        </div>
      )}
      <div className="space-y-8">
        {/* Schedule */}
        <div>
          <h3 className="font-medium text-t-white mb-3">
            What schedule works for you?
          </h3>
          <CardSelect
            options={SCHEDULE_OPTIONS}
            selected={schedule}
            onSelect={isDemo ? () => {} : toggle(setSchedule)}
            multi
          />
        </div>

        {/* Environment */}
        <div>
          <h3 className="font-medium text-t-white mb-3">
            What kind of work environment?
          </h3>
          <CardSelect
            options={ENVIRONMENT_OPTIONS}
            selected={environment}
            onSelect={isDemo ? () => {} : toggle(setEnvironment)}
            multi
          />
        </div>

        {/* Commute */}
        <div>
          <h3 className="font-medium text-t-white mb-3">
            How far can you travel to work?
          </h3>
          <CardSelect
            options={COMMUTE_OPTIONS}
            selected={commute}
            onSelect={isDemo ? () => {} : toggle(setCommute)}
            multi
          />
        </div>

        {/* Location */}
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

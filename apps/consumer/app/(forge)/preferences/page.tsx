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
import { FlowPage, GhostGuide } from "@crucible/consumer-ui";
import ForgeAccumulator from "@/components/ForgeAccumulator";
import {
  ENVIRONMENT_OPTIONS,
  migratePreferences,
  readSchedule,
  readCommute,
  splitPref,
  togglePreference,
  writeSchedule,
  writeEnvironment,
  writeCommute,
} from "@/lib/forge-preferences";
import {
  ChoiceChips,
  CommuteQuestion,
  Question,
  ScheduleQuestion,
  idsOf,
} from "@/components/forge/PreferenceQuestions";
import { LocationCombobox } from "@/components/forge/LocationCombobox";
import {
  locationFromResume,
  nextPath,
  planForgePath,
  previousPath,
  questionsFor,
} from "@/lib/forge-path";

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
  // A saved run was already migrated when it loaded (forge-context), so it is
  // read as it is. Only the demo sample, which still holds old ids, is migrated here.
  const prefs: Record<string, string> = isDemo
    ? migratePreferences(DEMO_SESSION.preferences || {})
    : session.preferences || {};
  const initialSchedule = readSchedule(prefs.schedule);
  const initialCommute = readCommute(prefs.commute);
  const [hours, setHours] = useState<string[]>(initialSchedule.hours);
  const [shifts, setShifts] = useState<string[]>(initialSchedule.shifts);
  const [environment, setEnvironment] = useState<string[]>(splitPref(prefs.environment));
  const [modes, setModes] = useState<string[]>(initialCommute.modes);
  const [distance, setDistance] = useState<string | null>(initialCommute.distance);
  // A location on their resume is offered to confirm, not asked cold (forge-path R6).
  const fromResume = isDemo ? null : locationFromResume(session);
  const [location, setLocation] = useState(prefs.location || fromResume || "");

  // This screen's questions, their order and wording, from the path model.
  const plan = planForgePath(session);
  const planned = isDemo
    ? questionsFor(planForgePath({ isDemo: true }), "preferences")
    : questionsFor(plan, "preferences");
  const offerStory = !isDemo && plan.offers.includes("story");

  const asks = (id: string) => planned.some((q) => q.id === id);

  function savePreferences(extra: Record<string, unknown> = {}) {
    // Spread first: keys this page does not own (for example a work type
    // brought across from a facility tablet) must survive. A question this
    // path asked on an earlier screen is left exactly as that screen saved it.
    const preferences: Record<string, string> = { ...(session.preferences || {}) };
    if (asks("schedule")) preferences.schedule = writeSchedule(hours, shifts);
    if (asks("environment")) preferences.environment = writeEnvironment(environment);
    if (asks("commute")) preferences.commute = writeCommute(modes, distance);
    if (asks("location")) preferences.location = location.trim();
    const updates = { preferences, lastPageVisited: "preferences", ...extra };
    updateSession(updates);
    return { ...session, ...updates };
  }

  function handleContinue() {
    if (isDemo) {
      updateSession({
        preferences: DEMO_SESSION.preferences,
        lastPageVisited: "preferences",
      });
      router.push("/processing");
      return;
    }
    const next = savePreferences();
    router.push(nextPath(planForgePath(next), "preferences"));
  }

  /** Short path: add the story screen now, before building. */
  function handleAddStory() {
    const extras = Array.from(new Set([...(session.pathExtras || []), "story"]));
    savePreferences({ pathExtras: extras });
    router.push("/story");
  }

  function renderQuestion(q: { id: string; variant: string }) {
    if (q.id === "schedule") {
      return (
        <ScheduleQuestion
          key="schedule"
          variant={isDemo ? "default" : q.variant}
          hours={hours}
          shifts={shifts}
          setHours={setHours}
          setShifts={setShifts}
          disabled={isDemo}
        />
      );
    }
    if (q.id === "environment") {
      return (
        <Question
          key="environment"
          title="Where and how do you want to work?"
          hint="Pick as many as fit. Skip it if you're open to anything."
          testId="q-environment"
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
      );
    }
    if (q.id === "commute") {
      return (
        <CommuteQuestion
          key="commute"
          variant={isDemo ? "default" : q.variant}
          modes={modes}
          distance={distance}
          setModes={setModes}
          setDistance={setDistance}
          disabled={isDemo}
        />
      );
    }
    if (q.id === "location") {
      const confirm = q.variant === "confirm" && !!fromResume && location === fromResume;
      return (
        <div key="location" data-testid={`q-location-${q.variant}`}>
          <label htmlFor="location-input" className="mb-1 block font-medium text-t-white">
            {confirm ? `Still in ${fromResume}?` : "Where are you located?"}{" "}
            <span className="text-sm font-normal text-t-phos-dim">(optional)</span>
          </label>
          <p id="location-hint" className="mb-2 text-sm text-t-phos-dim">
            {confirm
              ? "This came from your resume. Change it if you've moved."
              : "Start typing a city or ZIP and pick from the list. Not listed? Type it anyway."}
          </p>
          <LocationCombobox
            id="location-input"
            value={location}
            onChange={setLocation}
            disabled={isDemo}
            describedBy="location-hint"
          />
        </div>
      );
    }
    return null;
  }

  return (
    <FlowPage
      title="A few quick preferences"
      subtitle="This helps us find the right fit. You can change any of these later."
      actionLabel={isDemo ? "Next" : offerStory ? "Build my page" : "Continue"}
      onAction={handleContinue}
      showBack
      onBack={() => {
        // Back keeps what was picked here, so coming forward again loses nothing.
        if (!isDemo) savePreferences();
        router.push(isDemo ? "/story" : previousPath(plan, "preferences"));
      }}
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
      <div className="space-y-8">{planned.map((q) => renderQuestion(q))}</div>

      {offerStory && (
        <div className="mt-8 border border-dashed border-t-line bg-t-panel px-4 py-4" data-testid="offer-story">
          <p className="font-medium text-t-white">Anything in your way? (optional)</p>
          <p className="mt-1 text-sm text-t-phos-dim">
            A record, a gap, no ride. Tell me before I build and I can look up the laws and help that fit. Or skip it and build now.
          </p>
          <button
            type="button"
            onClick={handleAddStory}
            className="t-focus mt-3 min-h-touch border border-t-line px-4 py-2 text-sm font-medium text-t-amber-bright hover:border-t-amber"
          >
            Add that first
          </button>
        </div>
      )}
    </FlowPage>
  );
}

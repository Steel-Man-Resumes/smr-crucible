"use client";

/**
 * Page 4: "Want help with something getting in the way?" (optional).
 *
 * Phase 5 lane R2 (Codex C, A2): this was the Story inventory, with a
 * structured record form (charge type, count, recency, supervision). It is
 * now an optional support step: the person ticks what would help and, if
 * they want, says what kind of help. It never asks about an offense. Ticking
 * "A record" asks nothing more; it only tells t.ROY to point toward
 * employers and help for people with records. The privacy line below stays
 * true to the code: the answers go to the AI services we use and are saved
 * to the account when signed in.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { DEMO_SESSION } from "@/lib/demo-data";
import { getOpusMessage } from "@/lib/opus-messages";
import { FlowPage, GhostGuide } from "@crucible/consumer-ui";
import ForgeAccumulator from "@/components/ForgeAccumulator";
import { ScheduleQuestion } from "@/components/forge/PreferenceQuestions";
import { readSchedule, writeSchedule } from "@/lib/forge-preferences";
import {
  CREDENTIAL_KINDS,
  credentialRowNeeds,
  credentialRowsAsText,
  emptyCredentialRow,
  readCredentialRows,
  type CredentialRowDraft,
} from "@/lib/credential-rows";
import {
  CREDENTIALS_KEY,
  nextPath,
  planForgePath,
  previousPath,
  questionsFor,
  type PlannedQuestion,
} from "@/lib/forge-path";

// The ids are unchanged (stored answers and forge-path R5 read them); the
// words name the help, not the person.
const CHALLENGE_OPTIONS = [
  { id: "transportation", label: "Getting to work" },
  // Brings the shift question to the top of preferences (forge-path R5).
  { id: "childcare", label: "Childcare or family care" },
  { id: "housing", label: "A place to stay" },
  { id: "criminal_record", label: "A record (jobs and help for people with records)" },
  { id: "employment_gap", label: "A gap in work" },
  { id: "recovery", label: "Recovery" },
  { id: "health", label: "Health" },
  { id: "no_degree", label: "No diploma or degree" },
  { id: "career_change", label: "Changing careers" },
  { id: "other", label: "Something else" },
];

/** Options that ask nothing more when ticked: the record never gets a text box. */
const NO_FOLLOW_UP = new Set(["criminal_record"]);

export default function StoryPage() {
  const router = useRouter();
  const { session, updateSession } = useForgeSession();
  const isDemo = session.isDemo === true;
  const audience = session.audience || "client";
  const [selected, setSelected] = useState<string[]>(
    isDemo ? (DEMO_SESSION.challenges || []) : (session.challenges || [])
  );

  // Track page visit
  useEffect(() => {
    updateSession({
      pagesVisited: Array.from(new Set([...(session.pagesVisited || []), "story"])),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [narratives, setNarratives] = useState<Record<string, string>>(
    isDemo ? (DEMO_SESSION.challengeNarratives || {}) : (session.challengeNarratives || {})
  );

  // Questions the goals brought here (forge-path R4), planned from the
  // answers so far plus what is ticked on this screen right now.
  const plan = planForgePath({ ...session, challenges: selected });
  const story = questionsFor(plan, "story");
  const tone = story.find((q) => q.id === "challenges")?.variant === "open" ? "open" : "direct";
  const goalPrompts = isDemo ? [] : story.filter((q) => q.id === "schedule" || q.id === "credentials");
  // The licenses-and-training answer, one row per credential (round 7).
  const [credRows, setCredRows] = useState<CredentialRowDraft[]>(() => {
    const stored = readCredentialRows(session.credentialRows);
    return stored.length ? stored : [emptyCredentialRow()];
  });
  const initialSchedule = readSchedule(session.preferences?.schedule);
  const [hours, setHours] = useState<string[]>(initialSchedule.hours);
  const [shifts, setShifts] = useState<string[]>(initialSchedule.shifts);

  function toggleChallenge(id: string) {
    if (isDemo) return;
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleContinue() {
    if (isDemo) {
      updateSession({
        challenges: DEMO_SESSION.challenges,
        criminalRecord: DEMO_SESSION.criminalRecord,
        challengeNarratives: DEMO_SESSION.challengeNarratives,
        lastPageVisited: "story",
      });
      router.push("/preferences");
      return;
    }
    const updates = saveStory();
    router.push(nextPath(planForgePath({ ...session, ...updates }), "story"));
  }

  /** Save this screen's answers (Continue and Back both keep them). */
  function saveStory() {
    // The rows, and the same rows as plain lines for the writer (the old free-text box is gone).
    const rowsText = credentialRowsAsText(credRows);
    const asked = goalPrompts.some((q) => q.id === "credentials");
    // Emptying every row clears the old text too, so the writer is never told about a credential they took out (round 8).
    const { [CREDENTIALS_KEY]: _oldCredentials, ...withoutCredentials } = narratives;
    void _oldCredentials;
    const nextNarratives = !asked ? narratives : rowsText ? { ...narratives, [CREDENTIALS_KEY]: rowsText } : withoutCredentials;
    const updates: Partial<typeof session> = {
      challenges: selected,
      // Never asked here any more (no offense details). An answer from an
      // older run is dropped the next time this screen is saved.
      criminalRecord: undefined,
      challengeNarratives: nextNarratives,
      ...(asked ? { credentialRows: credRows.filter((r) => r.name.trim()) } : {}),
      lastPageVisited: "story",
    };
    // A schedule asked here is the same answer preferences would store.
    if (goalPrompts.some((q) => q.id === "schedule")) {
      updates.preferences = { ...(session.preferences || {}), schedule: writeSchedule(hours, shifts) };
    }
    updateSession(updates);
    return updates;
  }

  function renderGoalPrompt(q: PlannedQuestion) {
    if (q.id === "schedule") {
      return (
        <div key="schedule" className="mb-6 border border-t-line bg-t-panel p-5">
          <ScheduleQuestion
            variant={q.variant}
            hours={hours}
            shifts={shifts}
            setHours={setHours}
            setShifts={setShifts}
          />
        </div>
      );
    }
    if (q.id === "credentials") {
      const trade = q.variant === "trade";
      const setRow = (i: number, patch: Partial<CredentialRowDraft>) =>
        setCredRows((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
      return (
        <div key="credentials" className="mb-6" data-testid={`q-credentials-${q.variant}`}>
          <p className="mb-1.5 block text-sm font-medium text-t-white" id="credentials-label">
            {trade
              ? "Getting back into your trade: do you hold a license, certificate or card for it?"
              : "Any training, certificate or license you have, or are working on?"}{" "}
            <span className="font-normal text-t-phos-dim">(optional)</span>
          </p>
          <p className="mb-3 text-xs text-t-phos-dim">
            One per line. Pick what kind it is, then the year you got it or whether it&apos;s current, expired or in progress.
          </p>
          <ul className="space-y-3" aria-labelledby="credentials-label">
            {credRows.map((row, i) => {
              const needs = credentialRowNeeds(row);
              return (
                <li key={i} className="border border-t-line bg-t-panel p-3" data-testid="credential-row">
                  <label htmlFor={`cred-name-${i}`} className="block text-xs font-semibold text-t-white">
                    Name
                  </label>
                  <input
                    id={`cred-name-${i}`}
                    value={row.name}
                    onChange={(e) => setRow(i, { name: e.target.value })}
                    placeholder={trade ? "e.g., Forklift" : "e.g., Food handler"}
                    className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
                  />
                  <p className="mt-2 text-xs font-semibold text-t-white" id={`cred-kind-${i}`}>
                    What kind is it?
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`cred-kind-${i}`}>
                    {CREDENTIAL_KINDS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={row.kind === k}
                        onClick={() => setRow(i, { kind: k })}
                        className={`border px-3 py-1.5 text-xs ${row.kind === k ? "border-t-amber bg-t-amber text-t-bg" : "border-t-line text-t-white"}`}
                      >
                        {k.charAt(0).toUpperCase() + k.slice(1)}
                      </button>
                    ))}
                  </div>
                  <label htmlFor={`cred-when-${i}`} className="mt-2 block text-xs font-semibold text-t-white">
                    When did you get it, or is it current?
                  </label>
                  <input
                    id={`cred-when-${i}`}
                    value={row.when}
                    onChange={(e) => setRow(i, { when: e.target.value })}
                    placeholder="The year, or current, expired, in progress"
                    className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
                  />
                  {needs === "when" && row.when.trim() !== "" && (
                    <p role="status" className="mt-1 text-xs text-t-amber-bright">
                      Add the year you got it, or say if it&apos;s current, expired, in progress or completed.
                    </p>
                  )}
                  {needs === "name" && (
                    <p role="status" className="mt-1 text-xs text-t-amber-bright" data-testid="credential-name-notice">
                      Keep the name to just the name. Put expired, lapsed, suspended or the year in the box below.
                    </p>
                  )}
                  {needs === "kind-name" && (
                    <p role="status" className="mt-1 text-xs text-t-amber-bright" data-testid="credential-kind-notice">
                      The name says what kind it is. Pick that kind, or take the word out of the name.
                    </p>
                  )}
                  {needs === "permit" && (
                    <p role="status" className="mt-1 text-xs text-t-amber-bright" data-testid="credential-permit-notice">
                      That sounds like a permit. Pick Permit as the kind.
                    </p>
                  )}
                  {credRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setCredRows((rows) => rows.filter((_, k) => k !== i))}
                      className="mt-2 text-xs text-t-phos-dim underline"
                    >
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => setCredRows((rows) => [...rows, emptyCredentialRow()])}
            className="mt-3 border border-t-line px-3 py-1.5 text-xs text-t-white"
            data-testid="credential-add"
          >
            Add another
          </button>
        </div>
      );
    }
    return null;
  }

  void tone;
  return (
    <FlowPage
      title="Want help with something getting in the way?"
      subtitle="Tick what would help. Skip anything. You don't have to explain any of it."
      actionLabel={isDemo ? "Next" : (selected.length > 0 || goalPrompts.length > 0 ? "Continue" : "Nothing right now, skip")}
      onAction={handleContinue}
      showBack
      onBack={() => {
        if (!isDemo) saveStory();
        router.push(isDemo ? "/goals" : previousPath(plan, "story", session));
      }}
      footer={
        <p>
          What you share here helps t.ROY build your resume and find
          resources. To do that, it goes to the AI services we use, and if you
          sign in or make an account, it&apos;s saved there. It&apos;s never used to
          judge you. Skip anything you don&apos;t want to share.
        </p>
      }
    >
      <GhostGuide
        message={getOpusMessage("story", audience, isDemo)}
        pageId="story"
      />

      {!isDemo && <ForgeAccumulator />}

      {!isDemo && (
        <div className="bg-t-panel px-4 py-3 mb-4 border border-t-line">
          <p className="text-sm text-t-phos leading-relaxed">
            We never ask what a charge was. If a record is in the way, tick it, and
            t.ROY points you to employers and help for people with records.
          </p>
        </div>
      )}

      {isDemo && (
        <div className="bg-t-panel-2 px-4 py-3 mb-4 border border-t-amber">
          <p className="text-sm text-t-amber-bright font-medium">
            Demo mode: sample barriers pre-filled
          </p>
        </div>
      )}
      {/* Challenge selection */}
      <div className="space-y-2 mb-6">
        {CHALLENGE_OPTIONS.map((opt) => {
          const isSelected = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              onClick={() => toggleChallenge(opt.id)}
              className={`t-focus w-full text-left px-5 py-3.5 border transition-all min-h-touch ${
                isSelected
                  ? "border-t-amber bg-t-panel-2"
                  : "border-t-line bg-t-panel hover:border-t-phos-dim"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex-shrink-0 w-5 h-5 border flex items-center justify-center ${
                    isSelected
                      ? "border-t-amber bg-t-amber"
                      : "border-t-phos-dim"
                  }`}
                >
                  {isSelected && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M2.5 6L5 8.5L9.5 3.5"
                        stroke="#14100a"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <span className="font-medium text-t-white">{opt.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Narrative prompts for other selected challenges */}
      {selected
        .filter((id) => !NO_FOLLOW_UP.has(id))
        .map((id) => {
          const opt = CHALLENGE_OPTIONS.find((o) => o.id === id);
          if (!opt) return null;
          return (
            <div key={id} className="mb-4">
              <label className="text-sm font-medium text-t-white block mb-1.5">
                {opt.label}: what kind of help would make a difference?{" "}
                <span className="font-normal text-t-phos-dim">(optional)</span>
              </label>
              <textarea
                value={narratives[id] || ""}
                onChange={(e) =>
                  setNarratives({ ...narratives, [id]: e.target.value })
                }
                placeholder="For example: a ride to early shifts."
                rows={2}
                className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-y"
              />
            </div>
          );
        })}

      {/* What the goals brought here, in the order the goals were picked */}
      {goalPrompts.length > 0 && (
        <div className="mt-8" data-testid="story-goal-prompts">
          <p className="mb-3 text-sm text-t-phos-dim">From the goals you picked:</p>
          {goalPrompts.map((q) => renderGoalPrompt(q))}
        </div>
      )}
    </FlowPage>
  );
}

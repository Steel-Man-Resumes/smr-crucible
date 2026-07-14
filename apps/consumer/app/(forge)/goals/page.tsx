"use client";

/**
 * Page 3: What Are You Looking For
 *
 * Purpose exploration first (Ikigai-inspired, Maruna generative identity).
 * Position field NOT mandatory.
 * Alternative prompts: "What kind of work interests you?" /
 * "What are you good at?" / "What matters to you in a job?"
 * No blue-collar assumptions.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { DEMO_SESSION } from "@/lib/demo-data";
import { getOpusMessage } from "@/lib/opus-messages";
import { FlowPage, CardSelect, GhostGuide } from "@crucible/consumer-ui";
import ForgeAccumulator from "@/components/ForgeAccumulator";

const GOAL_OPTIONS = [
  {
    id: "stability",
    label: "Something stable",
    description: "Consistent hours, reliable income, a place I can stay.",
  },
  {
    id: "growth",
    label: "Room to grow",
    description: "I want to build skills and move up over time.",
  },
  {
    id: "meaning",
    label: "Work that matters to me",
    description: "I care about what I do, not just the paycheck.",
  },
  {
    id: "immediate",
    label: "Something right now",
    description: "I need income fast. I'll figure out the rest later.",
  },
  {
    id: "independence",
    label: "Be my own boss someday",
    description: "I want to build toward running something of my own.",
  },
  {
    id: "community",
    label: "Give back to my community",
    description: "I've been through it — I want to help others who are too.",
  },
  {
    id: "flexibility",
    label: "I need a flexible schedule",
    description: "Appointments, family, programs. My job has to work around my life.",
  },
];

export default function GoalsPage() {
  const router = useRouter();
  const { session, updateSession } = useForgeSession();
  const isDemo = session.isDemo === true;
  const audience = session.audience || "client";
  const [selected, setSelected] = useState<string[]>(
    isDemo ? (DEMO_SESSION.goals || []) : (session.goals || [])
  );
  const [narrative, setNarrative] = useState(
    isDemo ? (DEMO_SESSION.goalNarrative || "") : (session.goalNarrative || "")
  );
  const [showNarrative, setShowNarrative] = useState(isDemo && !!DEMO_SESSION.goalNarrative);
  const [hookNarrative, setHookNarrative] = useState(
    isDemo ? (DEMO_SESSION.hookNarrative || "") : (session.hookNarrative || "")
  );
  const [showHookPrompt, setShowHookPrompt] = useState(false);

  // Track page visit
  useEffect(() => {
    updateSession({
      pagesVisited: Array.from(new Set([...(session.pagesVisited || []), "goals"])),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(id: string) {
    if (isDemo) return;
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleContinue() {
    updateSession({
      goals: isDemo ? DEMO_SESSION.goals : selected,
      goalNarrative: isDemo ? DEMO_SESSION.goalNarrative : (narrative || undefined),
      hookNarrative: isDemo ? (DEMO_SESSION.hookNarrative || undefined) : (hookNarrative || undefined),
      lastPageVisited: "goals",
    });
    router.push("/story");
  }

  const canContinue = isDemo || selected.length > 0 || narrative.trim().length > 0;

  return (
    <FlowPage
      title="What do you actually want?"
      subtitle="Pick as many as fit. This changes what jobs I recommend."
      actionLabel={isDemo ? "Next" : "Continue"}
      actionDisabled={!canContinue}
      onAction={handleContinue}
      showBack
      onBack={() => router.push("/resume")}
      footer={
        !isDemo ? (
          <p>
            Not sure? Pick what feels closest. We&apos;ll figure it out.
          </p>
        ) : undefined
      }
    >
      <GhostGuide
        message={getOpusMessage("goals", audience, isDemo)}
        pageId="goals"
      />

      {!isDemo && <ForgeAccumulator />}

      {/* Why we ask */}
      {!isDemo && (
        <div className="bg-t-panel px-4 py-3 mb-4 border border-t-line">
          <p className="text-sm text-t-white leading-relaxed">
            This isn&apos;t a form, it&apos;s a filter. &ldquo;Stability&rdquo; and
            &ldquo;growth&rdquo; lead to different jobs. I need to know what
            matters so I don&apos;t waste your time.
          </p>
        </div>
      )}

      {isDemo && (
        <div className="bg-t-panel-2 px-4 py-3 mb-4 border border-t-amber">
          <p className="text-sm text-t-amber-bright font-medium">
            Demo mode — sample goals pre-selected
          </p>
        </div>
      )}

      <CardSelect
        options={GOAL_OPTIONS}
        selected={selected}
        onSelect={handleSelect}
        multi
      />

      {/* Helper when nothing is selected */}
      {!canContinue && (
        <p className="text-sm text-t-phos-dim text-center mt-2">
          Pick at least one, or describe what you&apos;re looking for below.
        </p>
      )}

      {/* Optional free-text for more nuanced expression */}
      <div className="mt-6 space-y-4">
        {!showNarrative ? (
          !isDemo && (
            <button
              onClick={() => setShowNarrative(true)}
              className="text-sm text-t-amber-bright underline underline-offset-2 hover:text-t-amber"
            >
              Want to say more about what you&apos;re looking for?
            </button>
          )
        ) : (
          <div className="space-y-2">
            <label
              htmlFor="goal-narrative"
              className="text-sm font-medium text-t-white"
            >
              {isDemo ? "Sample goal narrative" : "Tell us more in your own words"}
            </label>
            <textarea
              id="goal-narrative"
              value={narrative}
              onChange={isDemo ? () => {} : (e) => setNarrative(e.target.value)}
              placeholder="e.g., I want to work with my hands, or I'm interested in healthcare, or I want to start my own business someday..."
              rows={3}
              readOnly={isDemo}
              className={`w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-y ${isDemo ? "bg-t-panel-2 cursor-default" : ""}`}
            />
          </div>
        )}

        {/* Hooks-for-change prompt — surfaces what would make work feel meaningful */}
        {!isDemo && (selected.length > 0 || showNarrative) && !showHookPrompt && (
          <button
            onClick={() => setShowHookPrompt(true)}
            className="text-sm text-t-amber-bright underline underline-offset-2 hover:text-t-amber block"
          >
            What would make work feel like yours?
          </button>
        )}
        {(showHookPrompt || (isDemo && DEMO_SESSION.hookNarrative)) && (
          <div className="space-y-2">
            <label
              htmlFor="hook-narrative"
              className="text-sm font-medium text-t-white"
            >
              {isDemo ? "What would make work feel real to you?" : "What would make work feel like yours?"}
            </label>
            <p className="text-xs text-t-phos-dim">
              A mentor, a mission, using your story to help others — anything that would make getting up worth it.
            </p>
            <textarea
              id="hook-narrative"
              value={hookNarrative}
              onChange={isDemo ? () => {} : (e) => setHookNarrative(e.target.value)}
              placeholder="e.g., I want to help people going through what I went through. Or: I want to build something I can show my kids."
              rows={2}
              readOnly={isDemo}
              className={`w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-y ${isDemo ? "bg-t-panel-2 cursor-default" : ""}`}
            />
          </div>
        )}
      </div>
    </FlowPage>
  );
}

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
      lastPageVisited: "goals",
    });
    router.push("/story");
  }

  return (
    <FlowPage
      title="What do you actually want?"
      subtitle="Pick as many as fit. This changes what jobs I recommend."
      actionLabel={isDemo ? "Next" : "Continue"}
      actionDisabled={!isDemo && selected.length === 0 && !narrative.trim()}
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
        <div className="bg-sage-50 rounded-xl px-4 py-3 mb-4 border border-sage-200">
          <p className="text-sm text-sage-700 leading-relaxed">
            This isn&apos;t a form, it&apos;s a filter. &ldquo;Stability&rdquo; and
            &ldquo;growth&rdquo; lead to different jobs. I need to know what
            matters so I don&apos;t waste your time.
          </p>
        </div>
      )}

      {isDemo && (
        <div className="bg-amber-50 rounded-xl px-4 py-3 mb-4 border border-amber-200">
          <p className="text-sm text-amber-800 font-medium">
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

      {/* Optional free-text for more nuanced expression */}
      <div className="mt-6">
        {!showNarrative ? (
          !isDemo && (
            <button
              onClick={() => setShowNarrative(true)}
              className="text-sm text-sage-600 underline underline-offset-2 hover:text-sage-700"
            >
              Want to say more about what you&apos;re looking for?
            </button>
          )
        ) : (
          <div className="space-y-2">
            <label
              htmlFor="goal-narrative"
              className="text-sm font-medium text-foreground"
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
              className={`w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors resize-y ${isDemo ? "bg-gray-50 cursor-default" : ""}`}
            />
          </div>
        )}
      </div>
    </FlowPage>
  );
}

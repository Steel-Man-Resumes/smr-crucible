"use client";

/**
 * Page 1: Welcome / Readiness Detection
 *
 * Detects Stages of Change (Prochaska & DiClemente) through
 * natural conversational prompts — NOT a quiz or assessment.
 *
 * Demo mode: shows pre-filled readiness selection (not editable).
 */

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { DEMO_SESSION } from "@/lib/demo-data";
import { getOpusMessage } from "@/lib/opus-messages";
import { FlowPage, CardSelect, GhostGuide, TroyLivingIcon } from "@crucible/consumer-ui";
import { defaultDepth, planForgePath } from "@/lib/forge-path";

type ReadinessStage =
  | "precontemplation"
  | "contemplation"
  | "preparation"
  | "action";

const READINESS_OPTIONS = [
  {
    id: "exploring",
    label: "Just exploring",
    description: "Not sure I'm ready yet, but I'm curious.",
  },
  {
    id: "thinking",
    label: "Thinking about it",
    description: "I know I need to do something, but I don't know where to start.",
  },
  {
    id: "getting-ready",
    label: "Getting ready",
    description: "I've decided to make a change. Show me what's next.",
  },
  {
    id: "ready-now",
    label: "Ready to go",
    description: "I'm looking for work right now. Let's move.",
  },
];

/** t.ROY responds differently based on what they picked */
const TROY_RESPONSES: Record<string, string> = {
  exploring:
    "No pressure. Let's just see what's out there. You can stop anytime.",
  thinking:
    "That's where most people start. Let's figure it out together.",
  "getting-ready":
    "Good. You've already made the hardest decision. Let's build on it.",
  "ready-now":
    "Let's go. First thing: your resume.",
};

const STAGE_MAP: Record<string, ReadinessStage> = {
  exploring: "precontemplation",
  thinking: "contemplation",
  "getting-ready": "preparation",
  "ready-now": "action",
};

/**
 * The short path and the full path (lib/forge-path.ts, rule R1). Offered to
 * everyone once they pick where they are; "Ready to go" starts on the short
 * one, everyone else on the full one. Either way it is their pick.
 */
const PATH_OPTIONS = [
  {
    id: "light",
    label: "The short path",
    description: "The essentials only, then I build your page. You can add more on the way.",
  },
  {
    id: "full",
    label: "The full path",
    description: "Every question, your story too. Takes longer and makes a stronger page.",
  },
];

// Reverse map for demo: clinical stage → display option
const REVERSE_STAGE_MAP: Record<string, string> = {
  precontemplation: "exploring",
  contemplation: "thinking",
  preparation: "getting-ready",
  action: "ready-now",
};

export default function WelcomePage() {
  return (
    <Suspense>
      <WelcomePageInner />
    </Suspense>
  );
}

function WelcomePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, updateSession, clearSession } = useForgeSession();

  const isDemo = searchParams.get("demo") === "true";
  const audience = session.audience || "client";

  const [selected, setSelected] = useState<string>(
    isDemo && DEMO_SESSION.readinessStage
      ? REVERSE_STAGE_MAP[DEMO_SESSION.readinessStage] || ""
      : ""
  );
  const [acknowledged, setAcknowledged] = useState(false);
  // A run already under way (they came back to change this answer). Keep
  // their answers; "Start over" is one tap away for anyone else at this computer.
  const inProgress = !isDemo && !session.isDemo && !!session.readinessStage && !!session.startedAt;
  const [depth, setDepth] = useState<"light" | "full" | "">(
    inProgress ? session.pathChoice ?? defaultDepth(session.readinessStage) : ""
  );
  useEffect(() => {
    if (inProgress && !selected && session.readinessStage) {
      setSelected(REVERSE_STAGE_MAP[session.readinessStage] || "");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track page visit + set demo mode from URL param
  // Also clear stale demo sessions when arriving in real (non-demo) mode
  useEffect(() => {
    if (searchParams.get("demo") !== "true" && session.isDemo) {
      clearSession();
    }
    const updates: Partial<typeof session> = {
      lastPageVisited: "welcome",
      pagesVisited: Array.from(new Set([...(session.pagesVisited || []), "welcome"])),
    };
    if (searchParams.get("demo") === "true") {
      updates.isDemo = true;
    }
    updateSession(updates);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleContinue() {
    // Clear old session data before starting fresh
    // (preserves audience from intro, clears everything else)
    const audience = session.audience;
    clearSession();

    if (isDemo) {
      updateSession({
        audience,
        isDemo: true,
        readinessStage: DEMO_SESSION.readinessStage,
        startedAt: new Date().toISOString(),
        lastPageVisited: "welcome",
        pagesVisited: ["intro", "welcome"],
      });
    } else {
      if (!selected) return;
      const readinessStage = STAGE_MAP[selected];
      updateSession({
        audience,
        readinessStage,
        pathChoice: depth || defaultDepth(readinessStage),
        startedAt: new Date().toISOString(),
        lastPageVisited: "welcome",
        pagesVisited: ["intro", "welcome"],
      });
    }
    router.push("/resume");
  }

  /** Coming back to change this answer: keep everything else, and the path recomputes. */
  function handleKeepGoing() {
    if (!selected) return;
    const readinessStage = STAGE_MAP[selected];
    const next = { ...session, readinessStage, pathChoice: depth || defaultDepth(readinessStage) };
    updateSession({ readinessStage, pathChoice: next.pathChoice, lastPageVisited: "welcome" });
    router.push(planForgePath(next).screens[0].path);
  }

  function handleSelect(id: string) {
    if (isDemo) return;
    setSelected(id);
    setAcknowledged(true);
    // A new answer starts on that answer's default path; they can still switch.
    setDepth(defaultDepth(STAGE_MAP[id]));
  }

  function handleStartOver() {
    const keepAudience = session.audience;
    clearSession();
    updateSession({ audience: keepAudience });
    setSelected("");
    setDepth("");
    setAcknowledged(false);
  }

  return (
    <FlowPage
      title="Where are you at right now?"
      subtitle="This changes how much I talk. Pick what's true."
      actionLabel={isDemo ? "Next" : "Continue"}
      actionDisabled={!isDemo && !selected}
      onAction={inProgress ? handleKeepGoing : handleContinue}
      showBack
      onBack={() => router.push("/intro")}
      footer={
        <p>
          Everything here is private. You can change your answer at any time.
        </p>
      }
    >
      {inProgress && (
        <div className="mb-4 flex flex-col gap-2 border border-t-line bg-t-panel px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-t-white">
            Your answers from before are saved. Change this one and keep going, or start fresh.
          </p>
          <button
            type="button"
            onClick={handleStartOver}
            className="t-focus min-h-touch self-start px-3 text-sm font-medium text-t-amber-bright underline underline-offset-2 hover:text-t-amber sm:self-auto"
          >
            Start over
          </button>
        </div>
      )}
      <GhostGuide
        message={getOpusMessage("welcome", audience, isDemo)}
        pageId="welcome"
      />

      {isDemo && (
        <div className="bg-t-panel-2 px-4 py-3 mb-4 border border-t-amber">
          <p className="text-sm text-t-amber-bright font-medium">
            Demo mode: sample data pre-filled. Watch how t.ROY guides each step.
          </p>
        </div>
      )}

      <CardSelect
        options={READINESS_OPTIONS}
        selected={isDemo ? (REVERSE_STAGE_MAP[DEMO_SESSION.readinessStage!] || "") : selected}
        onSelect={handleSelect}
      />

      {/* The path offer: plain, both choices visible, theirs to pick. */}
      {!isDemo && selected && (
        <div className="mt-6" data-testid="path-choice">
          <p className="mb-1 font-medium text-t-white">How much do you want to do today?</p>
          <p className="mb-3 text-sm text-t-phos-dim">
            {selected === "ready-now" && depth === "light"
              ? "You need work now, so the short path is set. Want the full one? Tap it."
              : "Pick what fits. You can switch later by coming back here."}
          </p>
          <CardSelect options={PATH_OPTIONS} selected={depth} onSelect={(id) => setDepth(id as "light" | "full")} />
        </div>
      )}

      {/* t.ROY acknowledges the selection */}
      {acknowledged && selected && TROY_RESPONSES[selected] && (
        <div className="mt-4 bg-t-panel px-4 py-3 border border-t-line flex items-start gap-3 animate-in fade-in duration-300">
          <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center">
            <TroyLivingIcon size={26} />
          </span>
          <p className="text-sm text-t-phos leading-relaxed">
            {TROY_RESPONSES[selected]}
          </p>
        </div>
      )}
    </FlowPage>
  );
}

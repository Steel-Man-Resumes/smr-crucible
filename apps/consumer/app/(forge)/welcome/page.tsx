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
import { FlowPage, CardSelect, GhostGuide } from "@crucible/consumer-ui";

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
    "Let's go. First thing — your resume.",
};

const STAGE_MAP: Record<string, ReadinessStage> = {
  exploring: "precontemplation",
  thinking: "contemplation",
  "getting-ready": "preparation",
  "ready-now": "action",
};

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
        startedAt: new Date().toISOString(),
        lastPageVisited: "welcome",
        pagesVisited: ["intro", "welcome"],
      });
    }
    router.push("/resume");
  }

  function handleSelect(id: string) {
    if (isDemo) return;
    setSelected(id);
    setAcknowledged(true);
  }

  return (
    <FlowPage
      title="Where are you at right now?"
      subtitle="This changes how much I talk. Pick what's true."
      actionLabel={isDemo ? "Next" : "Continue"}
      actionDisabled={!isDemo && !selected}
      onAction={handleContinue}
      showBack
      onBack={() => router.push("/intro")}
      footer={
        <p>
          Everything here is private. You can change your answer at any time.
        </p>
      }
    >
      <GhostGuide
        message={getOpusMessage("welcome", audience, isDemo)}
        pageId="welcome"
      />

      {isDemo && (
        <div className="bg-t-panel-2 px-4 py-3 mb-4 border border-t-amber">
          <p className="text-sm text-t-amber-bright font-medium">
            Demo mode — sample data pre-filled. Watch how t.ROY guides each step.
          </p>
        </div>
      )}

      <CardSelect
        options={READINESS_OPTIONS}
        selected={isDemo ? (REVERSE_STAGE_MAP[DEMO_SESSION.readinessStage!] || "") : selected}
        onSelect={handleSelect}
      />

      {/* t.ROY acknowledges the selection */}
      {acknowledged && selected && TROY_RESPONSES[selected] && (
        <div className="mt-4 bg-t-panel px-4 py-3 border border-t-line flex items-start gap-3 animate-in fade-in duration-300">
          <svg
            width="20"
            height="20"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="flex-shrink-0 mt-0.5 text-t-amber"
          >
            <path
              d="M8 1C5.58 1 3 3.13 3 6v4c0 1 .5 2 1 2.5s1 1.5 1 2.5h6c0-1 .5-2 1-2.5S13 11 13 10V6c0-2.87-2.58-5-5-5z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
          </svg>
          <p className="text-sm text-t-phos leading-relaxed">
            {TROY_RESPONSES[selected]}
          </p>
        </div>
      )}
    </FlowPage>
  );
}

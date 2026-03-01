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
    description: "I'm not sure if I'm ready to look for work yet, but I'm curious.",
  },
  {
    id: "thinking",
    label: "Thinking about it",
    description: "I know I need to do something, but I'm not sure where to start.",
  },
  {
    id: "getting-ready",
    label: "Getting ready",
    description: "I've decided to make a change. I want to figure out my next steps.",
  },
  {
    id: "ready-now",
    label: "Ready to go",
    description: "I'm actively looking for work and need real tools right now.",
  },
];

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
  const { session, updateSession } = useForgeSession();

  const isDemo = searchParams.get("demo") === "true" || session.isDemo === true;
  const audience = session.audience || "client";

  const [selected, setSelected] = useState<string>(
    isDemo && DEMO_SESSION.readinessStage
      ? REVERSE_STAGE_MAP[DEMO_SESSION.readinessStage] || ""
      : ""
  );

  // Track page visit + set demo mode from URL param
  useEffect(() => {
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
    if (isDemo) {
      updateSession({
        readinessStage: DEMO_SESSION.readinessStage,
        startedAt: new Date().toISOString(),
        lastPageVisited: "welcome",
      });
    } else {
      if (!selected) return;
      const readinessStage = STAGE_MAP[selected];
      updateSession({
        readinessStage,
        startedAt: new Date().toISOString(),
        lastPageVisited: "welcome",
      });
    }
    router.push("/resume");
  }

  return (
    <FlowPage
      title="Where are you at right now?"
      subtitle="There's no wrong answer. This helps us meet you where you are."
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
        <div className="bg-amber-50 rounded-xl px-4 py-3 mb-4 border border-amber-200">
          <p className="text-sm text-amber-800 font-medium">
            Demo mode — sample data pre-filled. Watch how Opus guides each step.
          </p>
        </div>
      )}

      <CardSelect
        options={READINESS_OPTIONS}
        selected={isDemo ? (REVERSE_STAGE_MAP[DEMO_SESSION.readinessStage!] || "") : selected}
        onSelect={isDemo ? () => {} : setSelected}
      />
    </FlowPage>
  );
}

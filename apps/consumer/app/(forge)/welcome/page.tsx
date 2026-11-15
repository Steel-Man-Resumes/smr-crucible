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
import { useLocale, useTranslations } from "next-intl";

type ReadinessStage =
  | "precontemplation"
  | "contemplation"
  | "preparation"
  | "action";

const READINESS_IDS = ["exploring", "thinking", "getting-ready", "ready-now"] as const;

/** t.ROY responds differently based on what they picked (the words are in the catalog, keyed by these ids) */
const TROY_RESPONSE_IDS = new Set<string>(READINESS_IDS);

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
const PATH_IDS = ["light", "full"] as const;

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
  const t = useTranslations("refineryShell.welcome");
  const tc = useTranslations("common");
  const locale = useLocale();
  const READINESS_OPTIONS = READINESS_IDS.map((id) => ({
    id,
    label: t(`readiness.${id}.label`),
    description: t(`readiness.${id}.description`),
  }));
  const PATH_OPTIONS = PATH_IDS.map((id) => ({
    id,
    label: t(`path.${id}.label`),
    description: t(`path.${id}.description`),
  }));
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, updateSession, clearSession } = useForgeSession();

  const isDemo = searchParams.get("demo") === "true";
  const audience = session.audience || "client";

  // Lanes first (Phase 5 lane R2): the readiness question is no longer on
  // anyone's path. The first screen asks what you need today. Old links land
  // there; the partner and observer walkthrough (?demo=true) keeps this page.
  const toStart = !isDemo && !session.isDemo;
  useEffect(() => {
    if (toStart) router.replace("/start");
  }, [toStart, router]);

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

  if (toStart) return <div className="h-40" aria-busy="true" />;

  return (
    <FlowPage
      title={t("title")}
      subtitle={t("subtitle")}
      actionLabel={isDemo ? tc("actions.next") : tc("actions.continue")}
      actionDisabled={!isDemo && !selected}
      onAction={inProgress ? handleKeepGoing : handleContinue}
      showBack
      onBack={() => router.push("/intro")}
      footer={
        <p>
          {t("footer")}
        </p>
      }
    >
      {inProgress && (
        <div className="mb-4 flex flex-col gap-2 border border-t-line bg-t-panel px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-t-white">
            {t("savedBefore")}
          </p>
          <button
            type="button"
            onClick={handleStartOver}
            className="t-focus min-h-touch self-start px-3 text-sm font-medium text-t-amber-bright underline underline-offset-2 hover:text-t-amber sm:self-auto"
          >
            {tc("actions.startOver")}
          </button>
        </div>
      )}
      <GhostGuide
        message={getOpusMessage("welcome", audience, isDemo, locale)}
        pageId="welcome"
      />

      {isDemo && (
        <div className="bg-t-panel-2 px-4 py-3 mb-4 border border-t-amber">
          <p className="text-sm text-t-amber-bright font-medium">
            {t("demoNote")}
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
          <p className="mb-1 font-medium text-t-white">{t("howMuch")}</p>
          <p className="mb-3 text-sm text-t-phos-dim">
            {selected === "ready-now" && depth === "light"
              ? t("shortSet")
              : t("pickFits")}
          </p>
          <CardSelect options={PATH_OPTIONS} selected={depth} onSelect={(id) => setDepth(id as "light" | "full")} />
        </div>
      )}

      {/* t.ROY acknowledges the selection */}
      {acknowledged && selected && TROY_RESPONSE_IDS.has(selected) && (
        <div className="mt-4 bg-t-panel px-4 py-3 border border-t-line flex items-start gap-3 animate-in fade-in duration-300">
          <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center">
            <TroyLivingIcon size={26} />
          </span>
          <p className="text-sm text-t-phos leading-relaxed">
            {t(`troyResponses.${selected}`)}
          </p>
        </div>
      )}
    </FlowPage>
  );
}

"use client";

/**
 * Page 6: "Building your story"
 *
 * While /api/analyze works (one call, no streaming), the person sees their
 * own page with t.ROY walking it: a pointer moves from one real flaw to the
 * next and t.ROY says, in plain words, what is wrong and what the new page
 * does instead. The flaws come from the mint check run in this browser on
 * the text they already gave; nothing extra is sent anywhere.
 *
 * The status shows only what is true: sent, working (with the real time so
 * far), done. No percentages and no made-up stages.
 *
 * Privacy: only the resume text is shown. Record answers never appear here.
 * The shell goes quiet, and "Clear this computer" stays in the header.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useForgeSession } from "@/lib/forge-context";
import { rebuildActive } from "@/lib/lane-task";
import { DEMO_OUTPUT, DEMO_SESSION } from "@/lib/demo-data";
import { buildResumeTour, buildFailure, jobCardsFrom, type BuildFailure } from "@/lib/showstopper-tour";
import { useQuietShell } from "../quiet-shell";
import { BuildStatus, type BuildPhase } from "@/components/forge/showstopper/BuildStatus";
import { OldPageTour } from "@/components/forge/showstopper/OldPageTour";
import { JobCards } from "@/components/forge/showstopper/JobCards";
import { TroyArrival } from "@/components/forge/showstopper/TroyArrival";
import { useReducedMotion } from "@/components/forge/showstopper/useReducedMotion";
import { WorkFocus } from "@/components/forge/WorkFocus";

/** Stop waiting after this long; the server gives up well before it. */
const HARD_STOP_MS = 180_000;
/** A beat on "Done" so the person sees it finished before the page changes. */
const DONE_PAUSE_MS = 1500;

/**
 * A build failure, plus which copy to say it with. buildFailure
 * (lib/showstopper-tour.ts) words each failure in English; the screen says it
 * from the catalog, so it keeps the cause (and when it happened, for the daily
 * limit's reset time) next to buildFailure's `kind`, which still decides the buttons.
 */
type Failed = BuildFailure & {
  copy: "limit" | "tooBig" | "timeout" | "network" | "other";
  at: Date;
};

function failedWith(cause: Parameters<typeof buildFailure>[0]): Failed {
  const at = new Date();
  const copy =
    cause === 429 ? "limit" : cause === 413 ? "tooBig" : cause === "timeout" || cause === 504 ? "timeout" : cause === "network" ? "network" : "other";
  return { ...buildFailure(cause, at), copy, at };
}

/** When the daily limit opens again: same rule as limitResetLabel, in the site language. */
function limitResetParts(now: Date, locale: string): { time: string; today: boolean } {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const time = reset.toLocaleTimeString(locale === "es" ? "es-US" : "en-US", { hour: "numeric", minute: "2-digit" });
  const day = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "numeric", day: "numeric" });
  return { time, today: day(reset) === day(now) };
}

export default function ProcessingPage() {
  useQuietShell();
  const t = useTranslations("forgeProcessing");
  const locale = useLocale();
  const router = useRouter();
  const { session, updateSession, runIsMine, mayUseRun } = useForgeSession();
  const isDemo = session.isDemo === true;
  const reduced = useReducedMotion();

  const [runId, setRunId] = useState(0);
  const [phase, setPhase] = useState<BuildPhase>("sending");
  const [elapsed, setElapsed] = useState(0);
  const [failure, setFailure] = useState<Failed | null>(null);
  const startedRun = useRef(-1);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // What goes on screen while it works. A page the person typed in the
  // builder is not a "before", so it gets plain job cards instead.
  // Show the page as the person gave it, not the builder's cleaned copy.
  const resumeText = isDemo
    ? session.resumeText || DEMO_SESSION.resumeText
    : session.originalResumeText || session.resumeText;
  const tour = useMemo(
    () => (session.resumeMethod === "guided" && !isDemo ? null : buildResumeTour(resumeText)),
    [resumeText, session.resumeMethod, isDemo]
  );
  const jobs = useMemo(
    () => (tour ? [] : jobCardsFrom(session.resumeDoc?.experience, session.carriedIn?.jobs)),
    [tour, session.resumeDoc, session.carriedIn]
  );

  // The one real call. Runs once per attempt; "Try again" starts a new attempt.
  useEffect(() => {
    if (isDemo || startedRun.current === runId) return;
    // Never send a run that is not this account's (security review 3a r2,
    // L1: readOwnForgeSession). The "Is it yours?" answer re-renders this page.
    if (!runIsMine()) return;
    startedRun.current = runId;
    const t0 = Date.now();
    setFailure(null);
    setElapsed(0);
    setPhase("sending");

    const controller = new AbortController();
    const hardStop = setTimeout(() => controller.abort(), HARD_STOP_MS);
    const fail = (f: Failed) => {
      clearTimeout(hardStop);
      if (mounted.current) setFailure(f);
    };

    (async () => {
      let response: Response;
      try {
        const pending = fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            // Phase 6 S1 (review r1 L4, r2 L1): a rebuild's analysis reads the saved
            // page as starting text only; its checks read the run's own text.
            resumeText: session.resumeText,
            startingText: rebuildActive(session) ? session.originalResumeText : undefined,
            readinessStage: session.readinessStage,
            goals: session.goals,
            goalNarrative: session.goalNarrative,
            hookNarrative: session.hookNarrative,
            challenges: session.challenges,
            criminalRecord: session.criminalRecord,
            challengeNarratives: session.challengeNarratives,
            preferences: session.preferences,
          }),
        });
        setPhase("working");
        response = await pending;
      } catch {
        return fail(failedWith(controller.signal.aborted ? "timeout" : "network"));
      }
      if (!response.ok) return fail(failedWith(response.status));
      let forgeOutput: Record<string, unknown>;
      try {
        forgeOutput = await response.json();
      } catch {
        return fail(failedWith("unreadable"));
      }
      clearTimeout(hardStop);
      updateSession({ forgeOutput, lastPageVisited: "processing" });
      if (!mounted.current) return;
      setElapsed((Date.now() - t0) / 1000);
      setPhase("done");
      setTimeout(() => {
        if (mounted.current) router.push("/output");
      }, DONE_PAUSE_MS);
    })();
  }, [runId, mayUseRun]); // eslint-disable-line react-hooks/exhaustive-deps

  // The real time so far, while it works.
  useEffect(() => {
    if (isDemo || phase !== "working" || failure) return;
    const t0 = Date.now() - elapsed * 1000;
    const timer = setInterval(() => setElapsed((Date.now() - t0) / 1000), 1000);
    return () => clearInterval(timer);
  }, [phase, failure, isDemo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing here claims work is going on once it has stopped.
  const building = isDemo || !failure;
  const intro = tour
    ? tour.steps.length
      ? t("intro.tourSteps")
      : t("intro.tourNone")
    : jobs.length
      ? building
        ? t("intro.jobsBuilding")
        : t("intro.jobsStopped")
      : building
        ? t("intro.answersBuilding")
        : t("intro.answersStopped");

  const failureBody = (f: Failed) => {
    if (f.copy !== "limit") return t(`failure.${f.copy}.body`);
    const { time, today } = limitResetParts(f.at, locale);
    return t(today ? "failure.limit.bodyToday" : "failure.limit.bodyTomorrow", { time });
  };

  const openDemoResults = () => {
    updateSession({ forgeOutput: DEMO_OUTPUT, lastPageVisited: "processing" });
    router.push("/output");
  };

  return (
    <WorkFocus active={!failure && phase !== "done"} title={t("workFocusTitle")}>
    <div className="forge-workshop -mb-8 min-h-[calc(100vh-72px)] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <div className="mx-auto w-full max-w-6xl">
        <h1 className="mb-4 font-display text-2xl font-bold text-t-white sm:text-3xl">{t("title")}</h1>

        {/* What is really happening */}
        <div className="mb-6">
          {isDemo ? (
            <div className="flex flex-col gap-3 border border-t-line bg-t-panel px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-t-bone-dim">{t("demo.note")}</p>
              <button
                type="button"
                onClick={openDemoResults}
                className="t-focus min-h-touch bg-t-amber px-5 font-term text-sm font-bold text-ws-bg hover:bg-t-amber-bright"
              >
                {t("demo.seeResults")}
              </button>
            </div>
          ) : failure ? (
            <div role="alert" className="border border-ws-red-bright bg-t-panel px-4 py-4">
              <p className="text-base font-bold text-t-white">{t(`failure.${failure.copy}.title`)}</p>
              <p className="mt-1 max-w-2xl text-sm text-t-bone-dim">{failureBody(failure)}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {failure.kind === "retry" && (
                  <button
                    type="button"
                    onClick={() => setRunId((n) => n + 1)}
                    className="t-focus min-h-touch bg-t-amber px-6 font-term text-sm font-bold text-ws-bg hover:bg-t-amber-bright"
                  >
                    {t("failure.tryAgain")}
                  </button>
                )}
                {failure.kind !== "retry" && (
                  <Link
                    href="/preferences"
                    className="t-focus inline-flex min-h-touch items-center border border-t-line px-5 font-term text-sm text-t-white hover:border-ws-amber"
                  >
                    {t("failure.backToAnswers")}
                  </Link>
                )}
              </div>
              {failure.kind === "retry" && (
                <p className="mt-2 text-xs text-t-bone-dim">{t("failure.countsToward")}</p>
              )}
            </div>
          ) : (
            <BuildStatus phase={phase} elapsed={elapsed} />
          )}
        </div>

        {/* t.ROY and the page */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-8 lg:gap-y-5">
          <div
            className={`flex items-center gap-3 lg:items-start ${
              tour || jobs.length ? "lg:col-start-2 lg:row-start-1" : "lg:col-span-2"
            }`}
          >
            <TroyArrival size={56} reduced={reduced} />
            <p className="text-base leading-relaxed text-t-white lg:pt-5">
              <span className="sr-only">{t("troySays")}</span>
              {intro}
            </p>
          </div>

          {tour ? (
            <OldPageTour tour={tour} reduced={reduced} />
          ) : jobs.length ? (
            <JobCards jobs={jobs} />
          ) : null}
        </div>

      </div>
    </div>
    </WorkFocus>
  );
}

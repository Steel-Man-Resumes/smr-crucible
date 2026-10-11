"use client";

/**
 * The first screen: "What do you need today?" (Phase 5 lane R2; Troy
 * 2026-10-10; Codex review section C).
 *
 * Three main routes (a resume I can use, go after a job, get ready for an
 * interview), a quieter "Something else", and a quiet help link. The pick is
 * saved as today's task (migration 083 when signed in; this browser's run
 * otherwise) and decides the next screen. No readiness question, no
 * short/full chooser, no goals before the first page.
 *
 * Coming back: signed in, the lane home is the Refinery overview; signed
 * out, this page shows where the run is with one "Keep going". "Change"
 * (?change=1) always opens the picker again.
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { TaskPicker } from "@/components/lanes/TaskPicker";
import { LaneHeader } from "@/components/lanes/LaneHeader";
import { useLaneFocus } from "@/components/lanes/useLaneFocus";
import { planForgePath } from "@/lib/forge-path";
import {
  DOCUMENT_LINKS,
  LANE_HOME_HREF,
  START_PATH,
  TASK_COPY,
  isLaneTask,
  routeHref,
  type LaneTask,
} from "@/lib/lane-task";

export default function StartPage() {
  return (
    <Suspense>
      <StartInner />
    </Suspense>
  );
}

const signInFor = (path: string) => `/login?from=forge&callbackUrl=${encodeURIComponent(path)}`;

function StartInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { session, updateSession } = useForgeSession();
  const focus = useLaneFocus({ task: session.laneTask, target: session.laneTarget });
  const change = params.get("change") === "1";
  const step = params.get("step");
  const [busy, setBusy] = useState(false);
  const [accountResume, setAccountResume] = useState<boolean | null>(null);
  const [target, setTarget] = useState<string>("");

  // Does the account already hold a resume? (Interview and job routes skip the resume step when it does.)
  useEffect(() => {
    if (!focus.signedIn) {
      setAccountResume(false);
      return;
    }
    let live = true;
    fetch("/api/revisions?forge=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setAccountResume(!!j?.revision))
      .catch(() => live && setAccountResume(false));
    return () => {
      live = false;
    };
  }, [focus.signedIn]);

  useEffect(() => {
    if (focus.loaded && !target && focus.target) setTarget(focus.target);
  }, [focus.loaded, focus.target]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returning and signed in, with a task already picked: the lane home.
  useEffect(() => {
    if (!focus.loaded || change || step) return;
    if (focus.signedIn && focus.task) router.replace(LANE_HOME_HREF);
  }, [focus.loaded, focus.signedIn, focus.task, change, step, router]);

  const hasResume = !!session.resumeText || accountResume === true;

  /** Keep this browser's run in step with the pick (signed out, this IS the saved pick). */
  function keepInRun(task: LaneTask, laneTarget?: string | null) {
    updateSession({
      laneTask: task,
      ...(laneTarget !== undefined ? { laneTarget: laneTarget || undefined } : {}),
      // Tone only, inferred cautiously from the route: someone going after a
      // job or an interview needs work now (lib/forge-path.ts R1/R2).
      readinessStage: task === "job" || task === "interview" ? "action" : "preparation",
      audience: session.audience ?? "client",
      startedAt: session.startedAt ?? new Date().toISOString(),
      lastPageVisited: "start",
      pagesVisited: Array.from(new Set([...(session.pagesVisited || []), "start"])),
    });
  }

  async function pick(task: LaneTask) {
    setBusy(true);
    keepInRun(task);
    await focus.save(task);
    setBusy(false);
    router.push(routeHref(task, { signedIn: focus.signedIn, hasResume }));
  }

  async function continueJob() {
    setBusy(true);
    const t = target.replace(/\s+/g, " ").trim().slice(0, 200);
    keepInRun("job", t || null);
    await focus.save("job", t || null);
    setBusy(false);
    // A resume on file: aim it at this job. None yet: build only what this job needs.
    router.push(focus.signedIn && hasResume ? `/dashboard/application-tailor${t ? `?role=${encodeURIComponent(t)}` : ""}` : "/resume");
  }

  if (!focus.loaded || (focus.signedIn && focus.task && !change && !step)) {
    return <div className="h-40" aria-busy="true" />;
  }

  // ---- the job route's one step ----------------------------------------------
  if (step === "job") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6" data-testid="job-step">
        <Link href={`${START_PATH}?change=1`} className="t-focus inline-flex min-h-touch items-center text-sm text-t-bone-dim hover:text-t-amber-bright">
          Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-t-white">What job are you going after?</h1>
        <p className="mt-1 text-sm text-t-phos-dim">Type the job title, or paste the posting. Not sure yet? Leave it empty.</p>
        <label htmlFor="job-target" className="mt-5 block text-sm font-medium text-t-white">
          The job <span className="font-normal text-t-phos-dim">(optional)</span>
        </label>
        <textarea
          id="job-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="For example: forklift driver"
          className="mt-1 w-full border border-t-line bg-t-panel px-4 py-3 text-base text-t-white focus:border-t-amber focus:outline-none"
          data-testid="job-target"
        />
        <button
          type="button"
          onClick={continueJob}
          disabled={busy}
          className="t-focus mt-4 min-h-touch w-full bg-t-amber px-6 py-3 text-base font-bold text-white shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright disabled:opacity-60 sm:w-auto"
          data-testid="job-continue"
        >
          Continue
        </button>
        <div className="mt-6 space-y-2 text-sm">
          <p>
            <Link href="/rush" className="t-focus text-t-phos underline underline-offset-2 hover:text-t-white" data-testid="rush-branch">
              Job in mind and short on time? Do a quick version first.
            </Link>
          </p>
          <p>
            <Link
              href={focus.signedIn ? "/dashboard/jobs" : signInFor("/dashboard/jobs")}
              className="t-focus text-t-phos underline underline-offset-2 hover:text-t-white"
            >
              No job in mind yet? Find one.
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // ---- "Something else" routes, signed out: they live in the free account ----
  if (step === "documents" || step === "explore" || step === "support") {
    const task = step as LaneTask;
    const dest = task === "documents" ? "/dashboard/creative" : task === "explore" ? "/dashboard/resources#paths" : "/dashboard/resources#support";
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6" data-testid={`${task}-step`}>
        <Link href={`${START_PATH}?change=1`} className="t-focus inline-flex min-h-touch items-center text-sm text-t-bone-dim hover:text-t-amber-bright">
          Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-t-white">{TASK_COPY[task].label}</h1>
        <p className="mt-1 text-sm text-t-phos-dim">{TASK_COPY[task].body}</p>
        {task === "documents" && (
          <ul className="mt-4 space-y-2">
            {DOCUMENT_LINKS.map((d) => (
              <li key={d.href} className="border border-t-line bg-t-panel px-4 py-3">
                <p className="font-semibold text-t-white">{d.label}</p>
                <p className="text-sm text-t-phos-dim">{d.body}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-5 text-sm text-t-phos">This part works in your free account, so your work is saved.</p>
        <Link
          href={signInFor(dest)}
          className="t-focus mt-3 inline-flex min-h-touch items-center bg-t-amber px-6 py-3 text-base font-bold text-white hover:bg-t-amber-bright"
        >
          Sign in free
        </Link>
      </div>
    );
  }

  // ---- signed out, coming back: where the run is, one way on ------------------
  if (!change && focus.task && isLaneTask(session.laneTask)) {
    const next = session.forgeOutput ? "/output" : planForgePath(session).screens[0].path;
    return (
      <div data-testid="lane-home">
        <LaneHeader task={focus.task} target={focus.target} />
        <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
          <h1 className="text-2xl font-bold text-t-white">Welcome back.</h1>
          <p className="mt-1 text-sm text-t-phos-dim">
            {session.forgeOutput ? "Your resume is waiting for you." : session.resumeText ? "Your resume is saved on this computer." : "Pick up where you left off."}
          </p>
          <button
            type="button"
            onClick={() => router.push(next)}
            className="t-focus mt-5 min-h-touch w-full bg-t-amber px-6 py-3 text-base font-bold text-white hover:bg-t-amber-bright sm:w-auto"
            data-testid="lane-home-continue"
          >
            Keep going
          </button>
        </div>
      </div>
    );
  }

  // ---- the first screen ---------------------------------------------------------
  return (
    <div className="px-4 py-8 sm:px-6">
      <TaskPicker
        current={focus.task}
        onPick={pick}
        busy={busy}
        helpHref={focus.signedIn ? "/dashboard/resources#support" : `${START_PATH}?step=support`}
      />
    </div>
  );
}

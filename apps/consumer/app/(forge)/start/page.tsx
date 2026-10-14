"use client";

/**
 * The Forge's first decision: bring a resume or build one with t.ROY.
 *
 * The choice is saved as today's resume task (migration 083 when signed in;
 * this browser's run otherwise) and selects the matching intake path. Job and
 * interview routes remain compatible with saved runs and direct links, while
 * the new entrance leaves those decisions to the Refinery.
 *
 * Coming back: signed in, the lane home is the Refinery overview; signed
 * out, this page shows where the run is with one "Keep going". "Change"
 * (?change=1) always opens the two resume choices again.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { LaneHeader } from "@/components/lanes/LaneHeader";
import { useLaneFocus } from "@/components/lanes/useLaneFocus";
import { planForgePath } from "@/lib/forge-path";
import {
  DRAFT_BADGE,
  DOCUMENT_LINKS,
  LANE_HOME_HREF,
  START_PATH,
  TASK_COPY,
  isLaneTask,
  keepGoingHref,
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
  // Sent here by the Refinery because the resume is not built yet: show where
  // the run is, never send them back (that would loop).
  const fromRefinery = params.get("from") === "refinery";
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const navigating = useRef(false);
  // The account's saved resume (R1 revision), for the "welcome back" line.
  const [accountRev, setAccountRev] = useState<{ number: number; status: string } | null>(null);
  // The Refinery opens once the Forge resume is built (onboarding's forgeComplete).
  const [forgeComplete, setForgeComplete] = useState<boolean>(false);
  const [target, setTarget] = useState<string>("");

  // What the account already holds: a saved resume, and whether the Refinery is open to it.
  useEffect(() => {
    if (!focus.signedIn) return;
    let live = true;
    fetch("/api/revisions?forge=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && j?.revision && setAccountRev({ number: Number(j.revision.number), status: String(j.revision.status) }))
      .catch(() => undefined);
    fetch("/api/user/journey", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setForgeComplete(j?.snapshot?.metrics?.forgeComplete === true))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [focus.signedIn]);

  useEffect(() => {
    if (focus.loaded && !target) setTarget(session.laneJobPosting || focus.target || "");
  }, [focus.loaded, focus.target]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returning and signed in, with a task already picked: the lane home.
  useEffect(() => {
    if (!focus.loaded || change || step || fromRefinery || navigating.current) return;
    if (focus.signedIn && focus.task) router.replace(LANE_HOME_HREF);
  }, [focus.loaded, focus.signedIn, focus.task, change, step, fromRefinery, router]);

  // Practice and tailoring live in the Refinery, which opens once the Forge resume is built.
  const hasResume = !!session.forgeOutput || forgeComplete;

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

  async function pick(task: LaneTask, entry?: "upload" | "quick") {
    navigating.current = true;
    setBusy(true);
    setSaveError("");
    const saved = await focus.save(task);
    setBusy(false);
    if (!saved) { navigating.current = false; setSaveError("Your choice wasn't saved. Try again."); return; }
    keepInRun(task);
    router.push(entry && task === "resume" ? `/resume?entry=${entry}` : routeHref(task, { signedIn: focus.signedIn, hasResume }));
  }

  async function continueJob() {
    setBusy(true);
    setSaveError("");
    const posting = target.trim().slice(0, 4000);
    const firstLine = posting.split("\n")[0].replace(/\s+/g, " ").trim();
    const t = firstLine.length <= 200 ? firstLine : "Your selected job";
    const saved = await focus.save("job", t || null);
    setBusy(false);
    if (!saved) { navigating.current = false; setSaveError("Your choice wasn't saved. Try again."); return; }
    keepInRun("job", t || null);
    updateSession({ laneJobPosting: posting });
    // A resume on file: aim it at this job. None yet: build only what this job needs.
    router.push(focus.signedIn && hasResume ? "/dashboard/application-tailor?from=start" : "/resume");
  }

  if (!focus.loaded || (focus.signedIn && focus.task && !change && !step && !fromRefinery)) {
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
        {saveError && <p role="alert" className="mt-3 text-t-red">{saveError}</p>}
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

  // ---- coming back before the resume is built: where the run is, one way on --
  if (!change && focus.task && (fromRefinery || isLaneTask(session.laneTask))) {
    const task = focus.task;
    const next = keepGoingHref(task, {
      signedIn: focus.signedIn,
      hasForgeOutput: !!session.forgeOutput,
      hasResumeText: !!session.resumeText,
      forgeNext: planForgePath({ ...session, laneTask: task }).screens[0].path,
    });
    return (
      <div data-testid="lane-home">
        <LaneHeader task={focus.task} target={focus.target} />
        <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
          <h1 className="text-2xl font-bold text-t-white">Welcome back.</h1>
          <p className="mt-1 text-sm text-t-phos-dim" data-testid="lane-home-resume">
            {accountRev
              ? `Your resume is saved to your account (version ${accountRev.number}).`
              : session.forgeOutput
                ? "Your resume is waiting for you."
                : session.resumeText
                  ? "Your resume is saved on this computer."
                  : "Pick up where you left off."}
          </p>
          {accountRev && accountRev.status !== "finished" && (
            <p className="mt-1 text-sm text-t-amber-bright" data-testid="draft-badge">
              {DRAFT_BADGE}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              if (session.laneTask !== task) keepInRun(task);
              router.push(next);
            }}
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
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6" data-testid="forge-start">
      {saveError && <p role="alert" className="mb-3 text-t-red">{saveError}</p>}
      <p className="font-term text-xs font-bold uppercase tracking-[0.16em] text-t-amber-bright">The Forge · first decision</p>
      <h1 className="mt-2 font-display text-3xl font-bold text-t-white">What can we start with?</h1>
      <p className="mt-3 max-w-2xl text-base text-t-phos">The Forge builds your general resume from what you actually did. Bring any old version if you can. Even a bad one saves you from rebuilding your history from memory.</p>
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <button type="button" disabled={busy} onClick={() => void pick("resume", "upload")} className="t-focus min-h-[180px] border-2 border-t-amber bg-t-panel-2 p-5 text-left hover:bg-t-panel disabled:opacity-60" data-testid="forge-bring-resume">
          <span className="font-term text-xs font-bold uppercase tracking-[0.14em] text-t-amber-bright">Recommended · less typing</span>
          <span className="mt-4 block text-xl font-bold text-t-white">I have a resume, even a rough one</span>
          <span className="mt-2 block text-sm text-t-phos">Upload, photograph, or paste it. t.ROY reads it, asks you to fix uncertain facts, then writes the strongest general page it can support.</span>
          <span className="mt-4 block text-xs text-t-phos-dim">Time: shorter · Effort: review and correct · Output: general resume</span>
        </button>
        <button type="button" disabled={busy} onClick={() => void pick("resume", "quick")} className="t-focus min-h-[180px] border border-t-line bg-t-panel p-5 text-left hover:border-t-amber disabled:opacity-60" data-testid="forge-build-resume">
          <span className="font-term text-xs font-bold uppercase tracking-[0.14em] text-t-phos-dim">No page yet · more talking</span>
          <span className="mt-4 block text-xl font-bold text-t-white">Build one with t.ROY</span>
          <span className="mt-2 block text-sm text-t-phos">Start with one real job and something you did there. Speak or type. t.ROY helps assemble a page, and you check every fact.</span>
          <span className="mt-4 block text-xs text-t-phos-dim">Time: longer · Effort: tell us your history · Output: general resume</span>
        </button>
      </div>
      <div className="mt-6 border-l-4 border-[#4f6b57] bg-t-panel px-5 py-4">
        <h2 className="font-semibold text-t-white">Then comes The Refinery</h2>
        <p className="mt-1 text-sm text-t-phos">Your general page is the foundation. Job-specific applications, employer research, and interview practice need more of your history and belong in The Refinery. You can make those decisions after this first step.</p>
      </div>
      <p className="mt-5 text-sm text-t-phos-dim">Want to look first? <Link href="/check" className="t-focus text-t-white underline underline-offset-2">Check a resume for free</Link>. The quick check is open to everyone.</p>
    </div>
  );
}

"use client";

/**
 * The lane home (Phase 5 lane R2): the top of the Refinery overview once a
 * task is picked. Three things, in order: the person's current resume (with
 * an honest draft line and its next step: "Check and finish" for a draft the
 * writer made, "Build it with t.ROY" for a page saved as given), the one next task for
 * today's route, and the support that fits. The shell keeps every tool reachable.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { resumeWorkspaceAction, savedResumeAction, workspaceNextAction } from "@/lib/workspace-next-action";
import type { RefineryWorkspaceContext } from "@/lib/refinery-workspace";
import { LANES_CHANGED_EVENT } from "@/lib/lanes";
import { LANE_FOCUS_CHANGED_EVENT } from "./useLaneFocus";
import { laneToolHref } from "@/lib/lane-goals";
import { isLaneKind } from "@crucible/core/src/careerLaneShared";
import {
  BUILD_WITH_TROY_LABEL,
  CARDS_PARAM,
  CHECK_AND_FINISH_LABEL,
  DOCUMENT_LINKS,
  DRAFT_BADGE,
  TASK_COPY,
  rebuildHref,
  type LaneTask,
} from "@/lib/lane-task";

interface ForgeRevision {
  id: string;
  artifactId: string;
  number: number;
  status: "draft" | "finished";
  /** Phase 6: made by the writer (the server checked its lineage for a generate-docs receipt), not a page saved as given. */
  fromWriter?: boolean;
}

/**
 * Where a draft goes next (Phase 6, plan Q1). A draft the writer made goes to
 * "Check and finish". A page saved as the person gave it (an older "I have
 * one" save, or a "Build with me" first section) is never checked as it is
 * here: it goes to the writer, with that page as the source.
 */
export function draftNext(rev: Pick<ForgeRevision, "artifactId" | "fromWriter">): { label: string; href: string } {
  // The writer's own draft opens straight on its cards (no "rewrite it" offer for t.ROY's own page).
  return rev.fromWriter
    ? { label: CHECK_AND_FINISH_LABEL, href: `/output?check=${rev.artifactId}&${CARDS_PARAM}=1` }
    : { label: BUILD_WITH_TROY_LABEL, href: rebuildHref(rev.artifactId) };
}

/** The one next task on the lane home, by route and by where the resume stands. */
export function laneHomeNext(task: LaneTask, rev: Pick<ForgeRevision, "status" | "artifactId" | "fromWriter"> | null): { label: string; href: string } {
  // Interview practice and the other immediate tasks can start without a resume.
  if (!rev && task === "resume") return { label: "Start your resume", href: "/resume" };
  switch (task) {
    case "resume":
      // Round 3 (review r1 H1): a page the writer never made goes to the writer, even when a check of it passed.
      return rev!.status === "finished" && rev!.fromWriter ? { label: "Get your files in My resumes", href: "/dashboard/vault" } : draftNext(rev!);
    case "job":
      return { label: "Pick a job to go after", href: "/dashboard/jobs" };
    case "interview":
      return { label: "Practice for your interview", href: "/dashboard/interview" };
    case "documents":
      return { label: "Open creative work", href: "/dashboard/creative" };
    case "explore":
      return { label: "See job paths", href: "/dashboard/paths" };
    case "support":
      return { label: "Find help near you", href: "/dashboard/resources#support" };
  }
}

export function LaneHome({ task, profileFirst = false, laneId = null, hidePrimaryAction = false }: { task: LaneTask; profileFirst?: boolean; laneId?: string | null; hidePrimaryAction?: boolean }) {
  const laneKey = laneId || "main";
  const [result, setResult] = useState<{ key: string; work: RefineryWorkspaceContext | null; error: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      setResult(null);
      fetch(`/api/workspace-context?laneId=${encodeURIComponent(laneKey)}`, { cache: "no-store", signal: current.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Could not load saved work");
          const body = await response.json();
          if (!body?.data) throw new Error("Could not load saved work");
          if (live && !current.signal.aborted) setResult({ key: laneKey, work: body.data, error: false });
        })
        .catch(() => { if (live && !current.signal.aborted) setResult({ key: laneKey, work: null, error: true }); });
    };
    load();
    const events = [LANES_CHANGED_EVENT, LANE_FOCUS_CHANGED_EVENT, "resume-saved", "forge-synced", "next-step-changed"];
    events.forEach((event) => window.addEventListener(event, load));
    return () => { live = false; controller?.abort(); events.forEach((event) => window.removeEventListener(event, load)); };
  }, [retry, laneKey]);
  const current = result?.key === laneKey ? result : null;
  const loaded = !!current;
  const loadError = current?.error === true;
  const work = current?.work;
  const rev = work?.revision;
  const documentHref = work?.lane && isLaneKind(work.lane.kind) ? laneToolHref(work.lane.kind, work.lane.id) : null;
  const resumeNext = rev ? resumeWorkspaceAction(rev) : null;
  const next = loaded && !loadError ? workspaceNextAction({ work: work || null, task, profileFirst }) : null;
  const box = "border border-t-line bg-t-panel p-4";
  return (
    <section aria-labelledby="lane-home-heading" className="space-y-3" data-testid="lane-home">
      <h1 id="lane-home-heading" className="text-2xl font-bold text-t-white">
        Today: {TASK_COPY[task].label}
      </h1>
      <div className={`grid gap-3 ${hidePrimaryAction ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
        <div className={box} data-testid="lane-home-resume">
          <p className="text-xs font-semibold uppercase text-t-bone-dim">{documentHref ? "This lane’s documents" : "Current resume"}</p>
          {!loaded ? (
            <p className="mt-1 text-sm text-t-phos-dim">Loading...</p>
          ) : loadError ? (
            <div className="mt-1 text-sm">
              <p role="alert" className="text-t-red">We couldn't load your saved resume. Try again to check your latest work.</p>
              <button type="button" onClick={() => setRetry((n) => n + 1)} className="t-focus mt-2 min-h-touch text-t-amber-bright underline underline-offset-2">Try again</button>
            </div>
          ) : documentHref ? (
            <Link href={documentHref} className="t-focus mt-2 inline-flex min-h-touch items-center text-sm text-t-amber-bright underline underline-offset-2">Open {work?.lane?.name || "your documents"}</Link>
          ) : rev ? (
            <>
              <p className="mt-1 text-sm font-semibold text-t-white">Version {rev.number}{rev.status === "finished" ? ", finished" : ""}</p>
              {rev.status !== "finished" && (
                <p className="mt-1 text-sm text-t-amber-bright" data-testid="draft-badge">
                  {DRAFT_BADGE}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {(rev.status !== "finished" || !rev.fromWriter) && (
                  <Link href={resumeNext!.href} className="t-focus min-h-touch inline-flex items-center font-medium text-t-amber-bright underline underline-offset-2" data-testid="lane-home-check">
                    {resumeNext!.label}
                  </Link>
                )}
                <Link href="/dashboard/vault" className="t-focus min-h-touch inline-flex items-center text-t-phos underline underline-offset-2">
                  My resumes
                </Link>
              </div>
            </>
          ) : work?.selection?.artifactId ? (
            <>
              <p className="mt-1 text-sm text-t-phos" data-testid="lane-home-unversioned">You have a saved resume in this lane. It has no checked version yet.</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <Link href={savedResumeAction(work.selection.artifactId).href} className="t-focus min-h-touch inline-flex items-center font-medium text-t-amber-bright underline underline-offset-2" data-testid="lane-home-review">
                  {savedResumeAction(work.selection.artifactId).label}
                </Link>
                <Link href="/dashboard/vault" className="t-focus min-h-touch inline-flex items-center text-t-phos underline underline-offset-2">
                  My resumes
                </Link>
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-t-phos">No saved resume version in this lane yet.</p>
          )}
        </div>
        {!hidePrimaryAction && <div className={box} data-testid="lane-home-next">
          <p className="text-xs font-semibold uppercase text-t-bone-dim">Next</p>
          {next ? <Link
            href={next.href}
            className="t-focus mt-2 inline-flex min-h-touch w-full items-center justify-center bg-t-amber px-4 py-2.5 text-sm font-bold text-white hover:bg-t-amber-bright"
            data-testid="lane-home-next-action"
          >
            {next.label}
          </Link> : <p className="mt-2 text-sm text-t-phos-dim">{loadError ? "Reload your workspace to see the next step." : "Loading your next step..."}</p>}
          {task === "documents" && (
            <ul className="mt-2 space-y-1 text-sm">
              {DOCUMENT_LINKS.map((d) => (
                <li key={d.href}>
                  <Link href={d.href} className="t-focus text-t-phos underline underline-offset-2 hover:text-t-white">
                    {d.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>}
        <div className={box} data-testid="lane-home-support">
          <p className="text-xs font-semibold uppercase text-t-bone-dim">Support</p>
          <p className="mt-1 text-sm text-t-phos">Rides, ID, a place to stay, food, and legal help with a record.</p>
          <Link href="/dashboard/resources#support" className="t-focus mt-2 inline-flex min-h-touch items-center text-sm font-medium text-t-amber-bright underline underline-offset-2">
            Get support
          </Link>
        </div>
      </div>
    </section>
  );
}

"use client";

/**
 * The lane home (Phase 5 lane R2): the top of the Refinery overview once a
 * task is picked. Three things, in order: the person's current resume (with
 * an honest draft line and its next step: "Check and finish" for a draft the
 * writer made, "Build it with t.ROY" for a page saved as given), the one next task for
 * today's route, and the support that fits. "All tools" follows it on the
 * page, so every tool stays reachable.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BUILD_WITH_TROY_LABEL,
  CARDS_PARAM,
  CHECK_AND_FINISH_LABEL,
  DOCUMENT_LINKS,
  DRAFT_BADGE,
  TASK_COPY,
  rebuildHref,
  writtenByTroy,
  type LaneTask,
} from "@/lib/lane-task";

interface ForgeRevision {
  id: string;
  artifactId: string;
  number: number;
  status: "draft" | "finished";
  /** Phase 6: made by the writer (its receipt matched), not a page saved as given. */
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
  // Only the resume and interview routes need a resume first (review H1).
  if (!rev && (task === "resume" || task === "interview")) return { label: "Start your resume", href: "/resume" };
  switch (task) {
    case "resume":
      return rev!.status === "finished" ? { label: "Get your files in My resumes", href: "/dashboard/vault" } : draftNext(rev!);
    case "job":
      return { label: "Pick a job to go after", href: "/dashboard/jobs" };
    case "interview":
      return { label: "Practice for your interview", href: "/dashboard/interview" };
    case "documents":
      return { label: "Open creative work", href: "/dashboard/creative" };
    case "explore":
      return { label: "See job paths", href: "/dashboard/resources#paths" };
    case "support":
      return { label: "Find help near you", href: "/dashboard/resources#support" };
  }
}

export function LaneHome({ task, profileFirst = false }: { task: LaneTask; profileFirst?: boolean }) {
  const [rev, setRev] = useState<ForgeRevision | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/revisions?forge=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live) return;
        const r = j?.revision;
        setRev(r && typeof r.id === "string" ? { id: r.id, artifactId: r.artifactId, number: r.number, status: r.status, fromWriter: writtenByTroy(r) } : null);
      })
      .catch(() => undefined)
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, []);

  // A new account saves its profile (name, phone) before the Refinery's tools open.
  const next = profileFirst ? { label: "Save your profile below", href: "#profile-setup" } : laneHomeNext(task, rev);
  const box = "border border-t-line bg-t-panel p-4";
  return (
    <section aria-labelledby="lane-home-heading" className="space-y-3" data-testid="lane-home">
      <h1 id="lane-home-heading" className="text-2xl font-bold text-t-white">
        Today: {TASK_COPY[task].label}
      </h1>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className={box} data-testid="lane-home-resume">
          <p className="text-xs font-semibold uppercase text-t-bone-dim">Your resume</p>
          {!loaded ? (
            <p className="mt-1 text-sm text-t-phos-dim">Loading...</p>
          ) : rev ? (
            <>
              <p className="mt-1 text-sm font-semibold text-t-white">Version {rev.number}{rev.status === "finished" ? ", finished" : ""}</p>
              {rev.status !== "finished" && (
                <p className="mt-1 text-sm text-t-amber-bright" data-testid="draft-badge">
                  {DRAFT_BADGE}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {rev.status !== "finished" && (
                  <Link href={draftNext(rev).href} className="t-focus min-h-touch inline-flex items-center font-medium text-t-amber-bright underline underline-offset-2" data-testid="lane-home-check">
                    {draftNext(rev).label}
                  </Link>
                )}
                <Link href="/dashboard/vault" className="t-focus min-h-touch inline-flex items-center text-t-phos underline underline-offset-2">
                  My resumes
                </Link>
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-t-phos">No resume yet. It takes a few minutes to get a first piece saved.</p>
          )}
        </div>
        <div className={box} data-testid="lane-home-next">
          <p className="text-xs font-semibold uppercase text-t-bone-dim">Next</p>
          <Link
            href={next.href}
            className="t-focus mt-2 inline-flex min-h-touch w-full items-center justify-center bg-t-amber px-4 py-2.5 text-sm font-bold text-white hover:bg-t-amber-bright"
            data-testid="lane-home-next-action"
          >
            {next.label}
          </Link>
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
        </div>
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

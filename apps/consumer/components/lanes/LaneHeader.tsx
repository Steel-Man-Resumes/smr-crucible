"use client";

/**
 * The lane header (Phase 5 lane R2): "Working toward: <target or a job> ·
 * Today: <task>", with a Change link. On every Forge and Refinery screen
 * inside a lane.
 */

import Link from "next/link";
import { CHANGE_HREF, laneHeaderLine, type LaneTask } from "@/lib/lane-task";
import { useLaneFocus } from "./useLaneFocus";

export function LaneHeader({ task, target, changeHref = CHANGE_HREF, className = "" }: { task: LaneTask; target?: string | null; changeHref?: string; className?: string }) {
  const { toward, today } = laneHeaderLine(task, target);
  return (
    <div
      role="note"
      aria-label="Your lane"
      data-testid="lane-header"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-t-line bg-t-panel px-4 py-2 text-sm sm:px-6 ${className}`}
    >
      <span className="min-w-0 text-t-phos">
        <span className="text-t-phos-dim">Working toward:</span> <span className="font-semibold text-t-white" data-testid="lane-toward">{toward}</span>
        <span aria-hidden="true" className="px-1.5 text-t-phos-dim">·</span>
        <span className="text-t-phos-dim">Today:</span> <span className="font-semibold text-t-white" data-testid="lane-today">{today}</span>
      </span>
      <Link href={changeHref} className="t-focus inline-flex min-h-touch items-center text-sm font-medium text-t-amber-bright underline underline-offset-2 hover:text-t-amber" data-testid="lane-change">
        Change
      </Link>
    </div>
  );
}

/** The Refinery's lane header: the account's pick, Change opens the first screen again. */
export function RefineryLaneHeader() {
  const focus = useLaneFocus();
  if (!focus.loaded || !focus.task) return null;
  return <LaneHeader task={focus.task} target={focus.target} changeHref="/dashboard?change=1" className="mb-6 border border-t-line" />;
}

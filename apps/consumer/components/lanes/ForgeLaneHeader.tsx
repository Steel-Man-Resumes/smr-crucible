"use client";

/**
 * The lane header on the Forge's screens (Phase 5 lane R2), and the one place
 * the Forge run learns the account's pick: someone who picked a task on the
 * Refinery's first screen (signed in) arrives here with it already chosen.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { LaneHeader } from "./LaneHeader";
import { useLaneFocus } from "./useLaneFocus";
import { isLaneTask } from "@/lib/lane-task";

/** Forge screens that sit inside a lane. /start draws its own; processing is a quiet screen. */
export const FORGE_LANE_SCREENS = ["/resume", "/goals", "/story", "/preferences", "/output", "/rush"];

export function ForgeLaneHeader() {
  const pathname = usePathname();
  const { session, updateSession, mayUseRun } = useForgeSession();
  const focus = useLaneFocus({ task: session.laneTask, target: session.laneTarget });

  // The account's pick comes into this run once (never into a run that is not this account's).
  useEffect(() => {
    if (!focus.loaded || !focus.fromAccount || !mayUseRun || session.isDemo) return;
    if (!isLaneTask(focus.task)) return;
    if (session.laneTask === focus.task && (session.laneTarget ?? null) === (focus.target ?? null)) return;
    updateSession({
      laneTask: focus.task,
      laneTarget: focus.target ?? undefined,
      ...(session.readinessStage ? {} : { readinessStage: focus.task === "job" || focus.task === "interview" ? "action" : "preparation" }),
    });
  }, [focus.loaded, focus.fromAccount, focus.task, focus.target, mayUseRun]); // eslint-disable-line react-hooks/exhaustive-deps

  const task = isLaneTask(session.laneTask) ? session.laneTask : focus.task;
  if (session.isDemo || !task || !FORGE_LANE_SCREENS.includes(pathname)) return null;
  return <LaneHeader task={task} target={session.laneTarget ?? focus.target} />;
}

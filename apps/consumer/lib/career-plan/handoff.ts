/**
 * Choosing a direction: the handoff from the career planner to a career lane.
 *
 * Goes through the existing lane path (lib/paths/choose.ts): reuse an open
 * lane with the same role or create one, then save the lane focus with the
 * task that fits the first move (job search -> "job", resume -> "resume",
 * training -> "explore"). It copies no facts and adds no skills. The returned
 * href is the first move, carrying the chosen lane where the page reads it.
 *
 * Client-safe.
 */

import { choosePathDirection } from "../paths/choose";
import { pathJobsHref } from "../paths/explore";
import type { PlanDirection } from "./plan";

type Fetcher = Parameters<typeof choosePathDirection>[3];

export interface DirectionChoice {
  laneId: string;
  target: string;
  href: string;
  task: PlanDirection["firstMove"]["task"];
}

/** Where the first move goes once the lane exists. */
export function firstMoveHref(direction: PlanDirection, laneId: string, location: string): string {
  if (direction.firstMove.kind === "jobs") {
    const query = new URL(direction.firstMove.href, "https://x.invalid").searchParams.get("q") || direction.searchRole;
    return pathJobsHref(query, location, laneId);
  }
  return direction.firstMove.href;
}

export async function chooseCareerDirection(
  direction: PlanDirection,
  ctx: { laneAtStart: string; currentLane: () => string; location: string; fetcher?: Fetcher },
): Promise<DirectionChoice> {
  const task = direction.firstMove.task;
  const chosen = await choosePathDirection(direction.searchRole, ctx.laneAtStart, ctx.currentLane, ctx.fetcher ?? fetch, task);
  return { laneId: chosen.laneId, target: chosen.target, task, href: firstMoveHref(direction, chosen.laneId, ctx.location) };
}

/**
 * Today's task (migration 083, Phase 5 lane R2): the pure, client-safe half.
 *
 * The first screen after sign-in asks "What do you need today?". The answer
 * is one of these tasks. It is saved per person, tied to the lane they work
 * in (career_lane, 074), and only decides which screens come next and what
 * the lane header says. It never copies facts and never starts a new lane.
 */

import { isUuid } from "./careerLaneShared";

/** Every task, in migration 083's order. The screen's order is MAIN_TASKS then OTHER_TASKS. */
export const LANE_TASKS = ["resume", "job", "interview", "documents", "explore", "support"] as const;
export type LaneTask = (typeof LANE_TASKS)[number];

/**
 * The routes shown big on the first screen. "explore" ("I don't know what I
 * want yet") joined them 2026-10-23 on Troy's word: some people have no lane
 * at all, and that answer has to be as easy to pick as the others.
 */
export const MAIN_TASKS: readonly LaneTask[] = ["resume", "job", "interview", "explore"];
/** The routes behind the quieter "Something else". */
export const OTHER_TASKS: readonly LaneTask[] = ["documents", "support"];

export const LANE_FOCUS_TARGET_MAX = 200;

export function isLaneTask(v: unknown): v is LaneTask {
  return typeof v === "string" && (LANE_TASKS as readonly string[]).includes(v);
}

/** A target in the person's own words: trimmed, single spaces, at most 200 characters; empty is null. */
export function cleanFocusTarget(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, LANE_FOCUS_TARGET_MAX).trim();
  return t ? t : null;
}

export interface LaneFocus {
  task: LaneTask;
  /** null = the main lane. */
  laneId: string | null;
  target: string | null;
  updatedAt: string | null;
}

export type LaneFocusInputResult =
  | { ok: true; focus: { task: LaneTask; laneId: string | null; target: string | null } }
  | { ok: false; reason: string };

/** Read a request body: { task, laneId?, target? }. laneId "main" or null is the main lane. */
export function readLaneFocusInput(body: unknown): LaneFocusInputResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "no body" };
  const b = body as Record<string, unknown>;
  if (!isLaneTask(b.task)) return { ok: false, reason: "unknown task" };
  let laneId: string | null = null;
  if (b.laneId !== undefined && b.laneId !== null && b.laneId !== "main") {
    if (!isUuid(b.laneId)) return { ok: false, reason: "bad lane" };
    laneId = String(b.laneId).toLowerCase();
  }
  if (b.target !== undefined && b.target !== null && typeof b.target !== "string") return { ok: false, reason: "bad target" };
  return { ok: true, focus: { task: b.task, laneId, target: cleanFocusTarget(b.target) } };
}

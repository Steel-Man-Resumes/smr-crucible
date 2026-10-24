/**
 * Coverage (PURE). Replaces the old length-based "plan strength" meter.
 *
 * It counts which questions on the person's own path have an answer. It does
 * not read how much they wrote: "Bus stops before my shift ends" and a single
 * tap count the same as a paragraph. "Not sure" is an answer, and it stays
 * listed as open so the plan can say what is still unknown.
 */

import { getNode, type HurdleId } from "./graph";
import { hurdlesOf, isAnswered, walk, type Answer, type PlannerState } from "./reducer";

export interface HurdleCoverage {
  hurdle: HurdleId;
  onPath: number;
  answered: number;
  skipped: number;
  notSure: number;
  complete: boolean;
  /** What each skipped or "not sure" question decides, in plain words. */
  open: string[];
}

export interface Coverage {
  onPath: number;
  answered: number;
  skipped: number;
  notSure: number;
  complete: boolean;
  byHurdle: HurdleCoverage[];
  /** One plain sentence for the screen. */
  line: string;
}

export function isUnsure(nodeId: string, a: Answer | undefined): boolean {
  const node = getNode(nodeId);
  if (!node || !a || a.skipped || !a.choices?.length) return false;
  const picked = (node.choices ?? []).filter((c) => a.choices!.includes(c.id));
  return picked.length > 0 && picked.every((c) => c.uncertain);
}

export function hurdleCoverage(hurdle: HurdleId, answers: Record<string, Answer>): HurdleCoverage {
  const w = walk(hurdle, answers);
  let answered = 0, skipped = 0, notSure = 0;
  const open: string[] = [];
  for (const id of w.path) {
    const a = answers[id];
    const node = getNode(id)!;
    if (!isAnswered(a)) { open.push(node.decision); continue; }
    if (a!.skipped) { skipped++; open.push(node.decision); continue; }
    answered++;
    if (isUnsure(id, a)) { notSure++; open.push(node.decision); }
  }
  return { hurdle, onPath: w.path.length, answered, skipped, notSure, complete: w.complete, open };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function coverageOf(state: Pick<PlannerState, "selected" | "answers">): Coverage {
  const byHurdle = hurdlesOf(state).map((h) => hurdleCoverage(h, state.answers));
  const sum = (k: "onPath" | "answered" | "skipped" | "notSure") => byHurdle.reduce((t, c) => t + c[k], 0);
  const onPath = sum("onPath"), answered = sum("answered"), skipped = sum("skipped"), notSure = sum("notSure");
  const complete = byHurdle.every((c) => c.complete);
  const parts = [`You answered ${answered} of the ${plural(onPath, "question", "questions")} on your path.`];
  if (skipped) parts.push(`${plural(skipped, "was", "were")} skipped.`);
  if (notSure) parts.push(`${plural(notSure, "answer is", "answers are")} "not sure", so ${notSure === 1 ? "that part stays" : "those parts stay"} open.`);
  parts.push("This counts answers, not words. A short answer counts the same as a long one.");
  return { onPath, answered, skipped, notSure, complete, byHurdle, line: parts.join(" ") };
}

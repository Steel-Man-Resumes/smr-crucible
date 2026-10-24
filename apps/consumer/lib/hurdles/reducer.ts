/**
 * Hurdle planner reducer (PURE). One hurdle at a time, one question at a time.
 *
 * The path through a hurdle is DERIVED from the answers, never stored: start
 * at the hurdle's first node; an answered node queues its successors (one per
 * choice picked for a "many" node, then the node's own next); the walk stops
 * at the first unanswered node. So changing an earlier answer re-routes
 * everything after it, and answers on branches no longer reached are ignored
 * by the plan (they stay in memory, so going back and forth loses nothing).
 */

import { HURDLES, HURDLE_ORDER, getNode, isHurdleId, resolveNext, type HurdleId, type HurdleNode } from "./graph";

export interface Answer {
  choices?: string[];
  text?: string;
  skipped?: boolean;
}

export interface PlannerState {
  phase: "pick" | "narrow" | "done";
  /** Hurdles in the order they will be worked. */
  selected: HurdleId[];
  answers: Record<string, Answer>;
  /** The node on screen while narrowing. */
  cursor: string | null;
}

export type PlannerAction =
  | { type: "toggle"; hurdle: HurdleId }
  | { type: "start" }
  | { type: "answer"; nodeId: string; choices?: string[]; text?: string }
  | { type: "skip"; nodeId: string }
  | { type: "back" }
  | { type: "goto"; nodeId: string }
  | { type: "edit" }
  | { type: "restore"; selected: unknown; answers: unknown };

export const INITIAL_STATE: PlannerState = { phase: "pick", selected: [], answers: {}, cursor: null };

export function isAnswered(a: Answer | undefined): boolean {
  if (!a) return false;
  if (a.skipped) return true;
  if (a.choices && a.choices.length > 0) return true;
  return typeof a.text === "string" && a.text.trim().length > 0;
}

/** The successors of an answered node, in order. */
export function successors(node: HurdleNode, answer: Answer): string[] {
  const out: string[] = [];
  const push = (id: string | null) => { if (id && !out.includes(id)) out.push(id); };
  if (answer.skipped || node.kind === "text") {
    push(resolveNext(node.hurdle, node.next));
    return out;
  }
  const picked = (node.choices ?? []).filter((c) => answer.choices?.includes(c.id));
  if (node.kind === "one") {
    const c = picked[0];
    push(resolveNext(node.hurdle, c && c.next !== undefined ? c.next : node.next));
    return out;
  }
  // many: one follow-up per choice that has its own next, then the node's next.
  for (const c of picked) if (c.next !== undefined) push(resolveNext(node.hurdle, c.next));
  push(resolveNext(node.hurdle, node.next));
  return out;
}

/** Nodes this hurdle reaches given the answers. Ends at the first unanswered node. */
export function walk(hurdle: HurdleId, answers: Record<string, Answer>): { path: string[]; complete: boolean } {
  const path: string[] = [];
  const queue: string[] = [HURDLES[hurdle].start];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = getNode(id);
    if (!node) continue;
    path.push(id);
    const a = answers[id];
    if (!isAnswered(a)) return { path, complete: false };
    // Successors run before anything already queued (finish a branch before the
    // next), but a node that is also queued later is a join: keep only its last
    // place, so shared questions come after every branch that leads to them.
    queue.unshift(...successors(node, a!).filter((s) => !seen.has(s)));
    for (let i = 0; i < queue.length; i++) if (queue.indexOf(queue[i], i + 1) !== -1) queue.splice(i--, 1);
  }
  return { path, complete: true };
}

/**
 * The hurdles being worked: the ones the person picked, then any added by an
 * answer on the current path ("not sure" signs, "add the record plan too").
 * Recomputed from the answers every time, so going back and changing that
 * answer takes the added hurdle off the list again.
 */
export function activeHurdles(selected: HurdleId[], answers: Record<string, Answer>): HurdleId[] {
  const out = [...selected];
  for (let i = 0; i < out.length; i++) {
    for (const id of walk(out[i], answers).path) {
      const node = getNode(id)!;
      const a = answers[id];
      if (!a || a.skipped) continue;
      // In the order the person picked them (the one that matters most first).
      for (const id2 of a.choices ?? []) {
        const c = (node.choices ?? []).find((x) => x.id === id2);
        if (c?.addsHurdle && !out.includes(c.addsHurdle)) out.push(c.addsHurdle);
      }
    }
  }
  return out;
}

export function hurdlesOf(state: Pick<PlannerState, "selected" | "answers">): HurdleId[] {
  return activeHurdles(state.selected, state.answers);
}

/** Every node on screen order across hurdles: the full flat path. */
export function fullPath(state: Pick<PlannerState, "selected" | "answers">): string[] {
  return hurdlesOf(state).flatMap((h) => walk(h, state.answers).path);
}

/** First unanswered node across hurdles, or null when every hurdle is complete. */
export function nextOpen(state: Pick<PlannerState, "selected" | "answers">): string | null {
  for (const h of hurdlesOf(state)) {
    const w = walk(h, state.answers);
    if (!w.complete) return w.path[w.path.length - 1];
  }
  return null;
}

function advanceFrom(state: PlannerState, from: string): PlannerState {
  const s = state;
  const path = fullPath(s);
  const i = path.indexOf(from);
  const next = i >= 0 && i + 1 < path.length ? path[i + 1] : nextOpen(s);
  return next ? { ...s, phase: "narrow", cursor: next } : { ...s, phase: "done", cursor: null };
}

function cleanChoices(node: HurdleNode, choices: unknown): string[] {
  if (!Array.isArray(choices)) return [];
  const ids = new Set((node.choices ?? []).map((c) => c.id));
  const picked = [...new Set(choices.filter((c): c is string => typeof c === "string" && ids.has(c)))];
  if (node.kind === "one") return picked.slice(0, 1);
  // "Not sure" and "none" stand alone: picking them with others keeps the others.
  const kept = picked.length > 1 ? picked.filter((c) => c !== "not_sure" && c !== "rather_not") : picked;
  return node.maxPicks ? kept.slice(0, node.maxPicks) : kept;
}

export function cleanText(node: HurdleNode, text: unknown): string {
  if (typeof text !== "string") return "";
  let t = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, node.maxLength ?? 300);
  if (node.format === "state") t = t.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  return t;
}

export function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case "toggle": {
      if (state.phase !== "pick" || !isHurdleId(action.hurdle)) return state;
      const has = state.selected.includes(action.hurdle);
      const selected = has ? state.selected.filter((h) => h !== action.hurdle) : [...state.selected, action.hurdle];
      // Keep the planner's order so related questions stay together.
      return { ...state, selected: HURDLE_ORDER.filter((h) => selected.includes(h)) };
    }
    case "start": {
      if (!state.selected.length) return state;
      const first = fullPath(state)[0] ?? null;
      return first ? { ...state, phase: "narrow", cursor: first } : state;
    }
    case "answer": {
      const node = getNode(action.nodeId);
      if (!node || state.phase !== "narrow" || action.nodeId !== state.cursor) return state;
      const answer: Answer = node.kind === "text" ? { text: cleanText(node, action.text) } : { choices: cleanChoices(node, action.choices) };
      if (!isAnswered(answer)) return state;
      return advanceFrom({ ...state, answers: { ...state.answers, [node.id]: answer } }, node.id);
    }
    case "skip": {
      const node = getNode(action.nodeId);
      if (!node || state.phase !== "narrow" || action.nodeId !== state.cursor) return state;
      return advanceFrom({ ...state, answers: { ...state.answers, [node.id]: { skipped: true } } }, node.id);
    }
    case "back": {
      if (state.phase === "done") {
        const path = fullPath(state);
        return path.length ? { ...state, phase: "narrow", cursor: path[path.length - 1] } : { ...state, phase: "pick", cursor: null };
      }
      if (state.phase !== "narrow" || !state.cursor) return state;
      const path = fullPath(state);
      const i = path.indexOf(state.cursor);
      if (i <= 0) return { ...state, phase: "pick", cursor: null };
      return { ...state, cursor: path[i - 1] };
    }
    case "goto": {
      if (state.phase === "pick") return state;
      return fullPath(state).includes(action.nodeId) ? { ...state, phase: "narrow", cursor: action.nodeId } : state;
    }
    case "edit":
      return { ...state, phase: "pick", cursor: null };
    case "restore": {
      const selected = Array.isArray(action.selected) ? HURDLE_ORDER.filter((h) => (action.selected as unknown[]).includes(h)) : [];
      const answers: Record<string, Answer> = {};
      if (action.answers && typeof action.answers === "object") {
        for (const [id, raw] of Object.entries(action.answers as Record<string, unknown>)) {
          const node = getNode(id);
          if (!node || !raw || typeof raw !== "object") continue;
          const r = raw as Record<string, unknown>;
          if (r.skipped === true) { answers[id] = { skipped: true }; continue; }
          const a: Answer = node.kind === "text" ? { text: cleanText(node, r.text) } : { choices: cleanChoices(node, r.choices) };
          if (isAnswered(a)) answers[id] = a;
        }
      }
      if (!selected.length) return INITIAL_STATE;
      const s: PlannerState = { phase: "narrow", selected, answers, cursor: null };
      const open = nextOpen(s);
      return open ? { ...s, cursor: open } : { ...s, phase: "done" };
    }
    default:
      return state;
  }
}

/** Only the answers the current path reaches (what a plan or a save may use). */
export function reachedAnswers(state: Pick<PlannerState, "selected" | "answers">): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const id of fullPath(state)) if (state.answers[id] && isAnswered(state.answers[id])) out[id] = state.answers[id];
  return out;
}

/** Where the cursor sits: which hurdle, and question n of the path so far. */
export function position(state: PlannerState): { hurdle: HurdleId | null; hurdleIndex: number; step: number; stepsSoFar: number } {
  if (!state.cursor) return { hurdle: null, hurdleIndex: -1, step: 0, stepsSoFar: 0 };
  const node = getNode(state.cursor);
  const hurdle = node?.hurdle ?? null;
  const path = hurdle ? walk(hurdle, state.answers).path : [];
  return { hurdle, hurdleIndex: hurdle ? hurdlesOf(state).indexOf(hurdle) : -1, step: path.indexOf(state.cursor) + 1, stepsSoFar: path.length };
}

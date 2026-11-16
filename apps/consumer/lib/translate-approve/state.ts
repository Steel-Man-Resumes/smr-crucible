/**
 * Translate and approve (lane D2, slice 1): the per-unit state machine (design 2.3).
 *
 * Pure transitions. The Spanish side is never changed by the machine: the only way
 * `es` changes is `editSpanish`, which is the person's own edit, and it drops the
 * English with it.
 *
 *   state                 meaning                                              becomes source?
 *   already_english       the person wrote it in English                       yes, as typed
 *   untranslated          Spanish, no English yet (before the first call)      no   (added: the design has no row for "before the first call")
 *   draft                 machine English, the checker found nothing held       no   (until the person approves)
 *   held                  machine English, the checker held it                  no   (cannot be approved as it stands)
 *   approved              the person tapped approve on a draft                  yes
 *   edited_english        the person typed their own English                    yes (it is theirs, like a paste)
 *   needs_retranslation   the person edited the Spanish after translation       no   (the old English is dropped)
 *   removed               the person took the line off                          no
 *
 * Rules, all pinned by tests:
 *   - A held line cannot be approved. There is no override and no bulk approve.
 *   - A unit is source only when its state says so AND its stored hash is still the hash of its Spanish.
 *   - A model draft never skips the checker: `receiveDraft` runs it. Typed English runs it as notes only.
 *   - After a Spanish edit on the resume screen, `reconcile` carries each unit's state over by the hash of
 *     its Spanish line, so a changed line is a fresh unit and an unchanged line keeps its approval.
 */
import { checkUnit, type CheckResult, type Finding } from "./check";
import { detectLine } from "./detect";
import { lineHash, normalizeLine, type Unit } from "./units";
import type { RecordChoice } from "../record-choice";

export type UnitStateName =
  | "already_english"
  | "untranslated"
  | "draft"
  | "held"
  | "approved"
  | "edited_english"
  | "needs_retranslation"
  | "removed";

export interface UnitState extends Unit {
  state: UnitStateName;
  /** The English. For already_english it is the person's own line. Undefined before the first draft and after a Spanish edit. */
  en?: string;
  held: Finding[];
  notes: Finding[];
}

export class InvalidTransition extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransition";
  }
}

const SOURCE_STATES: ReadonlySet<UnitStateName> = new Set(["already_english", "approved", "edited_english"]);
const PENDING_STATES: ReadonlySet<UnitStateName> = new Set(["untranslated", "draft", "held", "needs_retranslation"]);

/* ----------------------------------------------------------- start --- */

/** The first state of a unit: a line already in English is the person's own words; every other line waits for a translation. */
export function initialState(unit: Unit): UnitState {
  if (detectLine(unit.es).lang === "en") return { ...unit, state: "already_english", en: unit.es, held: [], notes: [] };
  return { ...unit, state: "untranslated", held: [], notes: [] };
}

export function initStates(units: ReadonlyArray<Unit>): UnitState[] {
  return units.map(initialState);
}

/**
 * Carry states over to a fresh split by the hash of each Spanish line (a Spanish edit on the resume screen).
 * A unit whose Spanish did not change keeps its state, English and findings; a changed unit starts fresh.
 * Equal lines are matched in order, so two identical duty lines each keep their own approval.
 */
export function reconcile(prev: ReadonlyArray<UnitState>, next: ReadonlyArray<Unit>): UnitState[] {
  const pool = new Map<string, UnitState[]>();
  for (const p of prev) {
    const key = `${p.field}\u0000${p.hash}`;
    const list = pool.get(key) ?? [];
    list.push(p);
    pool.set(key, list);
  }
  return next.map((u) => {
    const hit = pool.get(`${u.field}\u0000${u.hash}`)?.shift();
    if (!hit) return initialState(u);
    return { ...u, state: hit.state, ...(hit.en !== undefined ? { en: hit.en } : {}), held: hit.held, notes: hit.notes };
  });
}

/* ------------------------------------------------------ transitions --- */

export interface CheckOptions {
  recordChoice?: RecordChoice;
}

function settle(u: UnitState, en: string, typed: boolean, opts: CheckOptions): { held: Finding[]; notes: Finding[] } {
  const r: CheckResult = checkUnit({ es: u.es, en, kind: u.kind, typed, recordChoice: opts.recordChoice });
  return { held: r.held, notes: r.notes };
}

/** The machine's English arrives for a unit that was waiting for it. Held when the checker holds it, a draft otherwise. */
export function receiveDraft(u: UnitState, en: string, opts: CheckOptions = {}): UnitState {
  if (u.state !== "untranslated" && u.state !== "needs_retranslation") {
    throw new InvalidTransition(`a draft cannot arrive for a unit in state ${u.state}`);
  }
  const { held, notes } = settle(u, en, false, opts);
  return { ...u, state: held.length ? "held" : "draft", en: en.trim(), held, notes };
}

/** The person taps approve. Only a draft can be approved; a held line cannot, and nothing overrides that. */
export function approve(u: UnitState): UnitState {
  if (u.state === "held") throw new InvalidTransition("a held line cannot be approved as it stands");
  if (u.state !== "draft") throw new InvalidTransition(`only a draft can be approved, not ${u.state}`);
  if (u.held.length) throw new InvalidTransition("a line with held findings cannot be approved");
  return { ...u, state: "approved" };
}

/**
 * The person types their own English. It is theirs: findings are notes only, never held. Allowed from every
 * state that has a Spanish line to answer (not from removed).
 */
export function editEnglish(u: UnitState, en: string, opts: CheckOptions = {}): UnitState {
  if (u.state === "removed") throw new InvalidTransition("a removed line has no English to edit");
  const text = en.trim();
  if (!text) throw new InvalidTransition("typed English cannot be empty; remove the line instead");
  const { notes } = settle(u, text, true, opts);
  return { ...u, state: "edited_english", en: text, held: [], notes };
}

/**
 * The person edits the Spanish line. The English is dropped and the hash follows the new Spanish, so the old
 * approval cannot attach to it. A line that now reads as English is the person's own words.
 */
export function editSpanish(u: UnitState, es: string): UnitState {
  const text = normalizeLine(es);
  if (!text) throw new InvalidTransition("the Spanish line cannot be empty; remove the line instead");
  if (u.state === "removed") throw new InvalidTransition("a removed line cannot be edited");
  const fresh: Unit = { ...stripState(u), es: text, hash: lineHash(text) };
  if (detectLine(text).lang === "en") return { ...fresh, state: "already_english", en: text, held: [], notes: [] };
  return { ...fresh, state: "needs_retranslation", held: [], notes: [] };
}

/** The person takes the line off the page. It stays on record as removed, so a re-split does not bring it back. */
export function remove(u: UnitState): UnitState {
  return { ...u, state: "removed" };
}

function stripState(u: UnitState): Unit {
  const { state: _s, en: _e, held: _h, notes: _n, ...unit } = u;
  return unit;
}

/* ------------------------------------------------------------ reads --- */

/** True when the unit's text may enter the person's own words: its state says so and its hash still matches its Spanish. */
export function isSource(u: UnitState, current?: Unit): boolean {
  if (!SOURCE_STATES.has(u.state)) return false;
  if (u.hash !== lineHash(u.es)) return false;
  if (current && (current.id !== u.id || current.hash !== u.hash)) return false;
  return !!(u.en ?? "").trim();
}

/** The text a source unit contributes: the English (the person's own line for already_english). */
export function sourceText(u: UnitState): string {
  return (u.en ?? "").trim();
}

/** The units the machine still has to translate: the only lines that go in a model call. */
export function awaitingTranslation(states: ReadonlyArray<UnitState>): UnitState[] {
  return states.filter((u) => u.state === "untranslated" || u.state === "needs_retranslation");
}

export interface Summary {
  total: number;
  alreadyEnglish: number;
  approved: number;
  editedEnglish: number;
  removed: number;
  held: number;
  drafts: number;
  waiting: number;
}

export function summarize(states: ReadonlyArray<UnitState>): Summary {
  const count = (n: UnitStateName) => states.filter((u) => u.state === n).length;
  return {
    total: states.length,
    alreadyEnglish: count("already_english"),
    approved: count("approved"),
    editedEnglish: count("edited_english"),
    removed: count("removed"),
    held: count("held"),
    drafts: count("draft"),
    waiting: count("untranslated") + count("needs_retranslation"),
  };
}

/** The summary button is enabled only when no line is pending and no held line is unresolved. */
export function canFinish(states: ReadonlyArray<UnitState>): boolean {
  return states.length > 0 && states.every((u) => !PENDING_STATES.has(u.state)) && states.some((u) => SOURCE_STATES.has(u.state));
}

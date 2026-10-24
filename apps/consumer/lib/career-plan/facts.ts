/**
 * The person's own facts for the career planner, and the post-check that
 * keeps the model honest about them.
 *
 * Facts come only from the server: the Master Draft work details, the Forge
 * run's skills and strengths, and what the person typed into this
 * conversation. Never from localStorage, never from the model.
 *
 * The post-check (verifyDirectionQuotes) is the hard line: every quote the
 * model puts next to a direction must appear, word for word, in a fact the
 * person gave. Anything else is stripped and counted so the screen can say so.
 *
 * Pure and client-safe.
 */

import type { PlanAnswers } from "./questions";

export type FactSource = "master" | "master_unchecked" | "forge_skill" | "forge_strength" | "today";

export interface CareerFact {
  id: string;
  text: string;
  source: FactSource;
}

export const FACT_SOURCE_LABEL: Record<FactSource, string> = {
  master: "Your Master Draft",
  master_unchecked: "Your Master Draft, not checked yet",
  forge_skill: "Your Forge run",
  forge_strength: "Your Forge run",
  today: "You said today",
};

export const FACT_TEXT_MAX = 300;
export const FACTS_MAX = 40;

const clean = (v: unknown, max = FACT_TEXT_MAX) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "");

export interface FactRows {
  /** consumer_profile.profile_data->'masterDraft' */
  master?: unknown;
  /** consumer_profile.skills */
  skills?: unknown;
  /** consumer_profile.forge_output */
  forgeOutput?: unknown;
}

const labelOf = (el: unknown): string => {
  if (typeof el === "string") return el;
  if (el && typeof el === "object") {
    const o = el as Record<string, unknown>;
    const v = o.name ?? o.title ?? o.label;
    if (typeof v === "string") return v;
  }
  return "";
};

/** The saved facts, from server rows only. Ids are stable for one load. */
export function buildSavedFacts(rows: FactRows): CareerFact[] {
  const out: CareerFact[] = [];
  const seen = new Set<string>();
  const add = (text: string, source: FactSource, prefix: string) => {
    const t = clean(text);
    const key = t.toLowerCase();
    if (!t || seen.has(key) || out.length >= FACTS_MAX) return;
    seen.add(key);
    out.push({ id: `${prefix}${out.filter((f) => f.id.startsWith(prefix)).length + 1}`, text: t, source });
  };
  const master = rows.master && typeof rows.master === "object" ? (rows.master as Record<string, unknown>).facts : null;
  if (Array.isArray(master)) {
    for (const f of master) {
      if (!f || typeof f !== "object") continue;
      const fact = f as Record<string, unknown>;
      add(clean(fact.text), fact.status === "confirmed" ? "master" : "master_unchecked", "m");
    }
  }
  const forge = rows.forgeOutput && typeof rows.forgeOutput === "object" ? (rows.forgeOutput as Record<string, unknown>) : {};
  const strengths = Array.isArray(forge.strengths) ? forge.strengths : [];
  for (const s of strengths) {
    if (!s || typeof s !== "object") continue;
    const ev = clean((s as Record<string, unknown>).evidence);
    if (ev) add(ev, "forge_strength", "s");
  }
  const skills = Array.isArray(rows.skills) ? rows.skills : Array.isArray(forge.skills) ? forge.skills : [];
  for (const s of skills) add(labelOf(s), "forge_skill", "k");
  return out;
}

/** What the person typed into this conversation, as facts with their own ids. */
export function todayFacts(answers: PlanAnswers): CareerFact[] {
  const out: CareerFact[] = [];
  const push = (id: string, v: string | undefined) => { const t = clean(v); if (t) out.push({ id, text: t, source: "today" }); };
  push("t-liked", answers.liked?.text);
  push("t-good", answers.goodAt);
  push("t-proud", answers.proud);
  return out;
}

/* ------------------------------------------------------------ the post-check -- */

/** Lower case, straight quotes, single spaces, no punctuation at the edges. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s"'.,;:!?()]+|[\s"'.,;:!?()]+$/g, "");
}

export interface Quote {
  factId: string;
  quote: string;
}

export interface CheckedQuote extends Quote {
  source: FactSource;
}

export const QUOTE_MIN = 3;
export const QUOTE_MAX = 200;

/**
 * Keep only quotes that appear word for word in a fact the person gave.
 * A quote pinned to the wrong fact id is moved to the fact it really came
 * from. Everything else is stripped and counted.
 */
export function verifyQuotes(quotes: unknown, facts: CareerFact[]): { kept: CheckedQuote[]; stripped: number } {
  const list = Array.isArray(quotes) ? quotes : [];
  const kept: CheckedQuote[] = [];
  let stripped = 0;
  const byId = new Map(facts.map((f) => [f.id, f]));
  for (const raw of list.slice(0, 6)) {
    const q = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const quote = typeof q.quote === "string" ? q.quote.replace(/\s+/g, " ").trim() : "";
    const norm = normalizeForMatch(quote);
    if (norm.length < QUOTE_MIN || quote.length > QUOTE_MAX) { stripped++; continue; }
    const claimed = typeof q.factId === "string" ? byId.get(q.factId) : undefined;
    const fact = claimed && normalizeForMatch(claimed.text).includes(norm) ? claimed : facts.find((f) => normalizeForMatch(f.text).includes(norm));
    if (!fact) { stripped++; continue; }
    if (kept.some((k) => k.factId === fact.id && normalizeForMatch(k.quote) === norm)) continue;
    kept.push({ factId: fact.id, quote, source: fact.source });
  }
  return { kept: kept.slice(0, 3), stripped };
}

/**
 * The model's one line on why the work connects. It may talk about the work;
 * it may not state a new fact about the person or a number. A line with a
 * figure, money, or a claim about what the person did is dropped.
 */
const PERSON_CLAIM = /\byou(?:'ve| have| had)? (?:were|was|worked|work(?:ed)? as|managed|led|ran|supervised|trained|built|earned|hold|held|have (?:a|an|the)|did|spent|finished|completed|got)\b/i;
export function cleanLink(raw: unknown): { text: string | null; dropped: boolean } {
  if (typeof raw !== "string") return { text: null, dropped: false };
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return { text: null, dropped: false };
  if (t.length > 220 || /\d/.test(t) || /[$£€]/.test(t) || /\b(?:salary|wage|per hour|an hour|a year|k\/yr)\b/i.test(t) || PERSON_CLAIM.test(t)) return { text: null, dropped: true };
  return { text: t, dropped: false };
}

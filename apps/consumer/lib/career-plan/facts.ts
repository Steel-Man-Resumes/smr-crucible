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

/**
 * Quotable facts are ONLY what the person wrote: Master Draft details (typed by
 * the person on /dashboard/master) and what they typed into this conversation.
 * Forge skills and strength evidence are earlier AI analysis
 * (generate-docs: "targeting context, never evidence about the person"), so
 * they are a separate ForgeReading: they may help rank the catalogue and are
 * shown labeled as t.ROY's reading, never as "You said" and never quoted.
 */
export type FactSource = "master" | "master_unchecked" | "today";

export interface CareerFact {
  id: string;
  text: string;
  source: FactSource;
}

export interface ForgeReading {
  id: string;
  text: string;
}

export const FACT_SOURCE_LABEL: Record<FactSource, string> = {
  master: "Your Master Draft",
  master_unchecked: "Your Master Draft, not checked yet",
  today: "You said today",
};

export const FORGE_READING_LABEL = "From your Forge run, t.ROY's reading";

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

/** The person's own saved facts: Master Draft only. Ids are stable for one load. */
export function buildSavedFacts(rows: FactRows): CareerFact[] {
  const out: CareerFact[] = [];
  const seen = new Set<string>();
  const master = rows.master && typeof rows.master === "object" ? (rows.master as Record<string, unknown>).facts : null;
  if (!Array.isArray(master)) return out;
  for (const f of master) {
    if (!f || typeof f !== "object" || out.length >= FACTS_MAX) continue;
    const fact = f as Record<string, unknown>;
    const t = clean(fact.text);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push({ id: `m${out.length + 1}`, text: t, source: fact.status === "confirmed" ? "master" : "master_unchecked" });
  }
  return out;
}

/** The Forge run's AI analysis (skills, strength evidence). Ranking hints only, never quoted. */
export function buildForgeReading(rows: FactRows): ForgeReading[] {
  const out: ForgeReading[] = [];
  const seen = new Set<string>();
  const add = (text: string) => {
    const t = clean(text, 160);
    if (!t || seen.has(t.toLowerCase()) || out.length >= 20) return;
    seen.add(t.toLowerCase());
    out.push({ id: `r${out.length + 1}`, text: t });
  };
  const forge = rows.forgeOutput && typeof rows.forgeOutput === "object" ? (rows.forgeOutput as Record<string, unknown>) : {};
  for (const st of Array.isArray(forge.strengths) ? forge.strengths : []) {
    if (st && typeof st === "object") add(clean((st as Record<string, unknown>).evidence));
  }
  const skills = Array.isArray(rows.skills) ? rows.skills : Array.isArray(forge.skills) ? forge.skills : [];
  for (const sk of skills) add(labelOf(sk));
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
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s"'.,;:!?()]+|[\s"'.,;:!?()]+$/g, "");
}

/** Words for matching: letters, digits and inner apostrophes ("didn't" stays one word). */
export function wordsOf(s: string): string[] {
  return normalizeForMatch(s).match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) ?? [];
}

export interface Quote {
  factId: string;
  quote: string;
}

export interface CheckedQuote extends Quote {
  source: FactSource;
}

/** A pointer into a fact must be at least this many whole words in a row (or the whole fact). */
export const QUOTE_MIN_WORDS = 4;

/** Words that turn a fact against the work ("Didn't like cooking", "I never led a crew"). */
const NEGATION = /^(?:not|no|never|nothing|nobody|none|neither|nor|hate|hated|hates|dislike|disliked|without|can't|cannot|couldn't|won't|wouldn't|don't|didn't|doesn't|isn't|wasn't|weren't|aren't|haven't|hasn't|hadn't|shouldn't|ain't|cant|dont|didnt|doesnt|wasnt|wont|isnt|never)$/;

/** A fact that says no to something is never shown as a reason it fits. */
export function isNegated(fact: string): boolean {
  return wordsOf(fact).some((w) => NEGATION.test(w));
}

function containsRun(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

/**
 * Keep only quotes that point into a fact the person wrote: the quote must be
 * the whole fact or at least four whole words in a row from it, on word
 * boundaries. What is shown is the WHOLE fact as the person wrote it, never
 * the model's fragment. A fact with a negation in it is never kept. A quote
 * pinned to the wrong fact id is moved to the fact it really came from.
 * Everything else is stripped and counted.
 */
export function verifyQuotes(quotes: unknown, facts: CareerFact[]): { kept: CheckedQuote[]; stripped: number } {
  const list = Array.isArray(quotes) ? quotes : [];
  const kept: CheckedQuote[] = [];
  let stripped = 0;
  const byId = new Map(facts.map((f) => [f.id, f]));
  const fits = (f: CareerFact, needle: string[]) => {
    const hay = wordsOf(f.text);
    const whole = needle.length === hay.length && containsRun(hay, needle);
    return (whole || (needle.length >= QUOTE_MIN_WORDS && containsRun(hay, needle))) && !isNegated(f.text);
  };
  for (const raw of list.slice(0, 6)) {
    const q = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const needle = typeof q.quote === "string" ? wordsOf(q.quote) : [];
    if (!needle.length) { stripped++; continue; }
    const claimed = typeof q.factId === "string" ? byId.get(q.factId) : undefined;
    const fact = claimed && fits(claimed, needle) ? claimed : facts.find((f) => fits(f, needle));
    if (!fact) { stripped++; continue; }
    if (kept.some((k) => k.factId === fact.id)) continue;
    kept.push({ factId: fact.id, quote: fact.text, source: fact.source });
  }
  return { kept: kept.slice(0, 3), stripped };
}

/**
 * The model's one line on why the work connects. It may talk about the work
 * only. Dropped: any figure or number word, money or pay words, hiring
 * promises, anything about a record or the law, and any "you"/"your" except
 * pointing back at what the person said.
 */
const PAY = /\b(?:dollars?|bucks|cents|pays?|paid|paying|salary|salaries|wages?|income|earn(?:s|ed|ing)?|an hour|per hour|hourly|a year|per year|k\/yr)\b/i;
const NUMBER_WORDS = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|million|dozen)\b/i;
const PROMISE = /\b(?:will hire|hire you|hires you|hired fast|guarantee[ds]?|guaranteed|won't matter|doesn't matter|easy to get|easily|fast|quick(?:ly)?|always|never|sure thing|no problem)\b/i;
const RECORD_LAW = /\b(?:record|records|felony|felonies|conviction|background|law|laws|legal|illegal|expunge\w*|pardon|license board|licensing board)\b/i;
export function cleanLink(raw: unknown): { text: string | null; dropped: boolean } {
  if (typeof raw !== "string") return { text: null, dropped: false };
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return { text: null, dropped: false };
  const aboutPerson = /\byou(?:r|rs|'re|'ve|'d|'ll|rself)?\b/i.test(t.replace(/\byou (?:said|told us|told me|wrote|mentioned|described)\b/gi, ""));
  if (t.length > 220 || /\d/.test(t) || /[$\u00A3\u20AC]/.test(t) || PAY.test(t) || NUMBER_WORDS.test(t) || PROMISE.test(t) || RECORD_LAW.test(t) || aboutPerson) return { text: null, dropped: true };
  return { text: t, dropped: false };
}

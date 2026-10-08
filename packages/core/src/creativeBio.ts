/**
 * The artist bio. Pure.
 *
 * Decision C3: t.ROY drafts the bio only from confirmed facts in the practice
 * record, and the person approves each sentence. A bio is a factual list in
 * sentence form (third person); the statement is the artist's voice and is
 * never drafted (creativeStatement.ts).
 *
 * Three lengths are kept side by side. Many arts applications cap a short bio
 * at 100 words or 600 characters (counted with spaces), so "short" holds both.
 *
 * Every drafted sentence is traced: each year, number and proper name in it
 * must appear in the facts it was drafted from. A sentence that names
 * anything else is dropped before the person sees it, and the save path
 * checks again.
 */

import type { PracticeEntry } from "./practiceRecordShared";
import { placeOf } from "./practiceRecordShared";
import { type BioDisclosureMode, type BioPronoun, type CreativeKindSettings, countChars, countWords } from "./creativeLaneShared";

export const BIO_LENGTHS = ["short", "medium", "long"] as const;
export type BioLength = (typeof BIO_LENGTHS)[number];

export const BIO_LIMITS: Record<BioLength, { label: string; maxWords: number; maxChars?: number; aimWords: number }> = {
  short: { label: "Short", maxWords: 100, maxChars: 600, aimWords: 80 },
  medium: { label: "Medium", maxWords: 220, aimWords: 200 },
  long: { label: "Long", maxWords: 500, aimWords: 400 },
};

export interface BioSentence {
  id: string;
  text: string;
  /** "draft": t.ROY drafted it from the record. "person": the person wrote it. */
  origin: "draft" | "person";
  /** Only approved sentences are in the bio. A draft starts unapproved. */
  approved: boolean;
}

export interface BioContent {
  disclosure?: BioDisclosureMode;
  lengths: Record<BioLength, BioSentence[]>;
}

export function emptyBio(): BioContent {
  return { lengths: { short: [], medium: [], long: [] } };
}

const SENTENCE_MAX = 400;
const MAX_SENTENCES = 40;

export function readBio(content: unknown): BioContent {
  const c = (content && typeof content === "object" ? content : {}) as Partial<BioContent>;
  const out = emptyBio();
  if (c.disclosure === "include" || c.disclosure === "context" || c.disclosure === "leave_out") out.disclosure = c.disclosure;
  for (const len of BIO_LENGTHS) {
    const list = (c.lengths as Record<string, unknown> | undefined)?.[len];
    if (!Array.isArray(list)) continue;
    out.lengths[len] = list
      .filter((s): s is BioSentence => !!s && typeof (s as BioSentence).text === "string")
      .slice(0, MAX_SENTENCES)
      .map((s, i): BioSentence => ({
        id: typeof s.id === "string" && s.id ? s.id.slice(0, 40) : `s${i}`,
        text: s.text.replace(/\s+/g, " ").trim().slice(0, SENTENCE_MAX),
        origin: s.origin === "person" ? "person" : "draft",
        approved: s.approved === true,
      }))
      .filter((s) => s.text);
  }
  return out;
}

/** The bio as it would be sent: approved sentences, in order. */
export function bioText(sentences: BioSentence[]): string {
  return sentences.filter((s) => s.approved).map((s) => s.text).join(" ");
}

export function bioCounts(text: string, len: BioLength): { words: number; chars: number; over: boolean } {
  const words = countWords(text);
  const chars = countChars(text);
  const lim = BIO_LIMITS[len];
  return { words, chars, over: words > lim.maxWords || (lim.maxChars !== undefined && chars > lim.maxChars) };
}

// ------------------------------------------------------------------ facts --

/**
 * The entries a bio may be drafted from. Confirmed only: an entry still
 * marked "need to find" is left out of the draft (the person can still write
 * about it in their own sentence). Entries that name a facility follow the
 * bio's disclosure mode: "include" drafts from them as named; "context" and
 * "leave out" keep them out of the draft (in context, the person writes that
 * sentence themselves).
 */
export function bioFactEntries(entries: PracticeEntry[], mode: BioDisclosureMode | undefined): PracticeEntry[] {
  return entries.filter((e) => {
    if (e.proof === "need_to_find") return false;
    if (e.names_facility && mode !== "include") return false;
    if (e.section === "work" || e.section === "press") return false;
    if (e.section === "collection" && e.details.holder === "private" && !e.details.consent) return false;
    if (e.section === "commission" && !e.details.consent) return false;
    return true;
  });
}

/** Everything the facts say, lowercased, for tracing. */
export function bioVocabulary(entries: PracticeEntry[], s: CreativeKindSettings | null | undefined): string {
  const parts: string[] = [];
  for (const e of entries) {
    parts.push(e.title, e.venue ?? "", e.city ?? "", e.state ?? "", String(e.year), e.end_year ? String(e.end_year) : "");
    const d = e.details;
    parts.push(d.curator ?? "", d.role ?? "", d.level ?? "", d.medium ?? "", d.expected ?? "", d.submittedWhen ?? "");
  }
  parts.push(s?.displayName ?? "", s?.discipline ?? "", s?.basedIn ?? "");
  return ` ${parts.join(" ").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ")} `;
}

/** Capitalised words that are ordinary sentence words, never facts. */
const COMMON_CAPS = new Set(
  "i the a an in at on of for from with and or but by to as she he they her his their them it its this that these those there who whose which work works art artist artists".split(" ")
);

/** Words that claim standing no record can back. */
const PUFF_RE =
  /\b(renowned|acclaimed|celebrated|award[- ]winning|internationally|nationally recognized|world[- ]class|prestigious|leading|visionary|masterful|groundbreaking|critically|highly sought|sought[- ]after|famous|legendary)\b/i;

/** Statement words: what the work means belongs in the statement, not the bio. */
const STATEMENT_WORDS_RE =
  /\b(explores?|exploring|investigates?|interrogates?|meditations? on|speaks? to|evokes?|grapples? with|delves? into|themes? of|the human condition|invites? (?:the )?viewers?|journey|transcend\w*)\b/i;

const FIRST_PERSON_RE = /\b(I|I'm|I've|I'd|my|me|mine|we|our|us)\b/;

export interface SentenceTrace {
  /** Years, numbers and names in the sentence that the facts do not hold. */
  untraced: string[];
  puff: string | null;
  statementWords: string | null;
  firstPerson: boolean;
  dash: boolean;
}

export function traceSentence(text: string, vocab: string): SentenceTrace {
  const untraced: string[] = [];
  const has = (w: string) => vocab.includes(` ${w.toLowerCase()} `);
  // Numbers (years included).
  for (const n of text.match(/\b\d[\d,]*\b/g) ?? []) {
    const bare = n.replace(/,/g, "");
    if (!has(bare)) untraced.push(n);
  }
  // Capitalised words after the first word of the sentence.
  const words = text.replace(/["“”‘’(),.;:!?]/g, " ").split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    if (i === 0) return;
    if (!/^[A-Z]/.test(w)) return;
    const base = w.replace(/'s$/i, "");
    if (COMMON_CAPS.has(base.toLowerCase())) return;
    if (!has(base)) untraced.push(w);
  });
  const puff = text.match(PUFF_RE)?.[0] ?? null;
  const statementWords = text.match(STATEMENT_WORDS_RE)?.[0] ?? null;
  return {
    untraced: Array.from(new Set(untraced)),
    puff,
    statementWords,
    firstPerson: FIRST_PERSON_RE.test(text),
    dash: /[\u2013\u2014]|\s--\s/.test(text),
  };
}

/** A drafted sentence is usable only when it traces fully and carries no puff, statement words, first person or dashes. */
export function draftSentenceOk(t: SentenceTrace): boolean {
  return t.untraced.length === 0 && !t.puff && !t.statementWords && !t.firstPerson && !t.dash;
}

// ------------------------------------------------------- deterministic draft --

interface Voice {
  subj: string;
  poss: string;
  was: string;
  has: string;
}

function voiceFor(name: string, p: BioPronoun | undefined, first: boolean): Voice {
  const pr = p ?? "name";
  if (pr === "name" || first) {
    const n = name || "The artist";
    return { subj: n, poss: `${n}'s`, was: "was", has: "has" };
  }
  if (pr === "they") return { subj: "They", poss: "Their", was: "were", has: "have" };
  if (pr === "she") return { subj: "She", poss: "Her", was: "was", has: "has" };
  return { subj: "He", poss: "His", was: "was", has: "has" };
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function newest(entries: PracticeEntry[]): PracticeEntry[] {
  return [...entries].sort((a, b) => (b.end_year ?? b.year) - (a.end_year ?? a.year) || b.year - a.year);
}

/**
 * A plain draft from the facts alone, no model. Used when the model is off or
 * fails, and as the floor the model's draft is checked against. Every word
 * that is not glue comes from an entry.
 */
export function draftBioFromFacts(entries: PracticeEntry[], s: CreativeKindSettings | null | undefined, len: BioLength): string[] {
  const settings = s ?? {};
  const name = settings.displayName ?? "";
  const facts = bioFactEntries(entries, settings.bioDisclosure);
  const out: string[] = [];
  let first = true;
  const v = () => {
    const x = voiceFor(name, settings.bioPronoun, first);
    first = false;
    return x;
  };

  if (name && settings.discipline) {
    const where = settings.basedIn ? ` based in ${settings.basedIn}` : "";
    const art = /^[aeiou]/i.test(settings.discipline) ? "an" : "a";
    out.push(`${name} is ${art} ${settings.discipline}${where}.`);
    first = false;
  }
  const by = (sec: PracticeEntry["section"]) => newest(facts.filter((e) => e.section === sec));

  const solo = by("exhibition").filter((e) => e.details.kind === "solo");
  for (const e of solo.slice(0, 2)) {
    const x = v();
    out.push(`${x.subj} had a solo exhibition, ${e.title}, at ${e.venue ?? placeOf(e)} in ${e.year}.`);
  }
  const shows = by("exhibition").filter((e) => e.details.kind !== "solo" && e.venue);
  if (shows.length) {
    const venues = Array.from(new Set(shows.map((e) => e.venue as string))).slice(0, 3);
    const x = v();
    out.push(`${x.poss} work has been shown at ${listJoin(venues)}.`);
  }
  for (const e of by("performance").slice(0, 2)) {
    const x = v();
    const word = e.details.kind === "reading" ? "read" : e.details.kind === "screening" ? "screened work" : "performed";
    out.push(`${x.subj} ${word} at ${e.venue ?? placeOf(e)} in ${e.year}.`);
  }
  for (const e of by("award").slice(0, 2)) {
    const x = v();
    out.push(`${x.subj} received the ${e.title}${e.venue ? ` from ${e.venue}` : ""} in ${e.year}.`);
  }
  for (const e of by("residency").slice(0, 2)) {
    const x = v();
    out.push(`${x.subj} ${x.was} in residence at ${e.venue ?? e.title} in ${e.year}.`);
  }
  const pubs = by("publication").filter((e) => e.details.status === "published" && e.venue);
  if (pubs.length) {
    const x = v();
    out.push(`${x.poss} writing has appeared in ${listJoin(Array.from(new Set(pubs.map((e) => e.venue as string))).slice(0, 3))}.`);
  }
  for (const e of by("commission").slice(0, 1)) {
    const x = v();
    out.push(`${x.subj} made ${e.title} for ${e.venue} in ${e.year}.`);
  }
  const holders = by("collection").filter((e) => e.venue);
  if (holders.length) {
    const x = v();
    out.push(`${x.poss} work is in the collection of ${listJoin(Array.from(new Set(holders.map((e) => e.venue as string))).slice(0, 3))}.`);
  }
  for (const e of by("teaching").slice(0, 1)) {
    const x = v();
    out.push(`${x.subj} ${x.has} worked as ${/^[aeiou]/i.test(e.title) ? "an" : "a"} ${e.title}${e.venue ? ` with ${e.venue}` : ""}.`);
  }
  for (const e of by("education").slice(0, 1)) {
    const x = v();
    out.push(`${x.subj} studied ${e.title}${e.venue ? ` at ${e.venue}` : ""}.`);
  }
  for (const e of by("arts_program").slice(0, 1)) {
    const x = v();
    out.push(`${x.subj} took part in ${e.title}${e.venue ? `, run by ${e.venue}` : ""}, in ${e.year}.`);
  }

  return fitToLength(out, len);
}

/** Keep sentences in order while the bio stays inside the length's limits. */
export function fitToLength(sentences: string[], len: BioLength): string[] {
  const lim = BIO_LIMITS[len];
  const kept: string[] = [];
  for (const s of sentences) {
    const t = [...kept, s].join(" ");
    if (countWords(t) > lim.maxWords) break;
    if (lim.maxChars !== undefined && countChars(t) > lim.maxChars) break;
    kept.push(s);
  }
  return kept;
}

// ---------------------------------------------------------------- the model --

/** The facts as plain lines for the model prompt. Only what bioFactEntries allows. */
export function bioFactLines(entries: PracticeEntry[], s: CreativeKindSettings | null | undefined): string[] {
  const settings = s ?? {};
  const lines: string[] = [];
  if (settings.displayName) lines.push(`Name: ${settings.displayName}`);
  if (settings.discipline) lines.push(`Makes: ${settings.discipline}`);
  if (settings.basedIn) lines.push(`Based in: ${settings.basedIn}`);
  for (const e of bioFactEntries(entries, settings.bioDisclosure)) {
    const bits = [e.section.replace("_", " "), e.title, e.venue, placeOf(e), e.end_year ? `${e.year} to ${e.end_year}` : String(e.year)];
    if (e.details.kind) bits.push(`kind: ${e.details.kind.replace("_", " ")}`);
    if (e.details.status) bits.push(`status: ${e.details.status.replace("_", " ")}`);
    if (e.details.role) bits.push(`role: ${e.details.role}`);
    lines.push(bits.filter(Boolean).join(" | "));
  }
  return lines;
}

export function bioSystemPrompt(len: BioLength, pronoun: BioPronoun | undefined): string {
  const lim = BIO_LIMITS[len];
  const who =
    pronoun === "they" ? "they/them" : pronoun === "she" ? "she/her" : pronoun === "he" ? "he/him" : "the person's name (no pronouns)";
  return [
    "You draft a short third-person artist bio from a list of facts.",
    "Use ONLY the facts given. Never add a place, a year, a number, a name, an honor or a description that is not in the facts.",
    "Never say what the work means, explores or evokes. That belongs to the artist's own statement, not the bio.",
    "No praise words (renowned, acclaimed, celebrated, award-winning, leading, and the like). No dashes. Plain words.",
    `Refer to the person by ${who}.`,
    `Stay under ${lim.maxWords} words${lim.maxChars ? ` and ${lim.maxChars} characters` : ""}.`,
    'Return JSON only: {"sentences": ["...", "..."]}',
  ].join("\n");
}

/**
 * Read the model's draft and keep only sentences that trace to the facts.
 * Returns what was kept and how many were dropped.
 */
export function parseBioDraft(raw: string, vocab: string): { kept: string[]; dropped: number } {
  let list: unknown = null;
  const m = (raw ?? "").match(/\{[\s\S]*\}/);
  if (m) {
    try {
      list = (JSON.parse(m[0]) as { sentences?: unknown }).sentences;
    } catch {
      list = null;
    }
  }
  if (!Array.isArray(list)) return { kept: [], dropped: 0 };
  const kept: string[] = [];
  let dropped = 0;
  for (const x of list.slice(0, MAX_SENTENCES)) {
    if (typeof x !== "string") continue;
    const t = x.replace(/\s+/g, " ").trim().slice(0, SENTENCE_MAX);
    if (!t) continue;
    if (draftSentenceOk(traceSentence(t, vocab))) kept.push(t);
    else dropped++;
  }
  return { kept, dropped };
}

export type BioSaveError = "draft_untraced" | "too_many";

/**
 * The server's check on a bio save: every DRAFT sentence must still trace to
 * the record today. A sentence the person wrote is theirs (the open items
 * still flag first person, statement words and length).
 */
export function checkBioSave(bio: BioContent, vocab: string): { ok: true } | { ok: false; error: BioSaveError; sentence?: string } {
  for (const len of BIO_LENGTHS) {
    if (bio.lengths[len].length > MAX_SENTENCES) return { ok: false, error: "too_many" };
    for (const s of bio.lengths[len]) {
      if (s.origin === "draft" && !draftSentenceOk(traceSentence(s.text, vocab))) {
        return { ok: false, error: "draft_untraced", sentence: s.text };
      }
    }
  }
  return { ok: true };
}

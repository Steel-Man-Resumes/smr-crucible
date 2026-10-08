/**
 * The artist bio. Pure.
 *
 * Decision C3, strict v1: the only drafted text is a fixed template filled
 * from ONE confirmed record entry per sentence (or, for the opening line, the
 * name, discipline and place the person typed for this lane). No model writes
 * any of it. The person keeps or cuts each sentence, and may edit any of
 * them: an edited sentence is the person's own words.
 *
 * Origin is never taken from the browser. The server compares each saved
 * sentence with the templates built from the record right now: an exact match
 * is a "fact" sentence with its source entry; anything else is
 * "person_written".
 *
 * Facility names follow the lane's CURRENT choice per entry (true title,
 * venue only, leave out), the same choice every other document reads. A
 * sentence of any origin that names a facility the lane keeps off is a BLOCK.
 */

import type { PracticeEntry } from "./practiceRecordShared";
import { placeOf } from "./practiceRecordShared";
import { type BioPronoun, type CreativeKindSettings, countChars, countWords, titleModeFor } from "./creativeLaneShared";

export const BIO_LENGTHS = ["short", "medium", "long"] as const;
export type BioLength = (typeof BIO_LENGTHS)[number];

export const BIO_LIMITS: Record<BioLength, { label: string; maxWords: number; maxChars?: number; aimWords: number }> = {
  short: { label: "Short", maxWords: 100, maxChars: 600, aimWords: 80 },
  medium: { label: "Medium", maxWords: 220, aimWords: 200 },
  long: { label: "Long", maxWords: 500, aimWords: 400 },
};

export type BioOrigin = "fact" | "person_written";

export interface BioSentence {
  id: string;
  text: string;
  /** Set by the server only: "fact" (an exact record template) or "person_written". */
  origin: BioOrigin;
  /** The one record entry a fact sentence comes from; null for the opening line or a person's sentence. */
  sourceEntryId?: string | null;
  /** Only approved sentences are in the bio. A fact draft starts unapproved. */
  approved: boolean;
}

export interface BioContent {
  lengths: Record<BioLength, BioSentence[]>;
}

export function emptyBio(): BioContent {
  return { lengths: { short: [], medium: [], long: [] } };
}

export const BIO_SENTENCE_MAX = 400;
export const BIO_MAX_SENTENCES = 40;

/** Read a stored bio safely. Keeps the server-set origin; ignores anything else stored with it. */
export function readBio(content: unknown): BioContent {
  const c = (content && typeof content === "object" ? content : {}) as Partial<BioContent>;
  const out = emptyBio();
  for (const len of BIO_LENGTHS) {
    const list = (c.lengths as Record<string, unknown> | undefined)?.[len];
    if (!Array.isArray(list)) continue;
    out.lengths[len] = list
      .filter((s): s is BioSentence => !!s && typeof (s as BioSentence).text === "string")
      .slice(0, BIO_MAX_SENTENCES)
      .map((s, i): BioSentence => ({
        id: typeof s.id === "string" && s.id ? s.id.slice(0, 60) : `s${i}`,
        text: s.text.replace(/\s+/g, " ").trim().slice(0, BIO_SENTENCE_MAX),
        origin: s.origin === "fact" ? "fact" : "person_written",
        sourceEntryId: typeof s.sourceEntryId === "string" ? s.sourceEntryId : null,
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

// ------------------------------------------------------------- templates --

export interface BioTemplate {
  /** "intro" or the entry id. One template per source, never pooled. */
  key: string;
  sourceEntryId: string | null;
  text: string;
}

interface Voice {
  subj: string;
  poss: string;
  was: string;
  has: string;
}

function voiceFor(name: string, p: BioPronoun | undefined): Voice {
  const pr = p ?? "name";
  if (pr === "they") return { subj: "They", poss: "Their", was: "were", has: "have" };
  if (pr === "she") return { subj: "She", poss: "Her", was: "was", has: "has" };
  if (pr === "he") return { subj: "He", poss: "His", was: "was", has: "has" };
  return { subj: name, poss: `${name}'s`, was: "was", has: "has" };
}

const an = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");

/**
 * The entries a bio may draw on: confirmed (not "need to find"), not a work
 * or press clipping, a private holder or client only with their OK, and a
 * facility-named entry only as the lane's choice for it allows.
 */
export function bioSourceEntries(entries: PracticeEntry[], s: CreativeKindSettings | null | undefined): PracticeEntry[] {
  return entries.filter((e) => {
    if (e.proof === "need_to_find") return false;
    if (e.section === "work" || e.section === "press") return false;
    if (e.section === "collection" && e.details.holder === "private" && !e.details.consent) return false;
    if (e.section === "commission" && !e.details.consent) return false;
    const mode = titleModeFor(e, s);
    return mode === "true_title" || mode === "venue_only";
  });
}

/** One sentence from one entry, or null when the entry has nothing a fixed template can say. */
function entrySentence(e: PracticeEntry, v: Voice, venueOnly: boolean): string | null {
  const at = e.venue ? ` at ${e.venue}` : "";
  const d = e.details;
  if (venueOnly) {
    // The title stays off; the kind of work and the venue are said plainly.
    if (!e.venue) return null;
    switch (e.section) {
      case "exhibition":
        return `${v.poss} work was shown in ${d.kind === "solo" ? "a solo" : d.kind === "two_person" ? "a two-person" : "a group"} exhibition at ${e.venue} in ${e.year}.`;
      case "arts_program":
        return `${v.subj} took part in an arts program run by ${e.venue}, starting in ${e.year}.`;
      case "teaching":
        return `${v.subj} taught with ${e.venue}, starting in ${e.year}.`;
      case "residency":
        return `${v.subj} ${v.was} in residence at ${e.venue} in ${e.year}.`;
      case "performance":
        return `${v.subj} performed at ${e.venue} in ${e.year}.`;
      default:
        return null;
    }
  }
  switch (e.section) {
    case "exhibition":
      if (d.kind === "solo") return `${v.subj} had a solo exhibition, ${e.title}${at}, in ${e.year}.`;
      return `${v.poss} work was in ${e.title}, ${d.kind === "two_person" ? "a two-person" : "a group"} exhibition${at}, in ${e.year}.`;
    case "performance": {
      const verb = d.kind === "reading" ? "gave a reading of" : d.kind === "screening" ? "screened" : "performed in";
      return `${v.subj} ${verb} ${e.title}${at} in ${e.year}.`;
    }
    case "award":
      return `${v.subj} received the ${e.title}${e.venue ? ` from ${e.venue}` : ""} in ${e.year}.`;
    case "residency":
      return `${v.subj} ${v.was} in residence${e.venue ? ` at ${e.venue}` : ` with ${e.title}`} in ${e.year}.`;
    case "publication":
      return d.status === "published" && e.venue ? `${v.poss} writing, ${e.title}, appeared in ${e.venue} in ${e.year}.` : null;
    case "commission":
      return e.venue ? `${v.subj} made ${e.title} for ${e.venue} in ${e.year}.` : null;
    case "collection":
      return e.venue ? `${v.poss} work ${e.title} is in the collection of ${e.venue}.` : null;
    case "teaching":
      return `${v.subj} ${v.has} worked as ${an(e.title)} ${e.title}${e.venue ? ` with ${e.venue}` : ""}, starting in ${e.year}.`;
    case "education":
      return `${v.subj} studied ${e.title}${e.venue ? ` at ${e.venue}` : ""}.`;
    case "arts_program":
      return `${v.subj} took part in ${e.title}${e.venue ? `, run by ${e.venue}` : ""}, starting in ${e.year}.`;
    default:
      return null;
  }
}

const ORDER: PracticeEntry["section"][] = ["exhibition", "performance", "award", "residency", "publication", "commission", "collection", "teaching", "education", "arts_program"];

/**
 * Every template sentence the record supports right now, in bio order: the
 * opening line (from the name, discipline and place typed for this lane), then
 * one sentence per entry, newest first within each kind. Each sentence draws
 * on exactly one source.
 */
export function bioTemplates(entries: PracticeEntry[], s: CreativeKindSettings | null | undefined): BioTemplate[] {
  const settings = s ?? {};
  const name = settings.displayName ?? "";
  if (!name) return [];
  const out: BioTemplate[] = [];
  if (settings.discipline) {
    const where = settings.basedIn ? ` based in ${settings.basedIn}` : "";
    out.push({ key: "intro", sourceEntryId: null, text: `${name} is ${an(settings.discipline)} ${settings.discipline}${where}.` });
  }
  const v = voiceFor(name, settings.bioPronoun);
  const src = bioSourceEntries(entries, settings);
  for (const sec of ORDER) {
    const list = src
      .filter((e) => e.section === sec)
      .sort((a, b) => (b.end_year ?? b.year) - (a.end_year ?? a.year) || b.year - a.year || a.title.localeCompare(b.title));
    for (const e of list) {
      const text = entrySentence(e, v, titleModeFor(e, settings) === "venue_only");
      if (text) out.push({ key: e.id, sourceEntryId: e.id, text });
    }
  }
  return out;
}

/** Keep templates in order while the bio stays inside the length's limits. */
export function fitToLength<T extends { text: string }>(items: T[], len: BioLength): T[] {
  const lim = BIO_LIMITS[len];
  const kept: T[] = [];
  for (const it of items) {
    const t = [...kept, it].map((x) => x.text).join(" ");
    if (countWords(t) > lim.maxWords) continue;
    if (lim.maxChars !== undefined && countChars(t) > lim.maxChars) continue;
    kept.push(it);
  }
  return kept;
}

/** The fact-built draft for one length. */
export function draftBioFromFacts(entries: PracticeEntry[], s: CreativeKindSettings | null | undefined, len: BioLength): BioTemplate[] {
  return fitToLength(bioTemplates(entries, s), len);
}

/**
 * The server's reading of a saved bio: text, approval and order from the
 * request; ORIGIN from the record. A sentence that equals a current template
 * exactly is "fact" (with its one source entry); anything else is the
 * person's own words. Any origin or disclosure the request carries is ignored.
 */
export function classifyBio(input: unknown, entries: PracticeEntry[], s: CreativeKindSettings | null | undefined): BioContent {
  const raw = readBio(input);
  const templates = bioTemplates(entries, s);
  const byText = new Map(templates.map((t) => [t.text, t]));
  const out = emptyBio();
  for (const len of BIO_LENGTHS) {
    out.lengths[len] = raw.lengths[len].map((x): BioSentence => {
      const t = byText.get(x.text);
      return t
        ? { id: x.id, text: x.text, origin: "fact", sourceEntryId: t.sourceEntryId, approved: x.approved }
        : { id: x.id, text: x.text, origin: "person_written", sourceEntryId: null, approved: x.approved };
    });
  }
  return out;
}

// ------------------------------------------------- checks on a sentence --

/** Words that claim standing no record can back. */
const PUFF_RE =
  /\b(renowned|acclaimed|celebrated|award[- ]winning|internationally|nationally|world[- ]class|prestigious|leading|visionary|masterful|groundbreaking|critically|highly sought|sought[- ]after|famous|legendary)\b/i;

/** Statement words: what the work means belongs in the statement, not the bio. */
const STATEMENT_WORDS_RE =
  /\b(explores?|exploring|investigates?|interrogates?|meditations? on|speaks? to|evokes?|grapples? with|delves? into|themes? of|the human condition|invites? (?:the )?viewers?|journey|transcend\w*)\b/i;

const FIRST_PERSON_RE = /\b(I|I'm|I've|I'd|my|me|mine|we|our|us)\b/;
const NUMBER_WORDS_RE = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|hundreds|thousand|dozens?|dozen|several|many|numerous)\b/i;

/** Everything the record and this lane's typed lines say, lowercased, for flagging a person's sentence. */
export function bioVocabulary(entries: PracticeEntry[], s: CreativeKindSettings | null | undefined): string {
  const parts: string[] = [];
  for (const e of entries) {
    parts.push(e.title, e.venue ?? "", e.city ?? "", e.state ?? "", String(e.year), e.end_year ? String(e.end_year) : "");
    const d = e.details;
    parts.push(d.curator ?? "", d.role ?? "", d.level ?? "", d.medium ?? "", d.expected ?? "");
  }
  parts.push(s?.displayName ?? "", s?.discipline ?? "", s?.basedIn ?? "");
  return ` ${parts.join(" ").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ")} `;
}

const COMMON_CAPS = new Set(
  "i the a an in at on of for from with and or but by to as she he they her his their them it its this that these those there who whose which work works art artist artists".split(" ")
);

export interface SentenceFlags {
  /** Years, numbers and capitalised names the record does not hold (the first word too, unless it is the name or a pronoun). */
  untraced: string[];
  numberWord: string | null;
  puff: string | null;
  statementWords: string | null;
  firstPerson: boolean;
}

/** Flags for a person's own sentence. A FIX each: their words, asked about, never blocked on these. */
export function flagSentence(text: string, vocab: string, name: string): SentenceFlags {
  const has = (w: string) => vocab.includes(` ${w.toLowerCase()} `);
  const untraced: string[] = [];
  for (const n of text.match(/\b\d[\d,]*\b/g) ?? []) if (!has(n.replace(/,/g, ""))) untraced.push(n);
  const nameWords = new Set(name.toLowerCase().split(/\s+/).filter(Boolean));
  const words = text.replace(/["“”‘’(),.;:!?]/g, " ").split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (!/^[A-Z]/.test(w)) continue;
    const base = w.replace(/'s$/i, "");
    if (COMMON_CAPS.has(base.toLowerCase()) || nameWords.has(base.toLowerCase())) continue;
    if (!has(base)) untraced.push(w);
  }
  return {
    untraced: Array.from(new Set(untraced)),
    numberWord: text.match(NUMBER_WORDS_RE)?.[0] ?? null,
    puff: text.match(PUFF_RE)?.[0] ?? null,
    statementWords: text.match(STATEMENT_WORDS_RE)?.[0] ?? null,
    firstPerson: FIRST_PERSON_RE.test(text),
  };
}

/**
 * The facility text a sentence may not carry on this lane: the title of each
 * facility-named entry not shown with its true title, and the venue of each
 * one left off (or not yet chosen). Lowercased.
 */
export function hiddenFacilityTerms(entries: PracticeEntry[], s: CreativeKindSettings | null | undefined): string[] {
  const out: string[] = [];
  // A venue that a SHOWN, non-facility entry also uses is public on this lane
  // anyway: shown means confirmed (not "need to find") and, when the lane
  // picks entries, picked.
  const picked = Array.isArray(s?.selection) ? new Set(s!.selection!.map((x) => x.toLowerCase())) : null;
  const shownVenues = new Set(
    entries
      .filter((e) => !e.names_facility && e.venue && e.proof !== "need_to_find" && (!picked || picked.has(e.id.toLowerCase())))
      .map((e) => (e.venue as string).toLowerCase())
  );
  for (const e of entries) {
    if (!e.names_facility) continue;
    const mode = titleModeFor(e, s);
    if (mode !== "true_title" && e.title.trim().length >= 4) out.push(e.title.toLowerCase());
    const venue = e.venue?.toLowerCase();
    if ((mode === "leave_out" || mode === "unset") && venue && venue.trim().length >= 4 && !shownVenues.has(venue)) out.push(venue);
    // Earlier names of the entry are never shown on a lane that keeps it off.
    if (mode !== "true_title") for (const f of e.details.formerNames ?? []) if (f.trim().length >= 4) out.push(f.toLowerCase());
  }
  return out;
}

export function namesHiddenFacility(text: string, terms: string[]): string | null {
  const t = text.toLowerCase();
  return terms.find((x) => t.includes(x)) ?? null;
}

/**
 * The bio text a page may carry on this lane: approved sentences, minus any
 * that name a facility the lane keeps off (those are left out, and the open
 * items say why). Every render, export and copy box uses this.
 */
export function bioTextForLane(sentences: BioSentence[], entries: PracticeEntry[], s: CreativeKindSettings | null | undefined): string {
  const hidden = hiddenFacilityTerms(entries, s);
  // A record sentence whose entry changed is left out too: the old claim never prints.
  const current = new Set(bioTemplates(entries, s).map((t) => t.text));
  return sentences
    .filter((x) => x.approved && !namesHiddenFacility(x.text, hidden) && (x.origin !== "fact" || current.has(x.text)))
    .map((x) => x.text)
    .join(" ");
}

/**
 * Claim words in a person's own sentence that the entries it names do not
 * back: a group show called "solo", a grant called a "fellowship", a prize
 * the record has no field for. Only checked when the sentence names an
 * entry's title or venue. A FIX each (the person's words, asked about).
 */
const CLAIMS: { re: RegExp; word: string; backs: (e: PracticeEntry) => boolean }[] = [
  { re: /\bsolo\b/i, word: "solo", backs: (e) => e.section === "exhibition" && e.details.kind === "solo" },
  { re: /\btwo[- ]person\b/i, word: "two-person", backs: (e) => e.section === "exhibition" && e.details.kind === "two_person" },
  { re: /\bjuried\b/i, word: "juried", backs: (e) => e.details.juried === true },
  { re: /\binvitational\b/i, word: "invitational", backs: (e) => e.details.invitational === true },
  { re: /\bcurated\b/i, word: "curated", backs: (e) => !!e.details.curator },
  { re: /\btour(ed|ing)?\b/i, word: "toured", backs: (e) => e.details.touring === true },
  { re: /\bfellowship\b/i, word: "fellowship", backs: (e) => e.section === "award" && e.details.kind === "fellowship" },
  { re: /\bresiden(cy|ce)\b/i, word: "residency", backs: (e) => e.section === "residency" },
  { re: /\b(prize|winner|national|nationally)\b/i, word: "", backs: () => false },
  // "first" and "won" only when they sit with a prize, award or place ("her first group show" is fine).
  { re: /\b(first|won)\b(?=[^.]*\b(prize|award|place|competition|contest|honou?rs?)\b)|\b(prize|award|place|competition|contest|honou?rs?)\b[^.]*\b(first|won)\b/i, word: "", backs: () => false },
];

export function unbackedClaims(text: string, entries: PracticeEntry[]): string[] {
  const t = text.toLowerCase();
  const named = entries.filter((e) => (e.title.length >= 4 && t.includes(e.title.toLowerCase())) || (e.venue && e.venue.length >= 4 && t.includes(e.venue.toLowerCase())));
  if (!named.length) return [];
  const out: string[] = [];
  for (const c of CLAIMS) {
    const m = text.match(c.re);
    if (!m) continue;
    // One word only, never a span of the sentence.
    const word = (c.word || m.slice(1).find((x) => x && /^(first|won|prize|winner|national|nationally)$/i.test(x)) || m[0].split(/\s+/)[0]).toLowerCase();
    // A word that is part of an entry's own title or venue is the record speaking.
    if (named.some((e) => c.re.test(e.title) || c.re.test(e.venue ?? ""))) continue;
    if (!named.some(c.backs)) out.push(word);
  }
  return out;
}

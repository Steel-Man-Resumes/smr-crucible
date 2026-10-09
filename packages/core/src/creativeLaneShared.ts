/**
 * Creative lanes: the pure half shared by the routes, the screens and the
 * renderer. No db import.
 *
 * A creative lane holds a document set for one practice: an artist resume
 * (College Art Association order), a bio in three lengths, the person's own
 * statement, and a work-sample list. Every document is ASSEMBLED from the
 * practice record (practiceRecordShared), never written fresh, so each line
 * traces to an entry the person typed. The lane keeps choices only
 * (kind_settings): page cap, which entries to show, how a title that names a
 * facility shows, the bio's disclosure mode.
 *
 * Length (decision C1): an artist resume is 1 to 2 pages; up to 4 only when a
 * call allows it, which is a per-lane setting the person turns on.
 */

import {
  type PracticeEntry,
  type PracticeSection,
  type TitleMode,
  isTitleMode,
  cleanLine,
  yearsOf,
  placeOf,
  looksLikeFacilityName,
} from "./practiceRecordShared";
import {
  BIG_CITY_WORDS,
  COMMON_WORDS,
  FACILITY_GENERIC_WORDS,
  FACILITY_NEAR_WORDS,
  PLACE_WORDS,
  STATE_CODES,
  STATE_NAMES,
  STATE_WORDS,
} from "./facilityWords";

export { FACILITY_GENERIC_WORDS } from "./facilityWords";

// --------------------------------------------------------------- settings --

export const BIO_PRONOUNS = ["name", "they", "she", "he"] as const;
export type BioPronoun = (typeof BIO_PRONOUNS)[number];

/** Default artist resume cap, and the most a call can allow (C1). */
export const ARTIST_RESUME_DEFAULT_PAGES = 2;
export const ARTIST_RESUME_MAX_PAGES = 4;

export interface CreativeKindSettings {
  /** The name to print, as the person wants it. */
  displayName?: string;
  /** What they make, in their words ("Painter", "Poet and printmaker"). */
  discipline?: string;
  /** Where they are based, in their words ("Detroit, MI"). */
  basedIn?: string;
  email?: string;
  phone?: string;
  website?: string;
  /** The call in front of them allows up to 4 pages. Off by default. */
  callAllowsMore?: boolean;
  /** entry id -> how this lane shows an entry that names a facility. */
  titleModes?: Record<string, TitleMode>;
  /** null/absent: every entry. A list: only these ("Selected" headings). */
  selection?: string[] | null;
  bioPronoun?: BioPronoun;
  /** CV lanes: research or teaching interests, in the person's own words. */
  interests?: string;
  /** CV lanes: languages and skills, in the person's own words. */
  languages?: string;
  /** CV lanes: the reference the person chose to list first. */
  leadReference?: string;
  /** Performer lanes: the agent or manager line, as the person types it. */
  agent?: string;
  /** Performer lanes: the description the person gives (never asked for an age). */
  height?: string;
  hair?: string;
  eyes?: string;
  voice?: string;
  /** Performer lanes: an age RANGE the person plays ("25-35"), never an age (CR-08). */
  ageRange?: string;
  /** Performer lanes: special skills, each one only on the page once the person says they can do it on request today. */
  skills?: PerformerSkill[];
  /** Performer lanes: show credit years (C2). Off by default; training stays dated either way. */
  showYears?: boolean;
  /**
   * phrase key -> the person's answer to "Does this name the place you chose
   * to leave off?" (review s2r3 N3-H1). "no" is never asked again; "yes"
   * holds the phrase. Changed one at a time (applyPhraseAnswer), never sent
   * as a whole map.
   */
  phraseAnswers?: Record<string, PhraseAnswer>;
  /** Revision of these settings; every save must be based on the current one. */
  rev?: number;
}

export interface PerformerSkill {
  /** The skill in the person's words. */
  text: string;
  /** The person says they can do it on request today (CR-08). */
  confirmed: boolean;
}
export const MAX_SKILLS = 20;
export const SKILL_MAX = 60;

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Caps that keep the cleaned settings under the database's 16,000-byte check
 * (075): 150 selected ids and 120 title choices, about 12 KB at most.
 */
const MAX_SELECTION = 150;
const MAX_TITLE_MODES = 120;
/** Stored answers per lane (about 25 bytes each, keeps the whole under 16,000). */
export const MAX_PHRASE_ANSWERS = 40;
const PHRASE_KEY_RE = /^[0-9a-f]{12}$/;

function cleanPhraseAnswers(v: unknown): Record<string, PhraseAnswer> {
  const out: Record<string, PhraseAnswer> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, a] of Object.entries(v as Record<string, unknown>).slice(0, MAX_PHRASE_ANSWERS)) {
      if (PHRASE_KEY_RE.test(k) && (a === "yes" || a === "no")) out[k] = a;
    }
  }
  return out;
}

function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (typeof x === "string" && ID_RE.test(x) && !out.includes(x.toLowerCase())) out.push(x.toLowerCase());
  return out.slice(0, MAX_SELECTION);
}

function cleanTitleModes(tm: unknown): Record<string, TitleMode> {
  const modes: Record<string, TitleMode> = {};
  if (tm && typeof tm === "object" && !Array.isArray(tm)) {
    for (const [k, m] of Object.entries(tm as Record<string, unknown>).slice(0, MAX_TITLE_MODES)) {
      if (ID_RE.test(k) && isTitleMode(m)) modes[k.toLowerCase()] = m;
    }
  }
  return modes;
}

/**
 * Merge an input over the current settings and clean it. Unknown keys are
 * dropped; a bad value for a known key is dropped too (never guessed).
 *
 * Facility choices (titleModes) and phrase answers are NEVER taken from the input here: a whole
 * map sent by a tab loaded earlier could undo a newer "leave it off". They
 * change one entry at a time through applyTitleMode, under a revision check.
 * The revision (rev) is the stored one; the caller bumps it on save.
 */
export function cleanKindSettings(input: unknown, current?: unknown): CreativeKindSettings {
  const cur = (current && typeof current === "object" && !Array.isArray(current) ? current : {}) as Record<string, unknown>;
  const inp = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const v = (k: string) => (k in inp ? inp[k] : cur[k]);
  const out: CreativeKindSettings = {};
  const str = (k: keyof CreativeKindSettings, max: number) => {
    const s = cleanLine(v(k), max);
    if (s) (out as Record<string, unknown>)[k] = s;
  };
  str("displayName", 120);
  str("discipline", 120);
  str("basedIn", 120);
  str("email", 160);
  str("phone", 40);
  str("website", 200);
  str("interests", 600);
  str("languages", 300);
  str("agent", 200);
  str("height", 40);
  str("hair", 40);
  str("eyes", 40);
  str("voice", 80);
  str("ageRange", 20);
  const sk = v("skills");
  if (Array.isArray(sk)) {
    const skills: PerformerSkill[] = [];
    for (const x of sk) {
      const text = cleanLine((x as { text?: unknown } | null)?.text, SKILL_MAX);
      if (text && !skills.some((y) => y.text.toLowerCase() === text.toLowerCase())) skills.push({ text, confirmed: (x as { confirmed?: unknown }).confirmed === true });
      if (skills.length >= MAX_SKILLS) break;
    }
    if (skills.length) out.skills = skills;
  }
  if (v("showYears") === true) out.showYears = true;
  const lr = v("leadReference");
  if (typeof lr === "string" && ID_RE.test(lr)) out.leadReference = lr.toLowerCase();
  if (v("callAllowsMore") === true) out.callAllowsMore = true;
  const modes = cleanTitleModes(cur.titleModes);
  if (Object.keys(modes).length) out.titleModes = modes;
  // Answers about a phrase, like facility choices, only ever change one at a time.
  const answers = cleanPhraseAnswers(cur.phraseAnswers);
  if (Object.keys(answers).length) out.phraseAnswers = answers;
  const sel = v("selection");
  if (Array.isArray(sel)) out.selection = ids(sel);
  const bp = v("bioPronoun");
  if (typeof bp === "string" && (BIO_PRONOUNS as readonly string[]).includes(bp)) out.bioPronoun = bp as BioPronoun;
  const rev = Number(cur.rev ?? 0);
  if (Number.isInteger(rev) && rev > 0) out.rev = rev;
  return out;
}

/** A lane's STORED settings, cleaned (facility choices and revision included). Use this to read; cleanKindSettings to merge an input. */
export function readKindSettings(stored: unknown): CreativeKindSettings {
  return cleanKindSettings({}, stored);
}

/** The settings revision (0 for none). */
export function settingsRev(s: { rev?: unknown } | null | undefined): number {
  const r = Number(s?.rev ?? 0);
  return Number.isInteger(r) && r >= 0 ? r : 0;
}

/** One facility choice for one entry, merged into the current settings. Null for a bad id or mode. */
export function applyTitleMode(current: unknown, entryId: unknown, mode: unknown): CreativeKindSettings | null {
  if (typeof entryId !== "string" || !ID_RE.test(entryId) || !isTitleMode(mode)) return null;
  const base = cleanKindSettings({}, current);
  const modes = { ...(base.titleModes ?? {}), [entryId.toLowerCase()]: mode };
  if (Object.keys(modes).length > MAX_TITLE_MODES) return null;
  return { ...base, titleModes: modes };
}

/** The page cap this lane allows: 2, or 4 when the person says a call allows it. */
export function artistResumePageCap(s: CreativeKindSettings | null | undefined): number {
  return s?.callAllowsMore ? ARTIST_RESUME_MAX_PAGES : ARTIST_RESUME_DEFAULT_PAGES;
}

/**
 * How this lane shows an entry. Entries that do not name a facility always
 * show their true title. One that does shows only as the person picked; until
 * they pick, it is left off and asked about (never shown softened).
 */
export function titleModeFor(entry: Pick<PracticeEntry, "id" | "names_facility">, s: CreativeKindSettings | null | undefined): TitleMode | "unset" {
  if (!entry.names_facility) return "true_title";
  return s?.titleModes?.[entry.id.toLowerCase()] ?? "unset";
}

// ------------------------------------------------------- facility matcher --
//
// Review s2r3 N3-H1, two tiers. Tier 1 holds a line off the page (a BLOCK
// until the person changes it or the choice): a whole hidden name, an earlier
// name, a name people use for it (the person types those), any run of 2+ of
// its words with a distinctive word in it, a distinctive word within three
// words of a facility word ("Folsom prison"), and a rare distinctive word
// standing alone ("Rikers"). Tier 2 only ASKS, one tap, never a BLOCK: a
// distinctive word standing alone that also commonly names a town, a person
// or a plain word ("Folsom, CA", "Lee"). The person's own name and home place
// are never tier 1. A "No" is kept per phrase and lane and never asked again;
// a "Yes" holds the phrase like tier 1.

/** Cyrillic and Greek letters that look like Latin ones (review s2r3 N3-L5). */
const LOOKALIKE: Record<string, string> = {
  "\u0430": "a", "\u0432": "b", "\u0435": "e", "\u0451": "e", "\u043a": "k", "\u043c": "m", "\u043d": "h", "\u043e": "o", "\u0440": "p",
  "\u0441": "c", "\u0442": "t", "\u0443": "y", "\u0445": "x", "\u0455": "s", "\u0456": "i", "\u0457": "i", "\u0458": "j", "\u0501": "d",
  "\u04bb": "h", "\u04cf": "l", "\u051b": "q", "\u051d": "w", "\u0261": "g",
  "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041a": "K", "\u041c": "M", "\u041d": "H", "\u041e": "O", "\u0420": "P", "\u0421": "C",
  "\u0422": "T", "\u0423": "Y", "\u0425": "X", "\u0405": "S", "\u0406": "I", "\u0408": "J",
  "\u03b1": "a", "\u03bf": "o", "\u03c1": "p", "\u03bd": "v", "\u03b9": "i", "\u03ba": "k", "\u03c4": "t", "\u03c5": "u", "\u03c7": "x",
  "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H", "\u0399": "I", "\u039a": "K", "\u039c": "M", "\u039d": "N",
  "\u039f": "O", "\u03a1": "P", "\u03a4": "T", "\u03a5": "Y", "\u03a7": "X",
};
const LOOKALIKE_RE = new RegExp(`[${Object.keys(LOOKALIKE).join("")}]`, "g");

/**
 * Text as the matcher reads it, case kept: compatibility forms folded
 * (fullwidth letters), soft hyphens and zero-width marks dropped, a word
 * broken by a hyphen at a line end joined again, Cyrillic and Greek
 * lookalikes read as Latin, accents dropped, and dotted initials closed up
 * ("S.Q." reads "SQ", "C.O." reads "CO").
 */
export function foldText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/([A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff])[-\u2010\u2011]\s*\r?\n\s*(?=[A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff])/g, "$1")
    .replace(LOOKALIKE_RE, (c) => LOOKALIKE[c] ?? c)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(?<![A-Za-z])(?:[A-Za-z]\.){2,}(?![A-Za-z])/g, (m) => m.replace(/\./g, ""));
}

/**
 * Lowercase words joined by single spaces, padded, so phrase checks match
 * whole words only. Case, punctuation, accents and apostrophes never matter
 * ("Riker's" and "RIKERS" are the same word).
 */
function wordsOf(text: string): string {
  const plain = foldText(text).toLowerCase().replace(/['`\u2018\u2019\u02bc]/g, "");
  return ` ${plain.replace(/[^a-z0-9]+/g, " ").trim()} `;
}

const RUN_STOPWORDS = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
const isNumberWord = (w: string) => /^\d+(?:st|nd|rd|th)?$/.test(w) || /^(?=[ivx]+$)x{0,3}(?:ix|iv|v?i{0,3})$/.test(w);
const isRealWord = (w: string) => !RUN_STOPWORDS.has(w) && !isNumberWord(w);
/** A word that is a city's name (never distinctive; a name with nothing else uses it only next to a facility word). */
const isCityWord = (w: string) => BIG_CITY_WORDS.has(w) && !STATE_WORDS.has(w) && !PLACE_WORDS.has(w);
/** A word that picks out WHICH place it is: not a stop word, number, facility word, state, place word or big city, three letters or more. */
const isDistinctive = (w: string) =>
  w.length >= 3 && isRealWord(w) && !FACILITY_GENERIC_WORDS.has(w) && !STATE_WORDS.has(w) && !PLACE_WORDS.has(w) && !BIG_CITY_WORDS.has(w);

/** The words of a name that pick out WHICH place it is. "San Quentin State Prison" gives "quentin". */
export function distinctiveWords(term: string): string[] {
  return Array.from(new Set(wordsOf(term).trim().split(" ").filter(isDistinctive)));
}

/** Every run of 2+ words inside a hidden name with at least two real words and one distinctive word ("state prison" alone never counts). */
function wordRuns(term: string): string[] {
  const w = wordsOf(term).trim().split(" ").filter(Boolean);
  const out: string[] = [];
  for (let len = 2; len <= w.length; len++) {
    for (let i = 0; i + len <= w.length; i++) {
      const run = w.slice(i, i + len);
      if (run.filter(isRealWord).length >= 2 && run.some(isDistinctive)) out.push(run.join(" "));
    }
  }
  return out;
}

/**
 * The pieces of a title that name the place: "Theater program, Example State
 * Prison" gives "Example State Prison"; "Shakespeare at San Quentin" gives
 * "San Quentin". The rest of the title is the work, not the place, so its
 * words stay free to use. A title with no such piece gives none (its runs
 * still count, its single words do not).
 */
function placeParts(title: string): string[] {
  const out: string[] = [];
  for (const seg of title.split(/[,;:()[\]|/\u2013\u2014]+|\s-\s/)) {
    seg.split(/\s(?:at|in|inside)\s/i).forEach((p, i) => {
      if (!p.trim()) return;
      if (i > 0 || wordsOf(p).trim().split(" ").some((w) => FACILITY_NEAR_WORDS.has(w))) out.push(p);
    });
  }
  return out;
}

/**
 * The text of a row to check against hidden names: everything that comes
 * from the record. A venue-only row's leading kind word ("Arts program",
 * "Teaching") is the page's own label, never the person's text.
 */
export function rowCheckText(r: { parts: Part[]; mode: "true_title" | "venue_only" }): string {
  return rowText(r.mode === "venue_only" ? r.parts.slice(1) : r.parts);
}

/** The ids of the entries a built page prints (its rows), for hiddenFacilityTerms. */
export function shownEntryIds(model: { sections: { rows?: { entryId: string }[] }[] }): string[] {
  return model.sections.flatMap((s) => (s.rows ?? []).map((r) => r.entryId));
}

export type PhraseAnswer = "yes" | "no";

/** What one lane keeps off, as the matcher reads it (all in lowercase word form). */
export interface HiddenTerms {
  /** Whole names: titles and venues kept off, and earlier names. Held in every field. */
  fullNames: string[];
  /** Names people use for the place ("the Q", "SQ"): held in free text, asked about in a name or place field. */
  names: string[];
  /** Runs of 2+ words of a name with a distinctive word in them. */
  runs: string[];
  /** Distinctive words: alone, a rare one holds, a common one is asked about. */
  words: string[];
  /** Words that hold within three words of a facility word (distinctive words; for a name with none, its city words). */
  anchors: string[];
  /** The person's answers on this lane, by phrase key. */
  answers: Record<string, PhraseAnswer>;
  /** The person's own name and home place for this lane: in other text, never held. */
  own: string[];
  /** The words of the person's own name: alone in any text, at most asked about ("R. Example"). */
  ownWords: string[];
}

/**
 * What a page may not name on this lane: the title of each facility-named
 * entry not shown with its true title, the venue of each one left off (or not
 * yet chosen), earlier names, and names people use for it. Each counts in
 * part too (see HiddenTerms). A part does not count when it is already on the
 * page through an entry this page prints with its true title.
 *
 * `shownIds` are the entries THIS page prints (review s2r2 N-M1). Without
 * them nothing is public: every hidden venue stays hidden (review s2r3 N3-M1).
 */
export function hiddenFacilityTerms(
  entries: PracticeEntry[],
  s: CreativeKindSettings | null | undefined,
  shownIds?: Iterable<string> | null
): HiddenTerms {
  const onPage = new Set(Array.from(shownIds ?? [], (x) => x.toLowerCase()));
  const printed = (e: PracticeEntry) => onPage.has(e.id.toLowerCase());
  // A hidden VENUE is public only through an entry on this page shown with its
  // TRUE title; a venue-only line or a held entry never makes it public.
  const shown = entries.filter((e) => titleModeFor(e, s) === "true_title" && printed(e));
  const shownVenues = new Set(shown.filter((e) => e.venue).map((e) => wordsOf(e.venue as string)));
  // Words already on this page (a PART of a hidden name found here is no
  // secret): true titles and venues of shown entries, and the venue a
  // venue-only line prints.
  const venueOnly = entries.filter((e) => titleModeFor(e, s) === "venue_only" && printed(e));
  const publicText = [...shown.map((e) => `${wordsOf(e.title)}|${wordsOf(e.venue ?? "")}`), ...venueOnly.map((e) => wordsOf(e.venue ?? ""))].join("|");
  const isPublic = (part: string) => publicText.includes(` ${part} `);

  const fullNames: string[] = [];
  const names: string[] = [];
  const sources: string[] = [];
  /** Titles with no piece naming the place: their 2+ word runs count, never a single word ("GED" stays free). */
  const runOnly: string[] = [];
  const addName = (t: string, min = 4, list = fullNames) => {
    const w = wordsOf(t).trim();
    if (t.trim().length >= min && w && !list.includes(w)) list.push(w);
  };
  for (const e of entries) {
    if (!e.names_facility) continue;
    const mode = titleModeFor(e, s);
    if (mode !== "true_title" && e.title.trim().length >= 4) {
      addName(e.title);
      const parts = placeParts(e.title);
      if (parts.length) sources.push(...parts);
      else runOnly.push(e.title);
    }
    const venue = e.venue ?? "";
    if ((mode === "leave_out" || mode === "unset") && venue.trim().length >= 4 && !shownVenues.has(wordsOf(venue))) {
      addName(venue);
      sources.push(venue);
    }
    // Earlier names of the entry are never shown on a lane that keeps it off.
    if (mode !== "true_title") {
      for (const f of e.details.formerNames ?? []) {
        if (f.trim().length < 4) continue;
        addName(f);
        // An earlier venue ("San Quentin") counts whole; an earlier title only where it names the place.
        const parts = placeParts(f);
        sources.push(...(parts.length ? parts : [f]));
      }
    }
    // Names people use for the place ("the Q", "SQ"), typed by the person:
    // kept off whenever the place is, matched whole.
    const placeShown = mode === "venue_only" && !!e.venue && looksLikeFacilityName(e.venue);
    if (mode !== "true_title" && !placeShown) for (const o of e.details.otherNames ?? []) addName(o, 2, names);
  }
  const runs: string[] = [];
  const words: string[] = [];
  const anchors: string[] = [];
  const add = (list: string[], x: string) => {
    if (!isPublic(x) && !list.includes(x)) list.push(x);
  };
  for (const src of runOnly) for (const r of wordRuns(src)) add(runs, r);
  for (const src of sources) {
    for (const r of wordRuns(src)) add(runs, r);
    const d = distinctiveWords(src);
    for (const w of d) add(words, w);
    for (const w of d.length ? d : wordsOf(src).trim().split(" ").filter(isCityWord)) add(anchors, w);
  }
  const own = [s?.displayName, s?.basedIn].filter((x): x is string => !!x && !!x.trim()).map((x) => wordsOf(x).trim());
  const ownWords = s?.displayName ? wordsOf(s.displayName).trim().split(" ").filter((w) => w.length >= 2) : [];
  return { fullNames, names, runs, words, anchors, answers: { ...(s?.phraseAnswers ?? {}) }, own, ownWords };
}

/** True when nothing is kept off (the common case: no work to do). */
function noTerms(t: HiddenTerms): boolean {
  return !t.fullNames.length && !t.names.length && !t.runs.length && !t.words.length && !t.anchors.length;
}

/** The longest phrase a card quotes and a key is built from. */
export const PHRASE_MAX = 160;

/**
 * The key a lane stores an answer under: a short hash of the phrase's words
 * (case and punctuation ignored), so the lane's settings stay small and never
 * hold the phrase itself.
 */
export function phraseKey(phrase: string): string {
  const s = wordsOf(phrase.slice(0, PHRASE_MAX)).trim();
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0").slice(0, 4);
}

/** How a field is read: free text, or the person's own name or home place (asked about, never held). */
export type FacilityFieldKind = "text" | "name" | "place";

export interface FacilityHit {
  /** 1: held off the page. 2: asked about, one tap. */
  tier: 1 | 2;
  /** The hidden word or name it matched (never printed). */
  term: string;
  /** The piece of the person's text it is in, for the card and the stored answer. */
  phrase: string;
}

const STATE_PLACE_RE = new RegExp(
  String.raw`^\s*,\s*(?:(?:${Array.from(STATE_CODES).map((c) => c.toUpperCase()).join("|")})\b|(?:${STATE_NAMES.join("|")})\b)`
);
const OWN_MARK = "xownx";

interface Tok {
  w: string;
  /** The word as typed starts with a lowercase letter (used as a plain word). */
  lower: boolean;
  /** What follows it in the folded text, up to the next word. */
  after: string;
}

function tokensOf(folded: string): Tok[] {
  const out: Tok[] = [];
  const re = /[A-Za-z0-9]+(?:['\u2019\u02bc][A-Za-z]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(folded))) {
    const raw = m[0];
    out.push({ w: raw.toLowerCase().replace(/['\u2019\u02bc]/g, ""), lower: /^[a-z]/.test(raw), after: folded.slice(m.index + raw.length, m.index + raw.length + 40) });
  }
  return out;
}

/** The person's own name and home place, blanked out of other text so they never hold it. */
function maskOwn(toks: Tok[], own: string[]): Tok[] {
  const out = toks.map((t) => ({ ...t }));
  for (const o of own) {
    const ow = o.split(" ").filter(Boolean);
    if (!ow.length) continue;
    for (let i = 0; i + ow.length <= out.length; i++) {
      if (ow.every((w, k) => out[i + k].w === w)) for (let k = 0; k < ow.length; k++) out[i + k].w = OWN_MARK;
    }
  }
  return out;
}

/** The pieces of a text a phrase is cut from: sentences, and parts split by ; | or a line break. Commas stay ("Folsom, CA" is one phrase). */
function piecesOf(text: string): string[] {
  return text.split(/[;|\n]+|(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean);
}

function pieceHit(piece: string, t: HiddenTerms, kind: FacilityFieldKind): { tier: 1 | 2; term: string } | null {
  const strong = (term: string) => ({ tier: kind === "text" ? (1 as const) : (2 as const), term });
  let ask: { tier: 2; term: string } | null = null;
  // A possessive reads both ways: "Riker's" matches "Rikers", "Stateville's" matches "Stateville".
  // A word split by a hyphen and a space (a line break someone flattened, "Quen- tin") is read joined too.
  const joined = piece.replace(/([A-Za-z])[-\u2010\u2011]\s+(?=[a-z])/g, "$1");
  for (const v of [piece, piece.replace(/['\u2019\u02bc]s\b/gi, ""), joined]) {
    const folded = foldText(v);
    const all = tokensOf(folded);
    const whole = ` ${all.map((x) => x.w).join(" ")} `;
    // A whole hidden name is held in any field, the person's own words included.
    for (const n of t.fullNames) if (whole.includes(` ${n} `)) return { tier: 1, term: n };
    // Names people use for it: held in free text; in a name or place field, asked about.
    for (const n of t.names) if (whole.includes(` ${n} `)) return strong(n);
    const toks = kind === "text" ? maskOwn(all, t.own) : all;
    const str = ` ${toks.map((x) => x.w).join(" ")} `;
    for (const r of t.runs) if (str.includes(` ${r} `)) return strong(r);
    for (let i = 0; i < toks.length; i++) {
      if (!t.anchors.includes(toks[i].w)) continue;
      for (let j = Math.max(0, i - 3); j <= Math.min(toks.length - 1, i + 3); j++) {
        if (j !== i && FACILITY_NEAR_WORDS.has(toks[j].w)) return strong(`${toks[i].w} ${toks[j].w}`);
      }
    }
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (!t.words.includes(tk.w)) continue;
      // Alone: a word that also names a town, a person or a plain thing (or is
      // typed as a plain word, or reads as a place, "Folsom, CA") is asked about.
      if (COMMON_WORDS.has(tk.w) || tk.lower || STATE_PLACE_RE.test(tk.after) || t.ownWords.includes(tk.w)) { if (!ask) ask = { tier: 2, term: tk.w }; }
      else return strong(tk.w);
    }
  }
  return ask;
}

/**
 * The facility hit a text carries on this lane, or null. Tier 1 is held off
 * the page; tier 2 prints and is asked about. A "name" or "place" field (the
 * person's own name, email and home place, a row's city and state, a
 * reference's name) is never tier 1. The person's stored answer for the
 * phrase wins: "yes" holds it, "no" clears a tier 2 ask for good.
 */
export function facilityCheck(text: string | null | undefined, terms: HiddenTerms, kind: FacilityFieldKind = "text"): FacilityHit | null {
  if (!text || !text.trim() || noTerms(terms)) return null;
  let ask: FacilityHit | null = null;
  // Soft hyphens and a word broken at a line end are joined before the text is cut into pieces.
  const pre = text
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/([A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff])[-\u2010\u2011]\s*\r?\n\s*(?=[A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff])/g, "$1");
  // An email address, a web address or a domain is read like a name: at most asked about, never held.
  const web: [string, FacilityFieldKind][] = [];
  const free = kind === "text" ? pre.replace(WEB_RE, (m) => (web.push([m, "name"]), " ")) : pre;
  const pieces: [string, FacilityFieldKind][] = [...piecesOf(free).map((p): [string, FacilityFieldKind] => [p, kind]), ...web];
  for (const [piece, k] of pieces) {
    const hit = pieceHit(piece, terms, k);
    if (!hit) continue;
    const phrase = piece.slice(0, PHRASE_MAX);
    const answer = terms.answers[phraseKey(phrase)];
    if (answer === "yes") return { tier: 1, term: hit.term, phrase };
    if (hit.tier === 1) return { tier: 1, term: hit.term, phrase };
    if (answer !== "no" && !ask) ask = { tier: 2, term: hit.term, phrase };
  }
  return ask;
}

/** Email addresses, web addresses and bare domains. */
const WEB_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\bhttps?:\/\/\S+|\bwww\.\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|edu|gov|io|co|us|info|art|me|app|dev|studio|gallery)\b/gi;

/** The hidden term a text names so that it is held (tier 1), or null. */
export function namesHiddenFacility(text: string, terms: HiddenTerms, kind: FacilityFieldKind = "text"): string | null {
  const h = facilityCheck(text, terms, kind);
  return h && h.tier === 1 ? h.term : null;
}

/** True when a text is held OR still asked about: a to-do line that does is replaced whole (export backstop). */
export function mentionsHiddenFacility(text: string, terms: HiddenTerms): boolean {
  return !!facilityCheck(text, terms, "text");
}

/** A card the person answers with one tap: does this phrase name the place they keep off? */
export interface FacilityAsk {
  /** A typed field of the lane, or a record entry, or a bio sentence. */
  field?: string;
  entryId?: string;
  sentenceId?: string;
  phrase: string;
}

/** The strongest hit on a page row: its own words as free text; its city, state and a reference's name as place and name fields. */
export function rowFacilityHit(r: { parts: Part[]; mode: "true_title" | "venue_only" }, e: PracticeEntry | undefined, terms: HiddenTerms): FacilityHit | null {
  const parts = r.mode === "venue_only" ? r.parts.slice(1) : r.parts;
  const place = e ? placeOf(e) : "";
  const isPlace = (p: Part) => !!e && !!p.text && (p.text === place || p.text === e.city || p.text === e.state);
  // Names of people: a reference, a publication's authors, a press piece's author. Asked about, never held.
  const isName = (p: Part) =>
    !!e && !!p.text && ((e.section === "reference" && p.text === e.title) || p.text === e.details.authors || p.text === e.details.author);
  const hits = [
    facilityCheck(rowText(parts.filter((p) => !isPlace(p) && !isName(p))), terms, "text"),
    ...parts.filter(isPlace).map((p) => facilityCheck(p.text, terms, "place")),
    ...parts.filter(isName).map((p) => facilityCheck(p.text, terms, "name")),
  ].filter((h): h is FacilityHit => !!h);
  return hits.find((h) => h.tier === 1) ?? hits[0] ?? null;
}

/**
 * Settle which items a page prints (review s2r3 N3-L1): only items that print
 * can make a hidden name public, and an item the check drops never does.
 * Starts from every candidate and drops held ones until the set holds still
 * (it only ever shrinks, so this ends). Returns the terms the kept items were
 * judged by and each item's hit.
 */
export function settleShown<T>(
  items: T[],
  idOf: (x: T) => string | null,
  check: (x: T, terms: HiddenTerms) => FacilityHit | null,
  termsFor: (shownIds: string[]) => HiddenTerms
): { terms: HiddenTerms; kept: T[]; hits: Map<T, FacilityHit> } {
  const ids = (list: T[]) => list.map(idOf).filter((x): x is string => !!x);
  let kept = items;
  for (let round = 0; round <= items.length; round++) {
    const terms = termsFor(ids(kept));
    const next = kept.filter((x) => check(x, terms)?.tier !== 1);
    if (next.length === kept.length) break;
    kept = next;
  }
  const terms = termsFor(ids(kept));
  const hits = new Map<T, FacilityHit>();
  for (const x of items) {
    const h = check(x, terms);
    if (h) hits.set(x, h);
  }
  return { terms, kept: items.filter((x) => hits.get(x)?.tier !== 1), hits };
}

/** One answer for one phrase, merged into the current settings. Null for a bad phrase or answer, or too many answers. */
export function applyPhraseAnswer(current: unknown, phrase: unknown, answer: unknown): CreativeKindSettings | null {
  if (typeof phrase !== "string" || !phrase.trim() || phrase.length > 400 || (answer !== "yes" && answer !== "no")) return null;
  const key = phraseKey(phrase.trim());
  if (!wordsOf(phrase).trim()) return null;
  const base = cleanKindSettings({}, current);
  const answers = { ...(base.phraseAnswers ?? {}), [key]: answer as PhraseAnswer };
  if (Object.keys(answers).length > MAX_PHRASE_ANSWERS) return null;
  return { ...base, phraseAnswers: answers };
}


/**
 * How an education entry's title prints (review s2r2 N-M3). Study the person
 * marked as classes without a degree reads "Coursework toward <degree>" or
 * "Coursework in <field>", never as the degree itself. A title that already
 * says so ("Coursework toward an Associate of Arts") prints as typed.
 */
export function studyTitle(e: Pick<PracticeEntry, "section" | "title" | "details">): string {
  const kind = e.section === "education" ? e.details.study : undefined;
  if (!kind || /^\s*(?:course ?work|classes|credits?|non-?degree)\b/i.test(e.title)) return e.title;
  return kind === "toward_degree" ? `Coursework toward ${e.title}` : `Coursework in ${e.title}`;
}

/** The credential kind and status words (D4), shared by every page that prints a credential. */
export const CREDENTIAL_KIND_WORD: Record<string, string> = {
  license: "License", certification: "Certification", certificate: "Certificate", card: "Card", training: "Training",
};
export const CREDENTIAL_STATUS_WORD: Record<string, string> = {
  active: "Active", inactive: "Inactive", expired: "Expired", in_progress: "In progress", eligible: "Eligible to test",
};

/**
 * The status words an entry carries on EVERY rendering, title shown or not:
 * a publication's graded status, study in progress, a credential's status.
 * A venue-only line must never read as more than the true one.
 */
export function statusPart(e: PracticeEntry): Part | null {
  const d = e.details;
  if (e.section === "publication") {
    const w = publicationStatusWords(e);
    return w ? { text: `(${w})` } : null;
  }
  if (e.section === "education" && d.status === "in_progress") return { text: `(${d.expected ? `in progress, expected ${d.expected}` : "in progress"})` };
  if (e.section === "arts_program" && d.status === "in_progress") return { text: "(in progress)" };
  if (e.section === "license" && d.credentialStatus) return { text: `(${CREDENTIAL_STATUS_WORD[d.credentialStatus] ?? d.credentialStatus})` };
  return null;
}

// ------------------------------------------------------ artist resume model --

/** A run of text on a row. Italic for titles of works and shows (CAA). */
export interface Part {
  text: string;
  italic?: boolean;
  /** Punctuation drawn right after the text, never italic (the comma after a title). */
  after?: string;
}

export interface ArtistRow {
  entryId: string;
  /** "2019" or "2019-2021", printed at the left. */
  years: string;
  parts: Part[];
  /** "true_title" or "venue_only": how the row was built (for the checks). */
  mode: "true_title" | "venue_only";
}

export interface ArtistSection {
  key: string;
  heading: string;
  rows: ArtistRow[];
}

export interface ArtistResumeModel {
  header: { name: string; discipline: string; contact: string[] };
  sections: ArtistSection[];
  /** Entries a lane setting asks about before they can show (R03). */
  needsChoice: string[];
  /** Entries left off on purpose (not selected, "leave out", or naming something this lane hides). */
  omitted: { entryId: string; reason: "not_selected" | "leave_out" | "needs_choice" | "private_holder" | "names_hidden" }[];
  /** Typed top-of-page fields kept off because they name something this lane hides. */
  heldFields: string[];
  /** Lines that print but share a word with a place this lane keeps off: one tap to answer (review s2r3 N3-H1). */
  asks: FacilityAsk[];
  /** True when the person trimmed with a selection ("Selected" headings). */
  trimmed: boolean;
}

/** How the artist resume's typed fields are read: the person's own name, email and home place are asked about, never held. */
const ARTIST_FIELD_KIND: Record<string, FacilityFieldKind> = { displayName: "name", email: "name", website: "name", basedIn: "place" };

/** The CAA order of sections, and which record entries feed each. */
export const ARTIST_SECTIONS: { key: string; heading: string; take: (e: PracticeEntry) => boolean }[] = [
  { key: "education", heading: "Education and Training", take: (e) => e.section === "education" || e.section === "arts_program" },
  { key: "solo", heading: "Solo Exhibitions", take: (e) => e.section === "exhibition" && e.details.kind === "solo" },
  { key: "two_person", heading: "Two-Person Exhibitions", take: (e) => e.section === "exhibition" && e.details.kind === "two_person" },
  { key: "group", heading: "Group Exhibitions", take: (e) => e.section === "exhibition" && e.details.kind === "group" },
  { key: "performance", heading: "Performances, Screenings and Readings", take: (e) => e.section === "performance" },
  { key: "commission", heading: "Commissions", take: (e) => e.section === "commission" },
  { key: "award", heading: "Awards, Grants and Fellowships", take: (e) => e.section === "award" },
  { key: "residency", heading: "Residencies", take: (e) => e.section === "residency" },
  { key: "publication", heading: "Publications", take: (e) => e.section === "publication" },
  { key: "press", heading: "Bibliography", take: (e) => e.section === "press" },
  { key: "teaching", heading: "Teaching", take: (e) => e.section === "teaching" },
  { key: "collection", heading: "Collections", take: (e) => e.section === "collection" },
];

/** The plain kind word a venue-only line leads with. Never names the show. */
export function venueOnlyLabel(e: PracticeEntry): string {
  switch (e.section) {
    case "exhibition":
      return e.details.kind === "solo" ? "Solo exhibition" : e.details.kind === "two_person" ? "Two-person exhibition" : "Group exhibition";
    case "performance":
      return e.details.kind === "screening" ? "Screening" : e.details.kind === "reading" ? "Reading" : "Performance";
    case "residency":
      return "Residency";
    case "commission":
      return "Commission";
    case "publication":
      return "Publication";
    case "press":
      return "Press";
    case "collection":
      return "Work in a collection";
    case "teaching":
      return "Teaching";
    case "arts_program":
      return "Arts program";
    case "award":
      return e.details.kind === "grant" ? "Grant" : e.details.kind === "fellowship" ? "Fellowship" : "Award";
    case "education":
      return "Study";
    case "work":
      return "Work";
    case "appointment":
      return "Position";
    case "research":
      return "Research";
    case "presentation":
      return "Presentation";
    case "clinical":
      return "Clinical placement";
    case "license":
      return CREDENTIAL_KIND_WORD[e.details.credentialKind ?? ""] ?? "Credential";
    case "service":
      return "Service";
    case "membership":
      return "Membership";
    case "reference":
      return "Reference";
    case "credit":
      return CREDIT_MEDIUM_WORD[e.details.medium ?? ""] ?? "Production";
    case "training":
      return "Training";
    case "union":
      return "Union";
  }
}

/** The kind word a performer credit shows when the lane keeps its title off. */
export const CREDIT_MEDIUM_WORD: Record<string, string> = {
  theater: "Stage production", film: "Film", tv: "Television", voice: "Voice work", music: "Music performance", other: "Production",
};

/** The status words a publication shows. Graded, never upgraded (CR-05). */
export function publicationStatusWords(e: PracticeEntry): string {
  switch (e.details.status) {
    case "in_press":
      return "in press";
    case "accepted":
      return "accepted";
    case "submitted":
      return e.details.submittedWhen ? `submitted ${e.details.submittedWhen}` : "submitted";
    default:
      return "";
  }
}

function commaJoin(parts: Part[]): Part[] {
  const out: Part[] = [];
  parts
    .filter((p) => p.text && p.text.trim())
    .forEach((p, i, arr) => {
      if (i === arr.length - 1) out.push({ ...p });
      // A quoted title takes its comma inside the quotes ("Two Poems," Review).
      else if (/^".*"$/.test(p.text)) out.push({ ...p, text: `${p.text.slice(0, -1)},"` });
      else out.push({ ...p, after: "," });
    });
  return out;
}

/** One entry as a row of the artist resume, exactly from the record. */
export function artistRowParts(e: PracticeEntry, mode: "true_title" | "venue_only"): Part[] {
  const place = placeOf(e);
  if (mode === "venue_only") {
    // The kind and the venue, never the title; the status words stay (H1).
    const row = commaJoin([{ text: venueOnlyLabel(e) }, { text: e.venue ?? "" }, { text: place }]);
    const st = statusPart(e);
    if (st) row.push(st);
    return row;
  }
  const d = e.details;
  switch (e.section) {
    case "exhibition": {
      const flags = [d.juried ? "juried" : "", d.invitational ? "invitational" : "", d.curator ? `curated by ${d.curator}` : ""].filter(Boolean).join(", ");
      const row = commaJoin([{ text: e.title, italic: true }, { text: e.venue ?? "" }, { text: place }]);
      if (flags) row.push({ text: `(${flags})` });
      return row;
    }
    case "performance": {
      const row = commaJoin([{ text: e.title, italic: true }, { text: d.role ?? "" }, { text: e.venue ?? "" }, { text: place }]);
      if (d.touring) row.push({ text: "(touring)" });
      return row;
    }
    case "commission":
      return commaJoin([
        { text: e.title, italic: true },
        { text: d.consent && e.venue ? `commissioned by ${e.venue}` : "private commission" },
        { text: place },
      ]);
    case "publication": {
      const status = publicationStatusWords(e);
      const row = commaJoin([{ text: `"${e.title}"` }, { text: e.venue ?? "", italic: true }]);
      if (status) row.push({ text: `(${status})` });
      return row;
    }
    case "press":
      return commaJoin([{ text: d.author ?? "" }, { text: `"${e.title}"` }, { text: e.venue ?? "", italic: true }, { text: d.date ?? "" }]);
    case "collection":
      return commaJoin([
        { text: d.holder === "private" && !d.consent ? "Private collection" : e.venue ?? "" },
        { text: d.holder === "private" && !d.consent ? "" : place },
      ]);
    case "teaching":
      return commaJoin([{ text: e.title }, { text: e.venue ?? "" }, { text: place }, { text: d.level ?? "" }]);
    case "education": {
      const status = d.status === "in_progress" ? (d.expected ? `in progress, expected ${d.expected}` : "in progress") : "";
      const row = commaJoin([{ text: studyTitle(e) }, { text: e.venue ?? "" }, { text: place }]);
      if (status) row.push({ text: `(${status})` });
      return row;
    }
    case "arts_program": {
      const status = d.status === "in_progress" ? "in progress" : "";
      const row = commaJoin([{ text: e.title }, { text: e.venue ?? "" }, { text: place }, { text: d.role ?? "" }]);
      if (status) row.push({ text: `(${status})` });
      return row;
    }
    case "work":
      return commaJoin([{ text: e.title, italic: true }, { text: d.medium ?? "" }]);
    default:
      return commaJoin([{ text: e.title }, { text: e.venue ?? "" }, { text: place }]);
  }
}

export function rowText(parts: Part[]): string {
  return parts.map((p) => p.text + (p.after ?? "")).join(" ");
}

function sortNewestFirst(a: PracticeEntry, b: PracticeEntry): number {
  const ea = a.end_year ?? a.year;
  const eb = b.end_year ?? b.year;
  return eb - ea || b.year - a.year || a.title.localeCompare(b.title);
}

/**
 * The artist resume, assembled from the record. Reverse chronological inside
 * every section, years at the left, empty sections never shown, public
 * collections before private ones (and a private holder named only with
 * their OK).
 */
export function buildArtistResumeModel(entries: PracticeEntry[], s: CreativeKindSettings | null | undefined): ArtistResumeModel {
  const settings = s ?? {};
  const selection = Array.isArray(settings.selection) ? new Set(settings.selection.map((x) => x.toLowerCase())) : null;
  const omitted: ArtistResumeModel["omitted"] = [];
  const needsChoice: string[] = [];
  const sections: ArtistSection[] = [];
  let trimmedAny = false;
  // First pass: the rows this page would print. Only those can make a hidden
  // name public (review s2r2 N-M1); then every row and typed field is checked.
  const pending: { sec: (typeof ARTIST_SECTIONS)[number]; rows: ArtistRow[]; trimmedHere: boolean }[] = [];

  for (const sec of ARTIST_SECTIONS) {
    const all = entries.filter(sec.take).sort(sortNewestFirst);
    if (sec.key === "collection") all.sort((a, b) => (a.details.holder === "private" ? 1 : 0) - (b.details.holder === "private" ? 1 : 0));
    const rows: ArtistRow[] = [];
    let trimmedHere = false;
    for (const e of all) {
      if (selection && !selection.has(e.id.toLowerCase())) {
        omitted.push({ entryId: e.id, reason: "not_selected" });
        trimmedHere = true;
        continue;
      }
      const mode = titleModeFor(e, settings);
      if (mode === "unset") {
        needsChoice.push(e.id);
        omitted.push({ entryId: e.id, reason: "needs_choice" });
        continue;
      }
      if (mode === "leave_out") {
        omitted.push({ entryId: e.id, reason: "leave_out" });
        continue;
      }
      rows.push({ entryId: e.id, years: yearsOf(e), parts: artistRowParts(e, mode), mode });
    }
    pending.push({ sec, rows, trimmedHere });
  }

  const byId = new Map(entries.map((e) => [e.id.toLowerCase(), e]));
  const settled = settleShown(
    pending.flatMap((p) => p.rows),
    (r) => r.entryId,
    (r, t) => rowFacilityHit(r, byId.get(r.entryId.toLowerCase()), t),
    (ids) => hiddenFacilityTerms(entries, settings, ids)
  );
  const hidden = settled.terms;
  const heldFields: string[] = [];
  const asks: FacilityAsk[] = [];
  const keep = (field: keyof CreativeKindSettings): string | undefined => {
    const t = settings[field] as string | undefined;
    if (!t) return t;
    const h = facilityCheck(t, hidden, ARTIST_FIELD_KIND[field as string] ?? "text");
    if (h?.tier === 1) return void heldFields.push(field);
    if (h) asks.push({ field, phrase: h.phrase });
    return t;
  };
  for (const { sec, rows: all, trimmedHere } of pending) {
    const rows = all.filter((r) => {
      const h = settled.hits.get(r);
      if (h?.tier === 1) {
        omitted.push({ entryId: r.entryId, reason: "names_hidden" });
        return false;
      }
      if (h) asks.push({ entryId: r.entryId, phrase: h.phrase });
      return true;
    });
    if (trimmedHere) trimmedAny = true;
    if (rows.length) {
      sections.push({ key: sec.key, heading: trimmedHere ? `Selected ${sec.heading}` : sec.heading, rows });
    }
  }

  const contact = (["basedIn", "email", "phone", "website"] as const).map(keep).filter((x): x is string => !!x);
  return {
    header: { name: keep("displayName") ?? "", discipline: keep("discipline") ?? "", contact },
    sections,
    needsChoice,
    omitted,
    heldFields,
    asks,
    trimmed: trimmedAny,
  };
}

/** The artist resume as plain text, for portal fields (years, a tab-free space, the row). */
export function artistResumePlainText(m: ArtistResumeModel): string {
  const lines: string[] = [];
  if (m.header.name) lines.push(m.header.name);
  if (m.header.discipline) lines.push(m.header.discipline);
  if (m.header.contact.length) lines.push(m.header.contact.join(" | "));
  for (const s of m.sections) {
    lines.push("", s.heading.toUpperCase());
    for (const r of s.rows) lines.push(`${r.years}  ${rowText(r.parts)}`);
  }
  return lines.join("\n").trim();
}

// ------------------------------------------------------------ work samples --

export interface WorkSampleRow {
  entryId: string;
  number: number;
  title: string;
  year: string;
  medium: string;
  /** Dimensions or duration, as the person gave it. */
  size: string;
  /** One line in the person's own words. Never generated. */
  description: string;
  fileName: string;
}

/**
 * The work-sample list: the person's works in the order they set (strongest
 * first). Works not in the order follow, newest first. Every field is copied
 * from the record as typed.
 */
export function buildWorkSampleList(
  entries: PracticeEntry[],
  order: string[] | null | undefined,
  s?: CreativeKindSettings | null
): WorkSampleRow[] {
  // The lane's choice decides, as for every document. A work has no venue, so
  // "venue only" keeps it off this list just like "leave it off"; a work with
  // no choice yet stays off and is asked about. A work whose own words name a
  // place this lane keeps off stays off too; only works on this list make a
  // word public (review s2r3 N3-M1).
  const works = workSampleCheck(entries, s).kept;
  const byId = new Map(works.map((w) => [w.id.toLowerCase(), w]));
  const ordered: PracticeEntry[] = [];
  for (const id of order ?? []) {
    const w = byId.get(id.toLowerCase());
    if (w && !ordered.includes(w)) ordered.push(w);
  }
  for (const w of [...works].sort(sortNewestFirst)) if (!ordered.includes(w)) ordered.push(w);
  return ordered.map((w, i) => ({
    entryId: w.id,
    number: i + 1,
    title: w.title,
    year: yearsOf(w),
    medium: w.details.medium ?? "",
    size: w.details.dimensions ?? w.details.duration ?? "",
    description: w.details.description ?? "",
    fileName: w.details.fileName ?? "",
  }));
}

/** A work's own words, as the facility check reads them. */
export function workText(e: PracticeEntry): string {
  return [e.title, e.details.medium, e.details.description, e.details.fileName].filter(Boolean).join(". ");
}

/** The works this lane may list (true title), settled against what the list itself prints, with each one's facility hit. */
export function workSampleCheck(entries: PracticeEntry[], s?: CreativeKindSettings | null) {
  const candidates = entries.filter((e) => e.section === "work" && titleModeFor(e, s) === "true_title");
  return settleShown(
    candidates,
    (e) => e.id,
    (e, t) => facilityCheck(workText(e), t, "text"),
    (ids) => hiddenFacilityTerms(entries, s, ids)
  );
}

export function workSampleListPlainText(rows: WorkSampleRow[]): string {
  return rows
    .map((r) => [`${r.number}. ${r.title}, ${r.year}`, [r.medium, r.size].filter(Boolean).join(", "), r.description, r.fileName ? `File: ${r.fileName}` : ""].filter(Boolean).join("\n"))
    .join("\n\n");
}

function csvCell(s: string): string {
  // Keep spreadsheet formulas inert: a leading = + - @ is quoted with a '.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function workSampleListCsv(rows: WorkSampleRow[]): string {
  const head = ["Number", "Title", "Year", "Medium", "Size or length", "Description", "File name"];
  return [head, ...rows.map((r) => [String(r.number), r.title, r.year, r.medium, r.size, r.description, r.fileName])]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n");
}

// ---------------------------------------------------------- counts, export --

/** Characters as portals count them: every character, spaces and line breaks included. */
export function countChars(text: string): number {
  return Array.from(text ?? "").length;
}

export function countWords(text: string): number {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

export interface PlainTextDoc {
  key: "artist_resume" | "bio_short" | "bio_medium" | "bio_long" | "statement" | "work_samples";
  label: string;
  text: string;
  chars: number;
  words: number;
}

export function plainTextDoc(key: PlainTextDoc["key"], label: string, text: string): PlainTextDoc {
  return { key, label, text, chars: countChars(text), words: countWords(text) };
}

/** How many entries shown on a page are still marked "need to find" proof (a note by the downloads; never a BLOCK). */
export function stillNeedsProof(entries: PracticeEntry[], shownIds: string[]): number {
  const shown = new Set(shownIds.map((x) => x.toLowerCase()));
  return entries.filter((e) => e.proof === "need_to_find" && shown.has(e.id.toLowerCase())).length;
}

export const NEEDS_PROOF_NOTE = "Some entries still need proof. You can download now; keep the proof handy.";

/**
 * Scope claims: words that say someone ran, led, trained or answered for
 * other people. One list for the resume and the cover letter, so the two
 * rules can never drift apart.
 *
 * Round 5: a scope claim on a line that is not in the person's own words is
 * settled only by the person's own rewrite or by cutting the line. An answer
 * never settles one, so nothing here reads an answer.
 *
 * Round 6: a scope claim is "theirs" only per claim. In one sentence of the
 * person's own words there must be the same family of verb, in the active
 * voice (not "was supervised by"), not denied, not inside a credential name
 * ("ServSafe Manager"), and, when the page names people ("the night crew"),
 * the same people. A family word anywhere is never enough.
 */

import { namedCredentialRe } from "./credentialWords";

export type ScopeFamily =
  | "supervise"
  | "manage"
  | "lead"
  | "oversee"
  | "direct"
  | "mentor"
  | "coordinate"
  | "train"
  | "schedule"
  | "responsible"
  | "delegate"
  | "hire"
  | "evaluate"
  | "own";

const PEOPLE = String.raw`(?:crews?|teams?|shifts?|staff|staffers?|department|store|kitchen|cooks?|workers?|employees?|hires?|associates?|people|persons?|operators?|drivers?|loaders?|aides?|nurses?|servers?|dishwashers?|volunteers?|interns?|techs?|technicians?|helpers?|laborers?|pickers?|packers?|men|guys|hands|members?|leads|reps?|agents?|cashiers?|clerks?|trainees?|apprentices?|co-?workers?|teammates?|colleagues?|peers?|newcomers?|starters?|temps?)`;
// Up to three words before the people noun ("all of the new", "a group of new", "the entire overnight dish washing").
const DET = String.raw`(?!(?:on|in|at|to|for|with|by|as|into|out|from|up|through|under|about|around|over|when|while|whenever|if|until|after|before|because|since|once|alongside|beside|among|like|next)\b)(?:(?:the|a|an|our|my|their|new|other|every|all|entire|whole)\s+){0,2}(?:(?:group|team|crew|bunch|handful)\s+of\s+(?:the\s+)?)?(?:of\s+the\s+)?(?:(?!(?:and|or)\s+(?:train|supervis|manag|lead|led|schedul|coordinat|mentor|direct|overs|hir|evaluat|onboard|coach|teach|taught|instruct|assign|ran|run)\w*\b)[a-z0-9-]+\s+){0,3}`;

const PATTERNS: Array<[RegExp, ScopeFamily]> = [
  [/\bsupervis\w*/gi, "supervise"],
  [/\bmanag(?:e|ed|es|ing|er|ers)\b(?!\s+to\b)/gi, "manage"],
  // "Time management", "inventory management" are skills; "team management" claims people.
  [/\b(?:team|staff|people|crew|employee|personnel|shift|store|kitchen|department|floor)\s+management\b/gi, "manage"],
  // Round 10: "the management of the stockroom crew" (a nominal claim; see isNounUse).
  [/\bmanagement\s+of\b/gi, "manage"],
  [/\b(?:led|lead|leads|leading|leader|leaders|leadership)\b/gi, "lead"],
  [/\bhead(?:ed|s|ing)?\s+up\s+(?:the\s+|a\s+|an\s+)?[a-z-]+/gi, "lead"],
  [new RegExp(String.raw`\bhead(?:ed|s|ing)?\s+${DET}${PEOPLE}\b`, "gi"), "lead"],
  [new RegExp(String.raw`\b${PEOPLE}\s+head\b`, "gi"), "lead"],
  [/\b(?:in charge of|took charge|take charge|taking charge|took over|take over|taking over)\b/gi, "lead"],
  [/\bspearhead\w*/gi, "lead"],
  [/\bboss(?:ed|es|ing)?\b/gi, "lead"],
  [/\bforem[ae]n\b/gi, "lead"],
  [/\bcaptain\w*/gi, "lead"],
  [/\bran\s+point\b/gi, "lead"],
  [/\b(?:point\s+person|crew\s+chief|second\s+in\s+command|key\s*-?\s*holder)\b/gi, "lead"],
  [new RegExp(String.raw`\bgo-?to\s+(?:person\s+)?for\s+${DET}${PEOPLE}\b`, "gi"), "lead"],
  [/\b(?:ran|runs?|running)\s+(?:the\s+)?(?:floor|line)\b/gi, "lead"],
  [new RegExp(String.raw`\b(?:ran|runs?|running)\s+${DET}${PEOPLE}\b`, "gi"), "lead"],
  [/\b(?:oversaw|oversee\w*|oversight)\b/gi, "oversee"],
  [/\bdirect(?:ed|s|ing|or|ors)\b/gi, "direct"],
  [/\bmentor\w*/gi, "mentor"],
  [/\bcoordinat\w*/gi, "coordinate"],
  [new RegExp(String.raw`\borgani[sz]\w*\s+${DET}${PEOPLE}\b`, "gi"), "coordinate"],
  [new RegExp(String.raw`\b(?:train(?:ed|s|ing)?|taught|teach(?:es|ing)?|coach\w*|onboard\w*|instruct\w*)(?!\s+(?:shifts?|sessions?|classes?|weeks?|days?|programs?|courses?)\b)\s+${DET}${PEOPLE}\b`, "gi"), "train"],
  [new RegExp(String.raw`\bshow\w*\s+${DET}${PEOPLE}\s+the\s+ropes\b`, "gi"), "train"],
  [/\bowned\s+(?:the\s+)?(?:[a-z-]+\s+){0,2}schedul\w*/gi, "schedule"],
  [new RegExp(String.raw`\bschedul\w*\s+(?:for\s+)?${DET}${PEOPLE}\b`, "gi"), "schedule"],
  [/\b(?:wrote|write|writes|made|make|makes|built|build|did|set|sets)\s+(?:up\s+)?(?:the\s+)?(?:[a-z-]+\s+)?schedules?\b/gi, "schedule"],
  [new RegExp(String.raw`\bkept\s+${DET}${PEOPLE}\s+on\s+(?:task|track|schedule)\b`, "gi"), "supervise"],
  [new RegExp(String.raw`\bwr(?:o|i)te?\s+up\s+${DET}${PEOPLE}\b|\bwrote\s+up\s+${DET}${PEOPLE}\b`, "gi"), "supervise"],
  [/\bapprov\w*\s+(?:the\s+)?(?:time\s+off|hours|time\s*cards?|timesheets?|schedules?|overtime|requests?)\b/gi, "supervise"],
  [/\bresponsible\s+for\b/gi, "responsible"],
  [/\bdelegat\w*/gi, "delegate"],
  [new RegExp(String.raw`\bassign\w*\s+(?:[a-z-]+\s+){0,3}to\s+${DET}${PEOPLE}\b`, "gi"), "delegate"],
  [/\bhir(?:ed|es|ing)\s+and\s+fir\w*/gi, "hire"],
  [new RegExp(String.raw`\bevaluat\w*\s+${DET}${PEOPLE}\b`, "gi"), "evaluate"],
  [new RegExp(String.raw`\bevaluat\w*\s+(?:[a-z-]+\s+){0,2}(?:performance|reviews?)\b`, "gi"), "evaluate"],
  [/\b(?:co-?owner|owner[\s/&-]*(?:and\s+)?operator|business\s+owner|owned\s+and\s+operated|self[\s-]employed)\b/gi, "own"],
];

// The people a claim is about (and, for "ran the floor/line" and "head up X", its object).
const NOUN_RE = new RegExp(String.raw`^(?:${PEOPLE}|floor|line)$`, "i");
const stemNoun = (w: string) => w.toLowerCase().replace(/(?<!s)s$/, "").replace(/^(m|wom)en$/, "$1an");

export interface ScopeHit {
  family: ScopeFamily;
  /** The words on the line, as written. */
  word: string;
  /** The people (or object) the claim names, stemmed, when it names any. */
  noun?: string;
  /** Every people word the claim names, stemmed. */
  nouns: string[];
  /** The other content words of its object ("daily dock operations" is dock and operation). */
  objects?: string[];
  /** Round 11: the page says it was shared ("Helped train new hires", "Trained new hires with my lead"). */
  shared?: boolean;
  /** A role on the page ("as a shift lead"), not a verb. */
  role?: boolean;
}

/** True when the hit is a role ("kitchen manager", "a shift lead"), not a verb. */
function isRoleUse(text: string, m: RegExpMatchArray): boolean {
  if (ROLE_NOUN_RE.test(m[0])) return true;
  if (!/^leads?$/i.test(m[0])) return false;
  const prev = text.slice(0, m.index).toLowerCase().match(/([a-z]+)\s*$/)?.[1];
  return !!prev && ROLE_PREV.has(prev);
}
const OBJECT_STOP = new Set(["as", "for", "with", "at", "on", "in", "to", "but", "while", "from", "by", "during", "across", "into", "when", "who", "that", "which", "alongside", "beside", "among", "like", "next"]);
const ROLE_PREV = new Set(["a", "an", "the", "as", "shift", "team", "crew", "line", "floor", "night", "day", "kitchen", "production", "warehouse", "store", "lead", "project", "dock", "grill"]);
const ARTICLE = new Set(["a", "an", "the", "as", "my", "our", "their", "his", "her"]);

function nounFor(text: string, m: RegExpMatchArray): string | undefined {
  // A role names its own scope by the word before it ("shift lead" is "shift", "kitchen manager" is "kitchen").
  if (isRoleUse(text, m)) {
    const prev = text.slice(0, m.index).toLowerCase().match(/([a-z]+)\s*$/)?.[1];
    return prev && !ARTICLE.has(prev) ? stemNoun(prev) : undefined;
  }
  // People named inside the match, after its verb ("Trained the night crew").
  const inside = (m[0].toLowerCase().match(/[a-z]+/g) ?? []).slice(1).filter((w) => NOUN_RE.test(w));
  if (/^head(?:ed|s|ing)?\s+up\b/i.test(m[0])) {
    const obj = m[0].toLowerCase().replace(/^head(?:ed|s|ing)?\s+up\s+(?:the\s+|a\s+|an\s+)?/, "");
    return obj ? stemNoun(obj) : undefined;
  }
  if (inside.length) return stemNoun(inside[inside.length - 1]);
  // Only in the same sentence.
  return firstPeopleRun(text.slice((m.index ?? 0) + m[0].length).split(/[.;!?]/)[0], NOUN_RE);
}

/** Every people word a claim names: its role word, or the people in its match and its object ("a team of 42 operators" is team and operator). */
function peopleFor(text: string, m: RegExpMatchArray): string[] {
  const main = nounFor(text, m);
  if (isRoleUse(text, m) || /^head(?:ed|s|ing)?\s+up\b/i.test(m[0])) return main ? [main] : [];
  const inside = peopleClasses((m[0].toLowerCase().match(/[a-z]+/g) ?? []).slice(1), NOUN_RE);
  return Array.from(new Set([...inside, ...objectPeople(text.slice((m.index ?? 0) + m[0].length).split(/[.;!?]/)[0], NOUN_RE, inside.length > 0)]));
}

const OBJECT_FILLER = new Set(["the", "a", "an", "all", "our", "my", "their", "daily", "and", "or", "both", "overall", "various", "multiple", "every", "each", "new", "two", "three", "four", "five", "six", "it", "them", "this", "that", "of"]);

/** The content words of a claim's object, stemmed ("daily dock operations" is dock and operation). */
function objectWords(text: string, m: RegExpMatchArray): string[] {
  const after = text.slice((m.index ?? 0) + m[0].length).split(/[.;!?]/)[0];
  const all = after.toLowerCase().match(/[a-z]+/g) ?? [];
  const stop = objectStop(all);
  return (stop >= 0 ? all.slice(0, stop) : all).slice(0, 6).filter((w) => !OBJECT_FILLER.has(w) && w.length > 2).map(stemNoun);
}

/**
 * The people in a verb's object phrase (up to the first preposition other
 * than "of"), as classes: a generic group (crew, team, staff, hires, people,
 * guys...) is "group", unless a word before it says which ("dish crew" is
 * "dish", "kitchen staff" is "kitchen"; a time word such as "night" does not
 * count); a role keeps its own name and its usual group ("cooks" is "cook"
 * and "kitchen", "dishwashers" is "dishwasher" and "dish").
 */
// Round 11: "trained new cashiers and ran the store": the next verb starts a new claim, not more people.
const objectStop = (all: string[], fromStart = false) => all.findIndex((w, i) => OBJECT_STOP.has(w) || ((i > 0 || fromStart) && (w === "and" || w === "or") && /^(?:[a-z]+ed|ran|led|oversaw|taught|made|did|took|kept|drove|ran|run|runs|lead|leads|train|trains|supervise|supervises|manage|manages)$/.test(all[i + 1] ?? "")));

function objectPeople(after: string, re: RegExp, afterObject = false): string[] {
  const all = after.toLowerCase().match(/[a-z]+/g) ?? [];
  const stop = objectStop(all, afterObject);
  return peopleClasses((stop >= 0 ? all.slice(0, stop) : all).slice(0, 7), re);
}

// Generic work groups, one class. Volunteers, interns, helpers and laborers are their own people, not "the crew".
const GROUP = new Set(["crew", "team", "staff", "staffer", "people", "person", "guy", "hire", "employee", "worker", "associate", "trainee", "member", "hand", "man", "shift", "department", "store", "line", "coworker", "co-worker", "teammate", "colleague", "peer", "newcomer", "starter"]);
const TIME_WORDS = new Set(["night", "day", "morning", "evening", "weekend", "overnight", "first", "second", "third", "graveyard", "new", "entire", "whole", "other", "all", "every", "the", "a", "an", "our", "my", "their", "of", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "twelve", "large", "small", "big"]);
const ROLE_GROUP: Record<string, string> = { cook: "kitchen", dishwasher: "dish", server: "floor", cashier: "front", nurse: "nursing", aide: "nursing", driver: "driving", loader: "dock", picker: "warehouse", packer: "warehouse" };

// Markers that ride along with the classes: "~group" when a group is named ("staff", "the crew", "all of the
// ..."), "~plural" when more than one person is ("the new cooks").
const GROUP_MARK = "~group";
const PLURAL_MARK = "~plural";
// Round 9: "~all" when the claim takes in everyone ("all", "entire", "whole", "every"); "~subset" when it
// counts them ("two", "a couple of", "a few"); "~new" when it names only the new ones.
const ALL_MARK = "~all";
const SUBSET_MARK = "~subset";
const NEW_MARK = "~new";
// Round 10: "~bare" when a group noun has no determiner ("I trained guys", "I trained employees"): some people, not
// the whole group. "~t:night" for each shift a claim names ("day and night shifts" is two).
const BARE_MARK = "~bare";
const SHIFT_TIME_RE = /^(?:day|days|night|nights|morning|evening|weekend|weekends|overnight|first|second|third|graveyard|swing)$/;
const DETERMINER_WORD_RE = /^(?:the|a|an|our|my|their|his|her|this|that|these|those|all|entire|whole|every|both|each)$/;
const SUBSET_WORD_RE = /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+|couple|few|some|several|handful|pair|most|many)$/;

function peopleClasses(words: string[], re: RegExp): string[] {
  const out = new Set<string>();
  const marks = new Set<string>();
  // Round 12: "every shift / week / day / night" is how often, not everyone.
  if (words.some((w, i) => /^(?:all|entire|whole)$/.test(w) || (w === "every" && !/^(?:shift|shifts|day|days|night|nights|week|weeks|weekend|weekends|morning|evening|month|year|time|sunday|monday|tuesday|wednesday|thursday|friday|saturday|other)$/.test(words[i + 1] ?? "")))) {
    marks.add(GROUP_MARK);
    marks.add(ALL_MARK);
  }
  if (words.some((w) => SUBSET_WORD_RE.test(w))) marks.add(SUBSET_MARK);
  if (words.some((w) => /^(?:new|newer)$/.test(w))) marks.add(NEW_MARK);
  if (words.some((w) => /^(?:shifts?)$/.test(w))) for (const w of words) if (SHIFT_TIME_RE.test(w)) marks.add(`~t:${w.replace(/s$/, "")}`);
  if (words.includes("both")) marks.add("~both");
  words.forEach((w, i) => {
    if (!re.test(w)) return;
    const s = stemNoun(w);
    if (s !== w.toLowerCase() || /^(?:men|people|staff|crew|team|hands)$/.test(w)) marks.add(PLURAL_MARK);
    if (GROUP.has(s)) {
      marks.add(GROUP_MARK);
      if (!words.slice(0, i).some((x) => DETERMINER_WORD_RE.test(x))) marks.add(BARE_MARK);
      const prev = words[i - 1];
      if (prev && !TIME_WORDS.has(prev) && !/^\d+$/.test(prev) && !re.test(prev)) out.add(stemNoun(prev));
      else out.add("group");
      return;
    }
    out.add(s);
    // A role also names its usual group ("cooks" are kitchen people), so it can stand for "kitchen staff".
    if (ROLE_GROUP[s]) out.add(ROLE_GROUP[s]);
  });
  // A specific class says more than "group": drop "group" when a role or modifier is named.
  if (out.size > 1) out.delete("group");
  return [...Array.from(out), ...Array.from(marks)];
}

/**
 * How many people a claim takes in (round 9): 0 one person ("a new cook"), 1
 * some people ("new cooks", "the new guys", "two new guys"), 2 a whole group
 * ("the dock crew", "nursing staff"), 3 everyone ("all new hires", "the
 * entire staff").
 */
function scopeLevel(classes: string[], theirs = false): number {
  if (classes.includes(ALL_MARK)) return 3;
  // Round 10: on the person's side a bare plural ("I trained guys") is some people, never the whole group.
  const group = classes.includes(GROUP_MARK) && !(theirs && classes.includes(BARE_MARK));
  if (group && !classes.includes(SUBSET_MARK) && !classes.includes(NEW_MARK)) return 2;
  return classes.includes(PLURAL_MARK) ? 1 : 0;
}

/**
 * Round 8: the person's claim covers the page's people only when every people
 * class on the page is in theirs. A role never stands for another role:
 * "nurses" are not "aides".
 *
 * Round 9: quantities agree. The person's words must take in as many people
 * as the page or more: one new cook never sources "new cooks", "new aides"
 * never source "nursing staff" or "the entire nursing staff". "all / entire / whole / every" on
 * the page needs the same word, or a whole group with no number or "new" on
 * theirs ("I trained the crew").
 */
function peopleCovered(page: string[], theirs: string[]): boolean {
  const real = page.filter((n) => !n.startsWith("~"));
  const mine = theirs.filter((n) => !n.startsWith("~"));
  if (!real.every((n) => mine.includes(n))) return false;
  // A role on the page needs that very role on theirs, not only its group.
  if (real.some((n) => ROLE_GROUP[n]) && !real.filter((n) => ROLE_GROUP[n]).every((n) => mine.includes(n))) return false;
  // Round 10: two shifts on the page ("day and night shifts", "both shifts") need each of them in their words.
  const times = (cls: string[]) => cls.filter((n) => n.startsWith("~t:"));
  const pageTimes = times(page);
  if ((pageTimes.length >= 2 || page.includes("~both")) && (!pageTimes.every((t) => theirs.includes(t)) || times(theirs).length < Math.max(2, pageTimes.length))) return false;
  const page_ = scopeLevel(page);
  const mine_ = scopeLevel(theirs, true);
  // Everyone ("all new hires", "the entire staff", "every employee"): round 10, their words say all or every too.
  if (page_ === 3) return theirs.includes(ALL_MARK);
  // A whole group ("the dish crew", "nursing staff"): more than one person, and not only the new ones.
  if (page_ === 2) return mine_ >= 2 || (mine_ === 1 && !theirs.includes(NEW_MARK));
  // Some people ("new cooks"): more than one.
  if (page_ === 1) return mine_ >= 1;
  return true;
}

/** The people a few words after a verb: the last word of the first run of people words ("new team leads" is "lead"). */
function firstPeopleRun(after: string, re: RegExp): string | undefined {
  // The verb's own object only: stop at the first preposition or joining word ("coordinated freight as a shift lead").
  const all = after.toLowerCase().match(/[a-z]+/g) ?? [];
  const stop = objectStop(all);
  const words = (stop >= 0 ? all.slice(0, stop) : all).slice(0, 7);
  let i = words.findIndex((w) => re.test(w));
  if (i < 0 || i > 5) return undefined;
  while (i + 1 < words.length && re.test(words[i + 1])) i++;
  return stemNoun(words[i]);
}

// "under the store manager", "helped the shift supervisor": someone else's role, not a claim.
const OTHER_ROLE_BEFORE = /\b(?:under|for|with|by|alongside|assisted|assisting|helped|helping|supported|supporting|reported\s+to|reporting\s+to|told|asked|from)\s+(?:(?:the|a|an|my|our|their|his|her)\s+)?(?:[a-z-]+\s+){0,2}$|\b(?:supervision|direction|leadership|guidance|oversight|management)\s+of\s+(?:(?:the|a|an|my|our|their|his|her)\s+)?(?:[a-z-]+\s+){0,2}$|\b(?:when|while|whenever|if|until|after|before|because|since|once)\s+(?:the|a|an|my|our|their|his|her)\s+(?:[a-z-]+\s+){0,2}$/i;
const DETERMINER_BEFORE = /\b(?:the|a|an|my|our|their|his|her|its)\s+$/i;

/**
 * Round 9: true when a hit is a noun (someone's role or a thing), never a
 * verb: a role noun ("the store manager"), a noun form ("the care
 * coordination team"), "lead" or "head" used as a role ("the shift lead",
 * "the head cook"), or a word after a determiner ("the training team"). Only
 * a noun is skipped after "under / for / with / by ..."; a verb ("Chosen by
 * the manager to supervise", "Known for training", "Stepped in for the
 * supervisor and led") is always a claim.
 */
/**
 * Round 10 (SF-4): a nominal claim, "the training of new hires", "supervision of the night crew",
 * "leadership of the dock crew": the noun is followed by "of" and people, and not by someone's role
 * ("under the supervision of the shift lead").
 */
function isNominalClaim(text: string, m: RegExpMatchArray): boolean {
  const end = (m.index ?? 0) + m[0].length;
  const ofInside = /^\S+\s+of\b/i.test(m[0]);
  const after = text.slice(end);
  if (!ofInside && !/^\s+of\s/i.test(after)) return false;
  const object = (ofInside ? m[0].replace(/^\S+\s+of\s+/i, "") + after : after.replace(/^\s+of\s+/i, "")).split(/[.;!?,]/)[0];
  if (/\b(?:lead|manager|supervisor|foreman|director|boss|owner|gm|chef|coordinator)\b/i.test(object.split(/\s+(?:on|in|at|for|with|during|across)\s+/i)[0])) return false;
  return !!firstPeopleRun(object, NOUN_RE) || objectPeople(object, NOUN_RE).some((n) => !n.startsWith("~"));
}

function isNounUse(text: string, m: RegExpMatchArray): boolean {
  if (isRoleUse(text, m) || NOUN_FORM_RE.test(m[0])) return true;
  const before = text.slice(0, m.index);
  const prev = before.toLowerCase().match(/([a-z]+)\s*$/)?.[1];
  // "the head cook", "a crew head": head as a noun, not "headed the crew".
  if (/^head\s/i.test(m[0]) && !!prev && (ARTICLE.has(prev) || ROLE_PREV.has(prev))) return true;
  if (/\shead$/i.test(m[0])) return true;
  return DETERMINER_BEFORE.test(before);
}

// Round 11: a page line that says the work was shared: "Helped train", "Assisted with training", "... with my lead",
// "... alongside the shift lead", "as part of the crew that ...".
const PAGE_SHARED_AFTER = /^[^.;!?]*?\b(?:with|alongside|together\s+with)\s+(?:my|the|our|a|his|her|their)\s+(?:[a-z-]+\s+){0,2}(?:lead|leads|supervisor|manager|team|crew|trainer|trainers|boss|coworkers?|co-workers?|partner|leadership|staff)\b/i;
function isSharedOnPage(text: string, m: RegExpMatchArray): boolean {
  const before = text.slice(0, m.index);
  if (SHARED_BEFORE.test(before) || /\bas\s+part\s+of\s+[^.;!?]*$/i.test(before)) return true;
  return PAGE_SHARED_AFTER.test(text.slice((m.index ?? 0) + m[0].length));
}

const PAGE_NOT_DONE_BEFORE = /\b(?:would|will|can|could|'d|'ll|hope|hoping|want|wants|eager|ready|chance|glad|love|like|looking\s+forward)\b[^.;!?,]*$/i;
const TRAINED_ADJ_BEFORE = /(?:[A-Za-z0-9][-\u2010-\u2015]|\b(?:cross|forklift|osha|haccp|servsafe|safety|cpr|hazmat|equipment|fully|well|highly|newly|properly|lift|reach|crane)\s+)$/i;

/** Every scope claim in a page line. */
export function scopeHits(line: string): ScopeHit[] {
  // Round 9: a known credential's name is not a scope claim ("I hold a current ServSafe Food Protection
  // Manager certification"); the credential is asked about on its own.
  const text = straightQuotes(line || "").replace(namedCredentialRe(), (x) => (/\b(?:manager|master|supervisor|lead)\b/i.test(x) ? "x".repeat(x.length) : x));
  const found: Array<ScopeHit & { at: number; end: number; role: boolean }> = [];
  for (const [re, family] of PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, "gi"))) {
      // Someone else's role or work: "under the head cook", "for the care coordination team".
      // Round 9: a noun only. A verb after "by / for / with / asked" is still the page's claim.
      // Round 11: a plan or a wish on the page ("I would welcome the chance to help run your store") is not a claim
      // of something done; a past-tense claim ("trained new hires") always is.
      if (!PAST_VERB_RE.test(m[0].split(/\s+/)[0]) && PAGE_NOT_DONE_BEFORE.test(text.slice(0, m.index))) continue;
      // Round 11 (SF-2): "Forklift-trained operator", "cross-trained team member": an adjective, not training people.
      if (/^trained\b/i.test(m[0]) && TRAINED_ADJ_BEFORE.test(text.slice(0, m.index))) continue;
      // Round 10: a nominal claim ("Tasked with the training of all new hires") is a claim, not someone else's.
      if (isNounUse(text, m) && OTHER_ROLE_BEFORE.test(text.slice(0, m.index)) && !isNominalClaim(text, m)) continue;
      found.push({ family, word: m[0], noun: nounFor(text, m), nouns: peopleFor(text, m), objects: objectWords(text, m), at: m.index!, end: m.index! + m[0].length, role: isRoleUse(text, m), shared: isSharedOnPage(text, m) });
    }
  }
  // A role word inside another claim is that claim's people ("trained new team leads"), not a role of the person's.
  return found
    .filter((h) => !(h.role && found.some((o) => o !== h && !o.role && o.at <= h.at && o.end >= h.end)))
    .map(({ family, word, noun, nouns, objects, shared, role }) => ({ family, word, noun, nouns, objects, ...(shared ? { shared } : {}), ...(role ? { role } : {}) }));
}

// The person's own words are read a little more loosely than the page: a
// verb of the family followed, in the same sentence, by people within a few
// words ("Trained and mentored twelve new team leads" covers "trained new
// team leads").
const LOOSE: Array<[RegExp, ScopeFamily]> = [
  [/\b(?:train(?:ed|s|ing)?|taught|teach(?:es|ing)?|coach\w*|onboard\w*|instruct\w*)\b/gi, "train"],
  [/\b(?:ran|runs?|running|head(?:ed|s|ing)?)\b/gi, "lead"],
  [/\bschedul\w*/gi, "schedule"],
  [/\borgani[sz]\w*/gi, "coordinate"],
  [/\bevaluat\w*/gi, "evaluate"],
  [/\bassign\w*/gi, "delegate"],
];
const PEOPLE_RE = new RegExp(String.raw`^${PEOPLE}$`, "i");
const NEGATION_BEFORE = /\b(?:never|not|no|didn['’]?t|did not|don['’]?t|wasn['’]?t|was not|weren['’]?t|nobody|none)\b(?:\s+\S+){0,3}\s*$/i;
// "was supervised by", "got trained", "were hired and fired by": the person is not the one doing it.
const PASSIVE_BEFORE = /\b(?:was|were|been|being|got|get|gets|getting|is|are|am|be)\s+(?:(?:also|just|always|often|first|then|all)\s+)?$/i;
// Credential names hold scope words that are not claims ("ServSafe Manager", "Certified Kitchen Supervisor card").
// Round 9: "training" followed by people is the verb ("in charge of training the new hires"), not a course name.
const CLAIM_NAME_RE = new RegExp(
  String.raw`\b(?:[A-Za-z0-9][\w&'-]*\s+){1,3}(?:certification|certificate|card|license|licence|certified|course|class|training(?!\s+${DET}${PEOPLE}\b))\b`,
  "gi"
);

const ROLE_NOUN_RE = /^(?:manager|managers|leader|leaders|leadership|supervisor|supervisors|director|directors|mentor|mentors|coordinator|coordinators|foreman|foremen|captain)$/i;
// A role at the start of a line is the person's own job title ("Shift Lead | Midwest Distribution").
const TITLE_START = /^\s*(?:[A-Za-z-]+\s+){0,3}$/;
const OWN_ROLE_BEFORE = /\b(?:i\s+(?:was|am|became|served\s+as|worked\s+as|started\s+as)|as)\s+(?:an?|the|their|our)?\s*(?:[a-z-]+\s+){0,3}$/i;

interface Claim {
  family: ScopeFamily;
  nouns: string[];
  objects: string[];
  /** The family's verb, active, with the person as its subject ("I supervised ...", "Supervised ..."). */
  verbSelf: boolean;
  /** The person is the one doing it, alone ("I trained", "Trained ..."). */
  self: boolean;
  /** Round 11: done with others ("we trained", "Mike and I trained", "I helped train"): clears only a shared page line. */
  shared: boolean;
  /** Their own role ("Shift Lead | Midwest", "I was the shift lead"): clears only the same role on the page, never a verb. */
  role?: boolean;
}

// Noun forms are never a claim of the person's ("my supervision", "management liked my work",
// "hand-eye coordination", "my mentor", "my lead's directions"); a role noun counts only as their own role.
const NOUN_FORM_RE = /^(?:supervision|supervisions|management|coordination|coordinations|direction|directions|oversight|leadership|mentorship|lead's|leads'|mentor|mentors)$/i;
// ---- Round 11: the strict matcher -----------------------------------------------------------
// Free text makes a scope claim the person's only in these shapes, and never through a growing list of
// helpers (rounds 9 and 10 each opened a leak by widening one):
//   - "I" + a plain past-tense verb, with at most a few adverbs between ("I trained", "I also supervised");
//   - "I used to" + verb; "I was / I'm the one who" + verb; "they / my boss had (made, let) me" + verb;
//   - "I was (put) in charge of", "I was responsible for";
//   - a line or clause that starts with a past-tense verb (their own resume: "Trained new hires, ran the dock").
// "We", "<name> and I", "me and <name>", "I helped (him) train" are SHARED: they clear only a shared page
// line ("Helped train new hires", "Trained new hires with my lead"), never a solo claim. Anything else
// ("would", "'d", "started", "kept", "got to", "ended up", any modal) is a one-tap card on the page.
const ADVERBS = String.raw`(?:also|personally|mainly|basically|pretty\s+much|often|always|regularly|sometimes|usually|just|even|really|actually|mostly|then|first|later|eventually|finally|once|both|myself|still)`;
const PAST_VERB_RE = /^(?:[a-z]+ed|ran|led|oversaw|taught|made|wrote|built|set|did|took|kept|showed|drove|bossed|head(?:ed)?)$/i;
const SELF_PAST_BEFORE = new RegExp(String.raw`\bI(?:'ve|\s+have|\s+had)?\s+(?:${ADVERBS}\s+){0,3}$`, "i");
const USED_TO_BEFORE = new RegExp(String.raw`\bI\s+(?:${ADVERBS}\s+){0,2}used\s+to\s+(?:${ADVERBS}\s+){0,1}$`, "i");
const ONE_WHO_BEFORE = new RegExp(String.raw`\bI(?:\s+was|\s+am|'m)\s+the\s+one\s+(?:who|that)\s+(?:${ADVERBS}\s+){0,2}$`, "i");
// Round 12 (R12-B1): only "had me / made me", past tense, after a real subject right before it (case-aware:
// "They", "My boss", "Mike"), with no wish, plan, modal or condition in the clause. "let me", "asked me to"
// and "got me to" never clear: being let or asked is not doing.
const HAD_ME_BEFORE = /(?:\b[Tt]hey|\b[Hh]e|\b[Ss]he|\b[Mm]anagement|\b(?:[Mm]y|[Tt]he|[Oo]ur)\s+[a-z]+|\b[A-Z][a-z]+)\s+(?:had|made)\s+me\s+$/;
const HAD_ME_NOT_DONE = /\b(?:hope|hoped|hoping|hopefully|wish|want|wanted|will|'ll|ll|would|'d|might|may|could|can|should|gonna|going\s+to|once|next|if|when|after|until|soon|someday|maybe)\b/i;
// "They had me train alongside the new hires": the person was the trainee.
const TRAINEE_AFTER_RE = /^\s*[a-z]*\s*(?:alongside|under|with|next\s+to|beside|among)\b/i;
const REFUSED_AFTER_RE = /\bbut\s+I\s+(?:said\s+no|didn'?t|did\s+not|refused|turned\s+it\s+down|never)\b|\band\s+I\s+(?:said\s+no|refused|turned\s+it\s+down)\b/i;
const COPULA_BEFORE = new RegExp(String.raw`\bI(?:\s+was|\s+am|'m)(?:\s+(?:put|made|${ADVERBS}))?\s+$`, "i");
const COPULA_CLAIM_RE = /^(?:in charge of|responsible for|took charge|head(?:ed)? up)\b/i;
const LINE_START_BEFORE = /^\s*(?:[-•*]\s*)?$/;
const LIST_BEFORE = /^\s*(?:[-•*]\s*)?(?:I\s+)?([A-Za-z]+)\b[^.;!?]*(?:,|\band)\s+(?:and\s+)?$/;
// Case matters here: "Mike and I" is shared, "3 years and I" is not.
const SHARED_SUBJECT_BEFORE = new RegExp(
  String.raw`(?:\b[Ww]e|\b[A-Z][a-z]+\s+and\s+I|\b(?:[Mm]y|[Tt]he|[Oo]ur)\s+[a-z]+\s+and\s+I|\b[Mm]e\s+and\s+(?:[A-Z][a-z]+|my\s+[a-z]+|the\s+[a-z]+)|\b[Ww]e\s+as\s+a\s+[a-z]+)\s+(?:${ADVERBS}\s+){0,2}$`
);
// "I helped manage", "I helped him train", "I assisted with training": shared work stays shared.
const SHARED_BEFORE = /\b(?:[Hh]elp(?:ed|s|ing)?|[Aa]ssist(?:ed|s|ing)?(?:\s+with)?)\s+(?:(?:him|her|them|us|[A-Z][a-z]+|the\s+[a-z]+|my\s+[a-z]+|our\s+[a-z]+)\s+)?(?:to\s+)?$/;
// Never a claim, whatever else is there: tried, wanted, attempted (the old shared list's other half).
const NOT_DONE_BEFORE = /\b(?:tried|tries|attempted|wanted|learned|learning)\s+(?:(?:him|her|them|us|[A-Z][a-z]+|the\s+[a-z]+|my\s+[a-z]+)\s+)?(?:to\s+)?$|\b(?:[Ww]ish|[Ww]ished|[Ii]f|[Uu]nless|[Hh]ope|[Hh]oped)\s+(?:I|we)\b[^.;!?]*$/;
// Their verb with someone else beside it ("trained new hires with him", "with my lead") is shared work.
// Round 12 (SF-6): only with a person or a role ("with my lead", "with Mike", "with the other lead"), never a tool.
const SHARED_AFTER_RE = /^[^.;!?,]*?\b(?:with|alongside|together\s+with)\s+(?:him|her|them|(?:my|the|our|his|her)\s+(?:other\s+|old\s+|shift\s+|team\s+|night\s+|day\s+)?(?:lead|leads|supervisor|manager|boss|trainer|coworkers?|co-workers?|crew|team|partner|foreman|owner|chef|crew\s+lead)\b|[A-Z][a-z]+\b)/;

type Doer = "self" | "shared" | "none";

/** Who does the verb at this spot, by the strict shapes above. `verb` is the claim's first word. */
function doerOf(before0: string, verb: string, after = ""): Doer {
  // Round 12: a clause starts again after "but" ("I wanted to quit but I trained the new guys").
  const before = before0.split(/\bbut\s+(?=I\b)/).pop() as string;
  const past = PAST_VERB_RE.test(verb);
  if (REFUSED_AFTER_RE.test(after)) return "none";
  if (NOT_DONE_BEFORE.test(before)) return "none";
  if (SHARED_BEFORE.test(before)) return /\bI\b|^\s*(?:[-•*]\s*)?(?:help|assist)/i.test(before) || LINE_START_BEFORE.test(before.replace(SHARED_BEFORE, "")) ? "shared" : "none";
  if (COPULA_CLAIM_RE.test(verb) && COPULA_BEFORE.test(before)) return "self";
  if (USED_TO_BEFORE.test(before)) return "self";
  if (ONE_WHO_BEFORE.test(before)) return "self";
  if (HAD_ME_BEFORE.test(before)) {
    const clause = before.split(/[,;]|\band\b/).pop() as string;
    if (HAD_ME_NOT_DONE.test(clause) || HAD_ME_NOT_DONE.test(before.slice(-80)) || TRAINEE_AFTER_RE.test(after)) return "none";
    return "self";
  }
  // Round 12 (SF-6): a plain present tense with "I" ("I train new hires", "I supervise the night crew") is their
  // own current work, unless a plan, a wish or a condition sits in the clause.
  if (!past && PRESENT_SCOPE_RE.test(verb) && SELF_PAST_BEFORE.test(before) && !/\b(?:did|do|does|didn'?t|don'?t)\s+I\s+$/i.test(before) && !PRESENT_NOT_DONE.test(before)) return "self";
  if (!past && !COPULA_CLAIM_RE.test(verb)) return "none";
  if (SHARED_SUBJECT_BEFORE.test(before)) return "shared";
  if (SELF_PAST_BEFORE.test(before)) return "self";
  if (LINE_START_BEFORE.test(before)) return "self";
  // A list of their own duties: every clause starts with a past-tense verb ("trained new guys, ran the dock").
  const list = before.match(LIST_BEFORE);
  // Round 12 (SF-3): never when someone else is the subject in between ("I picked orders and my lead trained
  // new hires and supervised the night crew": the lead supervised).
  // The subject that counts is the nearest one: in the clause since the last comma ("made the schedule when the
  // manager was out, trained new cashiers" is theirs; "I loaded trucks, Mike trained new hires and supervised" is Mike's).
  const lastSegment = (before.replace(/^\s*(?:[-•*]\s*)?(?:I\s+)?[A-Za-z]+/, "").split(/[,;]/).pop() as string);
  if (list && PAST_VERB_RE.test(list[1]) && !OTHER_SUBJECT_IN_LIST.test(lastSegment)) return "self";
  // Round 12: "I was the shift lead and trained new hires": a later verb takes the nearest subject, here "I".
  const iClause = before.match(/\bI\s+([^.;!?]*)\band\s+$/);
  if (past && iClause && !/\bI\b/.test(iClause[1]) && !OTHER_SUBJECT_IN_LIST.test(iClause[1]) && !HAD_ME_NOT_DONE.test(iClause[1]) && !/\b(?:wanted|tried|hoped|planned|asked|told|supposed|going)\b/i.test(iClause[1])) return "self";
  return "none";
}

const PRESENT_SCOPE_RE = /^(?:train|trains|teach|teaches|coach|coaches|supervise|supervises|run|runs|lead|leads|manage|manages|oversee|oversees|direct|directs|mentor|mentors|coordinate|coordinates|schedule|schedules|onboard|onboards)$/i;
const PRESENT_NOT_DONE = /\b(?:will|'ll|would|'d|can|could|might|may|should|want|wants|hope|hopes|wish|plan|plans|going\s+to|gonna|if|once|when|next|soon|someday|tomorrow|ready|able|willing)\b/i;
const OTHER_SUBJECT_IN_LIST = /\b(?:he|she|they|we|while|when|because|where|whereas)\b|\b(?:[Mm]y|[Tt]he|[Oo]ur|[Hh]is|[Hh]er|[Tt]heir)\s+[a-z]+\s+(?:[a-z]+ed|ran|led|oversaw|taught|made|did|took|kept|showed)\b|(?:^|[^.])\b(?!I\b)[A-Z][a-z]+\s+(?:[a-z]+ed|ran|led|oversaw|taught|made|did|took)\b/;

/** Curly apostrophes and quotes as straight ones (round 10: phones type "I’ve"). Same length, so positions hold. */
export function straightQuotes(text: string): string {
  return (text || "").replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"');
}

/** The scope claims the person makes in their own words, one per sentence hit, active and not denied. */
function personClaims(sourceText: string): Claim[] {
  const out: Claim[] = [];
  for (const raw of straightQuotes(sourceText || "").split(/[\n.;!?]+/)) {
    const sentence = raw.replace(namedCredentialRe(), (x) => "x".repeat(x.length)).replace(CLAIM_NAME_RE, (x) => "x".repeat(x.length));
    const ok = (m: RegExpMatchArray) => {
      const before = sentence.slice(0, m.index);
      if (NEGATION_BEFORE.test(before)) return false;
      // A role noun ("manager", "supervisor", "lead") is theirs only when it is their role: "I was the kitchen manager", not "the same manager".
      if (isRoleUse(sentence, m) && !OWN_ROLE_BEFORE.test(before) && !TITLE_START.test(before)) return false;
      // Round 12 (SF-1): "I was in charge of", "I was responsible for" are read before the passive check.
      if (COPULA_CLAIM_RE.test(m[0]) && COPULA_BEFORE.test(before)) return true;
      if (PASSIVE_BEFORE.test(before) && !/ing\b/i.test(m[0].split(/\s+/)[0])) return false;
      return true;
    };
    for (const [re, family] of PATTERNS) {
      for (const m of sentence.matchAll(new RegExp(re.source, "gi"))) {
        if (!ok(m)) continue;
        const role = isRoleUse(sentence, m);
        const first = m[0].split(/\s+/)[0];
        if (!role && NOUN_FORM_RE.test(first)) continue;
        if (!role && /^lead$/i.test(first) && /\b(?:my|our|the|a|his|her|their)\s+$/i.test(sentence.slice(0, m.index))) continue;
        // Round 11: a role ("I was the shift lead") never clears a claim; only the strict verb shapes do.
        let doer: Doer = role ? "none" : doerOf(sentence.slice(0, m.index), COPULA_CLAIM_RE.test(m[0]) ? m[0] : first, sentence.slice(m.index! + m[0].length));
        // Round 12 (SF-6): "I made the schedule for 8 cooks": the verb before "the schedule" is the one done.
        const madeIt = family === "schedule" && !role ? sentence.slice(0, m.index).match(/\b(made|did|wrote|built|set|handled|ran|put\s+together)\s+(?:up\s+)?(?:the|a|our|my)?\s*(?:[a-z-]+\s+)?$/i) : null;
        if (doer === "none" && madeIt) doer = doerOf(sentence.slice(0, (m.index ?? 0) - madeIt[0].length), madeIt[1].split(/\s+/)[0], sentence.slice(m.index! + m[0].length));
        if (doer === "self" && SHARED_AFTER_RE.test(sentence.slice(m.index! + m[0].length))) doer = "shared";
        out.push({ family, nouns: peopleFor(sentence, m), objects: objectWords(sentence, m), verbSelf: doer === "self", self: doer === "self", shared: doer === "shared", ...(role ? { role: true } : {}) });
      }
    }
    for (const [re, family] of LOOSE) {
      for (const m of sentence.matchAll(new RegExp(re.source, "gi"))) {
        if (!ok(m)) continue;
        const nouns = objectPeople(sentence.slice(m.index! + m[0].length), PEOPLE_RE);
        let doer: Doer = doerOf(sentence.slice(0, m.index), m[0], sentence.slice(m.index! + m[0].length));
        if (doer === "self" && SHARED_AFTER_RE.test(sentence.slice(m.index! + m[0].length))) doer = "shared";
        if (nouns.length) out.push({ family, nouns, objects: objectWords(sentence, m), verbSelf: doer === "self", self: doer === "self", shared: doer === "shared" });
      }
    }
  }
  return out;
}

/** The scope families in the person's own words (active, not denied, not in a credential name). */
export function scopeFamiliesIn(sourceText: string): Set<ScopeFamily> {
  return new Set(personClaims(sourceText).map((c) => c.family));
}

/**
 * The first scope claim on a line that is not the person's: no sentence of
 * theirs has the same family, active and not denied, about the same people
 * (when the line names people).
 */
export function scopeNotTheirs(line: string, sourceText: string): ScopeHit | undefined {
  return scopeHitsNotTheirs(line, sourceText)[0];
}

const plainWords = (t: string) => straightQuotes(t).toLowerCase().replace(/^\s*[-•*]\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();

/** True when the line, or every sentence of it, is a line or sentence the person wrote themselves (case and punctuation aside). */
export function isOwnLine(line: string, sourceText: string): boolean {
  const body = plainWords(line);
  if (!body) return false;
  const own = new Set(
    straightQuotes(sourceText || "")
      .split(/\n|(?<=[.!?;])\s+/)
      .map(plainWords)
      .filter(Boolean)
  );
  if (own.has(body)) return true;
  const sentences = line.split(/(?<=[.!?;])\s+/).map(plainWords).filter(Boolean);
  return sentences.length > 1 && sentences.every((x) => own.has(x));
}

/** Every scope claim on a line that is not the person's, in page order (round 11). */
export function scopeHitsNotTheirs(line: string, sourceText: string): ScopeHit[] {
  // Round 12: a line (or sentence) the person wrote word for word is theirs, every claim in it.
  if (isOwnLine(line, sourceText)) return [];
  const theirs = personClaims(sourceText);
  return scopeHits(line).filter(
    (h) =>
      !theirs.some((c) => {
        if (c.family !== h.family) return false;
        // Round 11: shared work clears only a shared page line; a solo page line needs their solo verb.
        // A role on the page ("as a shift lead") is cleared by their own role of that name.
        const doer = h.role && c.role ? true : h.shared ? c.self || c.shared : c.self;
        if (!doer) return false;
        // Round 12: "every week" alone is a time, not people; a claim with no people word reads its object.
        return h.nouns.some((n) => !n.startsWith("~"))
          ? peopleCovered(h.nouns, c.nouns)
          : // Round 7: a claim that names no people is theirs only when they used the verb themselves,
            // about the same thing ("I managed the stockroom" covers "Managed the stockroom", not "Managed inventory").
            !(h.objects ?? []).length || c.objects.some((o) => (h.objects ?? []).includes(o));
      })
  );
}

/**
 * Kept for older callers. Round 5: the gate never reads an answer for scope;
 * a scope claim is settled only by a rewrite or a cut. This only reports
 * whether an answer names a scope claim of its own, not a denial.
 */
export function answerTalksScope(answer: string): boolean {
  const text = answer || "";
  for (const [re] of PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, "gi"))) {
      if (!NEGATION_BEFORE.test(text.slice(0, m.index))) return true;
    }
  }
  return false;
}

// ---- Round 11: the one-tap scope card ---------------------------------------------------------
// An unmatched scope claim gets one card, "Is this true?": "Yes, I did this" (the person types who or what,
// and those words source that one claim only), "I helped with it" (the line becomes its shared form), or
// "Take it off". The typed words never join the person's words for any other line.

const PAST_OF: Record<ScopeFamily, string> = {
  supervise: "supervised",
  manage: "managed",
  lead: "led",
  oversee: "oversaw",
  direct: "directed",
  mentor: "mentored",
  coordinate: "coordinated",
  train: "trained",
  schedule: "scheduled",
  responsible: "was responsible for",
  delegate: "delegated work to",
  hire: "hired and fired",
  evaluate: "evaluated",
  own: "owned and operated",
};

const WHO_OF: Record<ScopeFamily, string> = {
  supervise: "Who did you supervise?",
  manage: "Who or what did you manage?",
  lead: "Who or what did you lead?",
  oversee: "Who or what did you oversee?",
  direct: "Who did you direct?",
  mentor: "Who did you mentor?",
  coordinate: "What did you coordinate?",
  train: "Who did you train?",
  schedule: "Who did you make the schedule for?",
  responsible: "What were you responsible for?",
  delegate: "Who did you hand work to?",
  hire: "Who did you hire?",
  evaluate: "Who did you evaluate?",
  own: "What business did you own?",
};

/** The question under "Yes, I did this": who or what, in their own words. */
export function scopeWhoQuestion(family: ScopeFamily | string): string {
  return WHO_OF[family as ScopeFamily] ?? "Who or what was it?";
}

const WHO_EMPTY = new Set(["nobody", "noone", "none", "no", "one", "anyone", "someone", "somebody", "everyone", "them", "they", "him", "her", "it", "stuff", "things", "thing", "idk", "dunno", "yes", "yeah", "yep", "sure", "ok", "okay", "the", "a", "an", "and", "or", "of", "my", "some", "all", "people"]);

/** True when a typed "who or what" names someone or something: a people word, or a real noun (round 11). */
export function isScopeWhoAnswer(typed: string): boolean {
  const words = (straightQuotes(typed || "").toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).filter(Boolean);
  // Round 12: a count of people is an answer ("all 40 of them", "about 8").
  if (/\b\d+\b/.test(typed || "")) return true;
  if (!words.length) return false;
  if (words.some((w) => NOUN_RE.test(w))) return true;
  return words.some((w) => w.length >= 3 && !WHO_EMPTY.has(w));
}

/** What "Yes, I did this" with their typed words says, as one sentence of theirs for that line only. */
export function scopeYesText(family: ScopeFamily | string, typed: string): string {
  const who = straightQuotes(typed || "").trim().replace(/[.!?]+$/, "");
  return `I ${PAST_OF[family as ScopeFamily] ?? "did"} ${who}.`;
}

const BASE_OF: Record<string, string> = {
  trained: "train", trains: "train", train: "train", taught: "teach", teaches: "teach", coached: "coach", coaches: "coach", onboarded: "onboard",
  instructed: "instruct", supervised: "supervise", supervises: "supervise", supervise: "supervise", led: "lead", leads: "lead", lead: "lead",
  managed: "manage", manages: "manage", manage: "manage", ran: "run", runs: "run", run: "run", oversaw: "oversee", oversees: "oversee",
  directed: "direct", directs: "direct", mentored: "mentor", mentors: "mentor", coordinated: "coordinate", coordinates: "coordinate",
  scheduled: "schedule", schedules: "schedule", organized: "organize", organised: "organise", evaluated: "evaluate", delegated: "delegate",
  headed: "head", heads: "head", assigned: "assign",
};

/**
 * The shared form of a line ("Trained new hires" is "Helped train new hires",
 * "Responsible for the dock crew" is "Helped with the dock crew"), or
 * undefined when the line cannot be turned around plainly.
 */
export function helpedForm(text: string, hitWord: string): string | undefined {
  const bullet = text.match(/^\s*[-•*]\s*/)?.[0] ?? "";
  const body = text.slice(bullet.length);
  // Round 12 (SF-7): "In charge of opening the store" is "Helped with opening the store".
  const lead = body.match(/^(Responsible\s+for|In\s+charge\s+of)\s+(.+)$/i);
  if (lead) return `${bullet}Helped ${/^responsible/i.test(lead[1]) || /^\w+ing\b/i.test(lead[2]) ? "with" : "run"} ${lead[2]}`;
  const first = (hitWord.match(/[A-Za-z]+/) ?? [""])[0];
  const base = BASE_OF[first.toLowerCase()];
  if (!base) return undefined;
  const at = body.search(new RegExp(`\\b${first}\\b`, "i"));
  if (at < 0) return undefined;
  const before = body.slice(0, at);
  if (/\bhelp(?:ed|s|ing)?\s+$/i.test(before)) return undefined;
  let swap: string;
  if (/\bto\s+$/i.test(before)) swap = `help ${base}`;
  else if (/^\s*$/.test(before)) swap = `Helped ${base}`;
  else if (/(?:\band|,|\bI)\s+$/i.test(before) && first.toLowerCase() !== base) swap = `helped ${base}`;
  else return undefined;
  let rest = body.slice(at + first.length);
  // Parallel form: "Supervised and trained the night crew" is "Helped supervise and train the night crew".
  rest = rest.replace(/^(\s+and\s+)([a-z]+)\b/i, (all, and, verb) => (BASE_OF[verb.toLowerCase()] && PAST_VERB_RE.test(verb) ? `${and}${BASE_OF[verb.toLowerCase()]}` : all));
  // An earlier verb joined to this one stays as it was only when the line reads; "Supervised and trained" with
  // "trained" picked would mix forms, so it is not offered.
  if (/\band\s+$/i.test(before) && /^\s*[A-Za-z]+(?:ed|ran|led)\s+and\s+$/i.test(before)) return undefined;
  return `${bullet}${before}${swap}${rest}`;
}

const COUNT_WORD_RE = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|dozen|dozens|hundred|hundreds|couple|few|several)\b/i;
const GROUP_NOUN_RE = /\b(?:crews?|teams?|shifts?|staff|staffers?|department|people|employees?|workers?|associates?|hires?|guys|hands|members?|coworkers?|co-workers?|teammates?|colleagues?|peers?|newcomers?|starters?)\b/i;

/**
 * Round 12 (SF-4): what typed "Yes, I did this" words must name for one claim.
 * A group the line does not count ("the night crew", "new hires") is covered
 * by any people word, a count of people, or names ("about 8 people on
 * nights", "Marcus and Tia"). A line that says all, every or entire, or gives
 * a number, needs the same in their words. A role the line names ("cooks",
 * "nurses") still needs that role. Returns undefined when the typed words
 * should go through the ordinary sentence reading instead.
 */
export function typedCoversHit(hit: ScopeHit, typed: string, line: string): boolean | undefined {
  // Round 12 (SF-1): "Responsible for <X>": the typed words must name part of X ("opening and closing" for
  // "opening and closing the store"), the same count or "all" when X has one.
  if (hit.family === "responsible") {
    const typedWords = (straightQuotes(typed).toLowerCase().match(/[a-z]+/g) ?? []).map(stemNoun);
    const objs = [...(hit.objects ?? []), ...hit.nouns.filter((n) => !n.startsWith("~") && n !== "group")];
    if (hit.nouns.includes(ALL_MARK) && !/\b(?:all|every|entire|whole)\b/i.test(typed)) return false;
    return objs.some((o) => o.length > 2 && typedWords.includes(o));
  }
  const real = hit.nouns.filter((n) => !n.startsWith("~"));
  if (!real.length) return undefined;
  const t = straightQuotes(typed || "");
  const after = line.slice(Math.max(0, line.toLowerCase().indexOf(hit.word.toLowerCase())));
  const pageText = `${hit.word} ${after.split(/[.;!?]/)[0]}`;
  if (!GROUP_NOUN_RE.test(pageText) || real.some((n) => ROLE_GROUP[n])) return undefined;
  const pageAll = hit.nouns.includes(ALL_MARK);
  const pageCount = COUNT_WORD_RE.test(pageText.replace(/\bevery\s+\w+/gi, ""));
  if (pageAll && !/\b(?:all|every|entire|whole|everyone|everybody)\b/i.test(t)) return false;
  if (pageCount && !COUNT_WORD_RE.test(t) && !/\b(?:all|every|entire|whole)\b/i.test(t)) return false;
  const words = t.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
  return words.some((w) => NOUN_RE.test(w)) || COUNT_WORD_RE.test(t) || /\b[A-Z][a-z]+\b(?:\s*(?:,|and)\s*[A-Z][a-z]+)?/.test(t.replace(/^\s*[A-Z][a-z]+\s/, (x) => x.toLowerCase()));
}

/** True when typed words are only the page line (or its object) pasted back (round 12). */
export function isScopeCopy(typed: string, line: string): boolean {
  const t = plainWords(typed);
  const l = plainWords(line);
  if (!t || !l) return false;
  return t === l;
}

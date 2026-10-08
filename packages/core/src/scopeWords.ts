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

const PEOPLE = String.raw`(?:crews?|teams?|shifts?|staff|staffers?|department|store|kitchen|cooks?|workers?|employees?|hires?|associates?|people|persons?|operators?|drivers?|loaders?|aides?|nurses?|servers?|dishwashers?|volunteers?|interns?|techs?|technicians?|helpers?|laborers?|pickers?|packers?|men|guys|hands|members?|leads|reps?|agents?|cashiers?|clerks?|trainees?|apprentices?|co-?workers?|teammates?|colleagues?|peers?|newcomers?|starters?)`;
// Up to three words before the people noun ("all of the new", "a group of new", "the entire overnight dish washing").
const DET = String.raw`(?!(?:on|in|at|to|for|with|by|as|into|out|from|up|through|under|about|around|over)\b)(?:(?:the|a|an|our|my|their|new|other|every|all|entire|whole)\s+){0,2}(?:(?:group|team|crew|bunch|handful)\s+of\s+(?:the\s+)?)?(?:of\s+the\s+)?(?:[a-z0-9-]+\s+){0,3}`;

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
  [new RegExp(String.raw`\b(?:train(?:ed|s|ing)?|taught|teach(?:es|ing)?|coach\w*|onboard\w*|instruct\w*)\s+${DET}${PEOPLE}\b`, "gi"), "train"],
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
}

/** True when the hit is a role ("kitchen manager", "a shift lead"), not a verb. */
function isRoleUse(text: string, m: RegExpMatchArray): boolean {
  if (ROLE_NOUN_RE.test(m[0])) return true;
  if (!/^leads?$/i.test(m[0])) return false;
  const prev = text.slice(0, m.index).toLowerCase().match(/([a-z]+)\s*$/)?.[1];
  return !!prev && ROLE_PREV.has(prev);
}
const OBJECT_STOP = new Set(["as", "for", "with", "at", "on", "in", "to", "but", "while", "from", "by", "during", "across", "into", "when", "who", "that", "which"]);
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
  return Array.from(new Set([...inside, ...objectPeople(text.slice((m.index ?? 0) + m[0].length).split(/[.;!?]/)[0], NOUN_RE)]));
}

const OBJECT_FILLER = new Set(["the", "a", "an", "all", "our", "my", "their", "daily", "and", "or", "both", "overall", "various", "multiple", "every", "each", "new", "two", "three", "four", "five", "six", "it", "them", "this", "that", "of"]);

/** The content words of a claim's object, stemmed ("daily dock operations" is dock and operation). */
function objectWords(text: string, m: RegExpMatchArray): string[] {
  const after = text.slice((m.index ?? 0) + m[0].length).split(/[.;!?]/)[0];
  const all = after.toLowerCase().match(/[a-z]+/g) ?? [];
  const stop = all.findIndex((w) => OBJECT_STOP.has(w));
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
function objectPeople(after: string, re: RegExp): string[] {
  const all = after.toLowerCase().match(/[a-z]+/g) ?? [];
  const stop = all.findIndex((w) => OBJECT_STOP.has(w));
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
  if (words.some((w) => /^(?:all|entire|whole|every)$/.test(w))) {
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
  const stop = all.findIndex((w) => OBJECT_STOP.has(w));
  const words = (stop >= 0 ? all.slice(0, stop) : all).slice(0, 7);
  let i = words.findIndex((w) => re.test(w));
  if (i < 0 || i > 5) return undefined;
  while (i + 1 < words.length && re.test(words[i + 1])) i++;
  return stemNoun(words[i]);
}

// "under the store manager", "helped the shift supervisor": someone else's role, not a claim.
const OTHER_ROLE_BEFORE = /\b(?:under|for|with|by|alongside|assisted|assisting|helped|helping|supported|supporting|reported\s+to|reporting\s+to|told|asked|from)\s+(?:(?:the|a|an|my|our|their|his|her)\s+)?(?:[a-z-]+\s+){0,2}$|\b(?:supervision|direction|leadership|guidance|oversight|management)\s+of\s+(?:(?:the|a|an|my|our|their|his|her)\s+)?(?:[a-z-]+\s+){0,2}$/i;
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
      // Round 10: a nominal claim ("Tasked with the training of all new hires") is a claim, not someone else's.
      if (isNounUse(text, m) && OTHER_ROLE_BEFORE.test(text.slice(0, m.index)) && !isNominalClaim(text, m)) continue;
      found.push({ family, word: m[0], noun: nounFor(text, m), nouns: peopleFor(text, m), objects: objectWords(text, m), at: m.index!, end: m.index! + m[0].length, role: isRoleUse(text, m) });
    }
  }
  // A role word inside another claim is that claim's people ("trained new team leads"), not a role of the person's.
  return found
    .filter((h) => !(h.role && found.some((o) => o !== h && !o.role && o.at <= h.at && o.end >= h.end)))
    .map(({ family, word, noun, nouns, objects }) => ({ family, word, noun, nouns, objects }));
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
  /** The person is the one doing it: their own verb ("I trained", "Trained ..."), or their own role ("I was the shift lead"). */
  self: boolean;
}

// Noun forms are never a claim of the person's ("my supervision", "management liked my work",
// "hand-eye coordination", "my mentor", "my lead's directions"); a role noun counts only as their own role.
const NOUN_FORM_RE = /^(?:supervision|supervisions|management|coordination|coordinations|direction|directions|oversight|leadership|mentorship|lead's|leads'|mentor|mentors)$/i;
// The person as the subject: the sentence starts with the verb, "I (also) verb", or "(I) verbed X and verb".
// Round 9: between "I" and the verb only helpers and adverbs ("I would", "I used to", "I also"), never
// another verb or person ("I watched him train", "I think Mike trained", "I know he supervised").
// Round 10 (R10-B1): never "can", "could" or "will" (an ability or a plan is not something they did), and
// never "would have". Habitual "would" stays ("I would train the new guys every Monday"). Aspect words and
// fillers are theirs too (SF-5): started, kept, ended up, wound up, got to, went on to, basically, pretty much.
const SELF_HELPERS = String.raw`(?:would|used|to|also|always|sometimes|then|often|usually|still|even|really|personally|actually|regularly|mostly|mainly|basically|pretty|much|kind|sort|eventually|later|soon|finally|was|were|am|had|have|has|did|do|'d|'ve|'m|just|first|once|each|every|day|night|both|myself|ourselves|started|start|began|begin|kept|keep|ended|wound|up|got|get|went|on|put|made)`;
const VERB_START = String.raw`(?:[A-Za-z]+ed|ran|led|did|took|made|kept|taught|drove|wrote|built|ran|ran|oversaw|showed|set|put|got|went)`;
const SELF_SUBJECT_BEFORE = new RegExp(
  String.raw`^\s*(?:[-•*]\s*)?$|\b(?:I|we)(?:'d|'ve|'m)?\s+(?:${SELF_HELPERS}\s+){0,3}$|\bI(?:\s+(?:was|am)|'m)\s+the\s+one\s+(?:who|that)\s+(?:${SELF_HELPERS}\s+){0,2}$|^\s*(?:[-•*]\s*)?(?:I\s+)?${VERB_START}\b[^.;!?]*(?:\band|,)\s+(?:and\s+)?$`,
  "i"
);
// An ability, a wish, a plan or a might-have-been between "I" and the verb is never a claim (R10-B1).
const NOT_DONE_BEFORE = /\b(?:can|could|will|shall|should|might|may|must|'ll)\s+(?:\w+\s+){0,2}$|\b(?:would|could|should|might|must|'d)\s+have\s+(?:\w+\s+){0,2}$|\b(?:would|'d)\s+(?:like|love|prefer)\b|\b(?:hope|hoped|hoping|want|wanted|wants|wanting|plan|plans|planned|planning|going|gonna|ready|able|willing|wish|wishing|trying|try|tried|aim|aiming|expect|expecting|eager)\s+to\b[^.;!?]*$|\bgonna\b/i;
// "I helped manage", "I helped him train", "I assisted with training", "I tried to lead": shared work stays shared (round 8; round 9: one object between).
const SHARED_BEFORE = /\b(?:[Hh]elp(?:ed|s|ing)?|[Aa]ssist(?:ed|s|ing)?(?:\s+with)?|[Tt]ried|[Tt]ries|[Aa]ttempted|[Ll]earned|[Ll]earning|[Ww]anted)\s+(?:(?:him|her|them|us|[A-Z][a-z]+|the\s+[a-z]+|my\s+[a-z]+|our\s+[a-z]+)\s+)?(?:to\s+)?$/;
// Resume style: "Proven record of leading large teams", "experience in managing crews" (no other subject named).
// Round 9: never with a pronoun anywhere before, or a named subject ("Darnell was in charge of", "Rick was good at").
const GERUND_SELF_BEFORE = /^(?:(?!\b(?:he|she|they|him|them|my|our|his|her|their|the)\b)[\w\s,'-])*\b(?:of|in|at)\s+$/i;
const NAMED_SUBJECT_RE = /^\s*(?:[-•*]\s*)?(?!I\b|We\b)[A-Z][a-z]+\s+(?:was|is|were|are|has|had|got|did|does|would|will|can|could|used|became|stayed|seemed)\b/;
const CAPITAL_NAME_INSIDE_RE = /\s(?!I\b)[A-Z][a-z]+\b/;
const isGerundSelf = (before: string) => GERUND_SELF_BEFORE.test(before) && !NAMED_SUBJECT_RE.test(before) && !CAPITAL_NAME_INSIDE_RE.test(before.replace(/^\s*(?:[-•*]\s*)?\S+/, ""));
const isSelf = (before: string) => (SELF_SUBJECT_BEFORE.test(before) || isGerundSelf(before)) && !SHARED_BEFORE.test(before) && !NOT_DONE_BEFORE.test(lastClause(before));
/** The clause a verb sits in: after the last "but", "and" or comma that starts a new subject. */
function lastClause(before: string): string {
  const parts = before.split(/\b(?:but|and|so|because)\s+(?=I\b|we\b)|,\s*(?=I\b|we\b)/i);
  return parts[parts.length - 1];
}

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
        const verbSelf = !role && isSelf(sentence.slice(0, m.index));
        out.push({ family, nouns: peopleFor(sentence, m), objects: objectWords(sentence, m), verbSelf, self: role || verbSelf });
      }
    }
    for (const [re, family] of LOOSE) {
      for (const m of sentence.matchAll(new RegExp(re.source, "gi"))) {
        if (!ok(m)) continue;
        const nouns = objectPeople(sentence.slice(m.index! + m[0].length), PEOPLE_RE);
        const verbSelf = isSelf(sentence.slice(0, m.index));
        if (nouns.length) out.push({ family, nouns, objects: objectWords(sentence, m), verbSelf, self: verbSelf });
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
  const theirs = personClaims(sourceText);
  return scopeHits(line).find(
    (h) =>
      !theirs.some((c) =>
        c.family !== h.family
          ? false
          : h.nouns.length
            ? c.self && peopleCovered(h.nouns, c.nouns)
            : // Round 7: a claim that names no people is theirs only when they used the verb themselves,
              // about the same thing ("I managed the stockroom" covers "Managed the stockroom", not "Managed inventory").
              c.self && c.verbSelf && (!(h.objects ?? []).length || c.objects.some((o) => (h.objects ?? []).includes(o)))
      )
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

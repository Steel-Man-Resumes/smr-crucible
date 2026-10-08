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
  /** Round 13 (SF-3, SF-4): the role as a job title, as written ("shift lead", "Lead custodian"). */
  title?: string;
}

// Round 13 (SF-3): "Lead custodian", "Lead cook", "Lead warehouse associate": a job title, not "led the custodians".
const TITLE_JOB_NOUN = String.raw`(?:custodian|janitor|porter|housekeeper|cook|chef|cashier|associate|picker|packer|operator|driver|technician|tech|server|bartender|dishwasher|stocker|loader|clerk|teller|agent|rep|representative|guard|officer|mechanic|welder|carpenter|electrician|painter|laborer|worker|attendant|aide|caregiver|assistant|nurse|baker|butcher|barista|host|hostess|groundskeeper|landscaper|installer|assembler|machinist|inspector|handler|sorter|receiver|shipper|dispatcher|cleaner|hand|person|specialist|trainer|instructor|coordinator|scheduler|planner|foreman|supervisor|manager|teammate|member|man)`;
const TITLE_SHAPED_LEAD = new RegExp(String.raw`^lead\s+(?!(?:a|an|the|my|our|all|every|each|new|other|their|his|her|\d+)\b)(?:[a-z-]+\s+)?${TITLE_JOB_NOUN}\b(?!s)`, "i");
// The words a title's role noun may carry before it ("shift", "kitchen", "customer service").
const TITLE_MODIFIER = new Set(["shift", "team", "crew", "line", "floor", "night", "day", "kitchen", "production", "warehouse", "store", "lead", "project", "dock", "grill", "customer", "service", "assistant", "general", "operations", "front", "desk", "call", "center", "maintenance", "cleaning", "custodial", "housekeeping", "sales", "department", "area", "unit", "overnight", "deli", "bakery", "produce", "pharmacy", "food", "prep", "office", "site", "senior", "junior", "head", "shipping", "receiving", "inventory", "facilities", "facility", "building", "restaurant", "bar", "cafe", "retail", "plant", "field", "fleet", "route", "program", "case", "care"]);

// A role word that can be a job title ("supervisor", "shift lead"); "leadership", "managers" never are.
const TITLE_ROLE_WORD = /^(?:manager|supervisor|director|coordinator|foreman|lead|leader)$/i;
const SOMEONE_ELSES_ROLE_BEFORE = /\b(?:my|our|his|her|their|the|your|whose)\s+(?:[a-z-]+\s+){0,2}$/i;

/** The role as a job title, as written: the role word with the title words before it ("Shift supervisor"), or "Lead X". */
function titleOfHit(text: string, at: number, end: number, titleShaped: boolean): string {
  if (titleShaped) {
    const m = text.slice(at).match(new RegExp(String.raw`^lead\s+(?:[a-z-]+\s+)?${TITLE_JOB_NOUN}\b`, "i"));
    return m ? m[0] : text.slice(at, end);
  }
  const before = text.slice(0, at).split(/\s+/).filter(Boolean);
  let start = at;
  let n = 0;
  for (let k = before.length - 1; k >= 0 && n < 2; k--, n++) {
    const w = before[k];
    if (/[,.;:!?|]$/.test(w) || !TITLE_MODIFIER.has(w.toLowerCase().replace(/[^a-z]/g, ""))) break;
    start = text.lastIndexOf(w, start - 1);
  }
  return text.slice(start, end).trim();
}

/** Title words with common short forms made the same (Rep, Mgr, Sup, Supv, Asst, Coord, Sr, Jr, Tech). */
export function titleWords(title: string): string[] {
  const SHORT: Record<string, string> = { rep: "representative", reps: "representative", representatives: "representative", mgr: "manager", mngr: "manager", sup: "supervisor", supv: "supervisor", supvr: "supervisor", spvr: "supervisor", asst: "assistant", assist: "assistant", coord: "coordinator", sr: "senior", jr: "junior", tech: "technician", techs: "technician", assoc: "associate", cust: "customer", svc: "service", srv: "service", ops: "operations", dept: "department", hs: "high" };
  return straightQuotes(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => SHORT[w] ?? w);
}

/** Round 13 (SF-9): the same title, case, punctuation and common short forms aside ("Customer Service Rep"). */
export function sameTitle(a: string, b: string): boolean {
  const x = titleWords(a).join(" ");
  return !!x && x === titleWords(b).join(" ");
}

/** The job titles in the person's own job headers ("Lead Custodian | Maumee Valley | 2020 - present"). */
function ownHeaderTitles(sourceText: string): string[] {
  return withoutGoalText(sourceText)
    .split("\n")
    .filter((l) => l.includes("|"))
    .map((l) => l.split("|")[0].replace(/^\s*[-•*]\s*/, "").trim())
    .filter((t) => t && t.split(/\s+/).length <= 6 && !/@|\d{3}/.test(t))
    .map((t) => titleWords(t).join(" "));
}

/** Round 13 (SF-3): a role on the page that is one of the person's own job titles, or part of one ("Lead custodian" for "Lead Custodian"). */
export function titleInOwnHeaders(title: string, sourceText: string): boolean {
  const t = titleWords(title).join(" ");
  if (!t) return false;
  return ownHeaderTitles(sourceText).some((h) => ` ${h} `.includes(` ${t} `));
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
  const found: Array<ScopeHit & { at: number; end: number; role: boolean; title?: string }> = [];
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
      const titleShaped = family === "lead" && /^lead$/i.test(m[0]) && TITLE_SHAPED_LEAD.test(text.slice(m.index!)) && !/\b(?:to|will|would|can|could|I|we|they|and|or|helped?|help)\s+$/i.test(text.slice(0, m.index));
      // Round 13 (SF-4): "My manager asked me", "when the lead was out": someone else's role, not a title of theirs.
      if (isRoleUse(text, m) && SOMEONE_ELSES_ROLE_BEFORE.test(text.slice(0, m.index)) && !OWN_ROLE_BEFORE.test(text.slice(0, m.index)) && !/\b(?:promoted\s+to|made|named|became)\s+(?:the\s+)?(?:[a-z-]+\s+){0,2}$/i.test(text.slice(0, m.index))) continue;
      const role = isRoleUse(text, m) || titleShaped;
      found.push({ family, word: m[0], noun: nounFor(text, m), nouns: peopleFor(text, m), objects: objectWords(text, m), at: m.index!, end: m.index! + m[0].length, role, shared: isSharedOnPage(text, m), ...(role && (titleShaped || TITLE_ROLE_WORD.test(m[0])) ? { title: titleOfHit(text, m.index!, m.index! + m[0].length, titleShaped) } : {}) });
    }
  }
  // A role word inside another claim is that claim's people ("trained new team leads"), not a role of the person's.
  return found
    .filter((h) => !(h.role && found.some((o) => o !== h && !o.role && o.at <= h.at && o.end >= h.end)))
    .map(({ family, word, noun, nouns, objects, shared, role, title }) => ({ family, word, noun, nouns, objects, ...(shared ? { shared } : {}), ...(role ? { role } : {}), ...(role && title ? { title } : {}) }));
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
// Round 13 (SF-8): up to two adverbs between the subject and "had" ("He always had me train the new hires").
const HAD_ME_BEFORE = new RegExp(String.raw`(?:\b[Tt]hey|\b[Hh]e|\b[Ss]he|\b[Mm]anagement|\b(?:[Mm]y|[Tt]he|[Oo]ur)\s+[a-z]+|\b[A-Z][a-z]+)\s+(?:${ADVERBS}\s+){0,2}(?:had|made)\s+me\s+$`);
const HAD_ME_NOT_DONE = /\b(?:hope|hoped|hoping|hopefully|wish|wished|wishing|want|wanted|wanting|will|'ll|ll|would|'d|might|may|could|can|should|gonna|going\s+to|once|next|if|when|after|until|soon|someday|maybe|bet|guess|suppose|pretend|imagine|unless)\b/i;
// Round 13 (SF-8): "When the manager was out" is a time in the past, not a condition. Only that shape is lifted
// out before the frame is read ("if the manager was out" stays a condition).
const PAST_TIME_CLAUSE = /\b(?:[Ww]hen|[Ww]henever|[Ww]hile)\s+(?:the|my|our|a|he|she|they|we|[A-Z][a-z]+)\b[^,;]*?\b(?:was|were|went|got|called|took|left|had|did|wasn'?t|weren'?t)\b[^,;]*?(?:,\s*|\s+)(?=(?:[Tt]hey|[Hh]e|[Ss]he|[Mm]anagement|[Mm]y|[Tt]he|[Oo]ur|[A-Z][a-z]+)\b[^,;]*$)/;
// "They had me train alongside the new hires": the person was the trainee.
const TRAINEE_AFTER_RE = /^\s*[a-z]*\s*(?:alongside|under|with|next\s+to|beside|among)\b/i;
const REFUSED_AFTER_RE = /\bbut\s+I\s+(?:said\s+no|didn'?t|did\s+not|don'?t|do\s+not|refused|turned\s+it\s+down|never|just|only)\b|\band\s+I\s+(?:said\s+no|refused|turned\s+it\s+down)\b|\bnot\s+really\b|\bor\s+not\b/i;
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
function doerOf(before0: string, verb: string, after = "", goal = false): Doer {
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
    // Round 13 (SF-8): the frame is read in the clause that holds the subject, after a past time clause is lifted out.
    const lifted = before.replace(PAST_TIME_CLAUSE, "");
    const clause = lifted.split(/[,;]|\band\b/).pop() as string;
    if (HAD_ME_NOT_DONE.test(clause) || HAD_ME_NOT_DONE.test(lifted.slice(-80)) || TRAINEE_AFTER_RE.test(after)) return "none";
    return "self";
  }
  // Round 12 (SF-6): a plain present tense with "I" ("I train new hires", "I supervise the night crew") is their
  // own current work, unless a plan, a wish or a condition sits in the clause.
  // Round 13 (R13-B1): only in work-history text (their upload, their work answers), never in the goal box or a
  // paragraph about the job they want, and never with a future, condition, goal or reported-speech word anywhere
  // before the verb in the sentence, or a future or condition word after it.
  if (!past && PRESENT_SCOPE_RE.test(verb) && SELF_PAST_BEFORE.test(before) && !/\b(?:did|do|does|didn'?t|don'?t)\s+I\s+$/i.test(before)) {
    if (goal || PRESENT_NOT_DONE.test(before0) || PRESENT_FRAME_AFTER.test(after)) return "none";
    return "self";
  }
  // Round 13: their own present-tense duty list, in work-history text only ("I lead a crew of 5, make the
  // cleaning schedule, show new people the floor machines"; "I take escalated calls ... and coach reps").
  if (!past && !goal && PRESENT_SCOPE_RE.test(verb)) {
    const pl = before.match(/\bI\s+([a-z]+)\b([^.;!?]*)(?:,|\band)\s+(?:and\s+)?$/);
    if (pl && !PRESENT_LIST_NOT.test(pl[1]) && !/(?:ed|ing)$/i.test(pl[1]) && !/\bI\b/.test(pl[2]) && !OTHER_SUBJECT_IN_LIST.test(pl[2]) && !PRESENT_NOT_DONE.test(before0) && !PRESENT_FRAME_AFTER.test(after)) return "self";
  }
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

// Round 13: "do / make / write the schedule" are read only as the verb before "the schedule".
const PRESENT_LIST_NOT = /^(?:want|wants|will|would|can|could|should|might|may|hope|hopes|plan|plans|need|needs|like|likes|love|loves|wish|try|tries|am|is|are|was|were|be|used|get|gets|got|have|has|had|go|goes|watch|watches|see|sees|help|helps|let|lets|think|say|says|guess|bet|pretend|wonder|asked|don|didn|never)$/i;
const PRESENT_SCOPE_RE = /^(?:make|makes|do|does|write|writes|build|builds|handle|handles|set|sets|train|trains|teach|teaches|coach|coaches|supervise|supervises|run|runs|lead|leads|manage|manages|oversee|oversees|direct|directs|mentor|mentors|coordinate|coordinates|schedule|schedules|onboard|onboards)$/i;
// Round 13 (R13-B1): read on the whole sentence before the verb, not only the clause.
const PRESENT_NOT_DONE = /\b(?:will|'ll|would|'d|can|can'?t|cannot|could|might|may|should|want|wants|wanted|wanting|hope|hopes|hoped|hoping|hopefully|wish|wished|wishing|plan|plans|planned|planning|going\s+to|gonna|if|whether|once|when|whenever|until|till|next|soon|someday|some\s+day|one\s+day|eventually|ideally|maybe|perhaps|tomorrow|ready|able|willing|where|that|which|so|as\s+soon\s+as|look|looks|looking|seek|seeking|interested|dream|ideal|goal|goals|picture|imagine|see\s+myself|starting|start|after|before|new\s+job|next\s+job|new\s+role|in\s+(?:a|an|the)\s+(?:[a-z]+\s+)?(?:role|job|position|spot)|as\s+(?:a|an)|hire\s+me|give\s+me|let\s+me|long[\s-]+term|in\s+(?:\d+|a|one|two|three|four|five|six|seven|eight|nine|ten|a\s+few|few)\s+(?:years?|months?|weeks?)|somewhere|something|anywhere|someplace|job|jobs|role|position|say|says|said|think|thinks|thought|pretend|pretends|claim|claims|believe|believes|guess|bet|suppose|wonder|asked|ask|not)\b/i;
const PRESENT_FRAME_AFTER = /\b(?:starting|start|next|soon|tomorrow|this\s+(?:year|month|week|fall|summer|spring|winter)|if|when|whenever|once|after|as\s+soon\s+as|until|till|someday|some\s+day|one\s+day|eventually|hopefully|would|will|'ll|in\s+(?:\d+|a|one|two|three|four|five|six|ten|a\s+few)\s+(?:years?|months?|weeks?))\b|\bin\s+my\s+(?:next|new)\b|\bat\s+my\s+(?:next|new)\b|\bbut\s+I\s+(?:don'?t|do\s+not|didn'?t|never|just|only)\b|\?/i;
// A line about the job they want: a present tense in it is a wish, not their work (R13-B1).
const GOAL_PARAGRAPH_RE = /\b(?:looking\s+(?:for|to)|seeking|want(?:s|ed)?\s+(?:a|an|to|my|the)|would\s+(?:love|like)|'d\s+(?:love|like)|hop(?:e|es|ing)\s+(?:to|for|I)|dream\s+(?:job|role)|ideal\s+(?:job|role)|my\s+goals?|next\s+(?:job|role)|new\s+(?:job|role)|interested\s+in|see\s+myself|in\s+(?:\d+|five|ten|a\s+few)\s+years)\b|(?:^|[.!?:]\s+)(?:a\s+)?[A-Za-z]+\s+(?:job|role|position)\s*(?:[.!:]|$)/im;
/** Round 13 (R13-B1): the goal box and other "what you're looking for" text, marked so a present tense in it never counts. */
export const GOAL_OPEN = "⁣";
export const GOAL_CLOSE = "⁤";
export function markGoalText(text: string | undefined): string {
  const t = (text || "").replace(/[⁣⁤]/g, "").trim();
  return t ? `${GOAL_OPEN}\n${t}\n${GOAL_CLOSE}` : "";
}
/** The person's words with the goal box taken out (R13-B1: a wish is never a line they wrote about their work). */
export function withoutGoalText(sourceText: string | undefined): string {
  return (sourceText || "").replace(/\u2063[\s\S]*?(?:\u2064|$)/g, "");
}
/** Lines of the person's words (the goal box as one block), each with whether it is goal text. */
function paragraphs(sourceText: string): Array<{ text: string; goal: boolean }> {
  const out: Array<{ text: string; goal: boolean }> = [];
  const parts = (sourceText || "").split(/(⁣[\s\S]*?(?:⁤|$))/);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith(GOAL_OPEN)) out.push({ text: part.replace(/[⁣⁤]/g, ""), goal: true });
    // A line about the job they want ("I'm looking for a lead job. I train new hires.") is goal text; the
    // lines around it are not.
    else for (const p of part.split(/\n/)) if (p.trim()) out.push({ text: p, goal: GOAL_PARAGRAPH_RE.test(straightQuotes(p)) });
  }
  return out;
}
const OTHER_SUBJECT_IN_LIST = /\b(?:he|she|they|we|while|when|because|where|whereas)\b|\b(?:[Mm]y|[Tt]he|[Oo]ur|[Hh]is|[Hh]er|[Tt]heir)\s+[a-z]+\s+(?:[a-z]+ed|ran|led|oversaw|taught|made|did|took|kept|showed)\b|(?:^|[^.])\b(?!I\b)[A-Z][a-z]+\s+(?:[a-z]+ed|ran|led|oversaw|taught|made|did|took)\b/;

/** Curly apostrophes and quotes as straight ones (round 10: phones type "I’ve"). Same length, so positions hold. */
export function straightQuotes(text: string): string {
  return (text || "").replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"');
}

/** The scope claims the person makes in their own words, one per sentence hit, active and not denied. */
function personClaims(sourceText: string): Claim[] {
  const out: Claim[] = [];
  for (const para of paragraphs(sourceText)) for (const raw of straightQuotes(para.text).split(/[\n.;!?]+/)) {
    const goal = para.goal;
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
        let doer: Doer = role ? "none" : doerOf(sentence.slice(0, m.index), COPULA_CLAIM_RE.test(m[0]) ? m[0] : first, sentence.slice(m.index! + m[0].length), goal);
        // Round 12 (SF-6): "I made the schedule for 8 cooks": the verb before "the schedule" is the one done.
        const madeIt = family === "schedule" && !role ? sentence.slice(0, m.index).match(/\b(made|did|wrote|built|set|handled|ran|put\s+together|make|makes|do|does|write|writes|build|builds|handle|handles|run|runs|sets)\s+(?:up\s+)?(?:the|a|our|my)?\s*(?:[a-z-]+\s+)?$/i) : null;
        if (doer === "none" && madeIt) doer = doerOf(sentence.slice(0, (m.index ?? 0) - madeIt[0].length), madeIt[1].split(/\s+/)[0], sentence.slice(m.index! + m[0].length), goal);
        if (doer === "self" && SHARED_AFTER_RE.test(sentence.slice(m.index! + m[0].length))) doer = "shared";
        out.push({ family, nouns: peopleFor(sentence, m), objects: objectWords(sentence, m), verbSelf: doer === "self", self: doer === "self", shared: doer === "shared", ...(role ? { role: true } : {}) });
      }
    }
    for (const [re, family] of LOOSE) {
      for (const m of sentence.matchAll(new RegExp(re.source, "gi"))) {
        if (!ok(m)) continue;
        const nouns = objectPeople(sentence.slice(m.index! + m[0].length), PEOPLE_RE);
        let doer: Doer = doerOf(sentence.slice(0, m.index), m[0], sentence.slice(m.index! + m[0].length), goal);
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
    straightQuotes(withoutGoalText(sourceText))
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
      // Round 13 (SF-3): a role that is one of their own job titles ("Lead Custodian | Maumee Valley").
      !(h.role && h.title && titleInOwnHeaders(h.title, sourceText)) &&
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
// Round 13 (SF-7): people words that name no group in particular, and the shift words that do.
const GENERIC_PEOPLE = new Set(["crew", "team", "staff", "staffer", "people", "person", "worker", "employee", "guy", "hand", "man", "member", "coworker", "co-worker", "teammate", "colleague", "peer", "shift", "department", "folk", "everyone", "everybody", "store", "kitchen", "group", "bunch"]);
const SHIFT_WORDS = new Set(["day", "days", "night", "nights", "morning", "mornings", "evening", "evenings", "overnight", "overnights", "weekend", "weekends", "first", "second", "third", "graveyard", "swing", "afternoon", "afternoons"]);
const shiftKey = (w: string) => w.replace(/s$/, "").replace(/^overnight$/, "night").replace(/^graveyard$/, "night").replace(/^third$/, "night").replace(/^first$/, "day").replace(/^morning$/, "day");
const UMBRELLA_PEOPLE = new Set(["associate", "employee", "staff", "staffer", "worker", "member", "people", "person", "hand", "coworker", "co-worker", "teammate", "colleague", "guy", "man", "shift", "store"]);
// Short forms of the same people word ("reps" is "representatives", "techs" is "technicians").
const SAME_PEOPLE: Record<string, string> = { rep: "representative", tech: "technician", assoc: "associate", cna: "aide", stna: "aide", coworker: "co-worker", newbie: "hire", newcomer: "hire" };
const sameWord = (w: string) => { const x = stemNoun(w); return SAME_PEOPLE[x] ?? x; };
// Capitalized words that are not anyone's name ("Never", "Nah", "Myself", "Supervisor").
const NOT_A_NAME = new Set(["i", "never", "nah", "no", "nope", "yes", "yeah", "yep", "none", "nobody", "nothing", "maybe", "myself", "me", "my", "mine", "the", "a", "an", "them", "they", "us", "we", "some", "someone", "somebody", "sometimes", "always", "often", "just", "all", "ok", "okay", "sure", "idk", "na", "not", "only", "also", "people", "everyone", "everybody", "anyone", "anybody", "supervisor", "manager", "lead", "leader", "boss", "owner", "foreman", "crew", "team", "staff", "workers", "guys", "new", "hires", "other", "others", "whoever", "whatever", "him", "her", "his", "he", "she", "it", "this", "that", "those", "these", "there", "here", "yes,", "no,", "about", "around", "like", "and", "or", "but", "with", "on", "at", "for", "of", "to", "in", "dunno", "unsure", "nights", "days", "night", "day", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "walmart", "amazon", "target", "kroger", "mcdonalds", "fedex", "ups"]);

/** The employer names in the person's own job headers ("Midwest Distribution"), as lowercase words. */
export function employerWordsOf(sourceText: string | undefined): Set<string> {
  return new Set(
    withoutGoalText(sourceText)
      .split("\n")
      .filter((l) => l.includes("|"))
      .flatMap((l) => (l.split("|")[1] ?? "").toLowerCase().match(/[a-z][a-z'&-]+/g) ?? [])
  );
}

export function typedCoversHit(hit: ScopeHit, typed: string, line: string, employers: Set<string> = new Set()): boolean | undefined {
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
  if (pageAll && !/\b(?:all|every|entire|whole|everyone|everybody)\b/i.test(t)) return false;
  // Round 13 (SF-7 ruling): a number on the line keeps its own number card, so the typed words need no count.
  const words = t.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
  // Round 13 (SF-7): a group the line does not name is refused ("new hires" for "the dock crew", "cashiers"
  // for "the night crew", "the day crew" for "the night crew"). Each claim reads only its own group, so on a
  // combined card "new hires" answers "Trained new hires" and not "supervised the night crew".
  const lineWords = new Set((straightQuotes(line).toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).map(sameWord));
  const local = pageText.split(/\s*(?:,|;|\band\b|\bwhile\b)\s+(?=(?:also\s+)?[a-z]+(?:ed|ran|led|oversaw|taught)\b)/i)[0];
  const hitWords = new Set((local.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).map(sameWord));
  const specific = words.filter((w) => PEOPLE_RE.test(w) && !GENERIC_PEOPLE.has(stemNoun(w)));
  // A page group that is everyone in a role-free word ("store associates", "employees", "team members") holds
  // any class of them ("the cashiers and stockers on my shift").
  const pagePeople = (local.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).filter((w) => PEOPLE_RE.test(w)).map(stemNoun);
  const umbrella = pagePeople.length > 0 && pagePeople.every((n) => UMBRELLA_PEOPLE.has(n));
  if (!umbrella && specific.some((w) => !lineWords.has(sameWord(w)))) return false;
  const pageShift = [...hitWords].filter((w) => SHIFT_WORDS.has(w)).map(shiftKey);
  const typedShift = words.filter((w) => SHIFT_WORDS.has(w)).map(shiftKey);
  if (pageShift.length && typedShift.length && !typedShift.some((w) => pageShift.includes(w))) return false;
  // A word of this claim's own group, a generic people word, a count, or names.
  if (words.some((w) => GENERIC_PEOPLE.has(stemNoun(w)))) return true;
  if (COUNT_WORD_RE.test(t)) return true;
  const content = words.filter((w) => w.length > 2 && !/^(?:the|and|with|new|yes|yeah|nope|nah|never|none|nothing|maybe|myself|not|did|led|for|all|any)$/.test(w));
  if (content.some((w) => hitWords.has(sameWord(w)))) return true;
  // Names: a capitalized word that is not a common word or an employer of theirs ("Marcus", "Marcus and Tia").
  const caps = t.match(/\b[A-Z][a-z]+\b/g) ?? [];
  const isName = (w: string) => !NOT_A_NAME.has(w.toLowerCase()) && !employers.has(w.toLowerCase()) && !NOUN_RE.test(w.toLowerCase());
  const tokens = t.trim().split(/\s+/);
  // Sentence case: a capital first word counts only when it is the whole answer or joined to another name.
  const firstIsSentenceCase = tokens.length > 1 && !/^(?:and|,|&)$/i.test(tokens[1] ?? "") && !/,$/.test(tokens[0]);
  return caps.filter((w, i) => !(i === 0 && firstIsSentenceCase && t.trim().startsWith(w))).some(isName);
}

/** True when typed words are only the page line (or its object) pasted back (round 12). */
export function isScopeCopy(typed: string, line: string): boolean {
  const t = plainWords(typed);
  const l = plainWords(line);
  if (!t || !l) return false;
  return t === l;
}

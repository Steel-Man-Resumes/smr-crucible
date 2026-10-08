/**
 * Scope claims: words that say someone ran, led or trained other people.
 * One list for the resume and the cover letter (review round 4), so the two
 * rules can never drift apart again.
 *
 * "Ran" and "head" count only with a people noun after them ("ran the night
 * crew", "headed the dish team"): "ran the grill" is ordinary work. "I
 * managed to ..." is not managing anyone.
 */

export type ScopeFamily = "supervise" | "manage" | "lead" | "oversee" | "direct" | "mentor" | "coordinate" | "train" | "schedule";

const PEOPLE = String.raw`(?:crews?|teams?|shifts?|staff|department|store|kitchen|cooks?|workers?|employees?|hires?|associates?|people|operators?|drivers?|loaders?|aides?|nurses?|servers?|dishwashers?|volunteers?|interns?|techs?|technicians?|helpers?|laborers?|pickers?|packers?)`;
const DET = String.raw`(?:(?:the|a|an|our|my|their|new|other|every|all)\s+)?(?:[a-z-]+\s+)?`;

const PATTERNS: Array<[RegExp, ScopeFamily]> = [
  [/\bsupervis\w*/gi, "supervise"],
  [/\bmanag(?:e|ed|es|ing|er|ers|ement)\b(?!\s+to\b)/gi, "manage"],
  [/\b(?:led|lead|leads|leading|leader|leaders|leadership)\b/gi, "lead"],
  [new RegExp(String.raw`\bhead(?:ed|s|ing)?\s+(?:up\s+)?${DET}${PEOPLE}\b`, "gi"), "lead"],
  [/\b(?:in charge of|took charge|take charge|taking charge)\b/gi, "lead"],
  [/\bspearhead\w*/gi, "lead"],
  [/\bboss(?:ed|es|ing)?\b/gi, "lead"],
  [/\bforem[ae]n\b/gi, "lead"],
  [new RegExp(String.raw`\bran\s+${DET}${PEOPLE}\b`, "gi"), "lead"],
  [/\b(?:oversaw|oversee\w*|oversight)\b/gi, "oversee"],
  [/\bdirect(?:ed|s|ing|or|ors)\b/gi, "direct"],
  [/\bmentor\w*/gi, "mentor"],
  [/\bcoordinat\w*/gi, "coordinate"],
  [new RegExp(String.raw`\btrain(?:ed|s|ing)?\s+${DET}${PEOPLE}\b`, "gi"), "train"],
  [/\bowned\s+(?:the\s+)?(?:[a-z-]+\s+){0,2}schedul\w*/gi, "schedule"],
];

export interface ScopeHit {
  family: ScopeFamily;
  /** The words on the line, as written. */
  word: string;
}

/** Every scope claim in a text. */
export function scopeHits(text: string): ScopeHit[] {
  const out: ScopeHit[] = [];
  for (const [re, family] of PATTERNS) {
    for (const m of (text || "").matchAll(new RegExp(re.source, "gi"))) out.push({ family, word: m[0] });
  }
  return out;
}

/** The first scope claim on a line whose family the person never used, if any. */
export function scopeNotTheirs(line: string, sourceText: string): ScopeHit | undefined {
  const theirs = new Set(scopeHits(sourceText).map((h) => h.family));
  return scopeHits(line).find((h) => !theirs.has(h.family));
}

const NEGATION_BEFORE = /\b(?:never|not|no|didn['’]?t|did not|don['’]?t|wasn['’]?t|was not|weren['’]?t|nobody|none)\b(?:\s+\S+){0,3}\s*$/i;

/**
 * True when an answer talks about running, leading or training people or
 * work: not "I managed to ...", and not a denial ("I never supervised anyone").
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

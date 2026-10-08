/**
 * Scope claims: words that say someone ran, led, trained or answered for
 * other people. One list for the resume and the cover letter, so the two
 * rules can never drift apart.
 *
 * Round 5: a scope claim on a line that is not in the person's own words is
 * settled only by the person's own rewrite or by cutting the line. An answer
 * never settles one, so nothing here reads an answer.
 *
 * "Ran", "head", "trained", "scheduled", "organized" and "evaluated" count
 * only with people after them ("ran the night crew", "trained a group of new
 * hires"): "ran the grill" is ordinary work. "I managed to ..." is not
 * managing anyone.
 */

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

const PEOPLE = String.raw`(?:crews?|teams?|shifts?|staff|staffers?|department|store|kitchen|cooks?|workers?|employees?|hires?|associates?|people|persons?|operators?|drivers?|loaders?|aides?|nurses?|servers?|dishwashers?|volunteers?|interns?|techs?|technicians?|helpers?|laborers?|pickers?|packers?|men|guys|hands|members?|leads|reps?|agents?|cashiers?|clerks?|trainees?|apprentices?)`;
// Up to three words before the people noun ("all of the new", "a group of new", "the entire overnight dish washing").
const DET = String.raw`(?!(?:on|in|at|to|for|with|by|as|into|out|from|up|through|under|about|around|over)\b)(?:(?:the|a|an|our|my|their|new|other|every|all|entire|whole)\s+){0,2}(?:(?:group|team|crew|bunch|handful)\s+of\s+(?:the\s+)?)?(?:of\s+the\s+)?(?:[a-z0-9-]+\s+){0,3}`;

const PATTERNS: Array<[RegExp, ScopeFamily]> = [
  [/\bsupervis\w*/gi, "supervise"],
  [/\bmanag(?:e|ed|es|ing|er|ers|ement)\b(?!\s+to\b)/gi, "manage"],
  [/\b(?:led|lead|leads|leading|leader|leaders|leadership)\b/gi, "lead"],
  [new RegExp(String.raw`\bhead(?:ed|s|ing)?\s+(?:up\s+)?${DET}${PEOPLE}\b`, "gi"), "lead"],
  [new RegExp(String.raw`\b${PEOPLE}\s+head\b`, "gi"), "lead"],
  [/\b(?:in charge of|took charge|take charge|taking charge|took over|take over|taking over)\b/gi, "lead"],
  [/\bspearhead\w*/gi, "lead"],
  [/\bboss(?:ed|es|ing)?\b/gi, "lead"],
  [/\bforem[ae]n\b/gi, "lead"],
  [/\bcaptain\w*/gi, "lead"],
  [/\bran\s+point\b/gi, "lead"],
  [new RegExp(String.raw`\b(?:ran|runs?|running)\s+${DET}${PEOPLE}\b`, "gi"), "lead"],
  [/\b(?:oversaw|oversee\w*|oversight)\b/gi, "oversee"],
  [/\bdirect(?:ed|s|ing|or|ors)\b/gi, "direct"],
  [/\bmentor\w*/gi, "mentor"],
  [/\bcoordinat\w*/gi, "coordinate"],
  [new RegExp(String.raw`\borgani[sz]\w*\s+${DET}${PEOPLE}\b`, "gi"), "coordinate"],
  [new RegExp(String.raw`\btrain(?:ed|s|ing)?\s+${DET}${PEOPLE}\b`, "gi"), "train"],
  [/\bowned\s+(?:the\s+)?(?:[a-z-]+\s+){0,2}schedul\w*/gi, "schedule"],
  [new RegExp(String.raw`\bschedul\w*\s+${DET}${PEOPLE}\b`, "gi"), "schedule"],
  [new RegExp(String.raw`\bkept\s+${DET}${PEOPLE}\s+on\s+(?:task|track|schedule)\b`, "gi"), "supervise"],
  [/\bresponsible\s+for\b/gi, "responsible"],
  [/\bdelegat\w*/gi, "delegate"],
  [new RegExp(String.raw`\bassign\w*\s+(?:[a-z-]+\s+){0,3}to\s+${DET}${PEOPLE}\b`, "gi"), "delegate"],
  [/\bhir(?:ed|es|ing)\s+and\s+fir\w*/gi, "hire"],
  [new RegExp(String.raw`\bevaluat\w*\s+${DET}${PEOPLE}\b`, "gi"), "evaluate"],
  [new RegExp(String.raw`\bevaluat\w*\s+(?:[a-z-]+\s+){0,2}(?:performance|reviews?)\b`, "gi"), "evaluate"],
  [/\b(?:co-?owner|owner[\s/&-]*(?:and\s+)?operator|business\s+owner|owned\s+and\s+operated|self[\s-]employed)\b/gi, "own"],
];

export interface ScopeHit {
  family: ScopeFamily;
  /** The words on the line, as written. */
  word: string;
}

/** Every scope claim in a page line. */
export function scopeHits(text: string): ScopeHit[] {
  const out: ScopeHit[] = [];
  for (const [re, family] of PATTERNS) {
    for (const m of (text || "").matchAll(new RegExp(re.source, "gi"))) out.push({ family, word: m[0] });
  }
  return out;
}

// The person's own words are read more loosely than the page: a verb of the
// family followed, in the same sentence, by people within a few words
// ("Trained and mentored twelve new team leads" covers "trained new team
// leads"). A denial ("never supervised anyone") never counts as theirs.
const LOOSE: Array<[RegExp, ScopeFamily]> = [
  [/\btrain(?:ed|s|ing)?\b/gi, "train"],
  [/\b(?:ran|runs?|running|head(?:ed|s|ing)?)\b/gi, "lead"],
  [/\bschedul\w*/gi, "schedule"],
  [/\borgani[sz]\w*/gi, "coordinate"],
  [/\bevaluat\w*/gi, "evaluate"],
  [/\bassign\w*/gi, "delegate"],
];
const PEOPLE_RE = new RegExp(String.raw`^${PEOPLE}$`, "i");
const NEGATION_BEFORE = /\b(?:never|not|no|didn['’]?t|did not|don['’]?t|wasn['’]?t|was not|weren['’]?t|nobody|none)\b(?:\s+\S+){0,3}\s*$/i;

/** The scope families in the person's own words. */
export function scopeFamiliesIn(sourceText: string): Set<ScopeFamily> {
  const out = new Set<ScopeFamily>();
  for (const sentence of (sourceText || "").split(/[\n.;!?]+/)) {
    for (const [re, family] of PATTERNS) {
      for (const m of sentence.matchAll(new RegExp(re.source, "gi"))) {
        if (!NEGATION_BEFORE.test(sentence.slice(0, m.index))) out.add(family);
      }
    }
    for (const [re, family] of LOOSE) {
      for (const m of sentence.matchAll(new RegExp(re.source, "gi"))) {
        if (NEGATION_BEFORE.test(sentence.slice(0, m.index))) continue;
        const after = sentence.slice(m.index! + m[0].length).toLowerCase().match(/[a-z]+/g) ?? [];
        if (after.slice(0, 6).some((w) => PEOPLE_RE.test(w))) out.add(family);
      }
    }
  }
  return out;
}

/** The first scope claim on a line whose family the person never used, if any. */
export function scopeNotTheirs(line: string, sourceText: string): ScopeHit | undefined {
  const theirs = scopeFamiliesIn(sourceText);
  return scopeHits(line).find((h) => !theirs.has(h.family));
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

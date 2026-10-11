/**
 * Fact trace (Phase 6, lane S2; rewording A, Troy 2026-10-11).
 *
 * Under rewording A, t.ROY may reword any line into strong plain words that
 * say what it means. What is locked is the FACTS: numbers, dates, job titles,
 * employers, tools, skills, credentials, results and scope. So the truth
 * check traces facts, not words: "In charge of the guys on my shift" ->
 * "Supervised the shift crew" passes (every fact traces back), while "Led a
 * 12-person crew plant-wide, cutting errors 20%" does not (a number, a scope
 * and a result the person never gave).
 *
 * This is the deterministic half. It finds the facts on a written line that
 * the person's own words do not carry. It cannot judge meaning ("clean safety
 * record" with no number in it is still a result, and it is caught by its
 * words; a brand-new claim in plain words is the model verifier's job). It is
 * used to decide when a line the model verifier rewrote or removed was only
 * reworded (every fact traces back) and should stand as written.
 *
 * Pure: no I/O.
 */

import { numberValues } from "@crucible/core/src/numberRead";
import { stemOf } from "@crucible/core/src/wordStem";
import { namedCredentialRe } from "@crucible/core/src/credentialWords";
import { scopeHitsNotTheirs, straightQuotes } from "@crucible/core/src/scopeWords";
import { isSectionHeader } from "@crucible/core/src/pageFitShared";

export type FactKind = "number" | "date" | "name" | "tool" | "skill" | "credential" | "result" | "scope" | "character";

export interface UntracedFact {
  kind: FactKind;
  /** The words on the line that carry the fact. */
  text: string;
}

const squash = (s: string) => s.toLowerCase().replace(/[\s\-\u2010-\u2015]+/g, "");
const words = (s: string) => (straightQuotes(s).toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).map((w) => w.replace(/'s$/, ""));

interface SourceIndex {
  text: string;
  flat: string;
  stems: Set<string>;
  numbers: Set<string>;
  years: Set<string>;
  monthYears: Set<string>;
}

const YEAR_RE = /\b(?:19|20)\d{2}\b/g;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_YEAR_RE = /\b(?:(\d{1,2})\/(?:\d{1,2}\/)?|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)((?:19|20)\d{2})\b/gi;

function monthYears(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(new RegExp(MONTH_YEAR_RE.source, "gi"))) {
    const month = m[1] ? Number(m[1]) : MONTHS.indexOf((m[2] || "").toLowerCase()) + 1;
    if (month >= 1 && month <= 12) out.add(`${month}/${m[3]}`);
  }
  return out;
}

// "8/2021" is a date: its month is not the number 8. Dates are traced as dates.
const SLASH_DATE_RE = /\b\d{1,2}\/(?:\d{1,2}\/)?(?:19|20)\d{2}\b/g;
const numbersOf = (text: string) => numberValues(text.replace(SLASH_DATE_RE, " "));

export function indexSource(source: string): SourceIndex {
  const text = source || "";
  const ws = words(text);
  return {
    text,
    flat: ` ${ws.join(" ")} `,
    stems: new Set(ws.map(stemOf)),
    numbers: numbersOf(text),
    years: new Set(text.match(YEAR_RE) ?? []),
    monthYears: monthYears(text),
  };
}

const saidStem = (src: SourceIndex, w: string) => src.stems.has(stemOf(w));
const saidPhrase = (src: SourceIndex, phrase: string) => squash(src.text).includes(squash(phrase));

// Results and benefits the person must have given: a change they caused, a record, a prize.
const RESULT_RE = /\b(?:reduc\w*|increas\w*|improv\w*|boost\w*|sav(?:ed|es|ing|ings)|lower(?:ed|ing)|rais(?:ed|ing)|cut(?:ting)?\s+(?:down\s+)?(?:on\s+)?(?:costs?|waste|errors?|time|downtime|turnover)|zero|record|accuracy|accurate|on[\s-]time|ahead\s+of\s+schedule|under\s+budget|resulting\s+in|which\s+led\s+to|leading\s+to|ensur\w*|prevent\w*|eliminat\w*|award\w*|recogni[sz]\w*|prais\w*|promot\w*|exceed\w*|achiev\w*|top\s+performer|employee\s+of\s+the\s+month|compliance|compliant|efficien\w*|productiv\w*|satisfaction)\b/gi;
// Claims about the person's character or the setting.
const CHARACTER_RE = /\b(?:dependable|reliable|reliability|hard[\s-]?work\w*|trustworthy|punctual\w*|consistent\w*|fast[\s-]paced|high[\s-]volume|busy|peak|attendance|work\s+ethic|self[\s-]starter|motivated|dedicated|go[\s-]getter)\b/gi;
// Words that widen how much the work covered.
const SIZE_RE = /\b(?:all|entire|whole|every\s+(?:department|area|site|location|team|crew|employee)|plant[\s-]?wide|company[\s-]?wide|site[\s-]?wide|facility[\s-]?wide|department[\s-]?wide|plant|facility|facilities|department|departments|company|division|region\w*|district|multi[\s-]?site|multiple\s+(?:sites|locations|stores|crews|teams)|sole(?:ly)?|single[\s-]handed\w*|alone|independently|senior|head)\b/gi;
// Size and scale words the person must have said (review L4): "a large crew", "heavy freight", "major accounts".
const SCALE_RE = /\b(?:large|larger|huge|massive|heavy|heavy-duty|major|key|critical|extensive|numerous|multiple|many|dozens|hundreds|thousands|high-value|high-volume|big|biggest|largest|daily|weekly|constant(?:ly)?|always|every\s+day|regular(?:ly)?)\b/gi;
// Equipment, machines and software a line can name in lower case.
const TOOL_RE = /\b(?:forklifts?|reach\s+trucks?|order\s+pickers?|pallet\s+jacks?|electric\s+pallet\s+jacks?|scissor\s+lifts?|boom\s+lifts?|cherry\s+pickers?|skid\s+steers?|bobcats?|excavators?|backhoes?|loaders?|cranes?|hoists?|cnc|lathes?|mills?|press\s+brakes?|welders?|mig|tig|plasma\s+cutters?|torches?|grinders?|saws?|nail\s+guns?|compressors?|generators?|scanners?|rf\s+guns?|label\s+printers?|cash\s+registers?|pos(?:\s+systems?)?|fryers?|grills?|ovens?|slicers?|dish\s+machines?|floor\s+buffers?|scrubbers?|buffers?|excel|word|outlook|quickbooks|sap|oracle|salesforce|wms|erp|crm|ehr|emr|epic|spreadsheets?|software|computer\s+systems?)\b/gi;

function hits(re: RegExp, line: string): string[] {
  return [...line.matchAll(new RegExp(re.source, "gi"))].map((m) => m[0]);
}

const SKILLS_HEADING_RE = /^(?:core competencies|competencies|key competencies|skills|key skills|core skills|technical skills|professional skills|skills summary|areas of expertise|qualifications)$/i;

function skillTerms(line: string): string[] {
  const body = line.replace(/^[-*\u2022]\s*/, "").replace(/^[A-Za-z][A-Za-z &/]{1,30}:\s*/, "");
  return body.split(/[|,;]/).map((t) => t.trim()).filter(Boolean);
}

const STOP = new Set(["and", "of", "the", "for", "with", "in", "on", "to", "a", "an", "at", "by", "from", "as", "or", "into", "per", "via"]);

/**
 * The facts on one written line that the person's own words do not carry.
 * `section` says whether the line sits under a skills heading (each term is a
 * skill claim there).
 */
export function untracedFacts(line: string, source: string | SourceIndex, opts: { section?: "skills" | "other"; job?: string } = {}): UntracedFact[] {
  const src = typeof source === "string" ? indexSource(source) : source;
  const out: UntracedFact[] = [];
  const t = line.trim();
  if (!t || isSectionHeader(t)) return out;
  const push = (kind: FactKind, text: string) => {
    if (!out.some((f) => f.kind === kind && f.text.toLowerCase() === text.toLowerCase())) out.push({ kind, text });
  };

  // Numbers (headcounts, amounts, percentages, "3rd") and dates.
  for (const n of numbersOf(t)) if (!src.numbers.has(n)) push("number", n);
  for (const y of t.match(YEAR_RE) ?? []) if (!src.years.has(y)) push("date", y);
  for (const my of monthYears(t)) if (!src.monthYears.has(my)) push("date", my);

  // Credentials by name, and the words that say one is held.
  for (const m of t.matchAll(namedCredentialRe())) if (!saidPhrase(src, m[0])) push("credential", m[0]);
  for (const m of hits(/\b(?:certified|certification|certificate|licensed|license|licence)\b/i, t)) {
    if (!/\b(?:certif|licen[cs])/i.test(src.text)) push("credential", m);
  }

  // Results, character and setting claims, by their words.
  for (const m of hits(RESULT_RE, t)) if (!saidStem(src, m.split(/\s+/)[0]) && !saidPhrase(src, m)) push("result", m);
  for (const m of hits(CHARACTER_RE, t)) if (!saidPhrase(src, m) && !saidStem(src, m.split(/[\s-]+/)[0])) push("character", m);

  // Scope: running people the person did not say they ran (meaning, not the exact verb),
  // and words that widen what the work covered.
  for (const h of scopeHitsNotTheirs(t, src.text, { job: opts.job })) push("scope", h.word);
  for (const m of hits(SIZE_RE, t)) {
    const w = m.toLowerCase();
    if (src.flat.includes(` ${w} `) || saidPhrase(src, m)) continue;
    // "all" in a skills label or "head" in "head of lettuce" is noise; keep the size words that change scope.
    if (w === "head" && !/\bhead\s+(?:of\s+)?(?:the\s+)?(?:crew|team|shift|department|kitchen|cook|chef)/i.test(t)) continue;
    push("scope", m);
  }

  for (const m of hits(SCALE_RE, t)) {
    if (src.flat.includes(` ${m.toLowerCase()} `) || saidPhrase(src, m)) continue;
    push("scope", m);
  }

  // Tools, machines and software named in lower case.
  for (const m of hits(TOOL_RE, t)) {
    const ws = words(m);
    if (!ws.every((w) => saidStem(src, w))) push("tool", m);
  }

  if (opts.section === "skills") {
    // Every skill term needs at least one of its words in the person's own words.
    for (const term of skillTerms(t)) {
      const ws = words(term).filter((w) => !STOP.has(w) && w.length > 2);
      if (!ws.length) continue;
      if (src.flat.includes(` ${ws.join(" ")} `)) continue;
      if (!ws.some((w) => saidStem(src, w))) push("skill", term);
    }
    return out;
  }

  // Names: a capitalized word that is not the first word of a sentence (an
  // employer, a title, a brand, a place), or a short all-caps word, the person
  // never wrote. On a job line ("TITLE | Employer | Place | dates") every word
  // of the title and employer counts.
  const isHeaderLine = t.includes("|");
  const body = t.replace(/^[-*\u2022]\s*/, "");
  const tokens = [...body.matchAll(/[A-Za-z][A-Za-z0-9&'.-]*/g)];
  for (const m of tokens) {
    const tok = m[0].replace(/[.']+$/, "");
    const at = m.index ?? 0;
    const before = body.slice(0, at).trimEnd();
    const sentenceStart = !before || /[.!?:;]$/.test(before);
    const capital = /^[A-Z]/.test(tok);
    const acronym = /^[A-Z]{2,5}$/.test(tok);
    if (!isHeaderLine && (!capital || (sentenceStart && !acronym))) continue;
    if (isHeaderLine && !capital && !acronym) {
      // On a job line a lowercase word is part of a title or employer too.
      if (STOP.has(tok.toLowerCase()) || /^(?:present|current|now|to)$/i.test(tok)) continue;
    }
    if (/^(?:present|current|now|i|a|an|the|and|of|to|in|on|at|for|with|by|or)$/i.test(tok)) continue;
    if (!/[a-z]/i.test(tok) || tok.length < 2) continue;
    const w = tok.toLowerCase();
    if (src.flat.includes(` ${w} `) || saidStem(src, w) || saidPhrase(src, tok)) continue;
    push("name", tok);
  }
  return out;
}

/**
 * Every line of a written document with the facts on it the person's words do
 * not carry (empty array: every fact traces back). Lines are trimmed; the
 * skills section is read term by term.
 */
export function traceDocument(output: string, source: string): Array<{ line: string; untraced: UntracedFact[] }> {
  const src = indexSource(source);
  let section: "skills" | "other" = "other";
  // The job header each line sits under: scope is read against that job's words (r2 ruling).
  let job: string | undefined;
  return (output || "").split("\n").map((raw) => {
    const line = raw.trim();
    if (isSectionHeader(line) || SKILLS_HEADING_RE.test(line.replace(/:$/, ""))) {
      section = SKILLS_HEADING_RE.test(line.replace(/:$/, "")) ? "skills" : "other";
      job = undefined;
      return { line, untraced: [] };
    }
    if (line.includes("|") && !/^[-*\u2022]/.test(line) && !line.includes("@")) job = line;
    return { line, untraced: line ? untracedFacts(line, src, { section, job }) : [] };
  });
}

/** True when every fact on the line traces back to the person's words. */
export function factsTraceBack(line: string, source: string | SourceIndex, opts: { section?: "skills" | "other" } = {}): boolean {
  return untracedFacts(line, source, opts).length === 0;
}

// ---- review M1 / r2 M-A: when a "wording" flag may be dropped ------------------------------------------
// A CLOSED list (CC ruling r2): duty phrasing on the person's line may become one of a few verbs that keep the
// same work, about the very same object. Any other verb change keeps the flag.
const DUTY_LEAD_RE = /^(?:i\s+)?(?:was\s+)?(?:responsible\s+for|did|do|does|dealt\s+with|deal\s+with|handled|handle|took\s+care\s+of|take\s+care\s+of|worked\s+on|work\s+on|duties\s+included)\s+(.+)$/i;
const SAME_WORK_VERB_RE = /^(?:handled|completed|ran|performed|kept\s+up(?:\s+with)?)\s+(.+)$/i;
// Words that keep a line at its true size. Wherever their words about this object carry one, the line keeps it.
const LIMITING_RE = /\b(?:help(?:ed|ing|s)?|assist(?:ed|ing|s)?|under|alongside|along|rode|until|expired|lapsed|former(?:ly)?|part\s+of|some|sometimes|occasionally|when\s+(?:needed|asked|assigned)|as\s+needed|backup|back-up|fill(?:ed)?\s+in|trainee|in\s+training|learning|class|course)\b/gi;
const FUNCTION_WORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with", "by", "from", "as", "into", "per", "my", "our", "their", "his", "her", "its", "this", "that", "these", "those", "all", "each"]);
const objectStems = (t: string) => words(t).filter((w) => !FUNCTION_WORDS.has(w)).map(stemOf);
const sameSet = (a: string[], b: string[]) => {
  const A = new Set(a);
  const B = new Set(b);
  return A.size > 0 && A.size === B.size && Array.from(A).every((x) => B.has(x));
};

/**
 * True only when `claim` is provably a rewording of a line of the person's own words: their line is duty
 * phrasing ("Did safety audits.", "Responsible for the dock paperwork.") and the claim is one of the same-work
 * verbs (handled, completed, ran, performed, kept up) about exactly the same object, every fact traces back,
 * and every limiting word in ANY of their lines about that object (helped, under, until, rode along...) is
 * kept. Anything else (a new duty, a new verb, a lost "helped", a size word) keeps the flag.
 */
export function onlyRewordedFrom(claim: string, source: string): boolean {
  const c = claim.trim().replace(/^[-*\u2022]\s*/, "").replace(/[.!?;]+$/, "");
  if (!c || !factsTraceBack(c, source)) return false;
  const sentences = (source || "")
    .split(/\n|(?<=[.!?;])\s+/)
    .map((l) => l.trim().replace(/^[-*\u2022]\s*/, "").replace(/[.!?;]+$/, ""))
    .filter(Boolean);
  // Unchanged apart from case and punctuation: nothing to judge.
  if (sentences.some((l) => l.toLowerCase() === c.toLowerCase())) return true;
  const cv = c.match(SAME_WORK_VERB_RE);
  if (!cv) return false;
  const obj = objectStems(cv[1]);
  const from = sentences.find((l) => {
    const d = l.match(DUTY_LEAD_RE);
    return !!d && sameSet(objectStems(d[1]), obj);
  });
  if (!from) return false;
  // Every line of theirs that names this object: its limiting words must all be on the claim.
  const nouns = new Set(obj.filter((x) => x.length >= 4));
  for (const l of sentences) {
    if (!objectStems(l).some((x) => nouns.has(x))) continue;
    for (const m of l.matchAll(new RegExp(LIMITING_RE.source, "gi"))) {
      const head = m[0].split(/\s+/)[0].toLowerCase();
      if (!new RegExp(`\\b${head.replace(/[^a-z-]/g, "")}`, "i").test(c)) return false;
    }
  }
  return true;
}

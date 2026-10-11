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
export function untracedFacts(line: string, source: string | SourceIndex, opts: { section?: "skills" | "other" } = {}): UntracedFact[] {
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
  for (const h of scopeHitsNotTheirs(t, src.text)) push("scope", h.word);
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
  return (output || "").split("\n").map((raw) => {
    const line = raw.trim();
    if (isSectionHeader(line) || SKILLS_HEADING_RE.test(line.replace(/:$/, ""))) {
      section = SKILLS_HEADING_RE.test(line.replace(/:$/, "")) ? "skills" : "other";
      return { line, untraced: [] };
    }
    return { line, untraced: line ? untracedFacts(line, src, { section }) : [] };
  });
}

/** True when every fact on the line traces back to the person's words. */
export function factsTraceBack(line: string, source: string | SourceIndex, opts: { section?: "skills" | "other" } = {}): boolean {
  return untracedFacts(line, source, opts).length === 0;
}

// ---- review M1: when a "wording" flag may be dropped ---------------------------------------

// The plain action verbs a rewording may bring in: the verb is the rewording.
// Scope verbs (supervised, led...) are not here: they are judged by the scope check.
const PLAIN_VERBS = new Set(
  ["ran", "run", "runs", "handled", "handle", "served", "serve", "operated", "operate", "performed", "perform", "completed",
   "complete", "conducted", "conduct", "drove", "drive", "carried", "carry", "made", "make", "built", "build", "prepared",
   "prepare", "worked", "work", "did", "do", "used", "use", "took", "take", "kept", "keep", "set", "fixed", "fix"]
);
// Words that keep a line at its true size. If the person's line has one, the reworded line keeps it.
const LIMITING_RE = /\b(?:help(?:ed|ing|s)?|assist(?:ed|ing|s)?|with\s+(?:the|a|my|our)\s+\w+|under|alongside|until|expired|lapsed|former(?:ly)?|part\s+of|some|sometimes|occasionally|when\s+(?:needed|asked|assigned)|as\s+needed|backup|back-up|fill(?:ed)?\s+in|trainee|in\s+training|learning|class|course)\b/gi;
const FUNCTION_WORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with", "by", "from", "as", "into", "per", "my", "our", "their", "his", "her", "its", "this", "that", "these", "those", "all", "each"]);

/**
 * True only when `claim` is provably a rewording of ONE line of the person's own words: every fact on it
 * traces back (numbers too, to that same line), no scope claim is new, every limiting word of their line
 * (helped, under, until, expired...) is still there, and the only new words are plain action verbs. A new
 * duty, a new noun, a new size word or a lost "helped" means it is not, and the flag stays.
 */
export function onlyRewordedFrom(claim: string, source: string): boolean {
  const c = claim.trim();
  if (!c || !factsTraceBack(c, source)) return false;
  const cw = words(c).filter((w) => !FUNCTION_WORDS.has(w));
  if (!cw.length) return false;
  const cStems = new Set(cw.map(stemOf));
  let best: { line: string; score: number } | null = null;
  for (const raw of (source || "").split(/\n|(?<=[.!?;])\s+/)) {
    const line = raw.trim();
    if (!line) continue;
    const ls = new Set(words(line).map(stemOf));
    const score = Array.from(cStems).filter((x) => ls.has(x)).length;
    if (score > 0 && (!best || score > best.score)) best = { line, score };
  }
  if (!best) return false;
  const lineStems = new Set(words(best.line).map(stemOf));
  // New words: only plain action verbs.
  if (cw.some((w) => !lineStems.has(stemOf(w)) && !PLAIN_VERBS.has(w))) return false;
  // Numbers come from that same line.
  const ln = numbersOf(best.line);
  for (const n of numbersOf(c)) if (!ln.has(n)) return false;
  // Every limiting word of their line is kept.
  for (const m of best.line.matchAll(new RegExp(LIMITING_RE.source, "gi"))) {
    if (!new RegExp(`\\b${m[0].split(/\s+/)[0].replace(/[^a-z-]/gi, "")}`, "i").test(c)) return false;
  }
  return true;
}

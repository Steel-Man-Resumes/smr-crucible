/**
 * The deterministic faithfulness check for the Spanish reading (lane D1).
 *
 * No model runs here. After the model returns a Spanish reading, this looks at
 * the English resume and the Spanish text and answers one narrow question: did
 * anything that must be copied exactly go missing?
 *
 *   1. Every digit sequence in the English must appear in the Spanish, after
 *      the thousands and decimal marks are removed (1,200 and 1.200 and 1200
 *      are the same figure; 18.50 and 18,50 are the same figure).
 *   2. Every run of capitalized words in the English that reads as a name
 *      (an employer, school, city, job title, a person) must appear unchanged
 *      in the Spanish.
 *
 * It is deliberately one-sided. It never says the Spanish is right, only that
 * these items were not found, so the screen can ask the person to look at
 * them. It can flag a name the model translated on purpose (a title-case skill
 * on a line of skills, say). That is the safe direction: a false alarm costs a
 * glance, a miss costs a wrong fact on a resume.
 *
 * Pure: no imports, no network, no database.
 */

export interface FaithfulnessResult {
  /** True only when nothing is missing. */
  ok: boolean;
  /** Digit sequences from the English that the Spanish does not have, as written in the English. */
  missingNumbers: string[];
  /** Names from the English that the Spanish does not have unchanged, as written in the English. */
  missingNames: string[];
  /** missingNumbers then missingNames: the list the screen shows. */
  missing: string[];
}

/* ------------------------------------------------------------ numbers --- */

// A figure: digits, optionally grouped by , . or a (narrow) no-break space
// followed by exactly three digits, optionally ending in a decimal part.
// The (?!\d) keeps "2019 2022" from being read as one figure, and a plain
// space is never a group mark.
const NUMBER = /\d+(?:[.,  ]\d{3}(?!\d))*(?:[.,]\d+)?/gu;

/** The figure with every separator removed: "1,200" and "1.200" both become "1200". Leading zeros stay ("0100"). */
export function normalizeNumber(raw: string): string {
  return raw.replace(/[.,  ]/g, "");
}

export function numberTokens(text: string): string[] {
  return text.match(NUMBER) ?? [];
}

/* -------------------------------------------------------------- names --- */

/**
 * Words that start with a capital but are translated on purpose, so they are
 * never a name: the resume's own section headings (the ones
 * formatResumeDownload writes, and the common ones a person types), months,
 * days, seasons and "Present".
 */
const HEADING_WORDS = new Set([
  "professional summary", "professional experience", "education & certifications", "education and certifications",
  "skills", "summary", "objective", "experience", "work experience", "work history", "employment", "employment history",
  "education", "certifications", "certificates", "licenses", "references", "projects", "volunteer", "volunteer experience",
  "awards", "languages", "training", "additional", "additional information", "profile", "core competencies", "highlights",
  "achievements", "technical skills", "relevant experience", "qualifications", "key skills", "contact", "interests",
]);
const CALENDAR_WORDS = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "spring", "summer", "fall", "autumn", "winter", "present", "current", "to", "present day",
]);
/** Joins two capitalized words inside one name ("Bank of America", "Johnson & Johnson"). */
const CONNECTORS = new Set(["of", "and", "&", "for"]);
/** A leading word that is not part of a name even when capitalized ("The Home Depot"). */
const LEADING_STOP = new Set(["the", "a", "an"]);

const WORD = /[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu;

function isCapitalized(word: string): boolean {
  const first = word.codePointAt(0);
  if (first === undefined) return false;
  const ch = String.fromCodePoint(first);
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

interface Tok { text: string; start: number; end: number; }

function tokens(line: string): Tok[] {
  const out: Tok[] = [];
  for (const m of line.matchAll(WORD)) out.push({ text: m[0], start: m.index!, end: m.index! + m[0].length });
  return out;
}

/** True when the characters between two tokens are exactly one plain space (the only thing that continues a name). */
/** Abbreviations whose period does not end a sentence: "St. Mary's Hall", "Dr. Ruiz". */
const ABBREVIATIONS = new Set(["st", "mt", "ft", "dr", "mr", "mrs", "ms", "jr", "sr", "inc", "co", "corp", "ltd", "ave", "blvd", "rd", "dept"]);

function joinsBySpace(line: string, a: Tok, b: Tok): boolean {
  const between = line.slice(a.end, b.start);
  return between === " " || (between === ". " && ABBREVIATIONS.has(a.text.toLowerCase()));
}

function headingKey(line: string): string {
  return line.trim().replace(/\s+/g, " ").toLowerCase();
}

interface LineKind {
  /** The line was a bullet ("- Loaded trucks"): its first word starts a sentence. */
  bullet: boolean;
  /** The piece follows a pipe ("Title | Company"): its first word is a field, not a sentence start. */
  afterPipe: boolean;
}

/** The names on one piece of a line, in order. */
function namesOnLine(line: string, kind: LineKind): string[] {
  const toks = tokens(line);
  const out: string[] = [];
  // A bullet or a long line of prose starts a sentence at its first word; a short field ("Acme Logistics") does not.
  const prose = kind.bullet || (!kind.afterPipe && toks.length > 5);
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (!isCapitalized(t.text) || CALENDAR_WORDS.has(t.text.toLowerCase())) { i++; continue; }
    // Grow the run: capitalized words (or a connector between two capitalized words) joined by one space.
    const run: Tok[] = [t];
    let j = i + 1;
    while (j < toks.length) {
      const prev = run[run.length - 1];
      const next = toks[j];
      if (!joinsBySpace(line, prev, next)) break;
      if (isCapitalized(next.text) && !CALENDAR_WORDS.has(next.text.toLowerCase())) { run.push(next); j++; continue; }
      // "of", "and" between two capitalized words.
      const after = toks[j + 1];
      if (CONNECTORS.has(next.text.toLowerCase()) && after && isCapitalized(after.text) && joinsBySpace(line, next, after) && !CALENDAR_WORDS.has(after.text.toLowerCase())) {
        run.push(next, after); j += 2; continue;
      }
      break;
    }
    // A name that starts a sentence in prose is only a sentence starter when it is one word.
    const atLineStart = (prose && run[0].start === 0) || /[.!?]\s+$/.test(line.slice(0, run[0].start));
    let words = run.map((r) => r.text);
    // Drop a leading "The" / "A" / "An".
    while (words.length > 0 && LEADING_STOP.has(words[0].toLowerCase()) && run.length > 1) {
      words = words.slice(1); run.shift();
    }
    const text = line.slice(run[0].start, run[run.length - 1].end);
    const single = run.length === 1;
    // A single capitalized word that starts a sentence is just a sentence starter ("Managed", "Operated").
    if (single && atLineStart) { i = j; continue; }
    // A lone capital letter is an initial or a pronoun, not a name.
    if (single && words[0].length < 2) { i = j; continue; }
    if (HEADING_WORDS.has(headingKey(text))) { i = j; continue; }
    out.push(text);
    i = j;
  }
  // "Johnson & Johnson": the run broke at "&" (not a word token). Re-join pieces split by " & ".
  return joinAmpersand(line, out);
}

function joinAmpersand(line: string, names: string[]): string[] {
  const out: string[] = [];
  for (let k = 0; k < names.length; k++) {
    let cur = names[k];
    while (k + 1 < names.length) {
      const joined = `${cur} & ${names[k + 1]}`;
      if (line.includes(joined)) { cur = joined; k++; } else break;
    }
    out.push(cur);
  }
  return out;
}

/** The names in an English resume that must come through unchanged. Exported for tests. */
export function nameTokens(english: string): string[] {
  const found: string[] = [];
  let section = "";
  for (const raw of english.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const key = headingKey(line);
    if (HEADING_WORDS.has(key)) { section = key; continue; }
    // Skills are common nouns, not names; digits on this line are still checked elsewhere.
    if (section === "skills" || section === "key skills" || section === "technical skills" || section === "core competencies") continue;
    const bullet = /^[-•*]\s+/.test(line);
    let text = line.replace(/^[-•*]\s+/, "");
    // "Credential | Institution  2018": the credential is a common noun, the institution is a name.
    if (section.startsWith("education") && text.includes("|")) text = text.split("|").slice(1).join("|");
    // Pipes separate fields; a name never spans one.
    text.split("|").forEach((piece, k) => {
      for (const n of namesOnLine(piece.trim(), { bullet: bullet && k === 0, afterPipe: k > 0 })) found.push(n);
    });
  }
  // Keep first occurrence, in order.
  return [...new Set(found)];
}

/** For matching: NFC, curly apostrophes straight, periods dropped ("St. Louis" = "St Louis"), spaces collapsed. */
function forMatching(text: string): string {
  return text.normalize("NFC").replace(/[‘’]/g, "'").replace(/\./g, "").replace(/\s+/g, " ");
}

export function checkFaithfulness(english: string, spanish: string): FaithfulnessResult {
  const spanishNumbers = new Set(numberTokens(spanish).map(normalizeNumber));
  const missingNumbers: string[] = [];
  const seenNumbers = new Set<string>();
  for (const raw of numberTokens(english)) {
    const key = normalizeNumber(raw);
    if (seenNumbers.has(key)) continue;
    seenNumbers.add(key);
    if (!spanishNumbers.has(key)) missingNumbers.push(raw);
  }

  const haystack = forMatching(spanish);
  const missingNames: string[] = [];
  for (const name of nameTokens(english)) {
    if (!haystack.includes(forMatching(name))) missingNames.push(name);
  }

  const missing = [...missingNumbers, ...missingNames];
  return { ok: missing.length === 0, missingNumbers, missingNames, missing };
}

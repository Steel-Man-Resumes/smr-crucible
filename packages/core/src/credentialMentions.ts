/**
 * Credentials, one at a time, wherever they sit on a page.
 *
 * Round 5 design: the gate never reads the person's free text to decide that
 * they "said" a credential, its kind or its status. Every credential on a
 * page is asked as a memory prompt (decision D4), and the line that stays is
 * written only from what the person confirms.
 *
 * Round 6: the one exception is whole-line exactness. A credential needs no
 * prompt only when its page line, or its part of a list line, is a whole line
 * the person wrote (their uploaded resume, their licenses-and-training
 * answer), case, spacing and punctuation aside. The person's text is never
 * cut on a semicolon or a line break to make a shorter match: a status or a
 * "not held" word they wrote with it must be on the page too. Recall is
 * widened (credential-implying titles, "licensed and bonded", licensure
 * initials) and backed by a catch-all: an all-caps token on the page that is
 * nowhere in the person's words is asked about.
 *
 * This file FINDS credentials on a page and groups mentions of one
 * credential (identical keys only), so each is asked once. It never decides
 * that one is true.
 *
 * Pure. Used by the draft/finished status (resumeStatus) and the finish gate
 * (the cover letter).
 */

import { linesOf, isSectionEnd, isEntryHeader, skillTermsOf, CONTACT_LINE_RE, STATUS_WORD_RE } from "./resumeMintCheckShared";
import { isCredentialTerm, namedCredentialRe, credentialInitialsRe, isShortInitialTerm } from "./credentialWords";
import { isWorkAcronym, needsHoldingWord } from "./workAcronyms";
import { isStrictCredentialWhen } from "./credentialStatus";
import { titleWords } from "./scopeWords";

export interface CredentialMention {
  /** The page line it is on, or the part when it is one part of a skills or credentials list line. */
  line: string;
  /** True when `line` is one part of a list line (skills or credentials), not a whole page line. */
  term: boolean;
  /** The credential as written ("Forklift Certified", "CPR", "AWS D1.1 Structural Welding Certification"). */
  name: string;
  /** One key per credential on the page(s), so it is asked about once. Never compared with the person's words. */
  key: string;
  /** Words of the name that identify it (not "certified", "card", years or status). */
  nameWords: string[];
  /** The exact words on the line that name it (to move or cut them). */
  raw: string;
  /** True when it is a known credential by name (CPR, OSHA 10), not a generic holding claim. */
  named: boolean;
  where: "credentials" | "skills" | "other";
  /** The whole page line it sits on. */
  context: string;
  /** What the page shows for this credential: its part of the line with that part's year or status, or the whole line. */
  unit: string;
  /** The words that name it on the page, without its year or status (for the whole-line match). */
  part: string;
  /** True when the credential is in a dated job header's title ("CERTIFIED NURSING ASSISTANT | ..."). */
  title?: boolean;
  /** True when it is an education line (a GED, a diploma, a degree): confirmed as earned or in progress. */
  education?: boolean;
  /** Round 10: a credential (not the schooling) found on an education line ("Welding Certificate" beside a diploma). */
  onEducationLine?: boolean;
}

const CRED_SECTION_RE = /^(?:certifications?|licenses?|licences?|credentials?|certifications? (?:and|&) licen[cs]es?|licen[cs]es? (?:and|&) certifications?)$/i;
const SKILLS_RE = /^(?:core competencies|skills|key skills|competencies|core skills|technical skills)$/i;
// Round 9: combined headings too ("EDUCATION & CERTIFICATIONS", "Training and Education"; pageFitShared knows them).
const EDU_WITH = String.raw`(?:training|certifications?|certificates?|credentials?|licen[cs]es?)`;
const EDUCATION_RE = new RegExp(
  String.raw`^(?:(?:education|schooling|academic background)(?:\s*(?:and|&|\/|,)\s*${EDU_WITH})*|${EDU_WITH}\s*(?:and|&|\/|,)\s*education)$`,
  "i"
);
// A heading that holds credentials as well as schooling ("EDUCATION & CERTIFICATIONS"): a line that is not schooling is a credentials line.
const COMBINED_HEADING_RE = /certific|credential|licen[cs]/i;
// Round 8: an education line is a credential too (GED, HSE, HiSET, a diploma, a degree, a certificate).
// Round 9: HSED, dotted G.E.D., and a page "certificate" are read too; the trailing (?![\w]) keeps "graduate" off "graduated".
const EDUCATION_CORE_RE =
  /\b(?:GED|G\.E\.D\.?|HSED|HSE|HiSET|TASC|equivalency|diploma|degree|graduate|associate(?:'s)?|bachelor(?:'s)?|master(?:'s)?|doctorate|certificate|A\.A\.S?\.?|B\.S\.?|B\.A\.?|M\.S\.?|M\.?B\.?A\.?)(?![\w])/i;
// A status the writer may supply on an education line: settled only by the person's confirmation.
const EDUCATION_STATUS_RE = /\b(?:graduated|graduating|completed|completion|finished|class\s+of)\b/i;
/** Everything that makes an education line a claim to ask about (round 9: and the holding words, read by the claim readers too). */
export const EDUCATION_CREDENTIAL_RE = new RegExp(
  String.raw`${EDUCATION_CORE_RE.source}|${EDUCATION_STATUS_RE.source}|\b(?:certified|certification|licensed|license|qualified|registered)\b`,
  "i"
);
// A school or program on an education line.
const SCHOOL_RE = /\b(?:college|school|academy|institute|university|center|centre|tech|technical|polytechnic|campus|adult\s+(?:ed|education)|job\s+corps|program|programme)\b/i;
const EDU_PART_SPLIT_RE = /\s*(?:\||,|;|\s[-\u2013\u2014]\s)\s*/;
const YEARISH_RE = /^(?:(?:class\s+of\s+)?(?:19|20)\d{2}(?:\s*[-\u2013]\s*(?:(?:19|20)\d{2}|present))?|present)$/i;
const STATE_PART_RE = /^[A-Z]{2}$/;

// Round 10: the status of a school someone went to without finishing is a status too, never a name
// ("Attended 2004 - 2007", "Coursework through 11th grade", "did not graduate").
const EDU_NOT_DONE_RE = /\b(?:attended|attending|(?:some\s+)?coursework\s+through\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\s+grade|through\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\s+grade|did\s+not\s+(?:finish|graduate|complete)|didn'?t\s+(?:finish|graduate|complete)|no\s+diploma|non-?graduate|left\s+in\s+\d{1,2}(?:st|nd|rd|th)\s+grade)\b/gi;

/** An education part without its year, its status or a bracketed aside ("Graduated 2008" is "", "High School Equivalency (GED)" is "High School Equivalency"). */
function cleanEducationPart(p: string): string {
  return p
    .replace(/\(([^)]*)\)/g, " ")
    .replace(EDU_NOT_DONE_RE, " ")
    .replace(/\b(?:graduated|graduating|completed|finished)(?:\s+(?:from|at|in))?\b/gi, " ")
    .replace(/\bclass\s+of\b/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b(?:in progress|current|currently|enrolled|expected|anticipated|present)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.:-]+|[\s,:-]+$/g, "")
    .trim();
}

const EDU_REST_STATUS_RE = /\b(?:19|20)\d{2}\b|\b(?:graduated|graduating|completed|completion|finished|class\s+of|in progress|current|currently|enrolled|expected|anticipated|present|earned|passed|attended|attending)\b/i;
// A program, a course or a grade: what a prompt may name when a line has no credential word.
const PROGRAM_WORD_RE =
  /\b(?:program|programme|technology|technician|welding|cosmetology|nursing|culinary|automotive|hvac|electrical|plumbing|carpentry|machining|machinist|trucking|business|administration|management|science|sciences|arts|studies|engineering|accounting|medical|phlebotomy|grade|course|courses|coursework|classes|training|apprenticeship|construction|manufacturing|logistics|computer|information|criminal|justice|english|math|basic\s+education|literacy)\b/i;
// Words that are never a school's own name: honors, scores, programs and record words never ride on a confirmation.
const NOT_A_SCHOOL_RE = /\b(?:honou?r|honors|roll|dean'?s|list|gpa|valedictorian|salutatorian|society|award|attendance|scholarship|cum\s+laude|magna|summa|program|programme|training|course|certificate|certification|license|diploma|degree|jail|prison|correctional|corrections|detention|facility|inmate|penitentiary|doc|reentry|re-entry)\b|\d/i;
// Generic school words: a name made only of these says nothing about which school.
const GENERIC_SCHOOL_WORDS = new Set(["high", "school", "college", "community", "technical", "tech", "university", "center", "centre", "career", "academy", "institute", "adult", "education", "the", "of", "area", "county", "state", "city", "public", "schools"]);

const partsOfEducationLine = (line: string) =>
  line
    .replace(/^\s*[-•*]\s*/, "")
    .split(EDU_PART_SPLIT_RE)
    .map((p) => p.trim())
    .filter(Boolean);
const isStatePart = (p: string) => STATE_PART_RE.test(cleanEducationPart(p)) || STATE_PART_RE.test(p);
const isPlacePart = (parts: string[], i: number) => isStatePart(parts[i]) || (/^[A-Z][a-z]+(?:\s[A-Z][a-z]+)?$/.test(parts[i]) && isStatePart(parts[i + 1] ?? ""));

/** True when a part names a school: a school word, and no honor, score, program, credential or record word. */
export function isSchoolName(part: string): boolean {
  const c = cleanEducationPart(part);
  return !!c && SCHOOL_RE.test(c) && !NOT_A_SCHOOL_RE.test(c);
}

/**
 * Round 10 (SF-3): a school name the person used: its first two words (or the
 * whole name) appear together in their own words ("Scott High" for "Scott
 * High School"), and it names more than generic words.
 */
export function schoolUsedBy(school: string, personText: string | undefined): boolean {
  const words = normalizeTyped(cleanEducationPart(school)).split(" ").filter(Boolean);
  if (!words.length || words.every((w) => GENERIC_SCHOOL_WORDS.has(w))) return false;
  // Round 11 (SF-3, SF-7): every distinctive word of the school must be one of theirs ("Owens" for "Owens
  // Community College"); a word after it they never said ("Welding Lab Supervisor") is not part of it.
  // Their contact line never counts ("Toledo, OH" does not make "Toledo Tech" theirs).
  return schoolSaidBy(words, personText);
}

// Round 13 (SF-6): only the person's words about school count toward a school name: a phrase that ends in a
// school word ("Scott High", "Owens Community College", "Lincoln HS") or the name after "graduated from",
// "attended", "dropped out of", "went to" in a sentence about school. An employer ("I worked at the Toledo Zoo",
// "I worked for Toledo Public Schools") or a city ("Toledo born and raised") never does.
const STRONG_SCHOOL_TYPES: Record<string, string> = { high: "high", hs: "high", tech: "tech", technical: "tech", polytechnic: "tech", vocational: "tech", college: "college", cc: "college", community: "college", academy: "academy", university: "university", institute: "institute", career: "career", adult: "adult", ged: "adult" };
const SCHOOL_TYPE_WORD = /^(?:high|hs|tech|technical|polytechnic|vocational|college|cc|community|academy|university|institute|career|adult|school|schools|center|centre|campus|education|ed)$/i;
const EMPLOYER_BEFORE = /\b(?:work(?:ed|s|ing)?\s+(?:for|at|with|in)|job\s+(?:at|with|for|in)|employed\s+(?:by|at)|hired\s+(?:at|by|on\s+at)|(?:custodian|janitor|cleaner|cook|aide|driver|bus\s+driver)\s+(?:at|for|with)|cleaned\s+(?:at|for)|contract(?:or)?\s+(?:at|for|with))\s+(?:the\s+)?$/i;
const SCHOOL_TALK = /\b(?:school|grade|diploma|ged|hse|degree|associate'?s?|bachelor'?s?|coursework|courses?|certificate|graduat\w*|class(?:es)?|dropped\s+out|drop\s+out|freshman|sophomore|junior|senior\s+year|semester|enrolled|studied)\b/i;
type SchoolPhrase = { words: Set<string>; strong: Set<string>; typed: boolean };
function personSchoolPhrases(personText: string | undefined): SchoolPhrase[] {
  const out: SchoolPhrase[] = [];
  const lines = (personText || "")
    .split("\n")
    .filter((l) => !CONTACT_LINE_RE.test(l) && !l.includes("|"))
    .map((l) => l.replace(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*[A-Z]{2}\b/g, " "));
  for (const line of lines) {
    for (const sentence of line.split(/(?<=[.!?;])\s+/)) {
      const toks = sentence.split(/\s+/);
      const norm = toks.map((t) => normalizeTyped(t));
      // A phrase ending in a school word: up to three name words before it, read back to a stop word.
      for (let i = 0; i < toks.length; i++) {
        if (!SCHOOL_TYPE_WORD.test(norm[i] || "")) continue;
        let end = i;
        while (end + 1 < toks.length && SCHOOL_TYPE_WORD.test(norm[end + 1] || "") && !/[,.;:!?]$/.test(toks[end])) end++;
        let start = i;
        while (start > 0 && i - start < 4 && !/[,.;:!?(]$/.test(toks[start - 1]) && !/^(?:at|to|from|of|in|the|a|an|and|or|for|my|our|i|went|attended|go|left|quit|finished|graduated|was|is|with|by|on|out)$/.test(norm[start - 1] || "")) start--;
        if (start === i && !/^(?:hs|cc)$/.test(norm[i])) {
          // "school" alone ("left school") names no school.
          if (!STRONG_SCHOOL_TYPES[norm[i]] || !/[A-Z]/.test(toks[i])) continue;
        }
        if (EMPLOYER_BEFORE.test(toks.slice(0, start).join(" "))) continue;
        const words = norm.slice(start, end + 1).flatMap((w) => w.split(" ")).filter(Boolean);
        out.push({ words: new Set(words), strong: new Set(words.map((w) => STRONG_SCHOOL_TYPES[w]).filter(Boolean)), typed: true });
        i = end;
      }
      // A name after a school verb, in a sentence about school ("I graduated from Scott", "went to Libbey but left in 10th grade").
      // "I took some welding classes at Penta", "went to Libbey but left in 10th grade".
      if (SCHOOL_TALK.test(sentence)) {
        for (const m of sentence.matchAll(/\b(?:went\s+to|attended|graduated\s+from|dropped\s+out\s+of|finished\s+at|left|at)\s+((?:[A-Z][\w'.]*)(?:\s+[A-Z][\w'.]*){0,2})/g)) {
          if (EMPLOYER_BEFORE.test(sentence.slice(0, m.index! + m[0].length - m[1].length))) continue;
          const words = normalizeTyped(m[1]).split(" ").filter(Boolean);
          if (words.length) out.push({ words: new Set(words), strong: new Set(words.map((w) => STRONG_SCHOOL_TYPES[w]).filter(Boolean)), typed: words.some((w) => SCHOOL_TYPE_WORD.test(w)) });
        }
      }
    }
  }
  return out;
}
/** True when one phrase of theirs about school holds every distinctive word of the school, and the same kind of school. */
function schoolSaidBy(schoolWordsNorm: string[], personText: string | undefined): boolean {
  const distinct = schoolWordsNorm.filter((w) => !GENERIC_SCHOOL_WORDS.has(w));
  if (!distinct.length) return false;
  const strong = new Set(schoolWordsNorm.map((w) => STRONG_SCHOOL_TYPES[w]).filter(Boolean));
  return personSchoolPhrases(personText).some(
    // A phrase with a school word must be the same kind of school ("Toledo Tech" is not "Toledo High School").
    (p) => distinct.every((w) => p.words.has(w)) && (!strong.size || !p.typed || [...strong].some((t) => p.strong.has(t)))
  );
}

/**
 * Round 11 (SF-7): the part of a school name the person used, and what the
 * writer added after it ("Scott High School Welding Lab Supervisor" is
 * "Scott High School" and "Welding Lab Supervisor").
 */
export function schoolPrefixUsed(part: string, personText: string | undefined): { school: string; rest: string } | undefined {
  const words = cleanEducationPart(part).split(/\s+/).filter(Boolean);
  for (let n = words.length; n > 0; n--) {
    const head = words.slice(0, n);
    const last = normalizeTyped(head[head.length - 1]);
    if (n < words.length && !SCHOOL_RE.test(last)) continue;
    if (!schoolSaidBy(head.map((w) => normalizeTyped(w)).filter(Boolean), personText)) continue;
    const school = head.join(" ");
    if (!isSchoolName(school)) continue;
    return { school, rest: words.slice(n).join(" ") };
  }
  return undefined;
}

/**
 * Round 9 (r9-N4), round 10 (SF-3): an education line rewritten from the
 * person's confirmation. The part the prompt named becomes what they
 * confirmed ("GED, in progress"); only a school name they used themselves
 * rides after a bar. Everything else the writer put there (honors, a GPA, a
 * program or a training, a facility) moves to its own line under it, where
 * every check reads it; years, statuses and places come off.
 */
export function educationLineRewrite(line: string, raw: string, confirmed: string, personText?: string): { line: string; rest?: string } {
  const bullet = line.match(/^\s*[-•*]\s*/)?.[0] ?? "";
  const parts = partsOfEducationLine(line);
  const schools: string[] = [];
  const others: string[] = [];
  parts.forEach((p, i) => {
    if (p === raw.trim() || YEARISH_RE.test(p) || isPlacePart(parts, i)) return;
    const c = EDU_REST_STATUS_RE.test(p) || /\(/.test(p) ? cleanEducationPart(p) : p;
    if (!c || YEARISH_RE.test(c) || STATE_PART_RE.test(c) || /^(?:some\s+)?(?:coursework|classes|courses)$/i.test(c)) return;
    const used = SCHOOL_RE.test(c) ? schoolPrefixUsed(c, personText) : undefined;
    if (used) {
      schools.push(used.school);
      if (used.rest) others.push(used.rest);
    } else if (!isSchoolName(c) && !/^(?:with|and|or|of|in|at)\b/i.test(c)) others.push(c);
  });
  return { line: `${bullet}${confirmed}${schools.length ? ` | ${schools.join(", ")}` : ""}`, ...(others.length ? { rest: `${bullet}${others.join(", ")}` } : {}) };
}

/**
 * Round 10 (SF-1): "I went but didn't finish". The line keeps the school (the
 * part the card named, when it is a school or a program, else a school the
 * person used) and only the years they typed, with no completion word.
 * Returns "" when there is no school to keep.
 */
export function educationAttendedLine(line: string, raw: string, name: string, years: string, personText?: string, typedSchool?: string): string {
  const bullet = line.match(/^\s*[-•*]\s*/)?.[0] ?? "";
  // Round 11 (SF-3): only a school the person named (or typed on the card) stays; a school or a course the
  // writer named never does.
  void raw;
  void name;
  const typed = typedSchoolParts(typedSchool);
  const keep = (typeof typed === "object" ? typed.school : "") || attendedSchoolOf(line, personText);
  if (!keep) return "";
  return `${bullet}${keep}, attended${attendedTail(years, typeof typed === "object" ? typed.grade : undefined)}`;
}

/**
 * Round 10 (SF-2): an education line without one of its parts ("High School
 * Diploma | Penta Career Center | Welding Certificate | 2015" without the
 * certificate). Returns "" when no school or credential is left.
 */
export function withoutEducationPart(line: string, raw: string): string {
  const bullet = line.match(/^\s*[-•*]\s*/)?.[0] ?? "";
  const want = dehyphenate(raw).toLowerCase();
  const parts = partsOfEducationLine(line);
  const kept = parts.filter((p) => !dehyphenate(p).toLowerCase().includes(want));
  if (kept.length === parts.length) return line;
  if (!kept.some((p) => isSchoolName(p) || EDUCATION_CORE_RE.test(p) || PROGRAM_WORD_RE.test(p))) return "";
  return `${bullet}${kept.join(line.includes("|") ? " | " : ", ")}`;
}

/** The school on an education line that the person named themselves, if any (round 11). */
export function attendedSchoolOf(line: string, personText?: string): string | undefined {
  for (const p of partsOfEducationLine(line)) {
    const c = cleanEducationPart(p);
    if (!SCHOOL_RE.test(c)) continue;
    const used = schoolPrefixUsed(c, personText);
    if (used) return used.school;
  }
  return undefined;
}

/** A school name the person typed on the card: plain words, no year, no status, no credential (round 11). */
export function typedSchoolName(typed: string | undefined): string {
  const p = typedSchoolParts(typed);
  return typeof p === "object" ? p.school : "";
}

/**
 * Round 12 (SF-8): what the person typed in "What school?". A grade or a
 * "did not graduate" they add is their status, not part of the name ("Scott
 * High (left in 11th grade)" is Scott High, through 11th grade). Returns ""
 * when empty, "rejected" when what is left is not a school's name.
 */
export function typedSchoolParts(typed: string | undefined): { school: string; grade?: string; facility?: true } | "" | "rejected" {
  let t = (typed || "").replace(/\s+/g, " ").replace(/[–—]/g, " - ").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const grade = t.match(/\b(\d{1,2}(?:st|nd|rd|th))\s+grade\b/i)?.[1];
  // Round 13 (SF-6): "(dropped out)", "(left)", "(didn't finish)", an open "(dropped out" and any dash are statuses.
  const STATUS_WORDS = String.raw`(?:grade|graduat|finish|left|quit|did\s*n|didn|attend|dropped|drop\s*out|dropout|no\s+diploma|withdr[ae]w)`;
  t = t
    .replace(/^(?:i\s+)?(?:went\s+to|attended|go\s+to|was\s+at)\s+/i, "")
    .replace(/\(([^)]*)\)/g, (all, inner) => (new RegExp(String.raw`\b${STATUS_WORDS}`, "i").test(inner) ? " " : all))
    .replace(new RegExp(String.raw`\s*\(\s*${STATUS_WORDS}[^)]*$`, "i"), "")
    .replace(/[,;-]\s*(?:through|thru|until|till|up\s+to)?\s*\d{1,2}(?:st|nd|rd|th)\s+grade\b.*$/i, "")
    .replace(/\s+(?:through|thru|until|till|up\s+to)\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\s+grade\b.*$/i, "")
    .replace(/[,;-]?\s*(?:did\s+not|didn'?t|never)\s+(?:graduate|finish)\b.*$/i, "")
    .replace(/[,;-]?\s*(?:left|quit|dropped\s+out|drop\s*out|dropout|withdrew)\b.*$/i, "")
    .replace(/[,;-]?\s*(?:no\s+diploma|non-?graduate|attended)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.,;:(-]+$/, "")
    .replace(/\(\s*$/, "")
    .trim();
  if (!t || t.length > 80 || /\d/.test(t) || EDU_REST_STATUS_RE.test(t) || EDUCATION_CORE_RE.test(t) || /\|/.test(t)) return "rejected";
  // A name: a school word, or a name in capitals; never "yes", "no" or "n/a".
  if (/^(?:yes|no|ok|okay|none|nope|n\/a|na|idk|sure|high school|school)$/i.test(t) || !(/[A-Z]/.test(t) || SCHOOL_RE.test(t) || /\bhigh\b/i.test(t))) return "rejected";
  return { school: t, ...(grade ? { grade: grade.toLowerCase() } : {}), ...(SCHOOL_FACILITY_RE.test(t) ? { facility: true as const } : {}) };
}

/** Round 13 (SF-6): a school box that names a jail or prison: the person chooses to keep it, it is never printed silently. */
export const SCHOOL_FACILITY_RE = /\b(?:jail|jails|prison|prisons|correctional|corrections|detention|juvenile\s+hall|juvie|penitentiary|penal|inmate|lockup|reformatory|youth\s+(?:center|facility|services)|windham\s+school\s+district|correctional\s+education)\b|^(?!.*\b(?:schools?|high|middle|elementary|academy|college|community|career|technical|tech|vocational|alternative|adult|learning|education|department|district|esc|isd|line|public|joint|university|institute)\b).*\bcounty\b/i;

const attendedTail = (years: string, grade?: string) => {
  const y = attendedYears(years);
  // Round 13 (N8): "Scott High, attended through 11th grade" (a comma only after years).
  return `${y ? ` ${y}` : ""}${grade ? `${y ? "," : ""} through ${grade} grade` : ""}`;
};

/**
 * Round 11 (SF-4): the parts of an education line that name other credentials
 * ("OSHA 10" in "GED | Toledo Adult Education | OSHA 10 | 2015"), with the
 * line's years, as a line of their own; "" when there are none. An answer
 * about the schooling never touches them: they keep their own card.
 */
export function credentialPartsOnly(line: string, credRaws: string[]): string {
  const bullet = line.match(/^\s*[-•*]\s*/)?.[0] ?? "";
  const parts = partsOfEducationLine(line);
  const wants = credRaws.map((r) => dehyphenate(r).toLowerCase()).filter(Boolean);
  const creds = parts.filter((p) => wants.some((w) => dehyphenate(p).toLowerCase().includes(w)));
  if (!creds.length) return "";
  const years = parts.filter((p) => YEARISH_RE.test(p));
  return `${bullet}${[...creds, ...years].join(line.includes("|") ? " | " : ", ")}`;
}

/** The years in an "I went but didn't finish" answer: one year or a range, nothing else. */
export function attendedYears(years: string): string {
  const t = (years || "").trim().replace(/[–—]/g, "-");
  const m = t.match(/^((?:19|20)\d{2})(?:\s*(?:-|to)\s*((?:19|20)\d{2}))?$/i);
  return m ? (m[2] ? `${m[1]} - ${m[2]}` : m[1]) : "";
}

/** True when an answer box holds only years for "didn't finish" (or nothing). */
export function isAttendedYears(years: string): boolean {
  return !(years || "").trim() || !!attendedYears(years);
}

/**
 * True when a page line is a confirmed education line (round 10): the
 * confirmed text, then only school names the person used ("GED, 2015 |
 * Toledo Adult Education").
 */
export function isConfirmedEducationLine(line: string, confirmed: string, personText?: string): boolean {
  const body = line.replace(/^\s*[-•*]\s*/, "").trim();
  const c = confirmed.trim();
  if (body === c) return true;
  if (!body.startsWith(`${c} | `)) return false;
  const rest = body.slice(c.length + 3);
  if (!rest.trim() || rest.includes("|") || EDU_REST_STATUS_RE.test(rest)) return false;
  return rest.split(/\s*,\s*/).every((p) => isSchoolName(p) && schoolUsedBy(p, personText));
}

/** True when a page line is a confirmed "went but didn't finish" line: the named school, "attended", and only the years typed. */
export function isConfirmedAttendedLine(line: string, name: string, years: string, personText?: string, typedSchool?: string): boolean {
  const body = line.replace(/^\s*[-•*]\s*/, "").trim();
  const typed = typedSchoolParts(typedSchool);
  const m = body.match(/^(.+?), attended(.*)$/);
  if (!m) return false;
  // Only the years they typed, and the grade they typed (round 12).
  if (m[2] !== attendedTail(years, typeof typed === "object" ? typed.grade : undefined)) return false;
  const school = m[1];
  void name;
  // Round 11 (SF-3): the school they typed on the card, or one they named in their own words.
  if (typeof typed === "object" && school === typed.school) return true;
  return isSchoolName(school) && schoolUsedBy(school, personText);
}

/**
 * Round 9: the part of an education line a prompt names (decision D4 asks
 * about the credential, never the school): the part with GED, HSED, a
 * diploma, a degree or a certificate; else the program ("Welding Program",
 * "12th grade"); else the school. "Graduated", "Completed" and years come off
 * the name: they are what the person confirms. Round 10: never a city, a
 * state or a status word ("Attended"); with nothing else, "this school".
 */
export function educationPartOf(body: string): { name: string; raw: string } | undefined {
  const parts = partsOfEducationLine(body);
  const clean = cleanEducationPart;
  // "Coursework completed through 11th grade": a bare "coursework" or "some classes" left over is a status, not a program.
  const named = parts.filter((p, i) => clean(p) && !YEARISH_RE.test(clean(p)) && !isPlacePart(parts, i) && !/^(?:some\s+)?(?:coursework|classes|courses)$/i.test(clean(p)));
  const core = named.find((p) => EDUCATION_CORE_RE.test(p));
  if (core) return { name: clean(core) || core, raw: core };
  // A program or a grade ("Welding Program", "Welding Technology", "12th grade") before the school.
  const program = named.find((p) => !isSchoolName(p) && PROGRAM_WORD_RE.test(clean(p)));
  if (program) return { name: clean(program), raw: program };
  const school = named.find((p) => SCHOOL_RE.test(clean(p)));
  if (school) return { name: clean(school), raw: school };
  return parts.length ? { name: "this school", raw: parts[0] } : undefined;
}

const HIGH_SCHOOL_DONE_RE = /\b(?:(?:finished|graduated(?:\s+from)?|completed|got\s+through|made\s+it\s+through)\s+(?:my\s+|the\s+)?high\s+school|high\s+school\s+grad\b)/gi;
// A schooling credential by name, on any line.
const EDU_NAMED_RE = /^(?:GED|G\.E\.D\.?|HSED|HiSET|High\s+School\s+(?:Diploma|Equivalency(?:\s+Diploma)?|Graduate|Degree))$/i;

/** True when an education line is an entry to ask about: a school or program, a year, or a "graduated / completed" status. */
function isEducationEntry(body: string): boolean {
  return EDUCATION_CORE_RE.test(body) || EDUCATION_STATUS_RE.test(body) || SCHOOL_RE.test(body) || /\b(?:19|20)\d{2}\b/.test(body) || PROGRAM_WORD_RE.test(body) || /\beducation\b/i.test(body);
}

// Holding claims: "Forklift Certified", "AWS D1.1 Structural Welding Certification", "Welding Certificate".
// Words may carry a dot only between digits ("D1.1"), so a match never runs across a sentence end.
const TRAILING_CLAIM_RE = /((?:\b[A-Za-z0-9][\w&+/'-]*(?:\.\d+)*\s+){1,4}?)(Certified|Certification|Certificate|License|Licence|Licensed|Card|Endorsement|Permit|Registry|Trained|Authorized|Authorised|Qualified)\b/gi;
// Words that end a credential's name when read backwards from its claim word ("on weekends as a fully licensed").
// Equipment and programs a person is trained, authorized or qualified on ("forklift trained").
const TRAINED_ON_RE = /\b(?:forklift|crane|reach|truck|pallet|jack|scissor|boom|lift|osha|hazmat|haccp|loto|gmp|servsafe|cpr|aed|first\s+aid|rigging|welding|cdl|equipment)\b/i;
const NAME_STOP = new Set([
  "cross", "well", "newly", "highly", "recently", "extensively", "properly", "fully", "being", "get", "got", "gets", "become", "trained",
  "a", "an", "the", "my", "our", "your", "his", "her", "their", "i", "i'm", "am", "is", "are", "was", "were", "be", "been",
  "and", "or", "as", "at", "on", "in", "of", "for", "to", "by", "from", "with", "who", "which", "that", "also", "still",
  "fully", "now", "hold", "holds", "held", "have", "has", "had", "got", "earned", "obtained", "passed", "completed",
  "received", "renewed", "current", "active", "valid", "since", "through", "until", "every", "all", "this", "it",
]);
// "Certified Nursing Assistant", "Licensed Electrician", "certified in CPR", "certified as a welder".
const LEADING_CLAIM_RE = /\b(Certified|Licensed|Registered)\s+(?:(?:in|as|for)\s+(?:an?\s+)?)?((?:[A-Za-z][\w&.+/'-]*)(?:\s+(?!and\b|with\b|who\b|for\b|in\b|at\b|on\b|of\b|to\b|since\b|through\b|throughout\b|until\b|by\b|from\b|during\b|every\b|each\b|daily\b|across\b|within\b|over\b|under\b|while\b)[A-Za-z][\w&.+/'-]*){0,2})/gi;
// "licensed and bonded electrician", "fully licensed, bonded and insured", "Electrician, licensed and bonded".
const HOLD_WORDS = String.raw`licensed|certified|registered|bonded|insured`;
const HOLDING_LIST_RE = new RegExp(String.raw`(?:\b([A-Z][a-z]+),\s+)?\b(?:fully\s+)?(?:${HOLD_WORDS})(?:\s*(?:,\s*(?:and\s+)?|\band\b\s*|&\s*)(?:${HOLD_WORDS}))+(?:\s+(?!for\b|on\b|in\b|at\b|to\b|with\b)([a-z][a-z'-]+))?`, "gi");
// "certified since 2015", "certified hand", "licensed through the state": not a credential's name.
const NOT_A_NAME_RE = /^(?:since|through|throughout|until|by|from|hand|hands|to|on|at|and|or|in|as|for|with|the|a|an|this|that|it|all|every|during|while|operator|worker|associate|employee|professional|team|staff)\b/i;
// A title word that says the person holds something.
// Someone else's: "to the RN", "for CDL drivers", "supported CNA staff", "the RN on duty".
// Round 8: someone else's credential only before a plural people word or "on duty" ("CDL drivers",
// "CNA staff", "the RN on duty"), or after "to the", "under the", "reported to", or "assisted /
// supported / helped (the)". "with", "by" and "from" never make it someone else's, a singular people
// word never does ("CDL driver" is the person), and "as a", "I am a" or "a" before it make it theirs.
const OTHERS_BEFORE = /\b(?:to\s+the|under(?:\s+the)?|reported\s+to(?:\s+the)?|assist(?:ed|ing)(?:\s+the)?|support(?:ed|ing)(?:\s+the)?|help(?:ed|ing)(?:\s+the)?)\s+$/i;
const OTHERS_AFTER = /^\s+(?:drivers|staff|teams|nurses|aides|crews|workers|employees|operators|technicians|techs|colleagues|coworkers|co-workers|on\s+duty)\b/i;
// Round 9: a member of the group holds it too ("Member of the CNA staff", "moved up to the CDL team", "joined the CNA staff").
const OWN_BEFORE = /\b(?:as\s+an?|i\s+am\s+an?|i'm\s+an?|am\s+an?|an?|(?:member|members|part|one)\s+of(?:\s+(?:the|a|an|our|their))?|joined(?:\s+(?:the|a|an|our|their))?|(?:moved|stepped|came)\s+up\s+to(?:\s+(?:the|a|an))?|promoted\s+to(?:\s+(?:the|a|an))?)\s+$/i;

/** True when a credential at this spot is someone else's ("the RN on duty", "for CDL drivers"), never the person's own. */
export function isOthersCredential(text: string, index: number, length: number): boolean {
  const before = text.slice(0, index);
  if (OWN_BEFORE.test(before)) return false;
  return OTHERS_AFTER.test(text.slice(index + length)) || OTHERS_BEFORE.test(before);
}

const TITLE_CREDENTIAL_RE = /\b(?:certified|licensed|registered|journeyman|master|bonded|accredited|credentialed|apprentice)\b/i;

const GENERIC = new Set([
  "i", "i'm", "am", "is", "are", "was", "were", "who", "have", "has", "had", "also", "still", "be", "been", "to",
  "it", "its", "this", "that", "we", "our", "you", "your", "can", "will",
  "certified", "certification", "certificate", "license", "licence", "licensed", "card", "training", "course",
  "class", "program", "level", "state", "issued", "current", "active", "valid", "expired", "renewal", "renewed",
  "endorsement", "permit", "registry", "registered", "status",
  "in", "as", "for", "a", "an", "the", "of", "and", "with", "holds", "hold", "earned", "passed", "my",
]);
// Words that start a holding claim's name but are not part of it ("Passed the AWS D1.1 ...").
const LEAD_TRIM = /^(?:(?:earned|obtained|got|hold|holds|held|have|has|had|passed|completed|received|renewed|current|active|valid|a|an|the|my|our|and|with|plus|also|i|i'm|am|is|are|was|were|who|still|fully|now|be|being|been|to|of|in|for|as|its)\s+)+/i;

// ---- one key per credential on the page ---------------------------------------
// Only the type words come off ("Forklift Certified" and "Forklift card" are
// one credential to ask about). Every other word stays, so "OSHA 30" is never
// "OSHA 10" and "CDL Class A" is never "CDL". Spelling is not guessed at: two
// spellings are two prompts, which is safe. The key only groups mentions on
// the page(s); it is never compared with the person's words.
const KEY_DROP = new Set([
  "certified", "certification", "certifications", "certificate", "cert", "card", "cards", "license", "licence",
  "licensed", "endorsement", "permit", "registry", "credential", "holder", "operator", "the", "a", "an", "my", "of", "in",
  // Round 10: "OSHA 10 trained" is the OSHA 10 card, asked and confirmed once.
  // Round 11 (SF-1): "authorized" stays in the key ("OSHA authorized trainer" is not the OSHA 10 card).
  "trained", "qualified",
]);

/** The key a credential name is grouped under. */
export function credentialKey(name: string): string {
  const t = name.toLowerCase().replace(/\b(?:19|20)\d{2}\b/g, " ");
  // A class letter stays with its class, whatever the spelling ("Class-A", "class a", "CDL-A", "CDL (A)").
  const joined = t
    .replace(/\bcdl[\s-]*\(?([a-d])\)?(?![\w'])/g, "cdl class_$1")
    .replace(/\bclass[\s-]*([a-d])\b/g, "class_$1");
  const toks = (joined.match(/[a-z0-9_.+]+/g) ?? [])
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w && !KEY_DROP.has(w));
  return Array.from(new Set(toks)).sort().join(" ");
}

/** Kept for callers of the round 4 name. The same strict page key. */
export const canonicalCredentialKey = credentialKey;

/** The key one credential name is filed under (the same key a mention of it gets). */
export function credentialKeyOf(name: string): string | undefined {
  return credentialKey(name) || undefined;
}

function cleanName(raw: string): string {
  return raw
    .replace(/^[-•*]\s*/, "")
    .replace(LEAD_TRIM, "")
    .replace(/\b(?:19|20)\d{2}\b/g, "")
    .replace(new RegExp(STATUS_WORD_RE.source, "gi"), "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,;:.]+$/, "")
    .trim();
}

function nameWordsOf(name: string): string[] {
  return (name.toLowerCase().match(/[a-z0-9][a-z0-9.'+-]*/g) ?? [])
    .map((w) => w.replace(/\.$/, ""))
    .filter((w) => w && !GENERIC.has(w) && !/^(?:19|20)\d{2}$/.test(w));
}

// ---- list lines: one part per credential ------------------------------------------

// Commas, semicolons, pipes, middots, bullets, plus signs, ampersands,
// parentheses, " - ", dashes, slashes, "with", "plus", "also", tabs and runs
// of spaces. A hyphen inside a name ("OSHA-10", "CDL-A") is not a split.
// "and" splits only between two parts that each stand as a credential.
const PART_SPLIT_RE = /\s*(?:[,;|·•+&()[\]\t]|\s-\s|[\u2013\u2014]|\s\/\s|\/(?=[A-Za-z])|\b(?:with|plus|also)\b|\s{2,})\s*/i;
// A part that only carries a year or a status ("2019", "current", "renewed yearly", "exp. 06/2027").
const CONTEXT_WORDS = new Set([
  "active", "current", "currently", "valid", "expired", "expires", "expiring", "exp", "inactive", "lapsed", "in", "progress",
  "enrolled", "completed", "complete", "finished", "passed", "renewed", "renewal", "renews", "suspended", "revoked",
  "through", "thru", "until", "good", "for", "standing", "up", "to", "date", "since", "as", "of", "issued", "obtained",
  "earned", "received", "on", "the", "a", "yearly", "annually", "annual", "every", "each", "year", "years", "is", "it",
  "still", "from", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
  "spring", "summer", "fall", "winter", "pending", "now", "present", "today", "ongoing",
]);
const CLASS_PART_RE = /^(?:class|level|grade|tier|type)[\s-]*[a-z0-9]{1,5}$/i;
// Wording, not a credential: a level or a qualifier ("Advanced Level", "OSHA-compliant", "Level Three").
const QUALIFIER_WORDS = new Set(["advanced", "basic", "intermediate", "beginner", "expert", "senior", "junior", "level", "levels", "one", "two", "three", "four", "five", "i", "ii", "iii", "iv", "graduate", "standard", "full", "general"]);
const QUALIFIER_PART_RE = /^[\w-]+[\s-](?:compliant|approved|aligned|based|trained)$|^(?:compliant|approved)$/i;
// Where or how it was earned ("county job center", "passed the driving test", "Safety First Training"): a detail of the part before it.
const DETAIL_PLACE_RE = /\b(?:center|centre|college|school|academy|institute|university|department|office|red cross|job corps|community|council|association|society|board|agency|commission|union)\b/i;
const DETAIL_START_RE = /^(?:passed|took|completed|finished|through|via|at|from|by|online)\b/i;
const PROVIDER_RE = /^(?:[A-Z][\w&'.-]*\s+){2,5}(?:Training|Institute|Council|College|Academy|Center|Centre|School|University|Association|Society|Board)$/;
// An employer or staffing agency after a credential ("Forklift Certified, Midwest Distribution, 2020").
const EMPLOYER_RE = /^(?:[A-Z][\w&'.-]*\s+){1,4}(?:Distribution|Logistics|Warehouse|Staffing|Services|Group|Company|Co\.?|Inc\.?|LLC|Corp\.?|Corporation|Foods|Manufacturing|Supply|Systems|Solutions|Health|Healthcare|Care|Hospital|Diner|Restaurant|Grill|Market|Freight|Transport|Trucking|Construction|Electric|Plumbing|Industries|Enterprises|Partners|Associates)$/;
const AGENCY_ASIDE = "\u27e8"; // marks a bracketed bare agency, "(OSHA)", as an aside
const AGENCIES = String.raw`OSHA|ANSI|NCCCO|NFPA|DOT|AWS|ASE|NCCER|EPA|MSHA|FAA|FMCSA`;

/** True when a list part carries only a year or a status, so it belongs to the part before it. */
export function isContextPart(part: string): boolean {
  const words = part.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  return words.every((w) => /^\d+$/.test(w) || CONTEXT_WORDS.has(w));
}

/** True when a list part only says where, how or how far: a detail or wording of the part before it. */
function isDetailPart(part: string): boolean {
  if (part.startsWith(AGENCY_ASIDE)) return true;
  if (isCredentialTerm(part)) return false;
  if (DETAIL_PLACE_RE.test(part) || DETAIL_START_RE.test(part) || PROVIDER_RE.test(part) || EMPLOYER_RE.test(part)) return true;
  if (QUALIFIER_PART_RE.test(part)) return true;
  const words = part.toLowerCase().split(/[\s-]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => QUALIFIER_WORDS.has(w));
}

const initials = (s: string) =>
  (s.match(/[A-Za-z][A-Za-z']*/g) ?? [])
    .filter((w) => !/^(?:of|and|the|for|in|a|an)$/i.test(w))
    .map((w) => w[0].toUpperCase())
    .join("");

export interface CredentialPart {
  /** The words on the page that name it, as written ("OSHA 10", "Forklift Certified", "CDL Class A"). */
  part: string;
  /** The part with the year, status or detail parts that follow it ("OSHA 10, 2019"). */
  unit: string;
}

/** Split on "and" only when both sides stand as credentials ("CPR and First Aid"); keep "Inspector and Supervisor Program" whole. */
function splitOnAnd(p: string): string[] {
  const sides = p.split(/\s+and\s+/i);
  if (sides.length < 2) return [p];
  return sides.every((s) => isCredentialTerm(s) && nameWordsOf(s).length > 0) ? sides : [p];
}

/**
 * The credentials in one list line, each with its own year or status. Every
 * part that names a credential is one to ask about; a part that is only a
 * year, a status, a place, a provider or wording goes with the part before
 * it; a class or level ("Class A") and an initialism in brackets ("Certified
 * Nursing Assistant (CNA)") go with the part they belong to.
 */
export function credentialUnitsOf(line: string): CredentialPart[] {
  const marked = line
    .replace(/^\s*[-•*]\s*/, "")
    .replace(new RegExp(String.raw`\(\s*(${AGENCIES})\s*\)`, "g"), `, ${AGENCY_ASIDE}$1`);
  const raw = marked
    .split(PART_SPLIT_RE)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap(splitOnAnd);
  const out: Array<{ part: string; ctx: string[] }> = [];
  for (const p0 of raw) {
    const p = p0;
    const prev = out[out.length - 1];
    if (prev && (isContextPart(p) || isDetailPart(p))) {
      prev.ctx.push(p.startsWith(AGENCY_ASIDE) ? `(${p.slice(1)})` : p);
      continue;
    }
    if (prev && !prev.ctx.length && CLASS_PART_RE.test(p)) {
      prev.part = `${prev.part} ${p}`;
      continue;
    }
    if (prev && !prev.ctx.length && /^[A-Z]{2,6}$/.test(p) && initials(prev.part).includes(p)) continue;
    if (isContextPart(p) || p.startsWith(AGENCY_ASIDE)) continue; // a year with nothing before it names nothing
    out.push({ part: p, ctx: [] });
  }
  return out.map((o) => ({ part: o.part, unit: [o.part, ...o.ctx].join(", ") }));
}

/** The credential parts of a list line (names only). */
export function credentialPartsOf(line: string): string[] {
  return credentialUnitsOf(line).map((u) => u.part);
}

/**
 * A list line without one credential part (and its year or status parts).
 * Returns "" when nothing is left, and the line unchanged when the part is
 * not in it.
 */
export function removeCredentialPart(line: string, part: string): string {
  const want = part.trim().toLowerCase();
  const units = credentialUnitsOf(line);
  const kept = units.filter((u) => u.part.trim().toLowerCase() !== want);
  if (kept.length === units.length) return line;
  return kept.map((u) => u.unit).join(", ");
}

/** A hyphen or dash between two letters, read as a space ("forklift-certified", "CDL-A"); same length, so positions hold. */
export function dehyphenate(text: string): string {
  // Round 10: curly apostrophes read as straight ones ("Driver’s License"), same length.
  return text.replace(/(?<=[A-Za-z])[-\u2010-\u2015](?=[A-Za-z])/g, " ").replace(/[\u2018\u2019\u02bc]/g, "'");
}

function namedIn(text: string): string[] {
  return Array.from(text.matchAll(namedCredentialRe())).map((m) => m[0]);
}

/** The title of a job header ("LINE COOK | Harbor Street Diner | 2019 - 2023" is "LINE COOK"). */
export function titleOfHeader(header: string): string {
  return header.split(/\s*\|\s*|\s+(?:at|@)\s+/i)[0].trim();
}

const isDatedHeader = (l: string) => isEntryHeader(l) && /\b(?:19|20)\d{2}\b|\bpresent\b/i.test(l);

/** Every credential mention on a page, in page order. */
export function credentialMentionsOf(text: string): CredentialMention[] {
  const out: CredentialMention[] = [];
  const ls = linesOf(text || "");
  let section: "credentials" | "skills" | "other" = "other";
  let context = "";
  const push = (
    line: string,
    rawName: string,
    where: CredentialMention["where"],
    term: boolean,
    raw: string,
    unit: string,
    part: string,
    opts: { title?: boolean; anyName?: boolean; education?: boolean } = {}
  ) => {
    const name = cleanName(rawName) || rawName.trim();
    let nameWords = nameWordsOf(name);
    // A credentials line with no name of its own ("Licensed, State Board") is still asked about.
    if (!nameWords.length && opts.anyName) nameWords = [name.toLowerCase()];
    if (!nameWords.length) return;
    const key = credentialKey(name) || name.toLowerCase();
    if (!key || out.some((m) => m.line === line && m.key === key)) return;
    // Round 9: a GED, HSED or high school diploma is education wherever it is ("I earned my G.E.D.").
    const education = opts.education || EDU_NAMED_RE.test(name);
    const onEducationLine = readingEducation && !education;
    out.push({ line, term, name, key, nameWords, where, raw, named: namedIn(name).length > 0, context, unit, part, ...(opts.title ? { title: true } : {}), ...(education ? { education: true } : {}), ...(onEducationLine ? { onEducationLine: true } : {}) });
  };

  let seenHeading = false;
  let inEducation = false;
  let readingEducation = false;
  let combined = false;

  // A credentials-section line: every part of it is a credential to ask about, each on its own.
  const readCredentialsLine = (l: string, body: string) => {
    const units = credentialUnitsOf(l);
    if (units.length >= 2) {
      for (const u of units) push(u.part, u.part, "credentials", true, u.part, u.unit, u.part, { anyName: true });
      return;
    }
    if (units.length === 1) push(l, units[0].part, "credentials", false, body, units[0].unit, units[0].part, { anyName: true });
  };

  // Any other line: every named credential, licensure initial and holding claim in it.
  // Round 7: a hyphen inside a word is read as a space, so "forklift-certified" is "forklift certified".
  // The line itself stays as written; a credential's words are found again across the hyphen when moved or cut.
  const readOtherLine = (l: string, body: string) => {
    const lf = dehyphenate(l);
    const units = credentialUnitsOf(body);
    const lone = units.length === 1 ? units[0] : null;
    const at = (raw: string) => (lone && lone.part.toLowerCase().includes(raw.toLowerCase()) ? lone : { part: body, unit: body });
    // Someone else's credential in a duty line is not a claim: "the RN on duty", "CDL drivers", "supported CNA staff".
    const othersAt = (idx: number, len: number) => isOthersCredential(lf, idx, len);
    for (const m of lf.matchAll(namedCredentialRe())) if (!othersAt(m.index!, m[0].length)) push(l, m[0], "other", false, m[0], at(m[0]).unit, at(m[0]).part);
    for (const m of lf.matchAll(credentialInitialsRe())) if (!othersAt(m.index!, m[0].length)) push(l, m[0], "other", false, m[0], at(m[0]).unit, at(m[0]).part);
    for (const m of lf.matchAll(HOLDING_LIST_RE)) {
      const raw = m[0].trim();
      push(l, raw, "other", false, raw, at(raw).unit, at(raw).part, { anyName: true });
    }
    const claimWordAt = new Set<number>();
    for (const m of lf.matchAll(TRAILING_CLAIM_RE)) {
      // The name is the run of content words right before the claim word.
      const words = m[1].trim().split(/\s+/);
      const name: string[] = [];
      for (let k = words.length - 1; k >= 0; k--) {
        // "Class A Commercial Driver's License": a class letter is part of the name, not the word "a".
        const classLetter = /^[A-D]$/.test(words[k]) && /^class$/i.test(words[k - 1] ?? "");
        if (NAME_STOP.has(words[k].toLowerCase()) && !classLetter) break;
        // A verb before the name ends it ("Stayed forklift-certified", "Became state licensed").
        if (/^(?:[a-z]+ed|became|become|stay|stays|remain|remains|kept|keep|keeps)$/i.test(words[k]) && name.length) break;
        name.unshift(words[k]);
      }
      if (!name.length) continue;
      // "grow qualified pipeline", "well trained": a trained / authorized / qualified claim needs a named thing before it.
      if (/^(?:trained|authori[sz]ed|qualified)$/i.test(m[2]) && !/\b[A-Z]{2,}/.test(name.join(" ")) && !TRAINED_ON_RE.test(name.join(" "))) continue;
      const raw = `${name.join(" ")} ${m[2]}`;
      // "State licensed": a name of only general words is still the claim ("Do you hold State licensed?").
      const generic = !nameWordsOf(name.join(" ")).length;
      if (generic && !/^(?:state|board|nationally|federally)$/i.test(name.join(" "))) continue;
      claimWordAt.add(m.index! + m[0].length - m[2].length);
      push(l, raw, "other", false, raw, at(raw).unit, at(raw).part, { anyName: generic });
    }
    // Round 10 (SF-8): "I finished high school", "graduated high school", "high school grad" claim the diploma.
    for (const m of lf.matchAll(HIGH_SCHOOL_DONE_RE)) push(l, "High school diploma", "other", false, m[0], at(m[0]).unit, at(m[0]).part, { education: true });
    for (const m of lf.matchAll(LEADING_CLAIM_RE)) {
      if (NOT_A_NAME_RE.test(m[2])) continue;
      // "Forklift Certified Line Cook": the claim word already closes "Forklift Certified"; "Line Cook" is the job.
      if (claimWordAt.has(m.index!)) continue;
      push(l, `${m[1]} ${m[2]}`, "other", false, m[0], at(m[0]).unit, at(m[0]).part);
    }
  };

  // An education line: the credential it names (GED, HSED, a diploma, a degree), else its program or school.
  const pushEducation = (l: string, body: string) => {
    const e = educationPartOf(body);
    if (e) push(l, e.name, "credentials", false, e.raw, body, e.raw, { anyName: true, education: true });
  };

  ls.forEach((l, i) => {
    const heading = l.replace(/:$/, "");
    if (EDUCATION_RE.test(heading)) {
      section = "other";
      inEducation = true;
      combined = COMBINED_HEADING_RE.test(heading);
      seenHeading = true;
      return;
    }
    if (CRED_SECTION_RE.test(heading)) inEducation = false;
    else if (SKILLS_RE.test(heading) || isSectionEnd(l)) inEducation = false;
    if (CRED_SECTION_RE.test(heading)) { section = "credentials"; seenHeading = true; return; }
    if (SKILLS_RE.test(heading)) { section = "skills"; seenHeading = true; return; }
    if (isSectionEnd(l)) { section = "other"; seenHeading = true; return; }
    if (i === 0 || CONTACT_LINE_RE.test(l)) return;
    context = l;
    const body = l.replace(/^\s*[-•*]\s*/, "");

    // Round 9: an education line is asked about as education (GED, HSED, a diploma, a degree, or a school
    // or program with a year or a "graduated / completed" status), and never returns early: a holding claim
    // in it ("Toledo Tech | Forklift Certified | 2019") is read by the claim readers like any line.
    readingEducation = inEducation;
    if (inEducation) {
      const before = out.length;
      if (EDUCATION_CORE_RE.test(body)) pushEducation(l, body);
      readOtherLine(l, body);
      if (out.length > before) return;
      // Under "EDUCATION & CERTIFICATIONS", a line that is not schooling is a credentials line ("- Welding, 2019").
      if (combined && !EDUCATION_STATUS_RE.test(body) && !SCHOOL_RE.test(body)) {
        readCredentialsLine(l, body);
        if (out.length > before) return;
      }
      if (isEducationEntry(body)) pushEducation(l, body);
      else if (EDUCATION_CREDENTIAL_RE.test(body)) push(l, body, "credentials", false, body, body, body, { anyName: true });
      return;
    }
    // A dated job header: its title is asked about only when it claims a credential
    // ("CERTIFIED NURSING ASSISTANT", "LICENSED ELECTRICIAN", "JOURNEYMAN ELECTRICIAN").
    if (section === "other" && seenHeading && isDatedHeader(l)) {
      const title = titleOfHeader(l);
      if (title && (isCredentialTerm(title) || TITLE_CREDENTIAL_RE.test(title))) push(l, title, "other", false, title, title, title, { title: true });
      return;
    }

    if (section === "credentials") {
      readCredentialsLine(l, body);
      return;
    }
    if (section === "skills") {
      for (const t of skillTermsOf(l)) {
        if (isCredentialTerm(t)) push(t, namedIn(t)[0] ?? t, "skills", true, t, t, t);
      }
      return;
    }
    readOtherLine(l, body);
  });
  // One credential, one mention: a name inside a longer one on the same line ("ASE" in "ASE Master Technician") is that one.
  return out.filter(
    (m) => !out.some((o) => o !== m && o.line === m.line && o.raw.length > m.raw.length && o.raw.toLowerCase().includes(m.raw.toLowerCase()))
  );
}

/**
 * True when two page keys are one credential to ask about once. Round 6:
 * identical keys only, so "OSHA 10 Trainer", "CDL Class A" and "CPR
 * Instructor" are each asked on their own and never cut unasked.
 */
export function sameCredential(a: string, b: string): boolean {
  return a === b;
}

/**
 * One mention per credential: its home. A credentials-section line first,
 * then a skills term, then the first other line. Each credential is asked
 * about once, by its own name, at its home.
 */
export function credentialHomes(mentions: CredentialMention[]): CredentialMention[] {
  const rank = { credentials: 0, skills: 1, other: 2 } as const;
  const homes: CredentialMention[] = [];
  for (const m of mentions) {
    const at = homes.findIndex((h) => sameCredential(h.key, m.key));
    if (at === -1) homes.push(m);
    else if (rank[m.where] < rank[homes[at].where]) homes[at] = m;
  }
  return homes;
}

// ---- the one exception: a whole line the person wrote -------------------------------

/** Lower case, punctuation as space, single spaces. */
export function normalizeTyped(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();
}

// Words that say the person does not hold it (yet): a line with one never covers a page line.
const NOT_HELD_RE = /\b(?:never|not|no longer|didn['’]?t|did not|don['’]?t|haven['’]?t|have not|hasn['’]?t|failed|fail|retake|retaking|studying|working on|not yet|permit|learner['’]?s?|road test|in progress|enrolled|lapse|pending|waiting|lost|revoked|suspended)\b/i;
// Round 12 (R12-B2): "present", "now", "since", "to date", "ongoing", "still", "today" say it is held now.
const STATUS_TOKEN_RE = /\b(?:active|current|currently|valid|expired|expires|expiring|inactive|lapsed|renewed|suspended|revoked|in good standing|good standing|completed|in progress|enrolled|pending|present|now|since|to date|ongoing|still|today)\b/gi;
const YEAR_TOKEN_RE = /\b(?:19|20)\d{2}\b/g;

interface PersonLine {
  /** The whole line as the person wrote it, normalised. */
  whole: string;
  /** The whole line as written (its status words count for every part of it). */
  text: string;
  notHeld: boolean;
  units: Array<{ part: string; unit: string }>;
}

/**
 * The person's own lines (their uploaded resume), each on its own (round 7:
 * no joining). A line that says they do not hold it covers nothing; a line's
 * status words must all be on the page.
 */
export function personCredentialLines(personText: string | undefined): PersonLine[] {
  // Round 8: a dated job header ("CNA | Meadowbrook | 2014 - 2017") is a job, never a credential line of theirs.
  const headers = personJobHeaderLines(personText);
  const lines = (personText || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !headers.has(l));
  return lines.map((l) => {
    const body = l.replace(/^\s*[-•*]\s*/, "");
    // On the person's side, a part that names no credential stays with the part before it ("CDL; failed the road test twice").
    const units: Array<{ part: string; unit: string }> = [];
    for (const u of credentialUnitsOf(body)) {
      const prev = units[units.length - 1];
      if (prev && !isCredentialTerm(u.part)) prev.unit = `${prev.unit}, ${u.unit}`;
      else units.push({ part: u.part, unit: u.unit });
    }
    return { whole: normalizeTyped(body), text: body, notHeld: NOT_HELD_RE.test(body), units };
  });
}

// ---- structured credentials (round 7) -----------------------------------------------

/** The kinds a credential can be, as the person picks them (the same as the confirmation box). */
export const CREDENTIAL_KINDS = ["license", "certification", "card", "training course", "permit"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** One credential the person entered in the Forge's training step: its name, kind and year or status. */
export interface CredentialRow {
  name: string;
  kind: CredentialKind;
  when: string;
}

// The writer's type and status words never survive into a line written from
// the person's answer: the line is the name they gave, the kind they picked,
// and their own year or status. A title word that is part of the credential's
// own name stays ("Registered Nurse", "Licensed Practical Nurse", "Certified
// Nursing Assistant"), and so does a class letter ("CDL Class A").
const CLAIM_WORDS_RE =
  /\b(?:certified(?!\s+(?:nursing|medical|pharmacy|welding|public|home|nurse|professional|clinical)\b)|certification|certifications|certificate|cert|licensed(?!\s+(?:practical|vocational|professional|clinical)\b)|license|licence|card|cards|training|trained|authori[sz]ed|qualified|course|program|endorsement|permit|registry|registered(?!\s+[A-Za-z])|holder|class(?![\s-]*[a-d0-9]\b))\b/gi;
const NAME_STATUS_RE =
  /\b(?:current|currently|active|valid|expired|expires|expiring|inactive|lapsed|in progress|enrolled|completed|finished|passed|renewed|suspended|revoked|in good standing|up to date|good for|through|until|since)\b|\b(?:19|20)\d{2}\b/gi;

/** A credential's name without the writer's type or status words ("Forklift Certified" is "Forklift"). */
export function bareCredentialName(name: string): string {
  return (
    name
      .replace(CLAIM_WORDS_RE, " ")
      .replace(NAME_STATUS_RE, " ")
      .replace(/[()]/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[,\s-]+|[,\s-]+$/g, "")
      .trim() || name.trim()
  );
}

/** The line a credential is written as from the person's own answer: the name, the kind they picked, and their own year or status. */
export function credentialLineText(name: string, kind: string, when: string): string {
  return `${bareCredentialName(name)} ${kind}, ${when.trim().replace(/[.\s]+$/, "")}`;
}

// Round 8: a row's name is the person's, exactly as typed. A status, a "not held" word or a year belongs
// in the status box, so a name holding one is refused at entry (and is never a complete row).
const ROW_NAME_STATUS_RE =
  /\b(?:current|currently|active|valid|expired|expires|expiring|inactive|lapsed|lapse|suspended|revoked|in progress|enrolled|pending|renewed|never|not|failed|retake|studying|working on|no longer|lost|denied)\b|\b(?:19|20)\d{2}\b/i;
const ROW_TYPE_WORD_RE = /\b(?:license|licence|licensed|certification|certificate|certified|card|permit|course|training|endorsement)\b/i;
const PERMIT_WORD_RE = /\b(?:permit|learner'?s?|instruction)\b/i;

// The kind a type word in the name says ("CDL license" is a license).
const NAME_KIND: Array<[RegExp, string]> = [
  [/\b(?:permit|learner'?s?)\b/i, "permit"],
  [/\b(?:license|licence|licensed)\b/i, "license"],
  [/\b(?:certification|certificate|certified)\b/i, "certification"],
  [/\bcard\b/i, "card"],
  // Round 12 (SF-9): "CDL Class B" is the license's own class, not a course.
  [/\b(?:course|training)\b|\bclass\b(?![\s-]*[a-d]\b)/i, "training course"],
];

/**
 * What a row's name box needs: "" when it is fine; "status" when it holds a
 * status or a year; "permit" when it names a permit and the kind is not
 * Permit; "kind" when it names another kind than the one picked ("CDL
 * license" picked as a card).
 */
export function credentialRowNameProblem(name: string, kind?: string): "" | "status" | "permit" | "kind" {
  if (ROW_NAME_STATUS_RE.test(name)) return "status";
  if (PERMIT_WORD_RE.test(name) && kind && kind !== "permit") return "permit";
  const said = NAME_KIND.find(([re]) => re.test(name))?.[1];
  if (said && kind && said !== kind) return "kind";
  return "";
}

/** True when a structured row is complete: a name with no status in it, one of the kinds, and a year or status the strict parser takes. */
export function isCompleteCredentialRow(r: Partial<CredentialRow> | null | undefined): r is CredentialRow {
  return (
    !!r &&
    typeof r.name === "string" &&
    !!r.name.trim() &&
    (CREDENTIAL_KINDS as readonly string[]).includes(r.kind as string) &&
    !credentialRowNameProblem(r.name, r.kind) &&
    typeof r.when === "string" &&
    isStrictCredentialWhen(r.when)
  );
}

/**
 * A row as one line, the name exactly as the person typed it (round 8): "CDL
 * permit, 2024" stays a permit. The kind is added only when the name holds
 * no type word of its own ("Forklift" and certification: "Forklift
 * certification, 2020").
 */
export function credentialRowText(r: Pick<CredentialRow, "name" | "kind" | "when">): string {
  const name = r.name.trim();
  const when = r.when.trim().replace(/[.\s]+$/, "");
  return ROW_TYPE_WORD_RE.test(name) ? `${name}, ${when}` : `${name} ${r.kind}, ${when}`;
}

/** True when the page shows this credential exactly as one of the person's structured rows: that name, that kind, that year or status. */
export function mentionMatchesRow(m: CredentialMention, rows: ReadonlyArray<CredentialRow> | undefined): boolean {
  if (!rows?.length || m.title) return false;
  const shown = [normalizeTyped(m.unit), normalizeTyped(m.context.replace(/^\s*[-•*]\s*/, ""))];
  if (rows.some((r) => isCompleteCredentialRow(r) && shown.includes(normalizeTyped(credentialRowText(r))))) return true;
  // Round 11 (SF-9): a credentials line that differs from the row only trivially is the row: the same family
  // of name, no kind but the row's, and no year or status but the row's ("Forklift Operator Certification,
  // 2023" for "Forklift, certification, 2023"; "ServSafe Food Handler, 2021" for its card row).
  if (m.where !== "credentials") return false;
  const unitKind = NAME_KIND.find(([re]) => re.test(m.unit))?.[1];
  // Round 12 (R12-B2): a range ("2020 - Present") is never a trivial difference.
  const range = m.unit.match(/\b(?:19|20)\d{2}\s*(?:[-\u2013\u2014]|\bto\b)\s*(?:(?:19|20)\d{2}|present|now|current|today)\b/i)?.[0];
  return rows.some(
    (r) =>
      isCompleteCredentialRow(r) &&
      (!range || normalizeTyped(r.when) === normalizeTyped(range)) &&
      !DEAD_WHEN_RE.test(r.when) &&
      r.kind !== "permit" &&
      credentialFamilyKey(r.name) === credentialFamilyKey(m.name) &&
      (!unitKind || unitKind === r.kind) &&
      Array.from(statusSet(m.unit)).every((x) => statusSet(r.when).has(x)) &&
      Array.from(yearsOf(m.unit)).every((y) => yearsOf(r.when).has(y)) &&
      !BIGGER_CREDENTIAL_RE.test(m.unit)
  );
}

// Long names and their short forms, only to tell that two names are one credential family.
const FAMILY_NAMES: Array<[RegExp, string]> = [
  [/\bcommercial\s+driver'?s?\b(?:\s+licen[cs]e)?/gi, "cdl"],
  [/\b(?:certified\s+)?nursing\s+assistant\b/gi, "cna"],
  [/\bstate\s+tested\s+nurs(?:e|ing)\s+(?:aide|assistant)\b/gi, "stna"],
  [/\blicensed\s+practical\s+nurse\b/gi, "lpn"],
  [/\bemergency\s+medical\s+technician\b/gi, "emt"],
  [/\bbasic\s+life\s+support\b/gi, "bls"],
  [/\bcardiopulmonary\s+resuscitation\b/gi, "cpr"],
  [/\b(\d+)[\s-]*hour\b/gi, "$1"],
];
/** A credential name's family key: the page key after long names become their short forms ("Certified Nursing Assistant" is "cna"). */
export function credentialFamilyKey(name: string): string {
  return credentialKey(FAMILY_NAMES.reduce((t, [re, to]) => t.replace(re, to), name));
}

// A row's status that says the person does not hold it now.
const DEAD_WHEN_RE = /\b(?:expired|lapsed|suspended|revoked|inactive|in progress|enrolled)\b/i;

/** The keys of credentials the person's rows mark expired, lapsed, suspended or not yet held. */
function deadRowKeys(rows: ReadonlyArray<CredentialRow> | undefined): Set<string> {
  return new Set((rows ?? []).filter((r) => r.kind === "permit" || r.kind === "training course" || DEAD_WHEN_RE.test(r.when)).map((r) => credentialFamilyKey(r.name)));
}

// ---- round 9: a live credential covers its plain mentions in sentences --------------------

// A status that says the person holds it now.
const LIVE_WHEN_RE = /\b(?:current|currently|active|valid|in good standing|good standing)\b/i;

/** True when a kind and a year-or-status say the person holds it now: current, active or valid, and not a permit or a course. */
export function isLiveCredential(kind: string, when: string, yearOnly = false): boolean {
  // Round 10 (open question 2): for a structured row, a year-only answer ("certification, 2019") counts too;
  // liveCredentialCovers then takes only a mention that shows that same year, or no status and no year at all.
  const dated = yearOnly && /\b(?:19|20)\d{2}\b/.test(when) && !/[a-z]/i.test(when.replace(/\b(?:in|since|earned|got|passed)\b/gi, ""));
  return kind !== "permit" && kind !== "training course" && (LIVE_WHEN_RE.test(when) || dated) && !DEAD_WHEN_RE.test(when);
}

const SHOWN_KIND_WORDS_RE = /^(?:\s*[-\u2010-\u2015]?\s*(?:certification|certificate|certified|cert|card|license|licence|licensed|permit|endorsement|registry|course|training|program|holder|status)\b)+/i;
const SHOWN_STATUS_AFTER_RE =
  /^\s*(?:[-\u2013\u2014]\s*(?:present|now|current|today|to\s+date)\b|\([^)]{0,20}\)|,?\s*(?:(?:that\s+is|which\s+is|is|and\s+is|currently)\s+)?(?:active|current|currently|valid|expired|expires|expiring|inactive|lapsed|renewed|suspended|revoked|pending|in\s+progress|in\s+good\s+standing|up\s+to\s+date|present|now|ongoing|still|to\s+date)\b|,?\s*(?:since|from|in|through|until|exp\.?|expires?|issued|earned|obtained|valid\s+through|current\s+through)?\s*(?:19|20)\d{2}\b)/i;
const SHOWN_STATUS_BEFORE_RE =
  /\b(?:active|current|currently|valid|expired|inactive|lapsed|suspended|revoked|pending|former|formerly|ex|retired|previous|previously|past|once|future|aspiring|prospective|student|trainee|in-training|soon-to-be)[\s-]+(?:(?:a|an|the|state|registered)\s+)?$/i;

/**
 * What the page shows right at a mention: a kind word in or after its name
 * ("CNA certification", "Certified nursing assistant"), and a status or year
 * attached to it ("CNA (current)", "CNA, expired", "former CNA"). A year or
 * place that belongs to the sentence ("at Meadowbrook since 2016") is not the
 * credential's.
 */
function shownAt(m: CredentialMention): { kind?: string; statuses: Set<string>; years: Set<string>; dead: boolean } {
  const line = dehyphenate(m.context);
  const raw = dehyphenate(m.raw || m.name);
  const at = line.toLowerCase().indexOf(raw.toLowerCase());
  const before = at >= 0 ? line.slice(0, at) : "";
  let after = at >= 0 ? line.slice(at + raw.length) : "";
  const kindAfter = after.match(SHOWN_KIND_WORDS_RE)?.[0] ?? "";
  after = after.slice(kindAfter.length);
  let statusText = "";
  for (let k = 0, m2 = after.match(SHOWN_STATUS_AFTER_RE); m2 && k < 3; k++, m2 = after.match(SHOWN_STATUS_AFTER_RE)) {
    statusText += ` ${m2[0]}`;
    after = after.slice(m2[0].length);
  }
  const statusBefore = before.match(SHOWN_STATUS_BEFORE_RE)?.[0] ?? "";
  const kind = NAME_KIND.find(([re]) => re.test(`${raw} ${kindAfter}`))?.[1];
  const words = `${statusBefore} ${statusText}`;
  return {
    kind,
    statuses: new Set((words.toLowerCase().match(STATUS_TOKEN_RE) ?? []).map((w) => w.replace(/^good standing$/, "in good standing"))),
    years: new Set(words.match(YEAR_TOKEN_RE) ?? []),
    dead: !!statusBefore && !/^(?:active|current|currently|valid)\b/i.test(statusBefore.trim()),
  };
}

/**
 * Round 9 (r9-S2): a live credential of the person's (a complete row, or a
 * confirmation, that says current, active or valid, and is not a permit or a
 * course) covers a plain mention of it in a sentence (the summary, a bullet,
 * the letter: "Certified nursing assistant with eight years", "I have worked
 * as a certified nursing assistant at Meadowbrook") when the page shows
 * exactly its kind and status, or none. The same family of name only
 * ("Certified Nursing Assistant" is "CNA"). Never a title, a list term, a
 * credentials or education line; never an expired, lapsed or permit row.
 */
export function liveCredentialCovers(m: CredentialMention, held: { name: string; kind: string; when: string }, opts: { yearOnly?: boolean } = {}): boolean {
  if (m.where !== "other" || m.title || m.term || m.education) return false;
  if (!isLiveCredential(held.kind, held.when, !!opts.yearOnly)) return false;
  // The same family, or a mention that names less of it ("AWS-certified" for the AWS D1.1 row).
  const heldKey = credentialFamilyKey(held.name).split(" ").filter(Boolean);
  const mentionKey = credentialFamilyKey(m.name).split(" ").filter(Boolean);
  if (!mentionKey.length || !mentionKey.every((w) => heldKey.includes(w))) return false;
  // Round 11 (SF-1): a role or level word in or right after the mention names a bigger credential
  // ("CPR instructor", "OSHA authorized trainer", "Certified Welding Inspector"): never covered by the smaller row.
  if (BIGGER_CREDENTIAL_RE.test(m.name) && !BIGGER_CREDENTIAL_RE.test(held.name)) return false;
  if (BIGGER_CREDENTIAL_RE.test(wordsAfterMention(m, 4))) return false;
  // Round 12: "Trainer, OSHA 10" names the bigger credential before it; a CDL endorsement is its own credential.
  if (BIGGER_CREDENTIAL_RE.test(wordsBeforeMention(m, 2)) && !BIGGER_CREDENTIAL_RE.test(held.name)) return false;
  if (CDL_ENDORSEMENT_RE.test(`${m.name} ${wordsAfterMention(m, 6)}`) && !CDL_ENDORSEMENT_RE.test(held.name)) return false;
  const shown = shownAt(m);
  // Round 11 (N1): a year-only row says when it was earned, not that it is held now. It covers only a
  // mention that shows that same year, or a bare name in a history sentence ("I passed my AWS D1.1 test").
  // Round 12 (N1 note): OSHA 10 and OSHA 30 outreach cards never expire. For these two only, the same card
  // (never 10 for 30, never a trainer, authorized or outreach trainer) counts as held now.
  const neverExpires =
    /^(?:10 osha|30 osha)$/.test(credentialFamilyKey(held.name)) &&
    credentialFamilyKey(m.name) === credentialFamilyKey(held.name) &&
    !/\b(?:trainer|authori[sz]ed|outreach|instructor|500|501)\b/i.test(`${m.name} ${wordsAfterMention(m, 3)}`) &&
    !DEAD_WHEN_RE.test(held.when);
  if (!LIVE_WHEN_RE.test(held.when) && !neverExpires) {
    const heldYears0 = yearsOf(held.when);
    const sameYear = shown.years.size > 0 && Array.from(shown.years).every((y) => heldYears0.has(y));
    // "OSHA 10 trained" says the training was done (history), not that a card is held now.
    const history = HISTORY_BEFORE_RE.test(wordsBeforeMention(m, 5)) || /\btrained\b/i.test(`${m.raw} ${wordsAfterMention(m, 1)}`);
    if (!sameYear && (HOLDING_WORD_RE.test(`${m.name} ${m.raw}`) || HOLDING_BEFORE_RE.test(wordsBeforeMention(m, 3)) || HOLDING_AFTER_RE.test(wordsAfterMention(m, 2)) || !history)) return false;
  }
  if (shown.dead) return false;
  if (shown.kind && shown.kind !== held.kind) return false;
  const heldStatuses = statusSet(held.when);
  if (neverExpires) heldStatuses.add("current");
  if (Array.from(shown.statuses).some((s) => !heldStatuses.has(s))) return false;
  const heldYears = yearsOf(held.when);
  if (Array.from(shown.years).some((y) => !heldYears.has(y))) return false;
  return true;
}

// Round 11: words that make a credential a bigger one than its name alone.
const BIGGER_CREDENTIAL_RE = /\b(?:trainer|trainers|instructor|instructors|inspector|inspectors|evaluator|evaluators|assessor|assessors|examiner|examiners|proctor|proctors|outreach|master|lead|supervisor|supervisors|manager|managers|authori[sz]ed|ii|iii|iv|level\s+\d+)\b/i;
const CDL_ENDORSEMENT_RE = /\b(?:hazmat|tanker|doubles|triples|passenger|school\s+bus|endorsements?)\b/i;
// Present-tense holding words: a status, which a year alone never shows (round 11, N1).
const HOLDING_WORD_RE = /\b(?:certified|licensed|registered|credentialed|accredited)\b/i;
const HOLDING_BEFORE_RE = /\b(?:with|holding|holds|hold|have|has|carry|carries|current|valid|active)\s+(?:(?:a|an|my|the|his|her)\s+)?$/i;
const HOLDING_AFTER_RE = /^\s*(?:card\s+)?(?:holder|certified|licensed)\b/i;
const HISTORY_BEFORE_RE = /\b(?:earned|passed|completed|got|received|took|finished|obtained|did|took)\b/i;

function mentionAt(m: CredentialMention): number {
  return dehyphenate(m.context).toLowerCase().indexOf(dehyphenate(m.raw || m.name).toLowerCase());
}
function wordsAfterMention(m: CredentialMention, n: number): string {
  const at = mentionAt(m);
  if (at < 0) return "";
  const after = dehyphenate(m.context).slice(at + (m.raw || m.name).length);
  return (after.match(/^[^.;!?|]*/)?.[0] ?? "").trim().split(/\s+/).slice(0, n).join(" ");
}
function wordsBeforeMention(m: CredentialMention, n: number): string {
  const at = mentionAt(m);
  if (at < 0) return "";
  const before = dehyphenate(m.context).slice(0, at);
  const clause = before.split(/[.;!?|]/).pop() ?? "";
  const words = clause.trim().split(/\s+/).filter(Boolean);
  return words.slice(-n).join(" ") + (words.length ? " " : "");
}

/**
 * Round 9: an education line is theirs when every part of it is a part of
 * one line they wrote ("High School Diploma | Lincoln High School | 2022"
 * covers "Lincoln High School | 2022"). A line of theirs that says they do
 * not hold it covers nothing.
 */
function educationIsTheirs(m: CredentialMention, person: PersonLine[]): boolean {
  if (!m.education || m.where !== "credentials") return false;
  // Round 10: a city or state the writer added ("GED | Toledo, OH | 2014" for their "GED, 2014") claims nothing.
  const partsOf = (t: string) => {
    const parts = partsOfEducationLine(t);
    return new Set(parts.filter((_, i) => !isPlacePart(parts, i)).map(normalizeTyped).filter(Boolean));
  };
  const page = partsOf(m.context);
  if (!page.size) return false;
  return person.some((p) => {
    if (p.notHeld) return false;
    const theirs = partsOf(p.text);
    return Array.from(page).every((x) => theirs.has(x));
  });
}

/** Kept for older callers: the person's lines, whole and normalised. */
export function typedCredentialEntries(answer: string | undefined): Set<string> {
  return new Set(personCredentialLines(answer).map((p) => p.whole));
}

const statusSet = (s: string) =>
  new Set(
    (s.toLowerCase().match(STATUS_TOKEN_RE) ?? []).map((w) =>
      w.replace(/^good standing$/, "in good standing").replace(/^(?:currently|present|now|since|to date|ongoing|still|today)$/, "current")
    )
  );
const yearsOf = (s: string) => new Set(s.match(YEAR_TOKEN_RE) ?? []);
const wordsOf = (s: string) => new Set(normalizeTyped(s).split(" ").filter(Boolean));
const setEq = (a: Set<string>, b: Set<string>) => a.size === b.size && Array.from(a).every((x) => b.has(x));

/**
 * True when this mention is a whole line the person wrote: the page line, or
 * the page's part of a list line, equals a whole line of theirs; or its part
 * names exactly what one of their parts names, with the same status words,
 * no year they did not give, and no word they did not write. A line of theirs
 * that says they do not hold it never covers anything.
 */
export function mentionIsTheirs(m: CredentialMention, person: PersonLine[]): boolean {
  if (!person.length || m.title) return false;
  const lineBody = normalizeTyped(m.context.replace(/^\s*[-•*]\s*/, ""));
  const unit = normalizeTyped(m.unit);
  const part = normalizeTyped(m.part);
  for (const p of person) {
    if (p.notHeld) continue;
    if (p.whole === lineBody || p.whole === unit) return true;
    for (const u of p.units) {
      if (normalizeTyped(u.part) !== part) continue;
      // Every status word on their whole line must be on the page, and no other.
      if (!setEq(statusSet(m.unit), statusSet(p.text))) continue;
      const theirYears = yearsOf(u.unit);
      if (Array.from(yearsOf(m.unit)).some((y) => !theirYears.has(y))) continue;
      const theirWords = wordsOf(u.unit);
      if (Array.from(wordsOf(m.unit)).some((w) => !theirWords.has(w))) continue;
      return true;
    }
  }
  return false;
}

/** Kept for older callers: the round 6 whole-line rule against the person's lines. */
export function mentionTypedExactly(m: CredentialMention, entries: Set<string> | string): boolean {
  const person = typeof entries === "string" ? personCredentialLines(entries) : personCredentialLines(Array.from(entries).join("\n"));
  return mentionIsTheirs(m, person);
}

// ---- job titles: the whole title, as the person wrote it -----------------------------

const NEGATED_RE = /\b(?:never|not|no|didn['’]?t|did not|wasn['’]?t|was not|isn['’]?t|aren['’]?t)\b/i;

/** The job titles in the person's own job header lines only ("Line Cook | Harbor Street Diner | 2019 - 2023", "Line cook, Harbor Street Diner, 2019-2023"). */
export function personHeaderTitles(personText: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const l of personJobHeaderLines(personText)) {
    const body = l.replace(/^\s*[-•*]\s*/, "");
    out.add(normalizeTyped(body.includes("|") ? titleOfHeader(body) : body.split(",")[0]));
  }
  out.delete("");
  return out;
}

/**
 * The person's own job header lines: under a work heading, or before any
 * heading. A credentials, skills or education line ("Forklift Certification |
 * 2019 - 2021") is never a job header. Title, employer and dates: three parts
 * (two under a work heading).
 */
// The last part of a "Title, Employer, 2019-2023" line: a year or a range of years.
const YEARS_PART_RE = /^\s*(?:19|20)\d{2}(?:\s*[-\u2013]\s*(?:(?:19|20)\d{2}|present))?\s*$/i;

export function personJobHeaderLines(personText: string | undefined): Set<string> {
  const out = new Set<string>();
  let section: "none" | "work" | "other" = "none";
  for (const line of (personText || "").split("\n")) {
    const raw = line.trim();
    if (/^[A-Z][A-Z &/]{3,}:?$/.test(raw) || CRED_SECTION_RE.test(raw.replace(/:$/, "")) || SKILLS_RE.test(raw.replace(/:$/, "")) || EDUCATION_RE.test(raw.replace(/:$/, ""))) {
      section = /\b(?:EXPERIENCE|WORK|EMPLOYMENT|HISTORY|JOBS)\b/i.test(raw) ? "work" : "other";
      continue;
    }
    if (section === "other" || !raw) continue;
    const l = raw.replace(/^\s*[-•*]\s*/, "");
    const need = section === "work" ? 2 : 3;
    if (l.includes("|") && l.split("|").length >= need && /\b(?:19|20)\d{2}\b|\bpresent\b/i.test(l)) out.add(raw);
    else if (l.split(",").length >= 3 && YEARS_PART_RE.test(l.split(",").pop() as string)) out.add(raw);
  }
  return out;
}

/** The job titles in the person's own words: the title of each of their job headers, and "X at Y" / "worked as X" in their sentences. */
export function personJobTitles(personText: string | undefined): Set<string> {
  const out = new Set<string>();
  const add = (t: string) => {
    const n = normalizeTyped(t.replace(/^(?:an?|the)\s+/i, ""));
    if (n) out.add(n);
  };
  for (const line of (personText || "").split("\n")) {
    const l = line.trim().replace(/^\s*[-•*]\s*/, "");
    if (!l) continue;
    if (l.includes("|")) add(titleOfHeader(l));
    else if (l.split(",").length >= 3 && YEARS_PART_RE.test(l.split(",").pop() as string)) add(l.split(",")[0]);
    for (const s of l.split(/(?<=[.!?;])\s+/)) {
      if (NEGATED_RE.test(s)) continue;
      const lead = s.match(/^([A-Za-z][A-Za-z'&/ -]{1,40}?)\s+(?:at|for|with)\s+[A-Z0-9]/);
      if (lead) add(lead[1]);
      for (const m of s.matchAll(/\b(?:worked|work|working|was|served|hired|employed|started)\s+as\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z'&/ -]{1,40}?)(?=\s+(?:at|for|with|in|from|on|until|since|and)\b|[.,;]|$)/gi)) add(m[1]);
      for (const m of s.matchAll(/\bI\s+(?:was|am)\s+(?:an?|the)\s+([A-Za-z][A-Za-z'&/ -]{1,40}?)(?=\s+(?:at|for|with|in|from)\b)/gi)) add(m[1]);
      // "hired on as a picker", "my job there was warehouse associate", "worked at Midwest ... as a warehouse associate".
      for (const m of s.matchAll(/\bhired\s+on\s+as\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z'&/ -]{1,40}?)(?=\s+(?:at|for|with|in|from|on|until|since|and)\b|[.,;]|$)/gi)) add(m[1]);
      for (const m of s.matchAll(/\bmy\s+(?:job|title|position|role)\b[^.;]*?\b(?:was|is)\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z'&/ -]{1,40}?)(?=\s+(?:at|for|with|in|from|on|until|since|and)\b|[.,;]|$)/gi)) add(m[1]);
      // "Warehouse associate, Midwest Distribution, 2019-2023."
      if (s.split(",").length >= 3 && YEARS_PART_RE.test((s.split(",").pop() as string).replace(/[.]$/, "")) && s.split(",")[0].split(/\s+/).length <= 4) add(s.split(",")[0]);
      if (/\b(?:worked|employed|hired|job)\b/i.test(s)) {
        for (const m of s.matchAll(/\bas\s+(?:an?|the)\s+([A-Za-z][A-Za-z'&/ -]{1,40}?)(?=\s+(?:at|for|with|in|from|on|until|since|and)\b|[.,;]|$)/gi)) add(m[1]);
      }
    }
  }
  return out;
}

/** True when the whole title is one of the person's own job titles. */
export function titleIsTheirs(title: string, personText: string | undefined): boolean {
  const n = normalizeTyped(title);
  if (!n) return false;
  const titles = personJobTitles(personText);
  if (titles.has(n)) return true;
  // Round 13 (SF-9): their short form ("Customer Service Rep", "Asst Mgr") is the same title.
  const t = titleWords(title).join(" ");
  return Array.from(titles).some((x) => titleWords(x).join(" ") === t);
}

// ---- the backstop: capitals nobody gave us -------------------------------------------

const CAPS_TOKEN_RE = /\b(?:[A-Z]{2,6}|[A-Z]+\d+[A-Z\d]*|\d+[A-Z]+[A-Z\d]*)\b/g;

/**
 * Mentions for every all-caps token (2 to 6 letters, or letters with digits)
 * on a line that is not the person's own words and is not in their text at
 * all: "Do you hold QMA?". Headings, the name line, contact lines, job
 * headers and lines in capitals are skipped.
 */
export function backstopMentionsOf(text: string, personText: string | undefined): CredentialMention[] {
  const person = (personText || "").toLowerCase();
  const known = credentialMentionsOf(text);
  const out: CredentialMention[] = [];
  let section: CredentialMention["where"] = "other";
  linesOf(text || "").forEach((l, i) => {
    if (CRED_SECTION_RE.test(l.replace(/:$/, ""))) { section = "credentials"; return; }
    if (SKILLS_RE.test(l.replace(/:$/, ""))) { section = "skills"; return; }
    if (isSectionEnd(l)) { section = "other"; return; }
    // A pipe line in a skills or credentials list is a list, not a job header.
    if (i === 0 || CONTACT_LINE_RE.test(l) || (section === "other" && isEntryHeader(l)) || !/[a-z]/.test(l)) return;
    const body = l.replace(/^\s*[-•*]\s*/, "");
    const terms = section === "other" ? [] : skillTermsOf(l);
    for (const m of l.matchAll(CAPS_TOKEN_RE)) {
      const tok = m[0];
      // Round 8: a work word next to a holding or training word is a claim ("OSHA trained", "RF certified").
      // Round 9: AED and ESL only with a holding word ("AED certified"), not a training word ("AED in training drills").
      const claimNear = (needsHoldingWord(tok) ? HOLDING_CONTEXT_RE : CLAIM_CONTEXT_RE).test(nearWords(l, m.index!, tok.length));
      if (isWorkAcronym(tok) && !claimNear) continue;
      // "in compliance with OSHA standards", "OSHA Safety Standards", "followed HACCP rules": the rules, not a card.
      if (RULES_AFTER_RE.test(afterWords(l, m.index!, tok.length)) && !CLAIM_CONTEXT_RE.test(nearWords(l, m.index!, tok.length))) continue;
      // "Boston, MA": a state after a city.
      if (/^(?:MA|PA)$/.test(tok) && /[A-Z][a-z]+,\s*$/.test(l.slice(0, m.index))) continue;
      // Someone else's ("the RN on duty", "CDL drivers") is not asked about.
      if (isOthersCredential(l, m.index!, tok.length)) continue;
      // A bracketed agency after a name ("Certified Forklift Operator (OSHA)") is wording about it.
      if (new RegExp(`^(?:${AGENCIES})$`).test(tok) && l[m.index! - 1] === "(" && l[m.index! + tok.length] === ")") continue;
      if (new RegExp(`\\b${tok.toLowerCase()}\\b`).test(person)) continue;
      if (known.some((k) => k.context === l && new RegExp(`\\b${tok}\\b`).test(k.raw))) continue;
      // In a list, the token's own item ("QMA Training") is what is asked about and cut, never the whole line.
      const asTerm = terms.find((t) => new RegExp(`\\b${tok}\\b`).test(t));
      const key = credentialKey(tok);
      if (out.some((o) => o.key === key && o.context === l)) continue;
      out.push({ line: asTerm ?? l, term: !!asTerm, name: tok, key, nameWords: [tok.toLowerCase()], raw: tok, named: false, where: section, context: l, unit: asTerm ?? body, part: asTerm ?? body });
    }
  });
  return out;
}

const CLAIM_CONTEXT_RE = /\b(?:trained|training|certified|certification|certificate|authori[sz]ed|qualified|card|course|class|license|licensed|completed)\b/i;
const HOLDING_CONTEXT_RE = /\b(?:certified|certification|certificate|authori[sz]ed|qualified|card|license|licensed)\b/i;
const RULES_AFTER_RE = /\b(?:guidelines?|standards?|rules?|regulations?|requirements?|procedures?|compliance|protocols?|practices?|policies|policy|codes?|logs?|checklists?)\b/i;
/** The three words after a token (round 9: "HACCP food safety rules" reads the rules word). */
function afterWords(l: string, index: number, length: number): string {
  return (l.slice(index + length).match(/[A-Za-z'-]+/g) ?? []).slice(0, 3).join(" ");
}

/** The two words on each side of a token. */
function nearWords(l: string, index: number, length: number): string {
  const before = (l.slice(0, index).match(/[A-Za-z'-]+/g) ?? []).slice(-2).join(" ");
  const after = (l.slice(index + length).match(/[A-Za-z'-]+/g) ?? []).slice(0, 2).join(" ");
  return dehyphenate(`${before} ${after}`);
}

/** The mentions of one name on a page, by the name itself (for a credential the backstop found). */
export function mentionsOfName(text: string, name: string): CredentialMention[] {
  return backstopMentionsOf(text, "").filter((m) => m.name === name);
}

/**
 * The credentials a page must ask about (decision D4): one per key, at the
 * best home among its mentions that are not the person's own whole lines.
 * A credential in a job title is skipped only when the whole title is one of
 * the person's own job titles. Every all-caps token nobody gave us is asked
 * too (the backstop).
 */
export function credentialsToAsk(
  text: string,
  personText?: string,
  skipKeys: Set<string> = new Set(),
  rows?: ReadonlyArray<CredentialRow>,
  backstopText?: string
): CredentialMention[] {
  const person = personCredentialLines(personText);
  const all = [...credentialMentionsOf(text), ...backstopMentionsOf(text, backstopText ?? personText)];
  const skip = Array.from(skipKeys);
  const headerTitles = personHeaderTitles(personText);
  const dead = deadRowKeys(rows);
  const ask = all.filter((m) => {
    if (skip.some((k) => sameCredential(k, m.key))) return false;
    // An exact structured row is the person's own line, status and all.
    if (mentionMatchesRow(m, rows)) return false;
    // Round 8: a credential their row marks expired, lapsed, suspended or not yet held is covered by nothing else.
    if (dead.has(m.key) || dead.has(credentialFamilyKey(m.name))) return true;
    // Round 9: a current row covers its plain mentions in sentences ("Certified nursing assistant with eight years").
    if (rows?.some((r) => isCompleteCredentialRow(r) && liveCredentialCovers(m, r, { yearOnly: true }))) return false;
    // Round 9: an education line made only of parts of one line they wrote.
    if (educationIsTheirs(m, person)) return false;
    // A job title covers the title itself only: when the whole title is in one of their own job header lines.
    if (m.title) return !headerTitles.has(normalizeTyped(m.raw));
    return !mentionIsTheirs(m, person);
  });
  return credentialHomes(ask);
}

export type CredentialIssue = "unsaid";

export interface CredentialCheck {
  mention: CredentialMention;
  issue: CredentialIssue;
}

/**
 * Kept for older callers. Round 5: the person's free text is never read, so
 * every credential to ask about is "unsaid" (a memory prompt) and `src` is
 * not used.
 */
export function checkCredentials(text: string, _src?: string, skipKeys: Set<string> = new Set()): CredentialCheck[] {
  return credentialsToAsk(text, undefined, skipKeys).map((mention) => ({ mention, issue: "unsaid" as const }));
}

/**
 * Credentials, one at a time, wherever they sit on a page.
 *
 * A credential is found by its known name ("ServSafe", "CNA", "OSHA 10",
 * "AWS D1.1") or by a holding claim ("Forklift Certified", "certified in
 * CPR", "licensed electrician"), on any line: a credentials section line, one
 * term of a skills line, or inside a long sentence. Each credential is then
 * checked by its own name, never by the first word of the line it sits on.
 *
 * Pure. Used by the draft/finished status (resumeStatus) and the finish gate
 * (the cover letter).
 */

import {
  linesOf,
  isSectionEnd,
  skillTermsOf,
  CONTACT_LINE_RE,
  STATUS_WORD_RE,
} from "./resumeMintCheckShared";
import { stemOf } from "./wordStem";

export interface CredentialMention {
  /** The page line it is on, or the skills term when it is one term of a skills line. */
  line: string;
  /** True when `line` is one term of a skills line, not a whole page line. */
  term: boolean;
  /** The credential as written ("Forklift Certified", "CPR", "AWS D1.1 Structural Welding Certification"). */
  name: string;
  /** One key per credential, so it is asked about once ("cna" for both "CNA" and "Certified Nursing Assistant"). */
  key: string;
  /** Words of the name that identify it (not "certified", "card", years or status). */
  nameWords: string[];
  /** The page says the person holds it (certified, licensed, a certification, a card). */
  claim: boolean;
  where: "credentials" | "skills" | "other";
}

const CRED_SECTION_RE = /^(?:certifications?|licenses?|licences?|credentials?|certifications? (?:and|&) licen[cs]es?|licen[cs]es? (?:and|&) certifications?)$/i;
const SKILLS_RE = /^(?:core competencies|skills|key skills|competencies|core skills|technical skills)$/i;

// Known credentials by name. Matched anywhere.
const NAMED_RE = /\b(?:OSHA[\s-]*\d+(?:[\s-]hour)?|CDL(?:[\s-]+Class[\s-]+[A-C])?|CNA|STNA|LPN|EMT(?:-[BP])?|ServSafe(?:\s+(?:Food\s+Handler|Manager|Food\s+Protection\s+Manager))?|EPA\s*608(?:\s+Universal)?|CPR|BLS|First\s+Aid|AWS\s+D\d+(?:\.\d+)?|HAZMAT|TWIC|Forklift\s+card|Six\s+Sigma(?:\s+\w+\s+Belt)?|PMP|NCCER)\b/gi;
// Holding claims: "Forklift Certified", "AWS D1.1 Structural Welding Certification", "Welding Certificate".
const TRAILING_CLAIM_RE = /((?:\b[A-Za-z0-9][\w&.+/'-]*\s+){1,4}?)(Certified|Certification|Certificate|License|Licence|Licensed|Card)\b/gi;
// "Certified Nursing Assistant", "Licensed Electrician", "certified in CPR", "certified as a welder".
const LEADING_CLAIM_RE = /\b(Certified|Licensed)\s+(?:(?:in|as|for)\s+(?:an?\s+)?)?((?:[A-Za-z][\w&.+/'-]*)(?:\s+(?!and\b|with\b|who\b|for\b|in\b|at\b)[A-Za-z][\w&.+/'-]*){0,2})/gi;

const GENERIC = new Set([
  "i", "i'm", "am", "is", "are", "was", "were", "who", "have", "has", "had", "also", "still", "be", "been", "to",
  "it", "its", "this", "that", "we", "our", "you", "your", "can", "will",
  "certified", "certification", "certificate", "license", "licence", "licensed", "card", "training", "course",
  "class", "program", "level", "state", "issued", "current", "active", "valid", "expired", "renewal", "renewed",
  "in", "as", "for", "a", "an", "the", "of", "and", "with", "holds", "hold", "earned", "passed", "my",
]);
// Words that start a holding claim's name but are not part of it ("Passed the AWS D1.1 ...").
const LEAD_TRIM = /^(?:(?:earned|obtained|got|hold|holds|held|have|has|had|passed|completed|received|renewed|current|active|valid|a|an|the|my|our|and|with|i|i'm|am|is|are|was|were|who|also|still|fully|now|be|being|been|to|of|in|for|as|state|its)\s+)+/i;

const ALIASES: Array<[RegExp, string]> = [
  [/^(?:cna|certified nursing assistant|nursing assistant|stna|state tested nursing assistant)$/, "cna"],
  [/^(?:cdl|commercial driver'?s?|commercial drivers?)/, "cdl"],
  [/^(?:cpr|bls)$/, "cpr"],
];

function keyOf(nameWords: string[], name = ""): string {
  const k = nameWords.join(" ");
  for (const [re, canon] of ALIASES) if (re.test(k)) return canon;
  // A known name inside a longer one ("AWS D1.1 Structural Welding Certification") is that credential.
  const named = namedIn(name)[0];
  if (named && named.length < name.length) {
    const nw = nameWordsOf(named);
    if (nw.length) return keyOf(nw, named);
  }
  return nameWords.map((w) => (/\d/.test(w) ? w : stemOf(w))).join(" ");
}

function cleanName(raw: string): string {
  return raw
    .replace(/^[-•*]\s*/, "")
    .replace(LEAD_TRIM, "")
    .replace(/\s*[,(|].*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/\b(?:19|20)\d{2}\b/g, "")
    .replace(STATUS_WORD_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function nameWordsOf(name: string): string[] {
  return (name.toLowerCase().match(/[a-z0-9][a-z0-9.'+-]*/g) ?? [])
    .map((w) => w.replace(/\.$/, ""))
    .filter((w) => w && !GENERIC.has(w) && !/^(?:19|20)\d{2}$/.test(w));
}

const CLAIM_WORD_RE = /\b(?:certified|certification|certificate|licensed|license|licence|card)\b/i;
const CREDENTIAL_WORD_RE = /\b(?:certif\w*|licen[cs]e[ds]?)\b/i;

/** Every credential mention on a page, in page order. */
export function credentialMentionsOf(text: string): CredentialMention[] {
  const out: CredentialMention[] = [];
  const ls = linesOf(text || "");
  let section: "credentials" | "skills" | "other" = "other";
  const push = (line: string, rawName: string, where: CredentialMention["where"], term: boolean, claimText: string) => {
    const name = cleanName(rawName) || rawName.trim();
    const nameWords = nameWordsOf(name);
    if (!nameWords.length) return;
    const key = keyOf(nameWords, name);
    if (out.some((m) => m.line === line && m.key === key)) return;
    out.push({ line, term, name, key, nameWords, claim: CLAIM_WORD_RE.test(claimText) || NAMED_ONLY.test(name), where });
  };

  ls.forEach((l, i) => {
    if (CRED_SECTION_RE.test(l.replace(/:$/, ""))) { section = "credentials"; return; }
    if (SKILLS_RE.test(l.replace(/:$/, ""))) { section = "skills"; return; }
    if (isSectionEnd(l)) { section = "other"; return; }
    if (i === 0 || CONTACT_LINE_RE.test(l)) return;

    if (section === "credentials") {
      push(l, l, "credentials", false, l);
      return;
    }
    if (section === "skills") {
      for (const t of skillTermsOf(l)) {
        if (namedIn(t).length || CREDENTIAL_WORD_RE.test(t)) push(t, namedIn(t)[0] ?? t, "skills", true, t);
      }
      return;
    }
    // Any other line: every named credential and every holding claim in it.
    for (const n of namedIn(l)) push(l, n, "other", false, l);
    for (const m of l.matchAll(TRAILING_CLAIM_RE)) {
      const raw = `${m[1]}${m[2]}`;
      if (nameWordsOf(cleanName(m[1])).length) push(l, cleanName(m[1]) + " " + m[2], "other", false, raw);
    }
    for (const m of l.matchAll(LEADING_CLAIM_RE)) push(l, `${m[1]} ${m[2]}`, "other", false, m[0]);
  });
  return out;
}

// A known name on its own ("CPR", "CNA") is a claim to hold it.
const NAMED_ONLY = /^(?:OSHA|CDL|CNA|STNA|LPN|EMT|ServSafe|EPA|CPR|BLS|First Aid|AWS|HAZMAT|TWIC|Forklift card|Six Sigma|PMP|NCCER)\b/i;

function namedIn(text: string): string[] {
  return Array.from(text.matchAll(NAMED_RE)).map((m) => m[0]);
}

/**
 * One mention per credential: its home. A credentials-section line first,
 * then a skills term, then the first other line. Each credential is asked
 * about once, by its own name, at its home.
 */
export function credentialHomes(mentions: CredentialMention[]): CredentialMention[] {
  const rank = { credentials: 0, skills: 1, other: 2 } as const;
  const byKey = new Map<string, CredentialMention>();
  for (const m of mentions) {
    const prev = byKey.get(m.key);
    if (!prev || rank[m.where] < rank[prev.where]) byKey.set(m.key, m);
  }
  return Array.from(byKey.values());
}

// Sentences of the person's words. A period inside a name ("AWS D1.1") does not end one.
const srcUnitsOf = (src: string) => src.split(/[\n;]+|\.(?=\s|$)/).map((u) => u.trim()).filter(Boolean);

/** The person's sentences that name this credential (any name word, by stem, or its alias). */
export function saidAbout(m: Pick<CredentialMention, "nameWords" | "key">, src: string): string[] {
  const stems = m.nameWords.map(stemOf);
  return srcUnitsOf(src).filter((u) => {
    const uw = (u.toLowerCase().match(/[a-z0-9][a-z0-9.'+-]*/g) ?? []).map((w) => w.replace(/\.$/, ""));
    if (m.key && uw.some((w) => keyOf([w]) === m.key)) return true;
    if (m.key === "cna" && /nursing assistant/i.test(u)) return true;
    const us = new Set(uw.map(stemOf));
    // Every identifying word must be there for a multi-word name; one is enough for a single word.
    const need = stems.filter((s) => s.length >= 2);
    return need.length > 0 && (need.length === 1 ? us.has(need[0]) : need.filter((s) => us.has(s)).length >= Math.ceil(need.length / 2));
  });
}

const COURSE_RE = /\b(?:class|classes|course|courses|training|program|coursework)\b/i;
const HOLD_RE = /\b(?:certified|certification|certificate|licensed|license|licence|passed|card|registry|hold|holds|have my)\b/i;
const TYPE_RE = /\b(?:certif\w*|licen[cs]\w*|card|registry|course|class|training|program|apprentice\w*|exam|test)\b/i;
const YEAR_RE = /\b(?:19[5-9]\d|20[0-4]\d)\b/;

export type CredentialIssue = "upgrade" | "unsaid" | "status";

export interface CredentialCheck {
  mention: CredentialMention;
  issue: CredentialIssue;
}

/**
 * The credential findings for a page, one credential at a time, at its home:
 * - unsaid: no word of its name is in anything the person told us (BLOCK; only a change or a cut settles it);
 * - upgrade: the page says they hold it, their words only describe a class (BLOCK);
 * - status: nobody gave its year or status (FIX; an answer with a status settles it).
 * `skipKeys` are credentials already handled on another page (the resume, for the letter).
 */
export function checkCredentials(text: string, src: string, skipKeys: Set<string> = new Set()): CredentialCheck[] {
  const out: CredentialCheck[] = [];
  for (const m of credentialHomes(credentialMentionsOf(text))) {
    if (skipKeys.has(m.key)) continue;
    const said = saidAbout(m, src);
    if (!said.length) {
      out.push({ mention: m, issue: "unsaid" });
      continue;
    }
    if (m.claim && !said.some((u) => HOLD_RE.test(u)) && said.some((u) => COURSE_RE.test(u))) {
      out.push({ mention: m, issue: "upgrade" });
      continue;
    }
    const lineHas = YEAR_RE.test(m.line) || STATUS_WORD_RE.test(m.line);
    const theyGave = said.some((u) => YEAR_RE.test(u) || STATUS_WORD_RE.test(u));
    if (!lineHas && !theyGave) out.push({ mention: m, issue: "status" });
  }
  return out;
}

/**
 * True when the person's own words already give this credential a type
 * (certificate, license, card, course...) and a year or a status, so there is
 * nothing to ask about it.
 */
export function credentialAlreadyKnown(m: CredentialMention, src: string): boolean {
  return saidAbout(m, src).some((u) => TYPE_RE.test(u) && (YEAR_RE.test(u) || STATUS_WORD_RE.test(u)));
}

/** True when an answer about a credential says what kind it is (license, certification, course, card...). */
export function answerGivesCredentialType(answer: string): boolean {
  return TYPE_RE.test(answer);
}

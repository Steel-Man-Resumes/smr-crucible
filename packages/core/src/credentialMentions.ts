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
import { isCredentialTerm, namedCredentialRe } from "./credentialWords";

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
  /** The exact words on the line that name it (to move or cut them). */
  raw: string;
  /** True when it is a known credential by name (CPR, OSHA 10), not a generic holding claim. */
  named: boolean;
  where: "credentials" | "skills" | "other";
  /** The whole page line it sits on (for a term: its skills or credentials line). Year and status are read here. */
  context: string;
}

const CRED_SECTION_RE = /^(?:certifications?|licenses?|licences?|credentials?|certifications? (?:and|&) licen[cs]es?|licen[cs]es? (?:and|&) certifications?)$/i;
const SKILLS_RE = /^(?:core competencies|skills|key skills|competencies|core skills|technical skills)$/i;

// Known credentials by name come from the one shared list (credentialWords).
// Holding claims: "Forklift Certified", "AWS D1.1 Structural Welding Certification", "Welding Certificate".
// Words may carry a dot only between digits ("D1.1"), so a match never runs across a sentence end.
const TRAILING_CLAIM_RE = /((?:\b[A-Za-z0-9][\w&+/'-]*(?:\.\d+)*\s+){1,4}?)(Certified|Certification|Certificate|License|Licence|Licensed|Card|Endorsement|Permit|Registry)\b/gi;
// Words that end a credential's name when read backwards from its claim word ("on weekends as a fully licensed").
const NAME_STOP = new Set([
  "a", "an", "the", "my", "our", "your", "his", "her", "their", "i", "i'm", "am", "is", "are", "was", "were", "be", "been",
  "and", "or", "as", "at", "on", "in", "of", "for", "to", "by", "from", "with", "who", "which", "that", "also", "still",
  "fully", "now", "hold", "holds", "held", "have", "has", "had", "got", "earned", "obtained", "passed", "completed",
  "received", "renewed", "current", "active", "valid", "since", "through", "until", "every", "all", "this", "it",
]);
// "Certified Nursing Assistant", "Licensed Electrician", "certified in CPR", "certified as a welder".
const LEADING_CLAIM_RE = /\b(Certified|Licensed)\s+(?:(?:in|as|for)\s+(?:an?\s+)?)?((?:[A-Za-z][\w&.+/'-]*)(?:\s+(?!and\b|with\b|who\b|for\b|in\b|at\b|since\b|through\b|until\b|by\b|from\b)[A-Za-z][\w&.+/'-]*){0,2})/gi;
// "certified since 2015", "certified hand", "licensed through the state": not a credential's name.
const NOT_A_NAME_RE = /^(?:since|through|until|by|from|hand|hands|to|on|at|and|or|in|as|for|with|the|a|an|this|that|it|all|every)\b/i;

const GENERIC = new Set([
  "i", "i'm", "am", "is", "are", "was", "were", "who", "have", "has", "had", "also", "still", "be", "been", "to",
  "it", "its", "this", "that", "we", "our", "you", "your", "can", "will",
  "certified", "certification", "certificate", "license", "licence", "licensed", "card", "training", "course",
  "class", "program", "level", "state", "issued", "current", "active", "valid", "expired", "renewal", "renewed",
  "endorsement", "permit", "registry", "registered", "status",
  "in", "as", "for", "a", "an", "the", "of", "and", "with", "holds", "hold", "earned", "passed", "my",
]);
// Words that start a holding claim's name but are not part of it ("Passed the AWS D1.1 ...").
const LEAD_TRIM = /^(?:(?:earned|obtained|got|hold|holds|held|have|has|had|passed|completed|received|renewed|current|active|valid|a|an|the|my|our|and|with|i|i'm|am|is|are|was|were|who|also|still|fully|now|be|being|been|to|of|in|for|as|state|its)\s+)+/i;

// ---- one key per credential (full key, never collapsed) -------------------
// Words that never identify a credential: how it is held, filler, status.
// Everything else (the name, a number, a class letter, a level, a belt color,
// a role word such as Manager, Instructor, Trainer, Inspector, Proctor,
// Authorized) is part of the key, so "OSHA 30" is never "OSHA 10" and
// "Certified CPR Instructor" is never "CPR".
const KEY_DROP = new Set([
  "certified", "certification", "certifications", "certificate", "cert", "card", "license", "licence", "licensed",
  "credential", "holder", "operator", "hour", "hours", "hr", "hrs", "the", "a", "an", "of", "for", "in", "and", "my",
  "with", "valid", "current", "active", "expired", "renewal", "renewed", "status", "issued", "training", "course",
  "class", "classes", "program", "endorsement", "permit", "registry", "registered", "i", "have", "has", "hold",
  "holds", "got", "earned", "passed", "completed", "obtained", "am", "is", "was", "also", "still", "our", "your",
]);

/**
 * The full key for a credential name. Spelling variants meet ("OSHA-10",
 * "OSHA10", "OSHA 10-Hour", "10-hour OSHA" are all "10 osha"; "Forklift
 * Certified" and "Certified Forklift Operator" are both "forklift"). Every
 * identifying word stays, in any order.
 */
export function canonicalCredentialKey(name: string): string {
  let t = ` ${name.toLowerCase()} `
    .replace(/\b((?:[a-z]\.){2,})/g, (m) => m.replace(/\./g, "")) // o.s.h.a. -> osha
    .replace(/([a-z]{3,})(\d)/g, "$1 $2") // osha10 -> osha 10
    .replace(/(\d)-(?=[a-z])/g, "$1 ") // 10-hour -> 10 hour
    .replace(/([a-z])-(?=\d)/g, "$1 ") // osha-10 -> osha 10
    .replace(/\bclass\s+([a-d])\b/g, "class_$1") // CDL Class A keeps its letter
    .replace(/\bcommercial driver'?s?\b/g, "cdl")
    .replace(/[^a-z0-9._ ]+/g, " ");
  const toks = (t.match(/[a-z0-9][a-z0-9._]*/g) ?? [])
    .map((w) => w.replace(/\.+$/, ""))
    .filter((w) => w && !KEY_DROP.has(w) && !/^(?:19|20)\d{2}$/.test(w))
    .map((w) => (/^[a-z]{4,}s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w));
  let set = new Set(toks);
  // A certified nursing assistant is a CNA; a state tested one is an STNA.
  if (set.has("nursing") && set.has("assistant")) {
    set.delete("nursing");
    set.delete("assistant");
    if (set.has("state") && set.has("tested")) {
      set.delete("state");
      set.delete("tested");
      set.add("stna");
    } else set.add("cna");
  }
  return Array.from(set).sort().join(" ");
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

const CLAIM_WORD_RE = /\b(?:certified|certification|certificate|licensed|license|licence|card|endorsement|permit|registry)\b/i;

/** Every credential mention on a page, in page order. */
export function credentialMentionsOf(text: string): CredentialMention[] {
  const out: CredentialMention[] = [];
  const ls = linesOf(text || "");
  let section: "credentials" | "skills" | "other" = "other";
  const push = (line: string, rawName: string, where: CredentialMention["where"], term: boolean, claimText: string, raw: string) => {
    const name = cleanName(rawName) || rawName.trim();
    const nameWords = nameWordsOf(name);
    if (!nameWords.length) return;
    const key = canonicalCredentialKey(name);
    if (!key || out.some((m) => m.line === line && m.key === key)) return;
    const named = namedIn(name).length > 0;
    out.push({ line, term, name, key, nameWords, claim: CLAIM_WORD_RE.test(claimText) || NAMED_ONLY.test(name), where, raw, named, context });
  };
  let context = "";

  ls.forEach((l, i) => {
    if (CRED_SECTION_RE.test(l.replace(/:$/, ""))) { section = "credentials"; return; }
    if (SKILLS_RE.test(l.replace(/:$/, ""))) { section = "skills"; return; }
    if (isSectionEnd(l)) { section = "other"; return; }
    if (i === 0 || CONTACT_LINE_RE.test(l)) return;
    context = l;

    if (section === "credentials") {
      // A line that lists several credentials is read part by part, so each
      // is checked, asked and confirmed on its own.
      const parts = credentialPartsOf(l);
      if (parts.length >= 2) {
        for (const p of parts) push(p, namedIn(p)[0] && namedIn(p)[0].length === p.length ? p : p, "credentials", true, p, p);
        return;
      }
      push(l, l, "credentials", false, l, l.replace(/^[-•*]\s*/, ""));
      return;
    }
    if (section === "skills") {
      for (const t of skillTermsOf(l)) {
        if (isCredentialTerm(t)) push(t, namedIn(t)[0] ?? t, "skills", true, t, t);
      }
      return;
    }
    // Any other line: every named credential and every holding claim in it.
    for (const n of namedIn(l)) push(l, n, "other", false, l, n);
    const claimWordAt = new Set<number>();
    for (const m of l.matchAll(TRAILING_CLAIM_RE)) {
      // The name is the run of content words right before the claim word.
      const words = m[1].trim().split(/\s+/);
      const name: string[] = [];
      for (let k = words.length - 1; k >= 0 && !NAME_STOP.has(words[k].toLowerCase()); k--) name.unshift(words[k]);
      if (!name.length || !nameWordsOf(name.join(" ")).length) continue;
      const raw = `${name.join(" ")} ${m[2]}`;
      claimWordAt.add(m.index! + m[0].length - m[2].length);
      push(l, raw, "other", false, raw, raw);
    }
    for (const m of l.matchAll(LEADING_CLAIM_RE)) {
      if (NOT_A_NAME_RE.test(m[2])) continue;
      // "Forklift Certified Line Cook": the claim word already closes "Forklift Certified"; "Line Cook" is the job.
      if (claimWordAt.has(m.index!)) continue;
      push(l, `${m[1]} ${m[2]}`, "other", false, m[0], m[0]);
    }
  });
  return out;
}

// A known name on its own ("CPR", "CNA") is a claim to hold it.
const NAMED_ONLY = /^(?:OSHA|CDL|CNA|STNA|LPN|EMT|ServSafe|EPA|CPR|BLS|First Aid|AWS|HAZMAT|TWIC|Forklift card|Food handler|Six Sigma|PMP|NCCER)\b/i;

/** The credential parts of a credentials line: split on commas, semicolons, pipes, slashes, middots, " - " and " and ". */
export function credentialPartsOf(line: string): string[] {
  return line
    .replace(/^[-•*]\s*/, "")
    .split(/\s*(?:[,;|·]|\s[-–]\s|\s\/\s|\/(?=[A-Za-z])|\band\b)\s*/i)
    .map((p) => p.replace(/^\(|\)$/g, "").trim())
    .filter((p) => p && isCredentialTerm(p));
}

function namedIn(text: string): string[] {
  return Array.from(text.matchAll(namedCredentialRe())).map((m) => m[0]);
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

// ---- what the person said -------------------------------------------------

interface SourceMention {
  key: string;
  /** The person's sentence or line it is in (year and status are read here). */
  unit: string;
  /** "course": they described a class or training for it; "hold": a card, a certification, a license, a known name. */
  kind: "course" | "hold";
}

// "a forklift training class", "OSHA 10 course": the one or two words before a course word.
const COURSE_NAME_RE = /\b([A-Za-z0-9][\w&.+'-]*(?:\s+[A-Za-z0-9][\w&.+'-]*)?)\s+(?:training|course|class)\b/gi;

/** The credentials in the person's own words, each under its full key. */
function sourceMentions(src: string): SourceMention[] {
  const out: SourceMention[] = credentialMentionsOf(`(the person)\n${src || ""}`).map((m) => ({ key: m.key, unit: m.context, kind: "hold" as const }));
  for (const u of srcUnitsOf(src || "")) {
    for (const m of u.matchAll(COURSE_NAME_RE)) {
      const key = canonicalCredentialKey(m[1].replace(LEAD_TRIM, ""));
      if (key) out.push({ key, unit: u, kind: "course" });
    }
  }
  return out;
}

/**
 * The person's sentences that name this exact credential. Strict by design:
 * the full key must match (every name word, number, class letter, level and
 * role word). An ordinary word ("first", "manager", "30", "forklift") never
 * counts as saying a named credential, and a longer name is never matched by
 * a shorter one.
 */
export function saidAbout(m: Pick<CredentialMention, "key">, src: string): string[] {
  return sourceMentions(src)
    .filter((s) => s.key === m.key)
    .map((s) => s.unit);
}

function saidKinds(m: Pick<CredentialMention, "key">, src: string): SourceMention[] {
  return sourceMentions(src).filter((s) => s.key === m.key);
}

const COURSE_RE = /\b(?:class|classes|course|courses|training|program|coursework)\b/i;
const HOLD_RE = /\b(?:certified|certification|certificate|licensed|license|licence|passed|card|registry|hold|holds|have my)\b/i;
const TYPE_RE = /\b(?:certif\w*|licen[cs]\w*|card|registry|course|class|training|program|apprentice\w*|exam|test)\b/i;
const YEAR_RE = /\b(?:19[5-9]\d|20[0-4]\d)\b/;

export type CredentialIssue = "upgrade" | "unsaid" | "status" | "status_claimed";

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
    const kinds = saidKinds(m, src);
    const said = kinds.map((k) => k.unit);
    if (!said.length) {
      out.push({ mention: m, issue: "unsaid" });
      continue;
    }
    if (m.claim && kinds.every((k) => k.kind === "course")) {
      out.push({ mention: m, issue: "upgrade" });
      continue;
    }
    const lineHas = YEAR_RE.test(m.context || m.line) || STATUS_WORD_RE.test(m.context || m.line);
    const theyGave = said.some((u) => YEAR_RE.test(u) || STATUS_WORD_RE.test(u));
    // The writer's "current" or year is never the person's status.
    if (lineHas && !theyGave) out.push({ mention: m, issue: "status_claimed" });
    else if (!lineHas && !theyGave) out.push({ mention: m, issue: "status" });
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

/** The key one credential name is filed under (the same key a mention of it gets). */
export function credentialKeyOf(name: string): string | undefined {
  return canonicalCredentialKey(name) || undefined;
}

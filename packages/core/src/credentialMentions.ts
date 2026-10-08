/**
 * Credentials, one at a time, wherever they sit on a page.
 *
 * Round 5 design: the gate never reads the person's free text to decide that
 * they "said" a credential, its kind or its status. Every credential on a
 * page is asked as a memory prompt (decision D4), and the line that stays is
 * written only from what the person confirms. The one exception is a line
 * the person typed into the Forge's licenses-and-training answer that is on
 * the page exactly as they typed it (whitespace, case and punctuation aside).
 *
 * This file only FINDS credentials on a page and groups the mentions of one
 * credential, so it is asked once. It never decides that one is true.
 *
 * Pure. Used by the draft/finished status (resumeStatus) and the finish gate
 * (the cover letter).
 */

import { linesOf, isSectionEnd, isEntryHeader, skillTermsOf, CONTACT_LINE_RE, STATUS_WORD_RE } from "./resumeMintCheckShared";
import { isCredentialTerm, namedCredentialRe } from "./credentialWords";

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
  /** What the page shows for this credential: the whole line, or its part of a list line with that part's year or status. */
  unit: string;
}

const CRED_SECTION_RE = /^(?:certifications?|licenses?|licences?|credentials?|certifications? (?:and|&) licen[cs]es?|licen[cs]es? (?:and|&) certifications?)$/i;
const SKILLS_RE = /^(?:core competencies|skills|key skills|competencies|core skills|technical skills)$/i;

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
const LEADING_CLAIM_RE = /\b(Certified|Licensed|Registered)\s+(?:(?:in|as|for)\s+(?:an?\s+)?)?((?:[A-Za-z][\w&.+/'-]*)(?:\s+(?!and\b|with\b|who\b|for\b|in\b|at\b|since\b|through\b|until\b|by\b|from\b)[A-Za-z][\w&.+/'-]*){0,2})/gi;
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
]);

/** The key a credential name is grouped under. */
export function credentialKey(name: string): string {
  const t = name.toLowerCase().replace(/\b(?:19|20)\d{2}\b/g, " ");
  // A class letter stays with its class, whatever the spelling ("Class-A", "class a").
  const joined = t.replace(/\bclass[\s-]*([a-d])\b/g, "class_$1");
  const toks = (joined.match(/[a-z0-9_.]+/g) ?? [])
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
// parentheses, " - ", dashes, slashes, "and", "with", "plus", "also", tabs and
// runs of spaces. A hyphen inside a name ("OSHA-10", "CDL-A") is not a split.
const PART_SPLIT_RE = /\s*(?:[,;|·•+&()[\]\t]|\s-\s|[\u2013\u2014]|\s\/\s|\/(?=[A-Za-z])|\b(?:and|with|plus|also)\b|\s{2,})\s*/i;
// A part that only carries a year or a status ("2019", "current", "renewed yearly", "exp. 06/2027").
const CONTEXT_WORDS = new Set([
  "active", "current", "currently", "valid", "expired", "expires", "expiring", "exp", "inactive", "lapsed", "in", "progress",
  "enrolled", "completed", "complete", "finished", "passed", "renewed", "renewal", "renews", "suspended", "revoked",
  "through", "thru", "until", "good", "for", "standing", "up", "to", "date", "since", "as", "of", "issued", "obtained",
  "earned", "received", "on", "the", "a", "yearly", "annually", "annual", "every", "each", "year", "years", "is", "it",
  "still", "from", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
  "spring", "summer", "fall", "winter", "pending", "now",
]);
const CLASS_PART_RE = /^(?:class|level|grade|tier|type)[\s-]*[a-z0-9]{1,3}$/i;
// Where or how it was earned ("county job center", "passed the driving test"): a detail of the part before it, never a credential of its own.
const DETAIL_PLACE_RE = /\b(?:center|centre|college|school|academy|institute|university|department|office|red cross|job corps|community|council|association|society|board|agency|commission|union)\b/i;
const DETAIL_START_RE = /^(?:passed|took|completed|finished|through|via|at|from|by|online)\b/i;

/** True when a list part only says where or how the part before it was earned. */
function isDetailPart(part: string): boolean {
  return !isCredentialTerm(part) && (DETAIL_PLACE_RE.test(part) || DETAIL_START_RE.test(part));
}

/** True when a list part carries only a year or a status, so it belongs to the part before it. */
export function isContextPart(part: string): boolean {
  const words = part.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  return words.every((w) => /^\d+$/.test(w) || CONTEXT_WORDS.has(w));
}

const initials = (s: string) =>
  (s.match(/[A-Za-z][A-Za-z']*/g) ?? [])
    .filter((w) => !/^(?:of|and|the|for|in|a|an)$/i.test(w))
    .map((w) => w[0].toUpperCase())
    .join("");

export interface CredentialPart {
  /** The words on the page that name it, as written ("OSHA 10", "Forklift Certified", "CDL Class A"). */
  part: string;
  /** The part with the year or status parts that follow it ("OSHA 10, 2019"). */
  unit: string;
}

/**
 * The credentials in one list line, each with its own year or status. Every
 * part that names anything is a credential to ask about; a part that is only
 * a year or a status goes with the part before it; a class or level ("Class
 * A") and an initialism in brackets ("Certified Nursing Assistant (CNA)") go
 * with the part they belong to.
 */
export function credentialUnitsOf(line: string): CredentialPart[] {
  const raw = line.replace(/^\s*[-•*]\s*/, "").split(PART_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  const out: Array<{ part: string; ctx: string[] }> = [];
  for (const p of raw) {
    const prev = out[out.length - 1];
    if (prev && (isContextPart(p) || isDetailPart(p))) {
      prev.ctx.push(p);
      continue;
    }
    if (prev && !prev.ctx.length && CLASS_PART_RE.test(p)) {
      prev.part = `${prev.part} ${p}`;
      continue;
    }
    if (prev && !prev.ctx.length && /^[A-Z]{2,6}$/.test(p) && initials(prev.part).includes(p)) continue;
    if (isContextPart(p)) continue; // a year with nothing before it names nothing
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

function namedIn(text: string): string[] {
  return Array.from(text.matchAll(namedCredentialRe())).map((m) => m[0]);
}

/** Every credential mention on a page, in page order. */
export function credentialMentionsOf(text: string): CredentialMention[] {
  const out: CredentialMention[] = [];
  const ls = linesOf(text || "");
  let section: "credentials" | "skills" | "other" = "other";
  let context = "";
  const push = (line: string, rawName: string, where: CredentialMention["where"], term: boolean, raw: string, unit: string) => {
    const name = cleanName(rawName) || rawName.trim();
    const nameWords = nameWordsOf(name);
    if (!nameWords.length) return;
    const key = credentialKey(name);
    if (!key || out.some((m) => m.line === line && m.key === key)) return;
    out.push({ line, term, name, key, nameWords, where, raw, named: namedIn(name).length > 0, context, unit });
  };

  let seenHeading = false;
  ls.forEach((l, i) => {
    if (CRED_SECTION_RE.test(l.replace(/:$/, ""))) { section = "credentials"; seenHeading = true; return; }
    if (SKILLS_RE.test(l.replace(/:$/, ""))) { section = "skills"; seenHeading = true; return; }
    if (isSectionEnd(l)) { section = "other"; seenHeading = true; return; }
    if (i === 0 || CONTACT_LINE_RE.test(l)) return;
    // A dated job header under a section ("CERTIFIED NURSING ASSISTANT | Meadowbrook | 2017 - Present")
    // names a job title, which the title check asks about. It is never moved or cut as a credential.
    if (section === "other" && seenHeading && isEntryHeader(l) && /\b(?:19|20)\d{2}\b|\bpresent\b/i.test(l)) return;
    context = l;
    const body = l.replace(/^\s*[-•*]\s*/, "");

    if (section === "credentials") {
      // Every part of a credentials line is a credential to ask about, each on its own.
      const units = credentialUnitsOf(l);
      if (units.length >= 2) {
        for (const u of units) push(u.part, u.part, "credentials", true, u.part, u.unit);
        return;
      }
      if (units.length === 1) push(l, units[0].part, "credentials", false, body, body);
      return;
    }
    if (section === "skills") {
      for (const t of skillTermsOf(l)) {
        if (isCredentialTerm(t)) push(t, namedIn(t)[0] ?? t, "skills", true, t, t);
      }
      return;
    }
    // Any other line: every named credential and every holding claim in it.
    for (const n of namedIn(l)) push(l, n, "other", false, n, body);
    const claimWordAt = new Set<number>();
    for (const m of l.matchAll(TRAILING_CLAIM_RE)) {
      // The name is the run of content words right before the claim word.
      const words = m[1].trim().split(/\s+/);
      const name: string[] = [];
      for (let k = words.length - 1; k >= 0; k--) {
        // "Class A Commercial Driver's License": a class letter is part of the name, not the word "a".
        const classLetter = /^[A-D]$/.test(words[k]) && /^class$/i.test(words[k - 1] ?? "");
        if (NAME_STOP.has(words[k].toLowerCase()) && !classLetter) break;
        name.unshift(words[k]);
      }
      if (!name.length || !nameWordsOf(name.join(" ")).length) continue;
      const raw = `${name.join(" ")} ${m[2]}`;
      claimWordAt.add(m.index! + m[0].length - m[2].length);
      push(l, raw, "other", false, raw, body);
    }
    for (const m of l.matchAll(LEADING_CLAIM_RE)) {
      if (NOT_A_NAME_RE.test(m[2])) continue;
      // "Forklift Certified Line Cook": the claim word already closes "Forklift Certified"; "Line Cook" is the job.
      if (claimWordAt.has(m.index!)) continue;
      push(l, `${m[1]} ${m[2]}`, "other", false, m[0], body);
    }
  });
  return out;
}

/**
 * True when two page keys are one credential to ask about once: the same
 * key, or one key's words all inside the other's when the shorter one is
 * specific (it has a number or is a known name: "AWS D1.1" inside "AWS D1.1
 * Structural Welding"). Page side only: it groups prompts, and a confirmation
 * rewrites every grouped mention from the one name the person said yes to.
 */
export function sameCredential(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = a.split(" ").filter(Boolean);
  const tb = b.split(" ").filter(Boolean);
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (!small.length || !small.every((w) => big.includes(w))) return false;
  return small.some((w) => /\d/.test(w)) || namedCredentialRe().test(small.join(" "));
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

// ---- the one exception: typed exactly ---------------------------------------------

/** Lower case, punctuation as space, single spaces. */
export function normalizeTyped(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The entries in the person's licenses-and-training answer: each line, and
 * each part between semicolons, normalised. A whole entry only, so a page
 * line that drops part of what they typed ("expired") never matches.
 */
export function typedCredentialEntries(answer: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const seg of (answer || "").split(/[\n;]+/)) {
    const n = normalizeTyped(seg.replace(/^\s*[-•*]\s*/, ""));
    if (n) out.add(n);
  }
  return out;
}

/**
 * True when this mention is on the page exactly as the person typed it in
 * their licenses-and-training answer: its part of the line with its year or
 * status, or the whole line.
 */
export function mentionTypedExactly(m: CredentialMention, entries: Set<string>): boolean {
  if (!entries.size) return false;
  return entries.has(normalizeTyped(m.unit)) || entries.has(normalizeTyped(m.context.replace(/^\s*[-•*]\s*/, "")));
}

/**
 * The credentials a page must ask about (decision D4, round 5): one per key,
 * at the best home among its mentions that are not typed exactly. A
 * credential is skipped only when every one of its mentions on the page is a
 * line the person typed exactly.
 */
export function credentialsToAsk(text: string, credentialsAnswer?: string, skipKeys: Set<string> = new Set()): CredentialMention[] {
  const entries = typedCredentialEntries(credentialsAnswer);
  const all = credentialMentionsOf(text);
  const skip = Array.from(skipKeys);
  const untyped = all.filter((m) => !skip.some((k) => sameCredential(k, m.key)) && !mentionTypedExactly(m, entries));
  return credentialHomes(untyped);
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

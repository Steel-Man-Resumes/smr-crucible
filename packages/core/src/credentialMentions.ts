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
// "licensed and bonded electrician", "fully licensed, bonded and insured", "Electrician, licensed and bonded".
const HOLD_WORDS = String.raw`licensed|certified|registered|bonded|insured`;
const HOLDING_LIST_RE = new RegExp(String.raw`(?:\b([A-Z][a-z]+),\s+)?\b(?:fully\s+)?(?:${HOLD_WORDS})(?:\s*(?:,\s*(?:and\s+)?|\band\b\s*|&\s*)(?:${HOLD_WORDS}))+(?:\s+(?!for\b|on\b|in\b|at\b|to\b|with\b)([a-z][a-z'-]+))?`, "gi");
// "certified since 2015", "certified hand", "licensed through the state": not a credential's name.
const NOT_A_NAME_RE = /^(?:since|through|until|by|from|hand|hands|to|on|at|and|or|in|as|for|with|the|a|an|this|that|it|all|every)\b/i;
// A title word that says the person holds something.
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
  "spring", "summer", "fall", "winter", "pending", "now",
]);
const CLASS_PART_RE = /^(?:class|level|grade|tier|type)[\s-]*[a-z0-9]{1,5}$/i;
// Wording, not a credential: a level or a qualifier ("Advanced Level", "OSHA-compliant", "Level Three").
const QUALIFIER_WORDS = new Set(["advanced", "basic", "intermediate", "beginner", "expert", "senior", "junior", "level", "levels", "one", "two", "three", "four", "five", "i", "ii", "iii", "iv", "graduate", "standard", "full", "general"]);
const QUALIFIER_PART_RE = /^[\w-]+[\s-](?:compliant|approved|aligned|based|trained)$|^(?:compliant|approved)$/i;
// Where or how it was earned ("county job center", "passed the driving test", "Safety First Training"): a detail of the part before it.
const DETAIL_PLACE_RE = /\b(?:center|centre|college|school|academy|institute|university|department|office|red cross|job corps|community|council|association|society|board|agency|commission|union)\b/i;
const DETAIL_START_RE = /^(?:passed|took|completed|finished|through|via|at|from|by|online)\b/i;
const PROVIDER_RE = /^(?:[A-Z][\w&'.-]*\s+){2,5}(?:Training|Institute|Council|College|Academy|Center|Centre|School|University|Association|Society|Board)$/;
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
  if (DETAIL_PLACE_RE.test(part) || DETAIL_START_RE.test(part) || PROVIDER_RE.test(part)) return true;
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
    opts: { title?: boolean; anyName?: boolean } = {}
  ) => {
    const name = cleanName(rawName) || rawName.trim();
    let nameWords = nameWordsOf(name);
    // A credentials line with no name of its own ("Licensed, State Board") is still asked about.
    if (!nameWords.length && opts.anyName) nameWords = [name.toLowerCase()];
    if (!nameWords.length) return;
    const key = credentialKey(name) || name.toLowerCase();
    if (!key || out.some((m) => m.line === line && m.key === key)) return;
    out.push({ line, term, name, key, nameWords, where, raw, named: namedIn(name).length > 0, context, unit, part, ...(opts.title ? { title: true } : {}) });
  };

  let seenHeading = false;
  ls.forEach((l, i) => {
    if (CRED_SECTION_RE.test(l.replace(/:$/, ""))) { section = "credentials"; seenHeading = true; return; }
    if (SKILLS_RE.test(l.replace(/:$/, ""))) { section = "skills"; seenHeading = true; return; }
    if (isSectionEnd(l)) { section = "other"; seenHeading = true; return; }
    if (i === 0 || CONTACT_LINE_RE.test(l)) return;
    context = l;
    const body = l.replace(/^\s*[-•*]\s*/, "");

    // A dated job header: its title is asked about only when it claims a credential
    // ("CERTIFIED NURSING ASSISTANT", "LICENSED ELECTRICIAN", "JOURNEYMAN ELECTRICIAN").
    if (section === "other" && seenHeading && isDatedHeader(l)) {
      const title = titleOfHeader(l);
      if (title && (isCredentialTerm(title) || TITLE_CREDENTIAL_RE.test(title))) push(l, title, "other", false, title, title, title, { title: true });
      return;
    }

    if (section === "credentials") {
      // Every part of a credentials line is a credential to ask about, each on its own.
      const units = credentialUnitsOf(l);
      if (units.length >= 2) {
        for (const u of units) push(u.part, u.part, "credentials", true, u.part, u.unit, u.part, { anyName: true });
        return;
      }
      if (units.length === 1) push(l, units[0].part, "credentials", false, body, units[0].unit, units[0].part, { anyName: true });
      return;
    }
    if (section === "skills") {
      for (const t of skillTermsOf(l)) {
        if (isCredentialTerm(t)) push(t, namedIn(t)[0] ?? t, "skills", true, t, t, t);
      }
      return;
    }
    // Any other line: every named credential, licensure initial and holding claim in it.
    const units = credentialUnitsOf(body);
    const lone = units.length === 1 ? units[0] : null;
    const at = (raw: string) => (lone && lone.part.toLowerCase().includes(raw.toLowerCase()) ? lone : { part: body, unit: body });
    for (const n of namedIn(l)) push(l, n, "other", false, n, at(n).unit, at(n).part);
    for (const m of l.matchAll(credentialInitialsRe())) push(l, m[0], "other", false, m[0], at(m[0]).unit, at(m[0]).part);
    for (const m of l.matchAll(HOLDING_LIST_RE)) {
      const raw = m[0].trim();
      push(l, raw, "other", false, raw, at(raw).unit, at(raw).part, { anyName: true });
    }
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
      push(l, raw, "other", false, raw, at(raw).unit, at(raw).part);
    }
    for (const m of l.matchAll(LEADING_CLAIM_RE)) {
      if (NOT_A_NAME_RE.test(m[2])) continue;
      // "Forklift Certified Line Cook": the claim word already closes "Forklift Certified"; "Line Cook" is the job.
      if (claimWordAt.has(m.index!)) continue;
      push(l, `${m[1]} ${m[2]}`, "other", false, m[0], at(m[0]).unit, at(m[0]).part);
    }
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
const STATUS_TOKEN_RE = /\b(?:active|current|currently|valid|expired|expires|expiring|inactive|lapsed|renewed|suspended|revoked|in good standing|good standing|completed|in progress|enrolled|pending)\b/gi;
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
 * The person's own lines, whole. A line that only continues the one before
 * it (it starts in lower case or a bracket, or names no credential: "expired
 * in 2020", "(card lost, expired)") stays with it, so a page line can never
 * match half of what they wrote.
 */
export function personCredentialLines(personText: string | undefined): PersonLine[] {
  const joined: string[] = [];
  let open = false; // a blank line ends a paragraph: nothing joins across it
  for (const raw of (personText || "").split("\n")) {
    const l = raw.trim();
    if (!l) {
      open = false;
      continue;
    }
    const prev = joined.length - 1;
    const short = l.split(/\s+/).length <= 5 && !isCredentialTerm(l) && (STATUS_WORD_RE.test(l) || NOT_HELD_RE.test(l));
    if (open && prev >= 0 && (/^[a-z(]/.test(l) || short)) joined[prev] = `${joined[prev]}; ${l}`;
    else joined.push(l);
    open = true;
  }
  return joined.map((l) => {
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

/** Kept for older callers: the person's lines, whole and normalised. */
export function typedCredentialEntries(answer: string | undefined): Set<string> {
  return new Set(personCredentialLines(answer).map((p) => p.whole));
}

const statusSet = (s: string) => new Set((s.toLowerCase().match(STATUS_TOKEN_RE) ?? []).map((w) => w.replace(/^good standing$/, "in good standing")));
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
    for (const s of l.split(/(?<=[.!?;])\s+/)) {
      if (NEGATED_RE.test(s)) continue;
      const lead = s.match(/^([A-Za-z][A-Za-z'&/ -]{1,40}?)\s+(?:at|for|with)\s+[A-Z0-9]/);
      if (lead) add(lead[1]);
      for (const m of s.matchAll(/\b(?:worked|work|working|was|served|hired|employed|started)\s+as\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z'&/ -]{1,40}?)(?=\s+(?:at|for|with|in|from|on|until|since|and)\b|[.,;]|$)/gi)) add(m[1]);
      for (const m of s.matchAll(/\bI\s+(?:was|am)\s+(?:an?|the)\s+([A-Za-z][A-Za-z'&/ -]{1,40}?)(?=\s+(?:at|for|with|in|from)\b)/gi)) add(m[1]);
    }
  }
  return out;
}

/** True when the whole title is one of the person's own job titles. */
export function titleIsTheirs(title: string, personText: string | undefined): boolean {
  const n = normalizeTyped(title);
  return !!n && personJobTitles(personText).has(n);
}

// ---- the backstop: capitals nobody gave us -------------------------------------------

const BACKSTOP_SKIP = new Set(["US", "USA", "UK", "AM", "PM", "OK", "ID", "IDS", "TV", "PC", "LLC", "INC", "ASAP", "FAQ", "PDF", "HR", "II", "III", "IV"]);
const CAPS_TOKEN_RE = /\b(?:[A-Z]{2,6}|[A-Z]+\d+[A-Z\d]*|\d+[A-Z]+[A-Z\d]*)\b/g;
const mostlyCaps = (l: string) => {
  const letters = l.replace(/[^A-Za-z]/g, "");
  return letters.length > 0 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6;
};

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
    if (i === 0 || CONTACT_LINE_RE.test(l) || isEntryHeader(l) || mostlyCaps(l)) return;
    const body = l.replace(/^\s*[-•*]\s*/, "");
    const terms = section === "other" ? [] : skillTermsOf(l);
    for (const m of l.matchAll(CAPS_TOKEN_RE)) {
      const tok = m[0];
      if (BACKSTOP_SKIP.has(tok)) continue;
      // A bracketed agency after a name ("Certified Forklift Operator (OSHA)") is wording about it.
      if (new RegExp(`^(?:${AGENCIES})$`).test(tok) && l[m.index! - 1] === "(" && l[m.index! + tok.length] === ")") continue;
      if (new RegExp(`\\b${tok.toLowerCase()}\\b`).test(person)) continue;
      if (known.some((k) => k.context === l && new RegExp(`\\b${tok}\\b`).test(k.raw))) continue;
      const asTerm = terms.find((t) => t.trim() === tok);
      const key = credentialKey(tok);
      if (out.some((o) => o.key === key && o.context === l)) continue;
      out.push({ line: asTerm ?? l, term: !!asTerm, name: tok, key, nameWords: [tok.toLowerCase()], raw: tok, named: false, where: section, context: l, unit: asTerm ?? body, part: asTerm ?? body });
    }
  });
  return out;
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
export function credentialsToAsk(text: string, personText?: string, skipKeys: Set<string> = new Set()): CredentialMention[] {
  const person = personCredentialLines(personText);
  const all = [...credentialMentionsOf(text), ...backstopMentionsOf(text, personText)];
  const skip = Array.from(skipKeys);
  const ask = all.filter((m) => {
    if (skip.some((k) => sameCredential(k, m.key))) return false;
    if (m.title) return !titleIsTheirs(m.raw, personText);
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

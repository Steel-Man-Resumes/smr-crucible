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
import { isWorkAcronym } from "./workAcronyms";
import { isStrictCredentialWhen } from "./credentialStatus";

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
}

const CRED_SECTION_RE = /^(?:certifications?|licenses?|licences?|credentials?|certifications? (?:and|&) licen[cs]es?|licen[cs]es? (?:and|&) certifications?)$/i;
const SKILLS_RE = /^(?:core competencies|skills|key skills|competencies|core skills|technical skills)$/i;
const EDUCATION_RE = /^(?:education|education and training|education & training|education\/training|schooling|academic background|training and education)$/i;
// Round 8: an education line is a credential too (GED, HSE, HiSET, a diploma, a degree, a certificate).
const EDUCATION_CREDENTIAL_RE =
  /\b(?:GED|HSE|HiSET|TASC|equivalency|diploma|degree|graduate|associate(?:'s)?|bachelor(?:'s)?|master(?:'s)?|doctorate|certificate|certification|A\.A\.S?\.?|B\.S\.?|B\.A\.?|M\.S\.?|M\.?B\.?A\.?)(?![\w])/i;

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
const OWN_BEFORE = /\b(?:as\s+an?|i\s+am\s+an?|i'm\s+an?|am\s+an?|an?)\s+$/i;

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
  return text.replace(/(?<=[A-Za-z])[-\u2010-\u2015](?=[A-Za-z])/g, " ");
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
    out.push({ line, term, name, key, nameWords, where, raw, named: namedIn(name).length > 0, context, unit, part, ...(opts.title ? { title: true } : {}), ...(opts.education ? { education: true } : {}) });
  };

  let seenHeading = false;
  let inEducation = false;
  ls.forEach((l, i) => {
    if (EDUCATION_RE.test(l.replace(/:$/, ""))) { section = "other"; inEducation = true; seenHeading = true; return; }
    if (CRED_SECTION_RE.test(l.replace(/:$/, ""))) inEducation = false;
    else if (SKILLS_RE.test(l.replace(/:$/, "")) || isSectionEnd(l)) inEducation = false;
    if (CRED_SECTION_RE.test(l.replace(/:$/, ""))) { section = "credentials"; seenHeading = true; return; }
    if (SKILLS_RE.test(l.replace(/:$/, ""))) { section = "skills"; seenHeading = true; return; }
    if (isSectionEnd(l)) { section = "other"; seenHeading = true; return; }
    if (i === 0 || CONTACT_LINE_RE.test(l)) return;
    context = l;
    const body = l.replace(/^\s*[-•*]\s*/, "");

    // An education line: its first part is the credential ("GED", "High School Diploma", "Associate Degree in ...").
    if (inEducation) {
      if (EDUCATION_CREDENTIAL_RE.test(body) || namedIn(body).length) {
        const first = credentialUnitsOf(body)[0] ?? { part: body, unit: body };
        const part = body.includes("|") ? titleOfHeader(body) : first.part;
        push(l, part, "credentials", false, part, body.includes("|") ? body : first.unit, part, { anyName: true, education: true });
      }
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
    // Round 7: a hyphen inside a word is read as a space, so "forklift-certified" is "forklift certified".
    // The line itself stays as written; a credential's words are found again across the hyphen when moved or cut.
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
    for (const m of lf.matchAll(LEADING_CLAIM_RE)) {
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
  /\b(?:certified(?!\s+(?:nursing|medical|pharmacy|welding|public|home|nurse|professional|clinical)\b)|certification|certifications|certificate|cert|licensed(?!\s+(?:practical|vocational|professional|clinical)\b)|license|licence|card|cards|training|course|program|endorsement|permit|registry|registered(?!\s+[A-Za-z])|holder|class(?![\s-]*[a-d0-9]\b))\b/gi;
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
  [/\b(?:course|training|class)\b/i, "training course"],
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
  return rows.some((r) => isCompleteCredentialRow(r) && shown.includes(normalizeTyped(credentialRowText(r))));
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
  return !!n && personJobTitles(personText).has(n);
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
      if (isWorkAcronym(tok) && !CLAIM_CONTEXT_RE.test(nearWords(l, m.index!, tok.length))) continue;
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
const RULES_AFTER_RE = /\b(?:guidelines?|standards?|rules?|regulations?|requirements?|procedures?|compliance|protocols?|practices?|policies|policy|codes?|logs?|checklists?)\b/i;
/** The two words after a token. */
function afterWords(l: string, index: number, length: number): string {
  return (l.slice(index + length).match(/[A-Za-z'-]+/g) ?? []).slice(0, 2).join(" ");
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

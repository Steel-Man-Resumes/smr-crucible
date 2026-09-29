/**
 * A credential says exactly what the person said it says (2026-09-28).
 *
 * Sample runs told a man who finished an EPA 608 course that he "has EPA 608"
 * and should say so to employers, and told a woman whose forklift certification
 * had expired that it was "renewable". The truth check covers some report
 * fields and not others, so this is a deterministic backstop over what the
 * report, the cover letter and the resume say.
 *
 * For common reentry-trade credentials it reads the status from the person's
 * own words, clause by clause: held, a course they took, one they want, one
 * that is no longer current (expired, suspended, revoked), or only mentioned.
 * A sentence that plainly claims more than that status for that credential is
 * FLAGGED for the person to check, never deleted: two reviews showed that
 * reading status from free text is too uncertain to delete on, and deleting a
 * true line about someone's real license is the worst mistake here. The prompts
 * and the truth check steer the model away from overstating in the first place.
 */

type Status = "held" | "course" | "wanted" | "not_current" | "mentioned";

/** `named`: the credential is its own name (EPA 608, CDL). Otherwise the word is
 *  also a skill (forklift, welding), so only an explicit certification claim counts. */
const CREDENTIALS: { key: string; re: RegExp; named: boolean }[] = [
  { key: "EPA 608", re: /\bEPA\s*(?:section\s*)?608\b/i, named: true },
  { key: "OSHA 10", re: /\bOSHA[\s-]*10\b/i, named: true },
  { key: "OSHA 30", re: /\bOSHA[\s-]*30\b/i, named: true },
  { key: "CDL", re: /\bCDL\b|\bcommercial driver'?s? licen[cs]e\b/i, named: true },
  { key: "ServSafe", re: /\bserv\s?safe\b/i, named: true },
  { key: "NCCER", re: /\bNCCER\b/i, named: true },
  { key: "CNA", re: /\bCNA\b|\bcertified nursing assistant\b/i, named: true },
  { key: "forklift", re: /\bforklift\b/i, named: false },
  { key: "food handler", re: /\bfood handler/i, named: false },
  { key: "CPR", re: /\bCPR\b|\bfirst aid\b/i, named: false },
  { key: "flagger", re: /\bflagger\b/i, named: false },
  { key: "welding", re: /\bwelding\b/i, named: false },
];

const NOT_CURRENT_RE = /\b(expired|lapsed|out of date|suspended|revoked|disqualified|lost|taken away|cancell?ed|no longer (?:valid|current|active)|pending reinstatement)\b/i;
const RENEWAL_RE = /\b(renewed|recertified|reinstated)\b/i;
const ATTAIN_RE = /\b(certified|certification|certificate|licensed|license|licence|card|passed|holder|endorsement|registry)\b/i;
const COURSE_RE = /\b(course|courses|class|classes|training|coursework|program|studying|enrolled|in progress)\b/i;
const WANT_RE = /\b(want|wants|wanting|plan|plans|planning|hope|hoping|need|needs|going to|working toward|working on|studying for|would like|trying to get|don'?t have|do not have|no)\b[^,;.\n]{0,25}$/i;

function clausesOf(text: string): string[] {
  return text
    .split(/\n+|[;,.](?=\s|$)|\s+-\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Classify one clause that mentions the credential. A named credential the
 *  person simply lists ("Class A CDL, 2019", "OSHA 10, 2021") is held; a skill
 *  word on its own ("Forklift operator") says nothing about certification. */
function clauseStatus(clause: string, re: RegExp, named: boolean): Status {
  // "certification course" is a course; "Class A" (a CDL class) is not a class.
  const c = clause
    .replace(/\b(certification|license|licence)\s+(course|class|prep|training|program)\b/gi, "$2")
    .replace(/\bclass\s+[a-d]\b/gi, " ");
  const at = c.search(re);
  const before = at > 0 ? c.slice(0, at) : "";
  if (NOT_CURRENT_RE.test(c) && !RENEWAL_RE.test(c)) return "not_current";
  if (WANT_RE.test(before)) return "wanted";
  if (ATTAIN_RE.test(c) || RENEWAL_RE.test(c)) return "held";
  if (COURSE_RE.test(c)) return "course";
  return named ? "held" : "mentioned";
}

/** Status of each credential named in the person's own words. */
export function credentialStatuses(source: string): Map<string, Status> {
  const out = new Map<string, Status>();
  const clauses = clausesOf(source);
  for (const { key, re, named } of CREDENTIALS) {
    const mine = clauses.filter((c) => re.test(c));
    if (!mine.length) continue;
    const statuses = mine.map((c) => clauseStatus(c, re, named));
    if (mine.some((c) => RENEWAL_RE.test(c))) out.set(key, "held");
    else if (statuses.includes("not_current")) out.set(key, "not_current");
    else if (statuses.includes("held")) out.set(key, "held");
    else if (statuses.includes("course")) out.set(key, "course");
    else if (statuses.includes("wanted")) out.set(key, "wanted");
    else out.set(key, "mentioned");
  }
  return out;
}

const CERT_WORDS = String.raw`(?:certification|certificate|license|licence|card|credential)`;
const NOT_OWNING_NEXT = String.raw`(?!\s+(?:type\s+[ivx]+(?:\s+and\s+[ivx]+)?\s+)?(?:course|courses|class|classes|training|coursework|program|prep|practice|test|tests|exam|exams|fee|fees|study|studying))`;
// Earning it, not claiming it: a real earning verb, or a condition ("once you
// pass"), aimed at the credential, a certification word or the exam.
const EARN_VERBS = String.raw`\b(?:get|getting|earn|earning|pass|passing|renew|renewing|become|becoming|enroll|enrolling|sign up for|study for|studying for|apply for|register for|schedule|scheduling|take|taking|once you|after you|when you|until you|before you)\b`;
function earnsIt(sentence: string, cred: string): boolean {
  return new RegExp(String.raw`${EARN_VERBS}[^.!?]{0,30}(?:${cred}|certified|certification|certificate|licensed|license|licence|card|exam|test)`, "i").test(sentence);
}
const CURRENT_WORDS = String.raw`(?:current|currently|active|valid|renewable|up to date|in good standing)`;

/** A claim of holding the credential, bound to that credential's name. */
function bound(sentence: string, re: RegExp, named: boolean): boolean {
  const cred = `(?:${re.source})`;
  const tests = [
    // "your EPA 608 Type I and II certification", "my forklift card"
    String.raw`\b(?:your|my)\s+(?:[\w-]+\s+){0,2}${cred}(?:\s+[\w()-]+){0,5}?\s+${CERT_WORDS}\b`,
    // "certified forklift operator", "EPA 608 certified", "Forklift Certified"
    String.raw`\b(?:certified|licensed)\s+(?:[\w-]+\s+){0,2}${cred}`,
    String.raw`${cred}(?:\s+[\w-]+){0,2}\s+(?:certified|licensed)\b`,
  ];
  if (named) {
    tests.push(
      // "your EPA 608" (not "your EPA 608 course" or "your EPA 608 test fee")
      String.raw`\b(?:your|my)\s+${cred}${NOT_OWNING_NEXT}`,
      // "you have EPA 608", "I hold a CDL", "holds a CDL"
      String.raw`\b(?:you|i)(?:'ve|\s+have|\s+hold|\s+earned|\s+got)\s+(?:an?\s+|the\s+|your\s+|my\s+)?${cred}${NOT_OWNING_NEXT}`,
      String.raw`\b(?:hold|holds|has)\s+(?:an?\s+|the\s+|your\s+)?${cred}${NOT_OWNING_NEXT}`
    );
  } else {
    tests.push(String.raw`\b(?:you|i)(?:'ve|\s+have|\s+hold|\s+earned|\s+got)\s+(?:an?\s+|the\s+|your\s+|my\s+)?${cred}\s+${CERT_WORDS}\b`);
  }
  return tests.some((t) => new RegExp(t, "i").test(sentence));
}

const SAYS_CERTIFIED = /\b(?:you're|you are|i'm|i am)\s+(?:[\w-]+\s+){0,2}(?:certified|licensed)\b/i;

/** Does this sentence claim more than the person's own words give a credential? */
export function claimsMoreThanGiven(sentence: string, statuses: Map<string, Status>): boolean {
  for (const { key, re, named } of CREDENTIALS) {
    if (!re.test(sentence)) continue;
    const status = statuses.get(key) ?? "mentioned";
    if (status === "held") continue;
    const cred = `(?:${re.source})`;
    if (status === "not_current") {
      if (NOT_CURRENT_RE.test(sentence)) continue; // it says so
      // Calling it current is a claim even when the sentence also talks about renewing.
      if (new RegExp(String.raw`${cred}[^.!?]{0,40}\b${CURRENT_WORDS}\b|\b${CURRENT_WORDS}\s+(?:[\w-]+\s+){0,2}${cred}`, "i").test(sentence)) return true;
      if (earnsIt(sentence, cred)) continue;
      if (bound(sentence, re, named) || SAYS_CERTIFIED.test(sentence)) return true;
      continue;
    }
    if (earnsIt(sentence, cred)) continue;
    if (bound(sentence, re, named)) return true;
    if (status === "course" || status === "wanted") {
      if (SAYS_CERTIFIED.test(sentence)) return true;
      // "the course, which is the certification": a course equated with the credential.
      if (
        COURSE_RE.test(sentence) &&
        /\bcertification\b(?!\s+(?:course|class|prep|training|program))/i.test(sentence) &&
        !/\b(exam|test|prepare|prepares|toward|towards|next step|require|requires|required)\b/i.test(sentence)
      ) return true;
    }
  }
  return false;
}

/** A short item (a skill name, a resume certification line) naming the
 *  credential as a certification, license or card is itself a claim. */
export function itemClaimsMoreThanGiven(item: string, statuses: Map<string, Status>): boolean {
  if (claimsMoreThanGiven(item, statuses)) return true;
  for (const { key, re } of CREDENTIALS) {
    if (!re.test(item)) continue;
    const status = statuses.get(key) ?? "mentioned";
    if (status === "held") continue;
    if (status === "not_current" && NOT_CURRENT_RE.test(item)) continue;
    const cred = `(?:${re.source})`;
    if (new RegExp(String.raw`${cred}(?:\s+[\w()-]+){0,4}?\s+${CERT_WORDS}\b(?!\s+(?:course|class|prep|training|program|exam|test))|\b${CERT_WORDS}\s*(?:in|for|of|:)?\s*${cred}`, "i").test(item)) {
      return true;
    }
  }
  return false;
}

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

/** Sentences in prose that claim more than the person's words give a credential.
 *  Nothing is removed: these are shown to the person to check. Reading status
 *  from free text is too uncertain to delete on, and a wrong flag costs a glance. */
export function findOverstatedCredentials(text: string, statuses: Map<string, Status>): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    for (const s of sentencesOf(line)) if (s.trim() && claimsMoreThanGiven(s, statuses)) found.push(s.trim());
  }
  return found;
}

const JOB_HEADER = /\s\|\s.*\b(19|20)\d\d\b/;

/** Resume: short lines (headline, certification entries, competencies) are
 *  checked as items, longer lines sentence by sentence. Job header lines are
 *  skipped. Nothing is removed. */
export function findOverstatedCredentialLines(text: string, statuses: Map<string, Status>): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || JOB_HEADER.test(trimmed)) continue;
    const words = trimmed.split(/\s+/).length;
    if (words <= 12) {
      if (itemClaimsMoreThanGiven(trimmed.replace(/^[-\u2022*]\s*/, ""), statuses)) found.push(trimmed);
    } else {
      found.push(...findOverstatedCredentials(trimmed, statuses));
    }
  }
  return found;
}

// Labels, not claims about the person.
const LABEL_KEYS = new Set(["industry", "category", "type", "schema_version", "generated_at"]);

/** The same check over the Forge report object. Skill names and strength titles
 *  are checked as items; career-path and resource titles are labels; prose is
 *  checked sentence by sentence. Nothing is removed. */
export function findOverstatedCredentialsDeep(value: unknown, statuses: Map<string, Status>): string[] {
  const found: string[] = [];
  const ITEM_LISTS = new Set(["skills", "strengths"]);
  // `list` is the key of the nearest array above this value.
  const walk = (v: unknown, key: string | undefined, list: string | undefined): void => {
    if (typeof v === "string") {
      if (key && LABEL_KEYS.has(key)) return;
      const isItem = (key === undefined || key === "name" || key === "title") && list !== undefined && ITEM_LISTS.has(list);
      if (isItem) {
        if (itemClaimsMoreThanGiven(v, statuses)) found.push(v);
        return;
      }
      if (key === "name" || key === "title") return; // career-path and resource titles are labels
      found.push(...findOverstatedCredentials(v, statuses));
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, undefined, key ?? list);
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) walk(val, k, list);
    }
  };
  walk(value, undefined, undefined);
  return Array.from(new Set(found));
}

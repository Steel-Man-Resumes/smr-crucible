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
 * A sentence is removed only when it plainly claims more than that status for
 * that credential. When in doubt it keeps the sentence: deleting a true line
 * about someone's real license is worse than missing an overstatement, which
 * the truth check and the prompts also guard against.
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

/** Remove sentences that overstate a credential from prose. Keeps line breaks. */
export function stripOverstatedCredentials(text: string, statuses: Map<string, Status>): { text: string; removed: string[] } {
  const removed: string[] = [];
  const lines = text.split("\n").map((line) =>
    sentencesOf(line)
      .filter((s) => {
        if (claimsMoreThanGiven(s, statuses)) {
          removed.push(s.trim());
          return false;
        }
        return true;
      })
      .join(" ")
  );
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n"), removed };
}

/** Resume: short lines (headline, certification entries, competencies) are
 *  items and are dropped whole; longer lines are prose and lose only the
 *  overstated sentence. Lines are never merged. */
export function stripOverstatedCredentialLines(text: string, statuses: Map<string, Status>): { text: string; removed: string[] } {
  const removed: string[] = [];
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const words = line.trim().split(/\s+/).filter(Boolean).length;
    if (words > 0 && words <= 12) {
      if (itemClaimsMoreThanGiven(line.replace(/^\s*[-•*]\s*/, ""), statuses)) {
        removed.push(line.trim());
        continue;
      }
      out.push(line);
      continue;
    }
    if (words > 12) {
      const r = stripOverstatedCredentials(line, statuses);
      removed.push(...r.removed);
      out.push(r.text);
      continue;
    }
    out.push(line);
  }
  return { text: out.join("\n"), removed };
}

// Keys whose strings are names or labels, not sentences about the person.
const LABEL_KEYS = new Set(["title", "name", "industry", "category", "type", "schema_version", "generated_at"]);

/** The same sweep over the Forge report object. Prose loses the overstated
 *  sentences; a list item left empty is dropped; a skill whose name is the
 *  overstated claim is dropped. Career paths and resources are never dropped,
 *  and labels are never touched. */
export function stripOverstatedCredentialsDeep<T>(value: T, statuses: Map<string, Status>): { value: T; removed: string[] } {
  const removed: string[] = [];
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") {
      if (key && LABEL_KEYS.has(key)) return v;
      const r = stripOverstatedCredentials(v, statuses);
      removed.push(...r.removed);
      return r.text;
    }
    if (Array.isArray(v)) {
      if (key === "skills") {
        return v
          .filter((item) => {
            const name = typeof item === "string" ? item : (item as { name?: unknown })?.name;
            if (typeof name === "string" && itemClaimsMoreThanGiven(name, statuses)) {
              removed.push(name);
              return false;
            }
            return true;
          })
          .map((item) => walk(item));
      }
      return v
        .map((item) => ({ before: item, after: walk(item) }))
        .filter(({ before, after }) => !(typeof after === "string" && after.trim() === "" && typeof before === "string" && before.trim() !== ""))
        .map(({ after }) => after);
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val, k);
      return out;
    }
    return v;
  };
  return { value: walk(value) as T, removed };
}

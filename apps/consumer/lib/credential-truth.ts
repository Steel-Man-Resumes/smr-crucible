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
 * Only the course, wanted and not-current cases are checked, since those are
 * the ones the person's words settle. A sentence that plainly claims more than
 * that status for that credential is FLAGGED for the person to check, never
 * deleted: two reviews showed that
 * reading status from free text is too uncertain to delete on, and deleting a
 * true line about someone's real license is the worst mistake here. The prompts
 * and the truth check steer the model away from overstating in the first place.
 */

type Status = "held" | "course" | "wanted" | "not_current" | "mentioned";

/**
 * `named`: the credential is its own name (EPA 608, CDL); otherwise the word is
 * also a skill (forklift, welding), so only an explicit certification claim counts.
 * `exam`: earning it takes a test after the class (EPA 608, CDL, CNA). For
 * completion credentials (OSHA 10/30, CPR, flagger, food handler, forklift, an
 * NCCER level) finishing the training IS getting it, so a finished training
 * line is not a course-only status.
 */
const CREDENTIALS: { key: string; re: RegExp; named: boolean; exam: boolean }[] = [
  { key: "EPA 608", re: /\bEPA\s*(?:section\s*)?608\b/i, named: true, exam: true },
  { key: "OSHA 10", re: /\bOSHA[\s-]*10\b|\b10[\s-]*(?:hour|hr)\s+OSHA\b/i, named: true, exam: false },
  { key: "OSHA 30", re: /\bOSHA[\s-]*30\b|\b30[\s-]*(?:hour|hr)\s+OSHA\b/i, named: true, exam: false },
  { key: "CDL", re: /\bCDL\b|\bcommercial driver'?s? licen[cs]e\b/i, named: true, exam: true },
  { key: "ServSafe", re: /\bserv\s?safe\b/i, named: true, exam: true },
  { key: "NCCER", re: /\bNCCER\b/i, named: true, exam: false },
  { key: "CNA", re: /\bCNA\b|\bcertified nursing assistant\b/i, named: true, exam: true },
  { key: "forklift", re: /\bforklift\b/i, named: false, exam: false },
  { key: "food handler", re: /\bfood handler/i, named: false, exam: false },
  { key: "CPR", re: /\bCPR\b|\bfirst aid\b/i, named: false, exam: false },
  { key: "flagger", re: /\bflagg(?:er|ing)\b/i, named: false, exam: false },
  { key: "welding", re: /\bweld(?:ing|er|ers)\b/i, named: false, exam: true },
];

const NOT_CURRENT_WORDS = String.raw`(?:expired|lapsed|out of date|suspended|revoked|cancell?ed|no longer (?:valid|current|active)|pending reinstatement)`;
const RENEWAL_WORDS = String.raw`(?:renewed|recertified|reinstated|restored|reissued|valid again|current again|active again|now valid|valid now|now active|active now|now current|back in good standing|have it again|got (?:it|them|my [\w-]+(?: [\w-]+)?) back)`;
const ATTAIN_WORDS = String.raw`(?:certified|certification|certificate|cert|certs|licensed|license|licence|card|passed|holder|endorsement|registry|permit|ticket)`;
const COURSE_RE = /\b(course|courses|class|classes|training|coursework|program|studying|enrolled|in progress)\b/i;
// Not finished yet: a course even for a completion credential.
const UNFINISHED_RE = /\b(in progress|enrolled|studying|currently taking|signed up|starting)\b/i;
// Words that make a renewal or certification something wanted or ahead, not done:
// "need to get it renewed", "can be restored", "prepares you for certification".
const AHEAD_RE = /\b(need|needs|want|wants|trying|try|hope|hoping|plan|planning|going to|to get|get it|get my|to be|can be|could be|will be|until|once|if|when|waiting|for|toward|towards|prepare|prepares|prep|eligible|take|taking|sit)\b/i;
// Wanting it: an aim at getting the credential, right before its name.
const WANT_RE = new RegExp(
  String.raw`(?:\b(?:want|wants|wanting|need|needs|plan|plans|planning|hope|hoping|going|trying|would like|'d like)\s+to\s+(?:get|earn|obtain|go for|pursue|take|start)\s+(?:an?\s+|my\s+|the\s+|your\s+)?(?:[\w-]+\s+){0,2}` +
    String.raw`|\b(?:working toward|working towards|working on getting|studying for|saving for|save up for|looking into getting)\s+(?:an?\s+|my\s+|the\s+)?(?:[\w-]+\s+){0,2}` +
    String.raw`|\b(?:want|wants)\s+(?:an?\s+|my\s+|the\s+)?(?:[\w-]+\s+)?)$`,
  "i"
);
// "No CDL yet", "don't have a forklift card": not having it, when nothing else
// follows the name ("no CDL violations" is about the record, not the license).
const NOT_HELD_BEFORE = /\b(?:no|don'?t have|do not have|never had|without)\s+(?:an?\s+|my\s+)?$/i;
const NOT_HELD_AFTER = /^(?:\s+(?:yet|license|licence|card|certification|cert)\b|\s*[,.;)]|\s*$|\s+(?:and|but|or|so)\b)/i;
// A heading the person wrote over a list of what they hold: "Certifications",
// "LICENSES/CERTIFICATIONS", "Training & Certifications", "Certifications: Welding".
const HEADING_WORD = String.raw`(?:licen[cs]es?|certifications?|certificates?|credentials?|training|cards?|tickets?)`;
const HELD_HEADING = new RegExp(String.raw`^\s*${HEADING_WORD}(?:\s*(?:and|&|/|,)\s*${HEADING_WORD})*\s*:?\s*$`, "i");
const INLINE_HEADING = new RegExp(String.raw`^\s*${HEADING_WORD}(?:\s*(?:and|&|/|,)\s*${HEADING_WORD})*\s*:\s*\S`, "i");
const HOLDING_WORD = /licen[cs]|certif|credential|card|ticket/i; // "Training" alone lists courses
const OTHER_HEADING = /^\s*(?:work\s+)?(?:experience|employment|work history|job history|education|skills|summary|objective|profile|references|projects|volunteer(?:ing)?|awards|interests|contact)\b[\w &/]*:?\s*$/i;

function otherCredentialIn(text: string, re: RegExp): boolean {
  const rest = text.replace(new RegExp(re.source, "gi"), " ");
  return CREDENTIALS.some((c) => c.re.source !== re.source && c.re.test(rest));
}

/** A word from `words` that happened, not one that is wanted or ahead. */
function doneWord(text: string, words: string): boolean {
  for (const m of Array.from(text.matchAll(new RegExp(String.raw`\b${words}\b`, "gi")))) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index);
    if (!AHEAD_RE.test(before)) return true;
  }
  return false;
}

/** The status word sits next to THIS credential ("my CDL was suspended"), is
 *  not negated ("never had my license suspended"), is not about another
 *  credential in between, and is not a period that ended ("suspended 2019 to 2021"). */
function notCurrentNear(text: string, re: RegExp): boolean {
  const cred = `(?:${re.source})`;
  const near = new RegExp(String.raw`${cred}(?:\W+\w+){0,5}?\W+${NOT_CURRENT_WORDS}\b|\b${NOT_CURRENT_WORDS}(?:\W+\w+){0,3}?\W+${cred}`, "gi");
  for (const m of Array.from(text.matchAll(near))) {
    const inside = m[0];
    if (otherCredentialIn(inside, re) || /\bbut\b/i.test(inside)) continue;
    const before = text.slice(0, m.index ?? 0).split(/\s+/).slice(-2).join(" ");
    if (/\b(never|not|no|without)\b/i.test(`${before} ${inside.replace(new RegExp(NOT_CURRENT_WORDS, "gi"), " ")}`)) continue;
    const after = text.slice((m.index ?? 0) + inside.length);
    if (/^\s*(?:from\s+)?(?:19|20)\d\d\s*(?:-|–|to|through|until)\s*(?:19|20)\d\d\b/i.test(after)) continue;
    return true;
  }
  return false;
}

/** "Valid Class A CDL", "my CDL is still active": the person says it is current now. */
function saysCurrent(text: string, re: RegExp): boolean {
  const cred = `(?:${re.source})`;
  const m = text.match(new RegExp(String.raw`\b(?:valid|current|active|in good standing)\s+(?:[\w-]+\s+){0,2}${cred}|${cred}(?:\W+\w+){0,3}?\W+(?:is|are)\s+(?:still\s+)?(?:valid|current|active|in good standing)\b`, "i"));
  if (!m) return false;
  const before = text.slice(0, m.index ?? 0).split(/\s+/).slice(-2).join(" ");
  return !/\b(not|no|never)\b/i.test(before) && !/\bnot\b/i.test(m[0]);
}

/** "certification course" is a course; "Class A" next to a CDL or license is not a class. */
function prep(text: string): string {
  return text
    .replace(/\b(certification|license|licence)\s+(course|class|prep|training|program)\b/gi, "$2")
    .replace(/\bclass\s+[a-d]\b(?=\s*(?:cdl|commercial|license|licence|driver))|(?<=\bcdl\s*)\bclass\s+[a-d]\b/gi, " ");
}

type Clause = { text: string; scope: string; next: string; underHeading: boolean };

/** Classify one clause that mentions the credential. `scope` is the whole line
 *  when the line names no other credential ("Completed CNA program, on the
 *  state registry"), so a word split off by a comma still counts. A named
 *  credential the person simply lists ("Class A CDL, 2019") is held; a skill
 *  word on its own ("Forklift operator") says nothing about certification. */
function clauseStatus(cl: Clause, cred: { re: RegExp; named: boolean; exam: boolean }): Status {
  const c = prep(cl.text);
  const scope = prep(cl.scope);
  const at = c.search(cred.re);
  const before = at > 0 ? c.slice(0, at) : "";
  const after = at >= 0 ? c.slice(at).replace(cred.re, "") : "";
  if (notCurrentNear(c, cred.re)) return "not_current";
  if (WANT_RE.test(before) || (NOT_HELD_BEFORE.test(before) && NOT_HELD_AFTER.test(after))) return "wanted";
  if (cl.underHeading && !COURSE_RE.test(c)) return "held";
  if (doneWord(scope, ATTAIN_WORDS)) return "held";
  if (COURSE_RE.test(c)) return cred.exam || UNFINISHED_RE.test(c) ? "course" : "held";
  return cred.named ? "held" : "mentioned";
}

/** Status of each credential named in the person's own words. */
export function credentialStatuses(source: string): Map<string, Status> {
  const lines = source.split("\n");
  const clauses: Clause[] = [];
  let underHeading = false;
  lines.forEach((line, i) => {
    if (!line.trim()) { underHeading = false; return; }
    if (HELD_HEADING.test(line) && HOLDING_WORD.test(line)) { underHeading = true; return; }
    if (OTHER_HEADING.test(line)) { underHeading = false; return; }
    const inline = INLINE_HEADING.test(line) && HOLDING_WORD.test(line.split(":")[0]);
    const next = lines[i + 1] ?? "";
    for (const c of line.split(/[;,.](?=\s|$)|\s+-\s+/)) {
      if (c.trim()) clauses.push({ text: c.trim(), scope: line, next, underHeading: underHeading || inline });
    }
  });
  const out = new Map<string, Status>();
  for (const cred of CREDENTIALS) {
    // "ServSafe Food Handler" is one credential: the named key decides.
    const mine = clauses
      .filter((c) => cred.re.test(c.text) && !(cred.key === "food handler" && /\bserv\s?safe\b/i.test(c.text)))
      // A line that names another credential too is read clause by clause.
      .map((c) => (otherCredentialIn(c.scope, cred.re) ? { ...c, scope: c.text } : c));
    if (!mine.length) continue;
    // Current now beats an old status: "Valid Class A CDL" with "revoked in 2014"
    // elsewhere, "suspended in 2019, got it back in 2023", or "Reinstated in 2022"
    // on the next line. A renewal that is wanted ("need to get it renewed") does not count.
    const nextOk = (c: Clause) => !CREDENTIALS.some((k) => k.re.test(c.next));
    const currentNow = mine.some(
      (c) => saysCurrent(prep(c.text), cred.re) || doneWord(c.scope, RENEWAL_WORDS) || (nextOk(c) && doneWord(c.next, RENEWAL_WORDS))
    );
    const statuses = mine.map((c) => clauseStatus(c, cred));
    if (currentNow) out.set(cred.key, "held");
    else if (statuses.includes("not_current")) out.set(cred.key, "not_current");
    else if (statuses.includes("held")) out.set(cred.key, "held");
    else if (statuses.includes("course")) out.set(cred.key, "course");
    else if (statuses.includes("wanted")) out.set(cred.key, "wanted");
    else out.set(cred.key, "mentioned");
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

const NOT_CURRENT_RE = new RegExp(String.raw`\b${NOT_CURRENT_WORDS}\b`, "i");

/** "You are certified" close to this credential's name: within five words, in
 *  the same clause, and not about another credential ("You're forklift certified
 *  and took the EPA 608 course"). It may reach past "and" only when "certified"
 *  names no object of its own: "certified in food safety and finished the EPA
 *  608 course" is about food safety. */
function saysCertified(sentence: string, re: RegExp): boolean {
  const cred = `(?:${re.source})`;
  const says = String.raw`\b(?:you're|you are|i'm|i am)\s+(?:[\w-]+\s+){0,2}(?:certified|licensed)\b`;
  const bare = String.raw`${says}(?!\s+(?:in|as|for|to|by|through|with|on)\b)`;
  const strictGap = String.raw`(?:[^\w,;]+(?!(?:and|but|or|plus|while|also|then)\b)\w+){0,5}?[^\w,;]+`;
  const looseGap = String.raw`(?:[^\w,;]+\w+){0,5}?[^\w,;]+`;
  const all = new RegExp(String.raw`${says}${strictGap}${cred}|${bare}${looseGap}${cred}|${cred}${strictGap}${says}`, "gi");
  return Array.from(sentence.matchAll(all)).some((m) => !otherCredentialIn(m[0], re));
}

/** Only these statuses are flagged: the person's words say the credential is a
 *  course, a goal, or no longer current. A credential they hold, or one they
 *  never said anything about, is left to the truth check. */
const FLAGGED: Status[] = ["course", "wanted", "not_current"];

/** Does this sentence claim more than the person's own words give a credential? */
export function claimsMoreThanGiven(sentence: string, statuses: Map<string, Status>): boolean {
  for (const { key, re, named } of CREDENTIALS) {
    if (!re.test(sentence)) continue;
    const status = statuses.get(key);
    if (!status || !FLAGGED.includes(status)) continue;
    const cred = `(?:${re.source})`;
    if (status === "not_current") {
      if (NOT_CURRENT_RE.test(sentence)) continue; // it says so
      // Calling it current is a claim even when the sentence also talks about renewing.
      if (new RegExp(String.raw`${cred}[^.!?]{0,40}\b${CURRENT_WORDS}\b|\b${CURRENT_WORDS}\s+(?:[\w-]+\s+){0,2}${cred}`, "i").test(sentence)) return true;
      if (earnsIt(sentence, cred)) continue;
      if (bound(sentence, re, named) || saysCertified(sentence, re)) return true;
      continue;
    }
    if (earnsIt(sentence, cred)) continue;
    if (bound(sentence, re, named)) return true;
    if (saysCertified(sentence, re)) return true;
    // "the course, which is the certification": a course equated with the credential.
    if (
      COURSE_RE.test(sentence) &&
      /\bcertification\b(?!\s+(?:course|class|prep|training|program))/i.test(sentence) &&
      !/\b(exam|test|prepare|prepares|toward|towards|next step|require|requires|required)\b/i.test(sentence)
    ) return true;
  }
  return false;
}

/** A short item (a skill name, a resume certification line) naming the
 *  credential as a certification, license or card is itself a claim. */
export function itemClaimsMoreThanGiven(item: string, statuses: Map<string, Status>): boolean {
  if (claimsMoreThanGiven(item, statuses)) return true;
  for (const { key, re } of CREDENTIALS) {
    if (!re.test(item)) continue;
    const status = statuses.get(key);
    if (!status || !FLAGGED.includes(status)) continue;
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

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
  { key: "OSHA 30", re: /\bOSHA[\s-]*30\b|\bOSHA[\s-]*10\s*\/\s*30\b|\b30[\s-]*(?:hour|hr)\s+OSHA\b/i, named: true, exam: false },
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

const NOT_CURRENT_WORDS = String.raw`(?:expired|lapsed|out of date|suspended|revoked|cancell?ed|inactive|ran out|run out|no longer (?:valid|current|active|good)|not (?:valid|current|active)|pending reinstatement)`;
// Signs it is current now, said next to the credential ("valid Class A CDL",
// "CDL is current"), or as renewal anywhere on its line.
const CURRENT_NEAR_RE = /\b(valid|current|active|in good standing|up to date)\b/i;
const RENEWED_RE = /\b(renewed|recertified|reinstated|restored|reissued|retook|retested|re-took|re-tested|valid again|current again|active again|have it again|driving again|got (?:it|them|my [\w-]+(?: [\w-]+)?) back)\b/i;
// A line part that is only a currency word: "Class A CDL, current", "CDL - active".
const CURRENT_PART = /^\s*\(?\s*(?:still\s+|now\s+)?(?:valid|current|active|in good standing|up to date)(?:\s+(?:now|again|through\s+\S+|thru\s+\S+|until\s+\S+|till\s+\S+))?\s*\)?\s*$/i;
const STILL_CURRENT = /\b(?:it'?s|it is|its|now|still|i'?m|im|i am)\s+(?:valid|current|active|good)\b|\b(?:valid|current|active)\b[^.;,]{0,25}\b(?:now|again)\b/i;
// A pending renewal ("need to get it renewed", "can be restored") never counts.
const PENDING_RE = /\b(?:need|needs|trying|try|want|wants|hope|hoping|plan|planning|waiting|going|have)\s+to\s+(?:get\s+)?(?:it\s+|them\s+|my\s+[\w-]+(?:\s+[\w-]+)?\s+)?(?:renew\w*|reinstat\w*|restor\w*|recertif\w*|back|valid|current|active)\b|\b(?:can|could|will|should|would)\s+be\s+(?:renew\w*|reinstat\w*|restor\w*|valid|current|active)\b|\bworking on getting (?:it|them|my [\w-]+) back\b/gi;
// Signs the person holds it, in the clause that names it.
const HOLD_WORDS = String.raw`(?:certified|certification|certificate|cert|certs|licensed|license|licence|card|passed|holder|endorsement|registry|permit|ticket|i have|i've got|i hold|which i have|got my|have my|earned my|i got (?:my|it|them|the|a|an))`;
// ...and elsewhere on its line, only unmistakable ones.
const REST_HOLD_RE = /\b(passed|registry|certified|licensed|which i have|i have (?:it|one|them)|got it|earned it|got my (?:license|licence|cert\w*|card|cdl|ticket))\b/i;
// A hold word right after one of these is not holding it: "get certified",
// "no card", "never got certified".
const NOT_HOLD_BEFORE = /\b(?:get|getting|be|become|becoming|being|to|no|not|never|without|don'?t have|do not have|didn'?t get|haven'?t|havent|never got)\s+(?:\w+\s+)?$/i;
const COURSE_RE = /\b(course|courses|class|classes|training|coursework|program|school|academy|college|diploma|curriculum|modules?|studying|enrolled|in progress)\b/i;
// Not finished yet: a course even for a completion credential.
const UNFINISHED_RE = /\b(in progress|enrolled|currently enrolled|studying|currently taking|signed up|sign up|starting|halfway|partway|module \d+ of \d+|not finished|never finished|didn'?t finish|haven'?t finished|still in training|still training|haven'?t yet|havent yet|not yet|haven'?t taken|havent taken)\b/i;
// A CDL learner's permit is not a CDL until the road test is passed.
const CDL_PERMIT = /\b(?:CDL\s+(?:\w+\s+)?permit|CLP|learner'?s permit|instruction permit)\b/i;
const PASSED_ROAD = /\bpassed\b[^.;]{0,25}\b(?:road|skills|driving|behind the wheel)\b/i;
// Wanting it: an aim at getting the credential itself, right before its name.
const WANT_BEFORE = new RegExp(
  String.raw`(?:\b(?:want|wants|wanting|need|needs|plan|plans|planning|hope|hoping|going|trying|would like|'d like|looking)\s+to\s+(?:get|earn|obtain|go for|pursue|be|become)\s+(?:an?\s+|my\s+|the\s+)?` +
    String.raw`|\b(?:working toward|working towards|working on getting|studying for|saving for|save up for|save for|looking into getting)\s+(?:an?\s+|my\s+|the\s+)?` +
    String.raw`|\b(?:plan|plans|goal|goals|next step|next)\s*:\s*(?:to\s+)?(?:take|get|earn|pass)\s+(?:the\s+|my\s+|an?\s+)?` +
    String.raw`|\bi\s+(?:really\s+|still\s+)?(?:want|need)\s+an?\s+` +
    String.raw`|\b(?:no|not|isn'?t|don'?t have|do not have|never had|never got)\s+(?:an?\s+)?)$`,
  "i"
);
// ...and nothing after the name that makes it about something else ("a CDL job",
// "my CDL physical", "no CDL violations").
const WANT_AFTER = /^(?:\s+(?:class\s+)?[a-d]\b)?(?:\s*$|\s*[,.;!?)]|\s+(?:yet|someday|soon|eventually|license|licence|permit|card|certification|cert|certified|licensed|trained|test|exam|so|because|to|and|but|next|this|in|by|first|now|either)\b)/i;
// Headings over a list: what the person holds, or what they are still taking.
const HEADING_WORD = String.raw`(?:licen[cs]es?|certifications?|certificates?|certs?|credentials?|training|cards?|tickets?)`;
const HELD_HEADING = new RegExp(String.raw`^\s*${HEADING_WORD}(?:\s*(?:and|&|/|,)\s*${HEADING_WORD})*\s*(?::\s*)?$`, "i");
const INLINE_HEADING = new RegExp(String.raw`^\s*${HEADING_WORD}(?:\s*(?:and|&|/|,)\s*${HEADING_WORD})*\s*:\s*\S`, "i");
const HOLDING_WORD = /licen[cs]|certif|\bcerts?\b|credential|card|ticket/i; // "Training" alone lists courses
const COURSE_HEADING = /^\s*(?:enrolled|in progress|currently (?:enrolled|taking)|coursework|classes|courses|upcoming|planned)\s*(?::\s*)?$/i;
const OTHER_HEADING = /^\s*(?:work\s+|job\s+|professional\s+|relevant\s+)?(?:experience|employment|employment history|work history|job history|education|skills|summary|objective|profile|references|projects|volunteer|volunteering|volunteer experience|awards|interests|contact|contact information)\s*(?::\s*)?$/i;
const THIS_YEAR = new Date().getFullYear();
// "exp. 03/2022", "exp 2019": an expiry date already past.
const EXP_DATE = /\bexp(?:\.|ires|iration|:)?\s*:?\s*(?:\d{1,2}[\/.-]){0,2}((?:19|20)\d\d)\b/i;

function otherCredentialIn(text: string, re: RegExp): boolean {
  const rest = text.replace(new RegExp(re.source, "gi"), " ");
  return CREDENTIALS.some((c) => c.re.source !== re.source && c.re.test(rest));
}

function unpending(text: string): string {
  return text.replace(PENDING_RE, " ");
}

/** A hold word in this clause, outside the credential's own name ("Certified
 *  Nursing Assistant" names CNA, it is not a claim) and not negated or wanted. */
function holdsIn(text: string, re: RegExp): boolean {
  const t = text.replace(new RegExp(re.source, "gi"), " cred ");
  for (const m of Array.from(t.matchAll(new RegExp(String.raw`\b${HOLD_WORDS}\b`, "gi")))) {
    if (!NOT_HOLD_BEFORE.test(t.slice(0, m.index ?? 0))) return true;
  }
  return false;
}

function negatedOrEnded(text: string, m: RegExpMatchArray, inside: string): boolean {
  const before = text.slice(0, m.index ?? 0).split(/\s+/).slice(-3).join(" ");
  if (/\b(never|not|no|without)\b/i.test(`${before} ${inside.replace(new RegExp(NOT_CURRENT_WORDS, "gi"), " ")}`)) return true;
  const after = text.slice((m.index ?? 0) + inside.length);
  return /^\s*(?:from\s+)?(?:19|20)\d\d\s*(?:-|–|to|through|until)\s*(?:19|20)\d\d\b/i.test(after);
}

/** The status word sits next to THIS credential ("my CDL was suspended"), is
 *  not negated ("never had my license suspended"), is not about another
 *  credential in between, and is not a period that ended ("suspended 2019 to 2021"). */
function notCurrentNear(text: string, re: RegExp): boolean {
  const cred = `(?:${re.source})`;
  const near = new RegExp(String.raw`${cred}(?:\W+\w+){0,5}?\W+${NOT_CURRENT_WORDS}\b|\b${NOT_CURRENT_WORDS}(?:\W+\w+){0,3}?\W+${cred}`, "gi");
  for (const m of Array.from(text.matchAll(near))) {
    if (otherCredentialIn(m[0], re) || /\bbut\b/i.test(m[0])) continue;
    if (!negatedOrEnded(text, m, m[0])) return true;
  }
  const exp = text.match(EXP_DATE);
  return !!exp && Number(exp[1]) < THIS_YEAR;
}

/** A line part (not naming the credential) that says it is no longer current:
 *  "Food handler card, expired June 2026", "CPR - exp. 03/2022". */
function restNotCurrent(part: string): boolean {
  const m = part.match(new RegExp(String.raw`\b${NOT_CURRENT_WORDS}\b`, "i"));
  const negated = m && /\b(never|not|no|without|didn'?t|haven'?t|hasn'?t|wasn'?t)\b/i.test(part.slice(0, m.index ?? 0));
  if (m && !negated && !negatedOrEnded(part, m, m[0])) return true;
  const exp = part.match(EXP_DATE);
  return !!exp && Number(exp[1]) < THIS_YEAR;
}

/** "certification course" is a course; "Class A" next to a CDL or license is not a class. */
function prep(text: string): string {
  return text
    .replace(/\b(certification|license|licence)\s+(course|class|prep|training|program)\b/gi, "$2")
    .replace(/\bclass\s+[a-d]\b(?=\s*(?:cdl|commercial|license|licence|driver))/gi, " ")
    .replace(/\b(cdl\s{0,3})class\s+[a-d]\b/gi, "$1 ");
}

type Clause = { text: string; others: string[]; next: string; underHeading: boolean; underCourseHeading: boolean };

/**
 * Classify one clause that mentions the credential. `others` are the other
 * parts of the same line when that line names no other credential, so
 * "Completed CNA program, on the state registry" or "suspended for 2 years,
 * reinstated in 2020" is read as one statement.
 */
function clauseStatus(cl: Clause, cred: { key: string; re: RegExp; named: boolean; exam: boolean }): Status {
  const c = prep(cl.text);
  const others = cl.others.map(prep);
  const rest = others.join(" ; ");
  const at = c.search(cred.re);
  const before = at > 0 ? c.slice(0, at) : "";
  const after = at >= 0 ? c.slice(at).replace(cred.re, "") : "";
  const cu = unpending(c);
  const renewedHere =
    RENEWED_RE.test(cu) || RENEWED_RE.test(unpending(rest)) || STILL_CURRENT.test(unpending(rest)) ||
    others.some((o) => CURRENT_PART.test(o)) ||
    (!CREDENTIALS.some((k) => k.re.test(cl.next)) && RENEWED_RE.test(unpending(cl.next)));
  const currentHere = renewedHere || CURRENT_NEAR_RE.test(cu.replace(new RegExp(NOT_CURRENT_WORDS, "gi"), " "));
  if (notCurrentNear(c, cred.re) || others.some(restNotCurrent)) return currentHere ? "held" : "not_current";
  if (WANT_BEFORE.test(before) && WANT_AFTER.test(after)) return "wanted";
  if (cred.key === "CDL" && (CDL_PERMIT.test(c) || CDL_PERMIT.test(rest)) && !PASSED_ROAD.test(`${c} ${rest}`)) return "course";
  if (currentHere || holdsIn(c, cred.re) || REST_HOLD_RE.test(unpending(rest))) return "held";
  if (cl.underCourseHeading || UNFINISHED_RE.test(c) || UNFINISHED_RE.test(rest)) return "course";
  if (cl.underHeading && !COURSE_RE.test(c)) return "held";
  if (COURSE_RE.test(c)) return cred.exam ? "course" : "held";
  return cred.named ? "held" : "mentioned";
}

/**
 * Status of each credential named in the person's own words. Any sign that
 * they hold it now wins: a plain listing, an attainment word, a renewal, "valid".
 * Only when nothing says so does a course, a goal or an expiry decide.
 */
export function credentialStatuses(source: string): Map<string, Status> {
  const lines = source.split("\n");
  const byLine: { parts: string[]; line: string; next: string; underHeading: boolean; underCourseHeading: boolean }[] = [];
  let underHeading = false;
  let underCourseHeading = false;
  lines.forEach((line, i) => {
    if (!line.trim()) { underHeading = false; underCourseHeading = false; return; }
    // Headings are short; the length check also keeps a huge pasted line fast.
    const short = line.length <= 80;
    if (short && HELD_HEADING.test(line) && HOLDING_WORD.test(line)) { underHeading = true; underCourseHeading = false; return; }
    if (short && COURSE_HEADING.test(line)) { underCourseHeading = true; underHeading = false; return; }
    if (short && OTHER_HEADING.test(line)) { underHeading = false; underCourseHeading = false; return; }
    const inline = INLINE_HEADING.test(line.slice(0, 200)) && HOLDING_WORD.test(line.split(":")[0]);
    // Clauses: split at , ; . and at a spaced hyphen (checked one character each
    // side, so a long run of spaces cannot make it slow).
    // "exp. 03/2022" stays one piece.
    const parts = line.replace(/\bexp\.\s/gi, "exp ").split(/[;,.](?=\s|$)|(?<=\s)-(?=\s)/).map((p) => p.trim()).filter(Boolean);
    byLine.push({ parts, line, next: lines[i + 1] ?? "", underHeading: underHeading || inline, underCourseHeading });
  });
  const out = new Map<string, Status>();
  for (const cred of CREDENTIALS) {
    const statuses: Status[] = [];
    for (const l of byLine) {
      if (!cred.re.test(l.line)) continue;
      const sharedLine = otherCredentialIn(l.line, cred.re);
      l.parts.forEach((p, j) => {
        if (!cred.re.test(p)) return;
        // "ServSafe Food Handler" is one credential: the named key decides.
        if (cred.key === "food handler" && /\bserv\s?safe\b/i.test(p)) return;
        const others = sharedLine ? [] : l.parts.filter((_, k) => k !== j);
        statuses.push(clauseStatus({ text: p, others, next: l.next, underHeading: l.underHeading, underCourseHeading: l.underCourseHeading }, cred));
      });
    }
    if (!statuses.length) continue;
    const order: Status[] = ["held", "not_current", "course", "wanted", "mentioned"];
    out.set(cred.key, order.find((s) => statuses.includes(s))!);
  }
  return out;
}

const CERT_WORDS = String.raw`(?:certification|certificate|license|licence|card|credential)`;
const NOT_OWNING_NEXT = String.raw`(?!\s+(?:type\s+[ivx]+(?:\s+and\s+[ivx]+)?\s+)?(?:course|courses|class|classes|training|coursework|program|prep|practice|test|tests|exam|exams|fee|fees|study|studying|permit|school|physical|job|jobs|route|routes|requirement|requirements|goal))`;
// Earning it, not claiming it: a real earning verb, or a condition ("once you
// pass"), aimed at the credential, a certification word or the exam.
const EARN_VERBS = String.raw`\b(?:get|getting|earn|earning|pass|passing|renew|renewing|become|becoming|enroll|enrolling|sign up for|study for|studying for|apply for|register for|schedule|scheduling|take|taking|working toward|working towards|work toward|work towards|working on|preparing for|prepare for|once you|after you|when you|until you|before you)\b`;
function earnsIt(sentence: string, cred: string): boolean {
  return new RegExp(String.raw`${EARN_VERBS}[^.!?]{0,30}(?:${cred}|certified|certification|certificate|licensed|license|licence|card|exam|test)`, "i").test(sentence);
}
const CURRENT_WORDS = String.raw`(?:current|currently|active|valid|renewable|up to date|in good standing)`;

// Words that link to something else, so "certified with the EPA 608 course" is not
// "certified EPA 608".
const LINK = String.raw`(?!(?:with|and|in|for|the|to|from|at|after|before|behind|plus|but|or|by|through|on|of|while)\b)`;

/** A claim of holding the credential, bound to that credential's name. */
function bound(sentence: string, re: RegExp, named: boolean): boolean {
  const cred = `(?:${re.source})`;
  // "your Class A CDL": a license class before the name.
  const credC = String.raw`(?:class\s+[a-d]\s+)?${cred}`;
  const tests = [
    // "your EPA 608 Type I and II certification", "my forklift card"
    String.raw`\b(?:your|my)\s+(?:[\w-]+\s+){0,2}${cred}(?:\s+[\w()-]+){0,5}?\s+${CERT_WORDS}\b`,
    // "certified forklift operator", "EPA 608 certified", "Forklift Certified"
    String.raw`\b(?:certified|licensed)\s+(?:${LINK}[\w-]+\s+){0,2}${cred}`,
    String.raw`${cred}(?:\s+${LINK}[\w-]+){0,2}\s+(?:certified|licensed)\b`,
    // "Class B CDL holder"
    String.raw`${cred}\s+holder\b`,
  ];
  if (named) {
    tests.push(
      // "your EPA 608" (not "your EPA 608 course" or "your EPA 608 test fee")
      String.raw`\b(?:your|my)\s+${credC}${NOT_OWNING_NEXT}`,
      // "you have EPA 608", "I hold a CDL", "holds a CDL"
      String.raw`\b(?:you|i)(?:'ve|\s+have|\s+hold|\s+earned|\s+got)\s+(?:an?\s+|the\s+|your\s+|my\s+)?${credC}${NOT_OWNING_NEXT}`,
      String.raw`\b(?:hold|holds|has)\s+(?:an?\s+|the\s+|your\s+)?${credC}${NOT_OWNING_NEXT}`,
      // "As a certified nursing assistant with...", "since you are a CNA,"
      // (not "as a CDL driver" or "a CNA student")
      String.raw`\b(?:as|am|are|i'm|you're)\s+an?\s+${credC}(?=\s*$|\s*[,.;!?)]|\s+(?:with|and|who|since|for|in|at)\b)`
    );
  } else {
    tests.push(String.raw`\b(?:you|i)(?:'ve|\s+have|\s+hold|\s+earned|\s+got)\s+(?:an?\s+|the\s+|your\s+|my\s+)?${cred}\s+${CERT_WORDS}\b`);
  }
  // A match that also names another credential is about that one.
  return tests.some((t) => Array.from(sentence.matchAll(new RegExp(t, "gi"))).some((m) => !otherCredentialIn(m[0], re)));
}

const NOT_CURRENT_RE = new RegExp(String.raw`\b${NOT_CURRENT_WORDS}\b`, "i");

/** "You are certified" close to this credential's name: within five words, in
 *  the same clause, and not about another credential. "Certified" counts only
 *  bare or with words like "now" or "fully" ("You're forklift certified" is
 *  about forklifts), and it may reach past "and" only when it names no object
 *  of its own ("certified in food safety and finished the EPA 608 course"). */
function saysCertified(sentence: string, re: RegExp): boolean {
  const cred = `(?:${re.source})`;
  const says = String.raw`\b(?:you're|you are|i'm|i am)\s+(?:(?:now|fully|also|officially|already|properly|legally)\s+){0,2}(?:certified|licensed)\b`;
  const bare = String.raw`${says}(?!\s+(?:in|as|for|to|by|through|with|on)\b)`;
  const strictGap = String.raw`(?:[^\w,;]+(?!(?:and|but|or|plus|while|also|then)\b)\w+){0,5}?[^\w,;]+`;
  const looseGap = String.raw`(?:[^\w,;]+\w+){0,5}?[^\w,;]+`;
  const all = new RegExp(String.raw`${says}${strictGap}${cred}|${bare}${looseGap}${cred}|${cred}${strictGap}${bare}`, "gi");
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
      // Calling it current is a claim even when the sentence also talks about
      // renewing, unless it is a condition ("retaking the class would make your
      // card current again").
      const callsCurrent = Array.from(
        sentence.matchAll(new RegExp(String.raw`${cred}[^.!?]{0,40}?\b${CURRENT_WORDS}\b|\b${CURRENT_WORDS}\s+(?:[\w-]+\s+){0,2}${cred}`, "gi"))
      ).some((m) => !/\b(would|will|could|can|make|makes|once|after|if|when|until|become|becomes|get|gets)\b/i.test(m[0]));
      if (callsCurrent) return true;
      // "needs renewing", "retake the class": it says it is not current.
      if (/\b(renew\w*|retak\w*|re-?certif\w*|reinstat\w*|expire[sd]?|lapse[sd]?)\b/i.test(sentence)) continue;
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
    if (new RegExp(String.raw`${cred}(?:\s+[\w()-]+){0,4}?\s+${CERT_WORDS}\b(?!\s+(?:course|class|prep|training|program|exam|test))|\b${CERT_WORDS}\s*(?:in|for|of|:)?\s*${cred}|${cred}(?:\s+[\w()-]+){0,4}?\s+(?:certified|licensed)\b`, "i").test(item)) {
      return true;
    }
    // A named credential listed on its own ("CNA (Wisconsin Nurse Aide Registry)",
    // "Certified Nursing Assistant (CNA) | ServSafe | CPR", "EPA 608, 2026") is a
    // claim to hold it.
    if (CREDENTIALS.find((c) => c.key === key)?.named) {
      // Up to four plain qualifier words may follow ("OSHA 30 Construction",
      // "EPA 608 Type I and II"), but not one that says it is a course, a goal,
      // no longer current, or a kind of work ("CDL driving jobs").
      const qualifier = String.raw`(?:\s+(?!(?:course|courses|class|classes|training|program|school|prep|exam|test|in|progress|enrolled|pending|planned|goal|expired|lapsed|revoked|suspended|driving|driver|drivers|job|jobs|work|route|routes|experience|student|trainee|permit)\b)[A-Za-z0-9/&-]+){0,4}`;
      const alone = new RegExp(String.raw`^\s*(?:class\s+[a-d]\s+)?${cred}${qualifier}(?:\s*\([^)]*\))?(?:\s*[-,]?\s*(?:19|20)\d\d)?\s*$`, "i");
      if (item.split(/\s*[|,;]\s*/).some((seg) => alone.test(seg))) return true;
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

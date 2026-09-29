/**
 * A credential says exactly what the person said it says (2026-09-28).
 *
 * Sample runs told a man who finished an EPA 608 course that he "has EPA 608"
 * and should say so to employers, and told a woman whose forklift certification
 * had expired that it was "renewable". The truth check covers some report
 * fields and not others, so this is a deterministic backstop over what the
 * report, the cover letter and the resume say.
 *
 * Two halves, both narrow on purpose (2026-09-29, after three reviews, a
 * labeled test set and white-box attacks):
 * - Reading the person's words, sentence by sentence: any sign they hold the
 *   credential now wins (a plain listing, "passed", a renewal, "valid"). Only
 *   when nothing says so does a course, a goal or an expiry decide.
 * - Reading what we wrote: a sentence counts only when it says the PERSON holds
 *   it ("you have", "your CDL opens", "list your EPA 608", "I am a CNA", a bare
 *   resume listing). Advice about getting one, or talk about jobs and other
 *   people, never counts.
 * Anything found is FLAGGED for the person to check, never deleted. Misses are
 * left to the truth check and the prompts.
 */

type Status = "held" | "course" | "wanted" | "not_current" | "mentioned";

/**
 * `named`: the credential is its own name (EPA 608, CDL); otherwise the word is
 * also a skill (forklift, welding), so only an explicit certification claim counts.
 * `exam`: earning it takes a test after the class (EPA 608, CDL, CNA). For
 * completion credentials (OSHA 10/30, CPR, flagger, food handler, forklift, an
 * NCCER level) finishing the training IS getting it.
 */
const CREDENTIALS: { key: string; re: RegExp; named: boolean; exam: boolean }[] = [
  { key: "EPA 608", re: /\bEPA\s*(?:section\s*)?608\b/i, named: true, exam: true },
  { key: "OSHA 10", re: /\bOSHA[\s-]*10\b|\b10[\s-]*(?:hour|hr)\s+OSHA\b/i, named: true, exam: false },
  { key: "OSHA 30", re: /\bOSHA[\s-]*30\b|\bOSHA[\s-]*10\s*\/\s*30\b|\b30[\s-]*(?:hour|hr)\s+OSHA\b/i, named: true, exam: false },
  { key: "CDL", re: /\bCDL\b|\bCLP\b|\bcommercial driver'?s? licen[cs]e\b|\bclass\s+[ab]\s+(?:driver'?s\s+)?licen[cs]e\b/i, named: true, exam: true },
  { key: "ServSafe", re: /\bserv\s?safe\b/i, named: true, exam: true },
  { key: "NCCER", re: /\bNCCER\b/i, named: true, exam: false },
  { key: "CNA", re: /\bCNA\b|\bcertified nursing assistant\b/i, named: true, exam: true },
  { key: "forklift", re: /\bforklift\b/i, named: false, exam: false },
  { key: "food handler", re: /\bfood handler/i, named: false, exam: false },
  { key: "CPR", re: /\bCPR\b|\bfirst aid\b/i, named: false, exam: false },
  { key: "flagger", re: /\bflagg(?:er|ing)\b/i, named: false, exam: false },
  { key: "welding", re: /\bweld(?:ing|er|ers)\b/i, named: false, exam: true },
];

// ---------------------------------------------------------------------------
// Reading the person's words
// ---------------------------------------------------------------------------

const NOT_CURRENT_WORDS = String.raw`(?:expired|lapsed|out of date|suspended|revoked|cancell?ed|inactive|ran out|run out|no longer (?:valid|current|active|good)|not (?:valid|current|active)|pending reinstatement)`;
const NOT_CURRENT_RE = new RegExp(String.raw`\b${NOT_CURRENT_WORDS}\b`, "i");
const NEGATION = /\b(?:never|not|no|without|wasnt|isnt|hasnt|havent|didnt|werent|aint)\b|n['’]t\b/i;
// Current again, said anywhere in the sentence.
const RENEWED_RE = /\b(renewed|recertified|reinstated|restored|reissued|rescinded|dismissed|overturned|reversed|never went into effect|retook|retested|re-took|re-tested|valid again|current again|active again|have it again|driving again|clean ever since|ever since then|since then|(?:been )?driving (?:[\w-]+\s+){0,2}since (?:19|20)\d\d|(?:got|have|has) (?:it|them|my [\w-]+(?: [\w-]+)?) back|(?:it'?s|its) back|back in good standing|cleared(?: up)?|(?:suspension|revocation)\s+(?:ended|was lifted|lifted|is over|was over)|that'?s over|it'?s over|all good now)\b/i;
const STILL_CURRENT = /\b(?:it'?s|it is|its|now|still|i'?m|im|i am|shows?|is|are)\s+(?:valid|current|active|good)\b|\b(?:valid|current|active)\b[^.;,]{0,25}\b(?:now|again|as of)\b|\bgot a new (?:one|card|cert\w*|license|licence)\b|\bgood (?:for\s+)?\d+\s+(?:years?|yrs)\b|\b(?:did|took|passed)\s+(?:the\s+|my\s+)?(?:[\w-]+\s+){0,2}(?:test|exam)\s+again\b/i;
// A part that is only a currency word: "Class A CDL, current", "CDL - active".
const CURRENT_PART = /^\s*\(?\s*(?:still\s+|now\s+)?(?:valid|current|active|in good standing|up to date)(?:\s+(?:now|again|through\s+\S+|thru\s+\S+|until\s+\S+|till\s+\S+))?\s*\)?\s*$/i;
const CURRENT_NEAR_RE = /\b(valid|current|active|in good standing|up to date)\b/i;
// A pending renewal ("need to get it renewed", "can be restored") never counts.
const PENDING_RE = /\b(?:need|needs|trying|try|want|wants|hope|hoping|plan|planning|waiting|going|have)\s+to\s+(?:get\s+)?(?:it\s+|them\s+|my\s+[\w-]+(?:\s+[\w-]+)?\s+)?(?:renew\w*|reinstat\w*|restor\w*|recertif\w*|back|valid|current|active)\b|\b(?:can|could|will|should|would)\s+be\s+(?:renew\w*|reinstat\w*|restor\w*|valid|current|active)\b|\bworking on getting (?:it|them|my [\w-]+) back\b/gi;
// Signs the person holds it, in the part that names it...
const HOLD_WORDS = String.raw`(?:certified|certification|certificate|cert|certs|licensed|license|licence|card|passed|holder|endorsement|registry|permit|ticket|i have|i've got|i hold|which i have|got my|have my|earned my|i got (?:my|it|them|the|a|an))`;
// ...and elsewhere in the sentence, only unmistakable ones.
const REST_HOLD_RE = /\b(passed|registry|certified|licensed|which i have|i have (?:it|one|them)|got it|earned it|got my (?:license|licence|cert\w*|card|cdl|ticket))\b/i;
// A hold word right after one of these is not holding it: "get certified", "no card".
const NOT_HOLD_BEFORE = /\b(?:get|getting|be|become|becoming|being|to|no|not|never|without|don'?t have|dont have|do not have|didn'?t get|didnt get|haven'?t|havent|never got)\s+(?:\w+\s+)?$/i;
const COURSE_WORD = String.raw`(?:course|courses|class|classes|training|coursework|program|academy|curriculum|modules?|prep|school|college|diploma|semesters?|quarters?|studying|enrolled)`;
// Not finished yet: a course even for a completion credential.
const UNFINISHED_RE = /\b(in progress|enrolled|currently enrolled|studying|currently taking|signed up|sign up|signing up|starting|before i (?:could )?finish(?:ed)?|most of the modules|never got to finish|didn'?t get to finish|started (?:the|a|my)\s+(?:[\w-]+\s+){0,3}(?:class|course|program|training|modules)|halfway|partway|module \d+ of \d+|not finished|never finished|didn'?t finish|haven'?t finished|still in training|still training|haven'?t yet|havent yet|not yet|haven'?t taken|havent taken)\b/i;
// ...unless it is about something else: "Hazmat endorsement in progress",
// "currently enrolled in the HVAC program".
const OTHER_PROGRESS = /\b(?:endorsement|upgrade|lpn|rn|degree|ged|hsed|high school|hazmat|tanker|level\s+\d)\b|\b(?:enrolled|signed up|taking|starting|started)\s+(?:in|for)\s+(?:an?\s+|the\s+|my\s+)?[\w-]+(?:\s+[\w-]+)?\s+(?:program|course|class|degree|school)\b/i;
// Not having it, said next to it: "no card or anything", "never signed me off",
// "they was going to certify me".
const NOT_HELD_RE = /\bno (?:card|cert\w*|license|licence|paper(?:work)?)\b(?!\s+(?:violations?|suspensions?|problems?|issues?|points?))|\bnever (?:had|got|received) (?:a |the |my )?(?:card|cert\w*|license|licence)\b|\bdidn'?t get (?:a |the |my )?(?:card|cert\w*)\b|\bnever signed (?:me )?off\b|\bnot signed off\b|\b(?:was|were) going to certify\b|\bnever (?:got|was|been) certified\b/i;
// A CDL learner's permit is not a CDL until the road test is passed.
const CDL_PERMIT = /\b(?:CDL\s+(?:\w+\s+)?permit|CLP|learner'?s permit|instruction permit)\b/i;
const PASSED_ROAD = /\bpassed\b[^.;]{0,25}\b(?:road|skills|driving|behind the wheel)\b/i;
// Wanting it: an aim at getting the credential itself, right before its name.
const WANT_BEFORE = new RegExp(
  String.raw`(?:\b(?:want|wants|wanting|need|needs|plan|plans|planning|hope|hoping|going|trying|would like|'d like|looking|goal is|supposed|told me|said)\s+to\s+(?:get|earn|obtain|go for|pursue|be|become|take)\s+(?:an?\s+|my\s+|the\s+)?` +
    String.raw`|\b(?:should|must|gotta|got to)\s+(?:get|earn|take)\s+(?:an?\s+|my\s+|the\s+)?` +
    String.raw`|\b(?:working toward|working towards|working on getting|studying for|saving for|save up for|save for|looking into getting)\s+(?:an?\s+|my\s+|the\s+)?` +
    String.raw`|\b(?:plan|plans|goal|goals|next step|next)\s*:\s*(?:to\s+)?(?:take|get|earn|pass)\s+(?:the\s+|my\s+|an?\s+)?` +
    String.raw`|\bi\s+(?:really\s+|still\s+)?(?:want|need)\s+an?\s+` +
    String.raw`|\b(?:no|not|isn'?t|don'?t have|dont have|do not have|never had|never got)\s+(?:an?\s+)?)$`,
  "i"
);
// ...and nothing after the name that makes it about something else ("a CDL job",
// "my CDL physical", "no CDL violations", "my CNA license transferred").
const WANT_AFTER = /^(?:\s+(?:class\s+)?[a-d]\b)?(?:\s*$|\s*[,.;!?)]|\s+(?:yet|someday|soon|eventually|license|licence|permit|card|certification|cert|certified|licensed|trained|test|exam|so|because|to|and|but|next|this|in|by|first|now|either)\b)(?!\s*(?:license|licence|permit|card|certification|cert)?\s*(?:transferred|replaced|renewed|reinstated|back|moved|updated|reissued)\b)/i;
// Headings over a list: what the person holds, or what they are still taking.
const HEADING_WORD = String.raw`(?:licen[cs]es?|certifications?|certificates?|certs?|credentials?|training|cards?|tickets?)`;
const HELD_HEADING = new RegExp(String.raw`^\s*${HEADING_WORD}(?:\s*(?:and|&|/|,)\s*${HEADING_WORD})*\s*(?::\s*)?$`, "i");
const INLINE_HEADING = new RegExp(String.raw`^\s*${HEADING_WORD}(?:\s*(?:and|&|/|,)\s*${HEADING_WORD})*\s*:\s*\S`, "i");
const HOLDING_WORD = /licen[cs]|certif|\bcerts?\b|credential|card|ticket/i; // "Training" alone lists courses
// "ENROLLED" lists what is not finished; "CLASSES" lists finished classes.
const UNFINISHED_HEADING = /^\s*(?:enrolled|in progress|currently (?:enrolled|taking)|upcoming|planned|next steps?|goals?)\s*(?::\s*)?$/i;
const COURSE_HEADING = /^\s*(?:coursework|classes|courses|training completed|completed training)\s*(?::\s*)?$/i;
const OTHER_HEADING = /^\s*(?:work\s+|job\s+|professional\s+|relevant\s+|career\s+)?(?:experience|employment|employment history|work history|job history|history|education|skills|summary|objective|profile|qualifications|references|projects|volunteer|volunteering|volunteer experience|awards|interests|contact|contact information)\s*(?::\s*)?$/i;
const THIS_YEAR = new Date().getFullYear();
// "exp. 03/2022", "exp 2019": an expiry date already past (not "8 yrs exp 2012-2020").
const EXP_DATE = /\bexp(?:\.|ires|iration|:)?\s*:?\s*(?:\d{1,2}[\/.-]){0,2}((?:19|20)\d\d)\b(?!\s*(?:-|\u2013|to|through)\s*(?:(?:19|20)?\d\d|present|now|current))/i;
const EXPERIENCE_EXP = /\b(?:yrs?|years?|months?)\b[^.;,]{0,15}\bexp\b/i;
const ENDED_RANGE = /^\s*\)?\s*(?:from\s+)?(?:19|20)\d\d\s*(?:-|\u2013|to|through|until)\s*(?:19|20)\d\d\b/i;
// Other papers a not-current word can be about.
const OTHER_PAPERS = /\b(?:parole|probation|sentence|insurance|id|medicaid|unemployment|resume|benefits|snap|lease|plates?|tags|visa|passport|offer|job|position|endorsement|hazmat|twic|privileges|visitation|custody|account)\b/i;
const OTHER_LICENSE = /\b(?:driver'?s|drivers|license|licence)\b/i;
const LINKS = /\b(?:and|but|while|though|however|so|because|before|after|when|until)\b(?!\s+(?:it|its|it's|they|that|this|then)\b)/i;

function otherCredentialIn(text: string, re: RegExp): boolean {
  const rest = text.replace(new RegExp(re.source, "gi"), " ");
  return CREDENTIALS.some((c) => c.re.source !== re.source && c.re.test(rest));
}

function unpending(text: string): string {
  return text.replace(PENDING_RE, " ");
}

/** A hold word in this part, outside the credential's own name ("Certified
 *  Nursing Assistant" names CNA, it is not a claim) and not negated or wanted. */
function holdsIn(text: string, re: RegExp): boolean {
  const t = text.replace(new RegExp(re.source, "gi"), " cred ");
  for (const m of Array.from(t.matchAll(new RegExp(String.raw`\b${HOLD_WORDS}\b`, "gi")))) {
    if (!NOT_HOLD_BEFORE.test(t.slice(0, m.index ?? 0))) return true;
  }
  return false;
}

/** "suspended for 90 days in 2016", "revoked for 3 years in 2018": over by now. */
function endedDuration(text: string): boolean {
  const m = text.match(/\bfor\s+(\d+|a|an|one|two|three|four|five|six|ninety)\s+(days?|weeks?|months?|years?)\b[^.;]{0,30}?\b((?:19|20)\d\d)\b|\b((?:19|20)\d\d)\b[^.;]{0,30}?\bfor\s+(\d+|a|an|one|two|three|four|five|six|ninety)\s+(days?|weeks?|months?|years?)\b/i);
  if (!m) return false;
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ninety: 90 };
  const count = m[1] ?? m[5];
  const n = Number(count) || words[count.toLowerCase()] || 1;
  const unit = (m[2] ?? m[6]).toLowerCase();
  const year = Number(m[3] ?? m[4]);
  const years = unit.startsWith("year") ? n : unit.startsWith("month") ? n / 12 : unit.startsWith("week") ? n / 52 : n / 365;
  return year + Math.ceil(years) < THIS_YEAR;
}

function pastExpiry(text: string): boolean {
  const m = text.match(EXP_DATE);
  if (!m || Number(m[1]) >= THIS_YEAR) return false;
  return !EXPERIENCE_EXP.test(text.slice(0, (m.index ?? 0) + 4));
}

/** The status word is about THIS credential ("my CDL was suspended"): close to
 *  its name, with no "and", "but" or other paper between them ("my forklift card
 *  and my license is suspended"), not negated ("wasn't revoked"), and not a
 *  period that ended ("suspended 2019 - 2021"). */
function notCurrentNear(text: string, cred: { key: string; re: RegExp }): boolean {
  const c = `(?:${cred.re.source})`;
  const near = new RegExp(String.raw`${c}(?:\W+\w+){0,5}?\W+${NOT_CURRENT_WORDS}\b|\b${NOT_CURRENT_WORDS}(?:\W+\w+){0,3}?\W+${c}`, "gi");
  const own = new RegExp(String.raw`${c}(?:\s+(?:license|licence|card|cert\w*|registration|endorsement))?`, "gi");
  for (const m of Array.from(text.matchAll(near))) {
    const inside = m[0];
    if (otherCredentialIn(inside, cred.re)) continue;
    const between = inside.replace(own, " ").replace(new RegExp(NOT_CURRENT_WORDS, "gi"), " ");
    if (LINKS.test(between) || OTHER_PAPERS.test(between)) continue;
    if (cred.key !== "CDL" && OTHER_LICENSE.test(between)) continue;
    const before = text.slice(0, m.index ?? 0).split(/\s+/).slice(-3).join(" ");
    if (NEGATION.test(`${before} ${between}`)) continue;
    if (ENDED_RANGE.test(text.slice((m.index ?? 0) + inside.length))) continue;
    if (FUTURE_STATUS.test(text.slice(0, (m.index ?? 0) + inside.search(new RegExp(NOT_CURRENT_WORDS, "i"))))) continue;
    if (endedDuration(text)) continue;
    return true;
  }
  return pastExpiry(text);
}

// The subject of a status word in another part or the next sentence has to be the
// credential itself: "expired June 2026", "it expired", "my license was revoked",
// "the registry shows inactive". Not "the nursing home revoked my job offer".
const ITS_SUBJECT = /(?:^|\b(?:it|its|it's|they|that|this|was|got|is|now|since|and|but|then|which|website|registry|registration|license|licence|cert\w*|card|certification|status|state)\b)[\s()"',:]*(?:(?:was|is|got|has been|had been|been|went|shows?|says?|now|then|also|all)\s+){0,3}$/i;
const FUTURE_STATUS = /\b(?:gonna|going to|was going to|would|could|might|will)\s+(?:be\s+|get\s+)?$/i;

/** Another part of the same sentence (or the next sentence) that says it is no
 *  longer current: "Food handler card, expired June 2026", "CPR - exp. 03/2022". */
function partNotCurrent(part: string, key: string): boolean {
  const m = part.match(NOT_CURRENT_RE);
  if (m) {
    const before = part.slice(0, m.index ?? 0);
    const after = part.slice((m.index ?? 0) + m[0].length);
    const aboutOther = OTHER_PAPERS.test(part) || (key !== "CDL" && /\bdriver'?s\b/i.test(part));
    if (!aboutOther && ITS_SUBJECT.test(before) && !FUTURE_STATUS.test(before) && !NEGATION.test(before) && !ENDED_RANGE.test(after)) return true;
  }
  return pastExpiry(part);
}

/** "CDL school", "EPA 608 Type I and II course", "class for CPR": a course word
 *  right next to the name. Not "drove a school bus with my CDL" or "a CNA in the
 *  memory care program". */
function courseNear(text: string, re: RegExp): boolean {
  const c = `(?:${re.source})`;
  const after = new RegExp(String.raw`${c}(?:\s+(?!(?:in|at|for|with|from|on|to|by|of|as)\b)[\w&/()-]+){0,4}?\s+${COURSE_WORD}\b`, "i");
  const before = new RegExp(String.raw`\b${COURSE_WORD}\s+(?:(?!(?:in|at|with|from)\b)[\w&/-]+\s+){0,1}(?:(?:for|on|in)\s+)?(?:the\s+|my\s+|a\s+)?${c}`, "i");
  return after.test(text) || before.test(text);
}

/** "certification course" is a course; "Class A" next to a CDL or license is not a class. */
function prep(text: string): string {
  return text
    .replace(/\b(certification|license|licence)\s+(course|class|prep|training|program)\b/gi, "$2")
    .replace(/\bclass\s+[a-d]\b(?=\s*(?:cdl|commercial|driver))/gi, " ")
    .replace(/\b(cdl\s{0,3})class\s+[a-d]\b/gi, "$1 ");
}

const ABBREV = /\b(?:st|mt|ft|dr|mr|mrs|ms|jr|sr|inc|co|no|vs|approx|ave|rd|blvd|exp|lic|cert|dept|hwy|etc|[a-z])$/i;

/** Sentences of one line. A period after a short abbreviation ("St. Louis",
 *  "exp. 2022", an initial) does not end one. */
function sentencesIn(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of Array.from(line.matchAll(/[.!?]+\s+/g))) {
    const end = (m.index ?? 0) + 1;
    if (ABBREV.test(line.slice(start, m.index ?? 0).split(/\s+/).pop() ?? "")) continue;
    out.push(line.slice(start, end));
    start = (m.index ?? 0) + m[0].length;
  }
  out.push(line.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

type Unit = { parts: string[]; text: string; next: string; underHeading: boolean; underCourseHeading: boolean; underUnfinishedHeading: boolean };

/** The person's words as sentences, each tagged with the heading above it. */
function unitsOf(source: string): Unit[] {
  const lines = source.split("\n");
  const units: Unit[] = [];
  let underHeading = false;
  let underCourseHeading = false;
  let underUnfinishedHeading = false;
  const set = (h: boolean, c: boolean, u: boolean) => { underHeading = h; underCourseHeading = c; underUnfinishedHeading = u; };
  for (const line of lines) {
    if (!line.trim()) { set(false, false, false); continue; }
    // Headings are short; the length check also keeps a huge pasted line fast.
    const short = line.length <= 80;
    if (short && HELD_HEADING.test(line) && HOLDING_WORD.test(line)) { set(true, false, false); continue; }
    if (short && UNFINISHED_HEADING.test(line)) { set(false, false, true); continue; }
    if (short && COURSE_HEADING.test(line)) { set(false, true, false); continue; }
    if (short && OTHER_HEADING.test(line)) { set(false, false, false); continue; }
    // Any other all-caps heading ends the section, unless it names a credential ("WELDING").
    if (short && /^[^a-z0-9]*[A-Z][A-Z &/]{3,}:?\s*$/.test(line.trim()) && !CREDENTIALS.some((c) => c.re.test(line))) {
      set(false, false, false); continue;
    }
    const inline = INLINE_HEADING.test(line.slice(0, 200)) && HOLDING_WORD.test(line.split(":")[0]);
    for (const sentence of sentencesIn(line)) {
      // Parts: split at , and ; and at a spaced hyphen that is not a year range.
      const parts = sentence.split(/[;,](?=\s|$)|(?<=[^\d\s]\s)-(?=\s)/).map((p) => p.trim()).filter(Boolean);
      units.push({ parts, text: sentence, next: "", underHeading: underHeading || inline, underCourseHeading, underUnfinishedHeading });
    }
  }
  units.forEach((u, i) => (u.next = units[i + 1]?.text ?? ""));
  return units;
}

type Signals = { renewed: boolean; current: boolean; nc: boolean; hold: boolean; unfinished: boolean; notHeld: boolean };

/** Per-part signals, computed once per sentence (so a long pasted line stays fast). */
function partSignals(parts: string[], key: string): Signals[] {
  return parts.map((p) => {
    const t = unpending(prep(p));
    return {
      renewed: RENEWED_RE.test(t) || STILL_CURRENT.test(t),
      current: CURRENT_PART.test(p),
      nc: partNotCurrent(p, key),
      hold: REST_HOLD_RE.test(t),
      // "not yet back on the road" is not about the credential's training.
      unfinished: UNFINISHED_RE.test(p) && !OTHER_PROGRESS.test(p) && (p.trim().split(/\s+/).length <= 4 || new RegExp(String.raw`\b(?:${COURSE_WORD}|test|exam|cert\w*|card|modules?)\b`, "i").test(p)),
      notHeld: NOT_HELD_RE.test(p),
    };
  });
}

function clauseStatus(
  part: string,
  rest: Signals,
  unit: Unit,
  cred: { key: string; re: RegExp; named: boolean; exam: boolean }
): Status {
  const c = prep(part);
  const at = c.search(cred.re);
  const before = at > 0 ? c.slice(0, at) : "";
  const after = at >= 0 ? c.slice(at).replace(cred.re, "") : "";
  const cu = unpending(c);
  const nextFree = !CREDENTIALS.some((k) => k.re.test(unit.next));
  const nextRenews = nextFree && (RENEWED_RE.test(unpending(unit.next)) || STILL_CURRENT.test(unpending(unit.next)));
  const renewedHere = RENEWED_RE.test(cu) || rest.renewed || rest.current || nextRenews;
  const currentHere = renewedHere || CURRENT_NEAR_RE.test(cu.replace(new RegExp(NOT_CURRENT_WORDS, "gi"), " "));
  if (notCurrentNear(c, cred) || rest.nc) return currentHere ? "held" : "not_current";
  if (WANT_BEFORE.test(before) && WANT_AFTER.test(after) && !/\buntil\s+(?:19|20)\d\d\b/i.test(c)) return "wanted";
  const nextNotHeld = nextFree && NOT_HELD_RE.test(unit.next);
  if ((NOT_HELD_RE.test(c) || rest.notHeld || nextNotHeld) && !currentHere && !holdsIn(c, cred.re)) return "wanted";
  // "Got my CDL permit (CLP)": a permit, unless a full license is named too
  // ("permit in March and my Class A license in May").
  if (cred.key === "CDL" && CDL_PERMIT.test(c) && !PASSED_ROAD.test(c)) {
    const rest = c.replace(new RegExp(CDL_PERMIT.source, "gi"), " ");
    if (!/\b(?:license|licence|cdl)\b(?!\s+permit)/i.test(rest)) return "course";
  }
  if (currentHere || holdsIn(c, cred.re) || rest.hold) return "held";
  if (unit.underUnfinishedHeading) return "course";
  if (unit.underCourseHeading) return cred.exam || UNFINISHED_RE.test(c) ? "course" : "held";
  if ((UNFINISHED_RE.test(c) && !OTHER_PROGRESS.test(c)) || rest.unfinished) return "course";
  if (unit.underHeading && !UNFINISHED_RE.test(c)) return "held";
  // "worked as a CNA", "my CDL", "drove OTR": used on the job, so held.
  const credSrc = `(?:${cred.re.source})`;
  if (new RegExp(String.raw`\b(?:worked|work|working|employed|hired|job)\s+as\s+an?\s+${credSrc}|\bmy\s+(?:class\s+[a-d]\s+)?${credSrc}(?!\s+${COURSE_WORD})`, "i").test(c)) return "held";
  if (cred.key === "CDL" && /\b(?:drove|driving|driver)\b[^.;]{0,20}\b(?:otr|over the road|semi|tractor.?trailer|18.?wheeler|tanker|flatbed)\b/i.test(unit.text)) return "held";
  if (courseNear(c, cred.re)) {
    // "Foreman said take the flagger class first. Haven't yet." / "class next week"
    const nextUnfinished = nextFree && UNFINISHED_RE.test(unit.next) && !OTHER_PROGRESS.test(unit.next);
    const ahead = /\bnext (?:week|month|year|spring|summer|fall|winter)\b|\bwill\b|\bgoing to\b/i.test(c);
    return cred.exam || nextUnfinished || ahead ? "course" : "held";
  }
  // Said later that it is no longer current: "I was a CNA from 2012 to 2017.
  // After my case the state took me off the registry, the website says revoked."
  if (nextFree && partNotCurrent(unit.next, cred.key)) return "not_current";
  // A named credential counts as held when it is listed or owned ("Class A
  // CDL, 2019", "my CDL", "as a CNA"), not when it is only mentioned ("no CDL
  // needed for those").
  if (cred.named && at >= 0) {
    const lead = before.trim().split(/\s+/).slice(-2).join(" ");
    const listed =
      !before.trim() || /^[\W\d]*$/.test(before) || c.trim().split(/\s+/).length <= 5 ||
      /\b(?:my|a|an|have|has|hold|holds|with|as|been|was|am|is|got|earned|licensed|certified|valid|current|active)$/i.test(lead);
    return listed ? "held" : "mentioned";
  }
  return "mentioned";
}

/**
 * Status of each credential named in the person's own words. Any sign that
 * they hold it now wins: a plain listing, an attainment word, a renewal, "valid".
 * Only when nothing says so does a course, a goal or an expiry decide.
 */
export function credentialStatuses(source: string): Map<string, Status> {
  const units = unitsOf(source);
  const out = new Map<string, Status>();
  for (const cred of CREDENTIALS) {
    const statuses = new Set<Status>();
    for (const u of units) {
      if (!cred.re.test(u.text)) continue;
      // A sentence that names another credential too is read part by part only.
      const shared = otherCredentialIn(u.text, cred.re);
      const sig = shared ? [] : partSignals(u.parts, cred.key);
      const count = (k: keyof Signals) => sig.filter((x) => x[k]).length;
      const totals = { renewed: count("renewed"), current: count("current"), nc: count("nc"), hold: count("hold"), unfinished: count("unfinished"), notHeld: count("notHeld") };
      u.parts.forEach((p, j) => {
        if (!cred.re.test(p)) return;
        // "ServSafe Food Handler" is one credential: the named key decides.
        if (cred.key === "food handler" && /\bserv\s?safe\b/i.test(p)) return;
        const own = sig[j];
        const rest = {
          renewed: totals.renewed - (own?.renewed ? 1 : 0) > 0,
          current: totals.current - (own?.current ? 1 : 0) > 0,
          nc: totals.nc - (own?.nc ? 1 : 0) > 0,
          hold: totals.hold - (own?.hold ? 1 : 0) > 0,
          unfinished: totals.unfinished - (own?.unfinished ? 1 : 0) > 0,
          notHeld: totals.notHeld - (own?.notHeld ? 1 : 0) > 0,
        };
        statuses.add(clauseStatus(p, rest, u, cred));
      });
    }
    if (!statuses.size) continue;
    const order: Status[] = ["held", "not_current", "course", "wanted", "mentioned"];
    out.set(cred.key, order.find((s) => statuses.has(s))!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading what we wrote
// ---------------------------------------------------------------------------

const CERT_NOUN = String.raw`(?:certification|certificate|cert|license|licence|card|credential|endorsement|registration)`;
const CERT_WORDS = String.raw`(?:certifications?|certificates?|licen[cs]es?|cards?|credentials?)`;
// Words after a name that make it a sub-kind of the same credential.
const QUAL = String.raw`(?:\s+(?:type\s+[ivx]+(?:\s+(?:and|&)\s+[ivx]+)?|universal|core|general industry|construction|manager|food handler|level\s+\d|[ab]))?`;
// Words after a name that make it about something else: "your CNA state exam",
// "your CDL permit", "CDL driver openings".
const THING = String.raw`(?:course|courses|class|classes|training|coursework|program|prep|practice|test|tests|exam|exams|fee|fees|study|studying|permit|school|physical|job|jobs|route|routes|requirement|requirements|goal|goals|date|dates|result|results|application|option|options|plan|plans|opening|openings|shortage|student|students|trainee|trainees|candidate|candidates|instructor|experience|history|work|skill|skills|duties|career|path|pathway|clinical|clinicals|rotation|hours|module|modules|completion|position|positions|role|roles|companies|carriers|recruiters|holders|renewal|reinstatement)`;
const NOT_THING_NEXT = String.raw`(?!\s+(?:[\w-]+\s+)?${THING}\b)`;
const ASSERT_VERB = String.raw`(?:is|are|shows?|proves?|makes?|opens?|gives?|puts?|sets?|means?|qualifies|helps?|covers?|lets?|counts?|matters?|stands?|keeps?|lands?|backs?|carries|speaks?|demonstrates?|allows?|already|directly|also|really|gets? you)`;
const PRESENT_VERB = String.raw`(?:put|list|add|highlight|show|mention|lead with|bring|feature|include|display|use|uses|using|point to|keep)`;
// Just before a claim, these make it about getting it or a condition.
const EARN_OR_IF = /\b(?:get|getting|earn|earning|pass|passing|renew|renewing|become|becoming|go for|pursue|save for|budget|start|finish|complete|look into|work toward|working toward|prepare for|study for|sign up for|enroll|apply for|register for|once|after|until|when|if|would|will|could|before|hope|hoping|expect|expecting|on track|to be|plan|planning|aim)\b[^.;!?]{0,20}$/i;
// ...and just after: "add your EPA 608 to your resume once you pass the exam".
const IF_AFTER = /^[^.;!?]{0,50}\b(?:once|after|when|as soon as|if)\s+(?:you|i)\s+(?:pass|get|finish|complete|earn|renew|are|have|take)\b/i;
// Words that link to something else, so "certified with the EPA 608 course" is not
// "certified EPA 608".
const LINK = String.raw`(?!(?:with|and|in|for|the|to|from|at|after|before|behind|plus|but|or|by|through|on|of|while)\b)`;
const CURRENT_WORDS = String.raw`(?:current|active|valid|renewable|up to date|up-to-date|in good standing|good)`;
const SAYS_NOT_CURRENT = /\b(renew(?!able)\w*|retak\w*|re-?certif\w*|reinstat\w*|expire[sd]?|lapse[sd]?)\b/i;

function credC(re: RegExp): string {
  // "your Class A CDL": a license class before the name.
  return String.raw`(?:class\s+[a-d]\s+)?(?:${re.source})`;
}

/** Matches of any pattern, dropping ones about another credential or right after
 *  "get", "once", "if" and the like. */
function claimed(sentence: string, patterns: string[], re: RegExp): boolean {
  for (const t of patterns) {
    for (const m of Array.from(sentence.matchAll(new RegExp(t, "gi")))) {
      if (otherCredentialIn(m[0], re)) continue;
      if (EARN_OR_IF.test(sentence.slice(Math.max(0, (m.index ?? 0) - 40), m.index))) continue;
      if (IF_AFTER.test(sentence.slice((m.index ?? 0) + m[0].length))) continue;
      return true;
    }
  }
  return false;
}

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

/** Does this sentence say the person holds a credential their words don't give them? */
export function claimsMoreThanGiven(sentence: string, statuses: Map<string, Status>, opts: { firstPerson?: boolean } = {}): boolean {
  for (const { key, re, named } of CREDENTIALS) {
    if (!re.test(sentence)) continue;
    const status = statuses.get(key);
    if (!status || !FLAGGED.includes(status)) continue;
    const c = credC(re);
    const own = String.raw`${c}${QUAL}`;
    if (status === "not_current") {
      // Calling it current: "your forklift certification is renewable", "your active CNA".
      const current = [
        String.raw`\b(?:your|my)\s+(?:${CURRENT_WORDS}|up-to-date)\s+${own}`,
        String.raw`\b(?:your|my)\s+${own}(?:\s+${CERT_NOUN})?\s+(?:is|are)\s+(?:still\s+)?${CURRENT_WORDS}\b`,
        String.raw`\b(?:you|i)\s+(?:still\s+)?(?:have|hold)\s+(?:an?\s+|the\s+|your\s+|my\s+)?(?:current|valid|active)\s+${own}`,
      ];
      if (claimed(sentence, current, re)) return true;
      // It says so, or talks about renewing: not a claim that it is current.
      if (NOT_CURRENT_RE.test(sentence) || SAYS_NOT_CURRENT.test(sentence)) continue;
    }
    const patterns = [
      // "you have EPA 608", "I hold a Class A CDL", "you have a forklift card"
      String.raw`\b(?:you|i)(?:'ve|\s+have|\s+hold|\s+earned|\s+got|\s+carry|\s+(?:already|still|now)\s+(?:have|hold))\s+(?:an?\s+|the\s+|your\s+|my\s+)?(?:current\s+|valid\s+|active\s+)?${own}${named ? "" : String.raw`\s+${CERT_NOUN}`}${NOT_THING_NEXT}`,
      // "explain you cooked for years and hold EPA 608"
      String.raw`\byou\b[^.;!?]{1,60}?\band\s+(?:have|hold|carry)\s+(?:an?\s+|the\s+|your\s+)?${own}${named ? "" : String.raw`\s+${CERT_NOUN}`}${NOT_THING_NEXT}`,
      // "your EPA 608 certification covers", "your Class A CDL opens doors"
      String.raw`\b(?:your|my)\s+(?:current\s+|valid\s+|active\s+)?${own}(?:\s+${CERT_NOUN})?\s+${ASSERT_VERB}\b(?!\s+(?:[\w-]+\s+){0,2}(?:away|within reach|pending|scheduled|in progress|on the way|coming|next|not|still ahead|close)\b)`,
      // "your EPA 608 and hands-on repair history make you"
      String.raw`\b(?:your|my)\s+${own}(?:\s+${CERT_NOUN})?\s+and\s+(?:your\s+|my\s+)?(?:[\w-]+\s+){0,8}?(?:make|makes|show|shows|give|gives|put|puts|set|sets|prove|proves|qualify|qualifies|help|helps|open|opens|mean|means)\b`,
      // "With your OSHA 30, you can apply for crew lead roles now."
      String.raw`\bwith\s+(?:your|my)\s+(?:current\s+|valid\s+)?${own}(?:\s+${CERT_NOUN})?\s*,\s*(?:you|i)\b`,
      // "put your EPA 608 at the top", "highlight your EPA 608", "it uses your kitchen knowledge and your EPA 608"
      String.raw`\b${PRESENT_VERB}\s+(?:both\s+)?(?:(?:your|my)\s+[\w-]+(?:\s+[\w-]+)?\s*(?:,|and)\s+)?(?:your|my)\s+(?:current\s+|valid\s+|active\s+)?${own}(?:\s+${CERT_NOUN})?${NOT_THING_NEXT}`,
      // "since you are a CNA,", "I am a Certified Nursing Assistant with"
      String.raw`\b(?:you(?:'re|\s+are)|i(?:'m|\s+am))\s+(?:already\s+|now\s+|still\s+)?an?\s+${own}(?=\s*$|\s*[,.;!?]|\s+(?:with|and|who|since)\b)`,
      // "As a certified nursing assistant with five years", "As a CNA, I"
      String.raw`\bas\s+an?\s+${own}(?:\s*,)?\s+(?:i\b|with\s+(?:[\w-]+\s+){0,3}(?:years?|experience|background))`,
      // "you are EPA 608 certified", "I'm a certified forklift operator", "you are an AWS certified welder"
      String.raw`\b(?:you(?:'re|\s+are)|i(?:'m|\s+am))\s+(?:an?\s+)?(?:(?:fully|now|also|already)\s+)?(?:${own}(?:\s+${LINK}[\w-]+){0,2}\s+(?:certified|licensed)\b|(?:[\w-]+\s+)?(?:certified|licensed)\s+(?:${LINK}[\w-]+\s+){0,2}${own})`,
    ];
    // On the resume and in the letter the person is speaking, so a phrase with no
    // subject is theirs: "Licensed Class A CDL driver", "EPA 608 certified", "CDL holder".
    if (opts.firstPerson) {
      patterns.push(
        String.raw`\b(?:certified|licensed)\s+(?:${LINK}[\w-]+\s+){0,2}${own}`,
        String.raw`${own}(?:\s+${LINK}[\w-]+){0,2}\s+(?:certified|licensed)\b`,
        String.raw`${own}\s+holder\b`
      );
    }
    if (claimed(sentence, patterns, re)) return true;
    if (saysCertified(sentence, re)) return true;
    // "the course, which is exactly the certification": a course equated with it.
    if (
      status !== "not_current" &&
      new RegExp(String.raw`\b${COURSE_WORD}\b[^.;!?]{0,40}\b(?:which|that)\s+(?:is|counts as)\s+(?:exactly\s+|basically\s+|really\s+|just\s+)?(?:the\s+|a\s+|your\s+)?(?:certification|license|credential)\b`, "i").test(sentence)
    ) return true;
  }
  return false;
}

// Items that are plainly about a course, a goal, a renewal or the past.
const NOT_A_CLAIM_ITEM = /\b(course|courses|class(?!\s+[a-d]\b)|classes|training|program|school|prep|exam|exams|test|tests|in progress|in process|expected|anticipated|projected|est|enrolled|pending|planned|goal|goals|scheduled|candidate|coursework|clinical|clinicals|rotation|student|trainee|permit|learner'?s|renewal|reinstatement|renew(?!able)\w*|retak\w*|expired|lapsed|revoked|suspended|inactive|seeking|pursuing|working toward|in training)\b/i;
const PAST_RANGE = /\b(?:19|20)\d\d\s*(?:-|\u2013|to)\s*((?:19|20)\d\d)\b/;

/** A short item (a skill name, a resume certification line) naming the
 *  credential as held: "EPA 608 Certification", "Forklift Certified", a bare
 *  "CNA (Wisconsin Nurse Aide Registry)" in a list. */
export function itemClaimsMoreThanGiven(item: string, statuses: Map<string, Status>): boolean {
  // An item on a resume or a skills list is the person's own claim.
  // "Skills: Class A CDL, ..." and "Certifications: CPR/AED, ..." are lists.
  const text = item.replace(/\s+/g, " ").trim().replace(/^(?:skills|certifications?|certs?|licen[cs]es?|credentials?|core competencies)\s*:\s*/i, "");
  if (!text || text.length > 300 || NOT_A_CLAIM_ITEM.test(text)) return false;
  const range = text.match(PAST_RANGE);
  if (range && Number(range[1]) < THIS_YEAR) return false; // it says when it was held
  // A job line ("CNA | Sunrise Care Center"): only a part that says certified,
  // licensed or a card is a claim.
  // A skills row ("Class A CDL | Clean driving record") is checked whole.
  const segs = text.split(/\s*\|\s*/);
  const jobLine = segs.length > 1 && segs.slice(1).some((p) => /^(?:[A-Z][\w.'&-]*\s+){1,4}[A-Z][\w.'&-]*$/.test(p.trim()));
  const pieces = jobLine ? segs.filter((p) => /certif|licen[cs]|\bcard\b|endorse/i.test(p)) : [text];
  for (const piece of pieces) {
    if (claimsMoreThanGiven(piece, statuses, { firstPerson: true })) return true;
    for (const { key, re, named } of CREDENTIALS) {
      if (!re.test(piece)) continue;
      const status = statuses.get(key);
      if (!status || !FLAGGED.includes(status)) continue;
      const c = credC(re);
      if (
        new RegExp(String.raw`${c}(?:\s+${LINK}(?!(?:your|my|once|if|when|so)\b)[\w()-]+){0,4}?\s+${CERT_WORDS}\b|\b${CERT_WORDS}\s*(?:in|for|of|:)?\s*${c}|${c}(?:\s+[\w()-]+){0,4}?\s+(?:certified|licensed)\b|\b(?:certified|licensed)\s+(?:[\w-]+\s+){0,2}${c}`, "i").test(piece)
      ) return true;
      // A named credential listed on its own is a claim to hold it. Up to four
      // plain qualifier words may follow ("OSHA 30 Construction").
      if (named) {
        const alone = new RegExp(String.raw`^\s*${c}(?:\s+[A-Za-z0-9/&-]+){0,4}?(?:\s*\([^)]*\))?(?:\s*[-,]?\s*(?:19|20)\d\d)?\s*$`, "i");
        if (piece.split(/\s*[,;]\s*/).some((seg) => seg.length <= 80 && alone.test(seg))) return true;
      }
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
export function findOverstatedCredentials(text: string, statuses: Map<string, Status>, opts: { firstPerson?: boolean } = {}): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    for (const s of sentencesOf(line)) if (s.trim() && claimsMoreThanGiven(s, statuses, opts)) found.push(s.trim());
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
      found.push(...findOverstatedCredentials(trimmed, statuses, { firstPerson: true }));
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

/**
 * Resume quality rules: what a Steel Man reader marks on a page that is
 * true but weak.
 *
 * The mint check (resumeMintCheckShared.ts) asks "is it true and is it a
 * document?" These rules ask the next question: "does each part do its job
 * for the person reading it?" An objective tells the employer what you want,
 * not what you bring. A skills list of character words proves nothing. A
 * "responsible for" line is the job description, not the work. Each finding
 * carries one plain t.ROY sentence of why, in the reader's terms.
 *
 * Showing fewer flaws is always safe; showing a wrong one is not. Every rule
 * here is narrow on purpose, and a strong page yields no findings.
 *
 * Pure: no I/O, no model. Safe in the browser and on the server.
 */

import { CONTACT_LINE_RE, skillTermsOf } from "./resumeMintCheckShared";

export type QualitySeverity = "weak" | "missing";

export interface QualityFinding {
  /** Short id. Shared with the writer's `changes[].rule` where they overlap. */
  rule: string;
  /** The line the finding is about, trimmed, exactly as it sits on the page. */
  line: string;
  /** One or two plain t.ROY sentences: what a reader takes from it. */
  why: string;
  severity: QualitySeverity;
  /**
   * Which copy of `line` this is, when the same text sits on the page more
   * than once (0 = the first). Lets a screen mark the right copy.
   */
  occurrence: number;
}

export const QUALITY_RULES = [
  "objective",
  "summary",
  "generic_summary",
  "soft_skill_list",
  "duty_phrasing",
  "weak_bullet",
  "bullets",
  "heading",
] as const;

// ---- Reading the page -------------------------------------------------------

type Section = "experience" | "skills" | "summary" | "objective" | "education" | "credentials" | "other";

const SECTION_NAMES: Array<[Section, RegExp]> = [
  ["objective", /^(?:career |job |professional |employment )?objective$/],
  ["summary", /^(?:(?:career |professional |personal )?summary|(?:professional )?profile|about me|qualifications summary|summary of qualifications|headline)$/],
  ["experience", /^(?:(?:professional |work |relevant |job |employment |volunteer )?experience|employment(?: history)?|work history|job history|career history|experience and volunteer work)$/],
  ["skills", /^(?:(?:core |key |technical |job |relevant |computer )?(?:skills|competencies|abilities)(?: (?:and|&) (?:abilities|qualities|tools|certifications?|equipment|training))?|areas of expertise|tools(?: (?:and|&) equipment)?|equipment(?: operated| (?:and|&) tools)?|machines(?: operated)?|software|technical)$/],
  ["education", /^(?:education(?: (?:and|&) (?:training|certifications?|credentials?|licen[cs]es?))?|training(?: (?:and|&) education)?|schooling)$/],
  ["credentials", /^(?:certifications?(?: (?:and|&) (?:licen[cs]es?|training))?|licen[cs]es?(?: (?:and|&) certifications?)?|credentials|certificates|training (?:and|&) certifications?)$/],
  ["other", /^(?:references|volunteer(?: work)?|projects|awards|languages|additional information|interests|hobbies|activities|accomplishments|achievements|highlights|key achievements|honors|military(?: service| experience| history)?|community (?:service|involvement)|affiliations|memberships)$/],
];

const BULLET_RE = /^[-*\u2022\u00b7\u25aa\u25cf\u25e6\u2023\u2013\u2014]\s*/;
const YEAR_RE = /\b(?:19|20)\d{2}\b/;
const words = (s: string) => s.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
const isBullet = (l: string) => BULLET_RE.test(l);
const bodyOf = (l: string) => l.replace(BULLET_RE, "").trim();
const isAllCaps = (l: string) => /[A-Z]/.test(l) && !/[a-z]/.test(l);

/** Which known section a heading names, or null when the line is not a known heading. */
function knownSection(l: string): Section | null {
  const t = l.replace(/[:\s]+$/, "").replace(/\s+/g, " ").trim().toLowerCase();
  for (const [s, re] of SECTION_NAMES) if (re.test(t)) return s;
  return null;
}

/** A line built like a heading: short, no digits, no "|", and set apart (all caps or a trailing colon). */
function headingShape(l: string): boolean {
  if (l.includes("|") || /[\d,@]/.test(l) || isBullet(l)) return false;
  const w = words(l);
  if (!w.length || w.length > 5) return false;
  // Short acronyms ("CDL", "CPR") are items, not headings.
  if (w.join("").length < 5) return false;
  return isAllCaps(l) || /:\s*$/.test(l);
}

interface PageLine {
  text: string;
  section: Section | null;
  heading: boolean;
  /** A heading in the person's own words (not one a reader expects). */
  unknown?: boolean;
}

interface Page {
  lines: PageLine[];
  /** Index (into lines) of the first heading, or -1. */
  firstHeading: number;
}

function readPage(text: string): Page {
  const raw = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  const lines: PageLine[] = [];
  let section: Section | null = null;
  let firstHeading = -1;
  for (let k = 0; k < raw.length; k++) {
    const l = raw[k];
    // "Objective: Seeking a ..." opens the objective section on its own line.
    const inline = l.match(/^([A-Za-z ]{3,30}):\s*\S/);
    const known = knownSection(l);
    if (known) {
      section = known;
      if (firstHeading < 0) firstHeading = lines.length;
      lines.push({ text: l, section, heading: true });
      continue;
    }
    // "Objective: Seeking ..." or "Skills: forklift, pallet jack": the label
    // opens its section on the same line.
    const inlineSection = inline ? knownSection(inline[1]) : null;
    if (inlineSection) {
      if (firstHeading < 0) firstHeading = lines.length;
      section = inlineSection;
      lines.push({ text: l, section, heading: false });
      continue;
    }
    // A line built like a heading that no reader list knows ("EQUIPMENT
    // RUN", "Places I've Worked:") still closes the section above it, so its
    // items are never read as job bullets. An all-caps job title right over
    // a dated line ("LINE COOK" / "Harbor Grill, 2019 - 2021") is a job
    // header, not a heading.
    // Before the first known heading, a short all-caps line under the name is
    // a headline ("CERTIFIED WELDER"); only a trailing colon makes it a heading there.
    if (k > 0 && headingShape(l) && (firstHeading >= 0 || /:\s*$/.test(l))) {
      const jobTitle = !/:\s*$/.test(l) && raw.slice(k + 1, k + 3).some((n) => YEAR_RE.test(n) && !headingShape(n));
      if (!jobTitle) {
        section = "other";
        if (firstHeading < 0) firstHeading = lines.length;
        lines.push({ text: l, section, heading: true, unknown: true });
        continue;
      }
    }
    lines.push({ text: l, section, heading: false });
  }
  return { lines, firstHeading };
}

/** A place line: "Billings, MT" or "Billings, Montana". */
const PLACE_RE = /^[A-Za-z .'-]+,\s*[A-Za-z .]+$/;
const isPlace = (l: string) => PLACE_RE.test(l) && words(l).length <= 4;

/** A job line: carries a year and either a "|" or a comma ("Cook, Diner, 2019 - 2021"). */
const looksLikeEntry = (l: string) => !isBullet(l) && YEAR_RE.test(l) && /[|,]|\s-\s|\bto\b/.test(l);

// ---- Word lists -------------------------------------------------------------

// Character words: true or not, nobody can test you on them. A skills list
// made of these proves nothing a bullet doesn't prove better. Matched against
// the WHOLE skill term (after "good", "strong" and the like come off), so
// "Patient care" and "Adobe Creative Cloud" stay real skills.
const SOFT_SKILL_RE = new RegExp(
  "^(?:" +
    [
      "hard[- ]?work(?:er|ing)?",
      "work ethic",
      "team ?player",
      "team ?work",
      "works? well with others",
      "people skills",
      "interpersonal(?: skills)?",
      "(?:good |great |excellent |strong |effective )?communication(?: skills)?",
      "communicator",
      "dependab(?:le|ility)",
      "reliab(?:le|ility)",
      "punctual(?:ity)?",
      "honest(?:y)?",
      "loyal(?:ty)?",
      "trustworthy",
      "(?:self[- ])?motivated",
      "self[- ]?starter",
      "(?:fast|quick) learner",
      "eager to learn",
      "willing to learn",
      "detail[- ]oriented",
      "attention to detail",
      "organized",
      "organizational skills",
      "time management",
      "multi[- ]?task(?:ing|er)?",
      "flexib(?:le|ility)",
      "adaptab(?:le|ility)",
      "positive attitude",
      "friendly",
      "problem[- ]solv(?:ing|er)",
      "critical thinking",
      "leadership(?: skills)?",
      "dedicated",
      "dedication",
      "professionalism",
      "patient",
      "patience",
      "caring",
      "energetic",
      "creative",
      "go[- ]getter",
      "works? well under pressure",
      "on time",
      "responsible",
      "good with (?:people|customers|kids|children)",
      "people person",
    ].join("|") +
    ")$",
  "i"
);

/** True when a skill term is only a character word ("Strong work ethic", "Team player"). */
function isSoftTerm(term: string): boolean {
  const t = term
    .toLowerCase()
    .replace(/[.!]+$/, "")
    .replace(/^(?:very |extremely |highly |good |great |excellent |strong |effective |outstanding )+/, "")
    .replace(/ skills?$/, "")
    .trim();
  return !!t && SOFT_SKILL_RE.test(t);
}

// Phrases that fit any page. A summary made of them says nothing about this person.
const GENERIC_RE = new RegExp(
  "\\b(?:" +
    [
      "hard[- ]?work(?:er|ing)",
      "dedicated",
      "(?:self[- ])?motivated",
      "highly motivated",
      "reliable",
      "dependable",
      "team ?player",
      "results[- ]driven",
      "detail[- ]oriented",
      "proven track record",
      "excellent communication",
      "strong work ethic",
      "work ethic",
      "(?:fast|quick) learner",
      "passionate",
      "dynamic",
      "go[- ]getter",
      "self[- ]?starter",
      "seeking",
      "looking for",
      "opportunity to grow",
      "room to grow",
      "growing company",
      "challenging (?:position|role|opportunity)",
      "any position",
      "various",
      "seasoned professional",
      "people person",
      "eager to learn",
      "willing to learn",
    ].join("|") +
    ")\\b",
  "gi"
);

const OBJECTIVE_LINE_RE = /^(?:i am |i'm )?(?:seeking|looking for|to obtain|to secure|to gain|to find|obtain|secure) (?:a |an |the |employment|work|a position|position|full[- ]time|part[- ]time|entry[- ]level|challenging)/i;

// Duty phrasing: the job description, not the work. These always read that way.
const DUTY_RE = /\b(responsible for|duties (?:included|include|were|consisted of)|duties:|job (?:was|included) to)\b/i;
// These read that way only on a bare line. A count ("Worked with a 5-cook
// line") or a second action ("...to plate the covers") makes it real work,
// and being put in charge is a promotion, not a duty.
const SOFT_DUTY_RE = /\b(in charge of|dealt with|worked with|tasked with)\b/i;
const PROMOTED_RE = /\b(?:put|placed|promoted|moved up|made|named)\s+(?:\w+\s+)?in charge of\b/i;
// Vague lines that could sit under any job.
const VAGUE_RE = /\b(?:as (?:assigned|needed|directed|required)|where(?:ver)? needed|various (?:tasks|duties|jobs|things)|other duties|odd jobs|general (?:duties|labor tasks)|helped out)\b/i;
const DID_START_RE = /^(?:i\s+)?(did)\b/i;

// Verbs a bullet may start with. A bullet that starts with one of these is
// doing work; a short bullet that starts with anything else names a topic.
const VERBS = new Set(
  (
    "add adjust advise aid answer apply arrange assemble assess assist audit bake balance bill book bring build buy calibrate " +
    "call care carry change check clean clear close coach collect complete conduct connect cook coordinate count cover " +
    "create cut deliver design detail develop diagnose direct dispatch distribute drive edit enter establish estimate fabricate " +
    "file fill finish fix follow form frame fuel grade greet grill guide handle haul help hire inspect install interview inventory " +
    "issue keep label lay lead learn lift load locate log maintain make manage measure meet mentor mix monitor mop move negotiate " +
    "open operate order organize oversee pack paint patrol perform pick place plan plant plumb point polish post pour prep prepare " +
    "present prevent price print process produce program protect pull pump purchase put raise read receive record recruit reduce " +
    "refill repair replace report resolve restock review roof route run sand schedule scan secure sell serve service set ship " +
    "sort staff start stock store supervise supply support sweep take teach tend test track train transport treat troubleshoot " +
    "tutor unload update use verify wash weld wire work wrap write"
  ).split(" ")
);
const IRREGULAR = new Set(
  "built bought brought caught cut drove fed fixed found fought gave got grew held hung kept laid led left lent made met paid put ran read rode sent set shot sold spent split spoke stood swept taught told took threw understood won wore wrote dug".split(" ")
);

function startsWithVerb(body: string): boolean {
  const first = (words(body)[0] ?? "").toLowerCase();
  if (!first) return false;
  if (IRREGULAR.has(first) || VERBS.has(first)) return true;
  if (first.endsWith("ed") && first.length > 4) return true;
  if (first.endsWith("es") && VERBS.has(first.slice(0, -2))) return true;
  if (first.endsWith("s") && VERBS.has(first.slice(0, -1))) return true;
  return false;
}

// ---- What t.ROY says ----------------------------------------------------------

const WHY = {
  objective:
    "An objective tells the employer what you want. They're reading to see what you bring, so this spot gets a few true lines about your work instead.",
  summary:
    "There's no summary up top. Two or three true lines about what you do and what you bring tell a reader why to keep going.",
  generic_summary:
    "This line could sit on anybody's page, so it tells a reader nothing about you. A summary works when it carries facts only you have.",
  soft_skill_list:
    "Anybody can type these words, so a reader skips right past them. Skills are things you could be tested on, like tools and machines; your bullets show the rest.",
  weak_bullet:
    "This names a task but not what you did with it. A bullet starts with the action, so a reader sees the work.",
  gerund:
    "This starts with an -ing word, so it reads like a list of chores. A bullet starts with the action itself, like Trained instead of Training.",
  vague:
    "This could sit under any job, so it tells a reader nothing. A bullet names one real thing you did.",
  bullets:
    "This is a block of words, not bullets. A hiring manager skims, so each thing you did gets its own bullet that starts with the action.",
  bare:
    "These are bare words under a job, not bullets. A reader can't tell what you did with them.",
  heading_missing:
    "Your jobs sit here with no heading over them. A reader and the hiring software look for a plain heading like EXPERIENCE to find them.",
  heading_odd:
    "A reader and the hiring software don't know this heading. Plain ones like EXPERIENCE, SKILLS and EDUCATION get found fast.",
  heading_mixed:
    "This heading looks different from your others. Matching headings read as careful, and mixed ones read as rushed.",
  did: "\"Did\" is a weak start. Lead with the action itself so a reader sees the work.",
} as const;

function dutyWhy(phrase: string): string {
  const p = phrase.replace(/:$/, "");
  const shown = p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  return `"${shown}" reads like the job posting. The employer already knows what the job was; this line should say what you did in it.`;
}

// ---- The rules ----------------------------------------------------------------

interface Analysis {
  findings: QualityFinding[];
  /** Positive evidence the page is strong (never inferred from silence). */
  strong: boolean;
}

/**
 * Read a page and return what a Steel Man reader would mark, in page order.
 * One finding per line at most. An empty array means nothing weak was found;
 * it does NOT mean the page is strong (see `pageLooksStrong`).
 */
export function runQualityCheck(text: string): QualityFinding[] {
  return analyze(text).findings;
}

/**
 * True only on positive evidence: no quality findings, a summary or headline
 * up top, an experience heading, and at least two bullets that start with an
 * action. A page this cannot read well is never called strong.
 */
export function pageLooksStrong(text: string): boolean {
  return analyze(text).strong;
}

function analyze(text: string): Analysis {
  const none: Analysis = { findings: [], strong: false };
  if (typeof text !== "string" || !text.trim()) return none;
  const page = readPage(text);
  const ls = page.lines;
  if (ls.length < 3) return none;

  const found = new Map<number, Omit<QualityFinding, "occurrence">>();
  const add = (i: number, f: Omit<QualityFinding, "occurrence">) => {
    if (i >= 0 && i < ls.length && !found.has(i)) found.set(i, f);
  };

  const isContact = (l: string) => CONTACT_LINE_RE.test(l);
  // The top block: lines after the name and before the first heading.
  const topEnd = page.firstHeading < 0 ? ls.length : page.firstHeading;
  const topIdx: number[] = [];
  for (let i = 1; i < topEnd; i++) if (!isContact(ls[i].text)) topIdx.push(i);

  const hasExperienceHeading = ls.some((l) => l.heading && l.section === "experience");
  // A job line not under a heading that would explain it (education and
  // credentials carry years and commas too).
  const ENTRY_SECTIONS = new Set<Section | null>([null, "objective", "summary", "other"]);
  const entryIdx = ls.findIndex(
    (l, i) => i > 0 && !l.heading && ENTRY_SECTIONS.has(l.section) && !isContact(l.text) && looksLikeEntry(l.text) && !(l.section === "other" && precededByKnownOther(i))
  );
  function precededByKnownOther(i: number): boolean {
    for (let j = i - 1; j >= 0; j--) if (ls[j].heading) return ls[j].section === "other" && !ls[j].unknown;
    return false;
  }
  const hasJobs = hasExperienceHeading || entryIdx >= 0;

  // Experience lines: under an experience heading; with no heading at all,
  // from the first job line to the next heading.
  const inExperience = (i: number): boolean => {
    if (ls[i].heading) return false;
    if (ls[i].section === "experience") return true;
    if (!hasExperienceHeading && entryIdx >= 0 && i >= entryIdx) {
      for (let j = entryIdx; j <= i; j++) if (ls[j].heading) return false;
      return true;
    }
    return false;
  };

  // 1. Objective statement.
  let objectiveAt = -1;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (l.section !== "objective" || l.heading) continue;
    objectiveAt = i;
    break;
  }
  if (objectiveAt < 0) {
    const headingAt = ls.findIndex((l) => l.heading && l.section === "objective");
    if (headingAt >= 0) objectiveAt = headingAt;
  }
  if (objectiveAt < 0) {
    for (const i of topIdx) {
      if (OBJECTIVE_LINE_RE.test(bodyOf(ls[i].text))) {
        objectiveAt = i;
        break;
      }
    }
  }
  if (objectiveAt >= 0) add(objectiveAt, { rule: "objective", line: ls[objectiveAt].text, why: WHY.objective, severity: "weak" });

  // 2. Summary: missing, or generic.
  const summaryLines: number[] = ls.map((l, i) => (l.section === "summary" && !l.heading ? i : -1)).filter((i) => i >= 0);
  if (!ls.some((l) => l.section === "summary")) {
    // A headline ("Certified Welder", "WELDER") or a summary sentence under
    // the name counts. A city line does not.
    for (const i of topIdx) if (i !== objectiveAt && !isPlace(ls[i].text) && words(ls[i].text).length >= 1) summaryLines.push(i);
  }
  const hasTop = summaryLines.length > 0;
  // A missing summary is marked last, so a heading mark on the same line wins.
  const summaryMissing = !hasTop && objectiveAt < 0 && hasJobs && page.firstHeading >= 0;
  if (summaryLines.length) {
    // What only this person has: words from their job lines (titles, employers, tools).
    const own = new Set<string>();
    for (let i = 0; i < ls.length; i++) {
      if (!inExperience(i)) continue;
      for (const w of words(ls[i].text)) if (w.length >= 5) own.add(w.toLowerCase());
    }
    for (const i of summaryLines) {
      const l = bodyOf(ls[i].text);
      const generic = l.match(GENERIC_RE) ?? [];
      if (!generic.length) continue;
      const genericWords = new Set(generic.flatMap((g) => words(g).map((w) => w.toLowerCase())));
      const anchored = /\d/.test(l) || words(l).some((w) => w.length >= 5 && own.has(w.toLowerCase()) && !genericWords.has(w.toLowerCase()));
      if (generic.length >= 2 || !anchored) {
        add(i, { rule: "generic_summary", line: ls[i].text, why: WHY.generic_summary, severity: "weak" });
      }
    }
  }

  // 3. Skills made of character words (each term judged whole).
  const skillIdx = ls.map((l, i) => (l.section === "skills" && !l.heading ? i : -1)).filter((i) => i >= 0);
  if (skillIdx.length) {
    let total = 0;
    let soft = 0;
    let firstSoft = -1;
    for (const i of skillIdx) {
      for (const term of skillTermsOf(ls[i].text)) {
        total++;
        if (isSoftTerm(term)) {
          soft++;
          if (firstSoft < 0) firstSoft = i;
        }
      }
    }
    if (soft >= 2 && soft * 2 >= total && firstSoft >= 0) {
      add(firstSoft, { rule: "soft_skill_list", line: ls[firstSoft].text, why: WHY.soft_skill_list, severity: "weak" });
    }
  }

  // 4. Duty phrasing and vague lines, in the top block and under jobs.
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (l.heading || isContact(l.text)) continue;
    if (!(inExperience(i) || l.section === "summary" || topIdx.includes(i) || isBullet(l.text))) continue;
    if (l.section === "skills" || l.section === "education" || l.section === "credentials") continue;
    const body = bodyOf(l.text);
    const m = body.match(DUTY_RE);
    if (m) {
      add(i, { rule: "duty_phrasing", line: l.text, why: dutyWhy(m[1]), severity: "weak" });
      continue;
    }
    const soft = body.match(SOFT_DUTY_RE);
    if (soft && !/\d/.test(body) && !PROMOTED_RE.test(body) && !hasSecondAction(body)) {
      add(i, { rule: "duty_phrasing", line: l.text, why: dutyWhy(soft[1]), severity: "weak" });
      continue;
    }
    if (DID_START_RE.test(body) && (l.section === "experience" || isBullet(l.text))) {
      add(i, { rule: "duty_phrasing", line: l.text, why: WHY.did, severity: "weak" });
      continue;
    }
    if (inExperience(i) && VAGUE_RE.test(body) && !/\d/.test(body)) {
      add(i, { rule: "weak_bullet", line: l.text, why: WHY.vague, severity: "weak" });
    }
  }

  // 5. Job lines. Inside experience, find each job's header (the lines up to
  // its dates) and its body (the lines after). Header lines are never judged
  // as sentences; body lines that are not bullets are.
  const exp = ls.map((_, i) => i).filter((i) => inExperience(i));
  const isYearLine = (i: number) => YEAR_RE.test(ls[i].text) && !isBullet(ls[i].text);
  // A date-only line ("2019 - 2022", "Billings, MT | 2019 - 2022"): the lines
  // right above it are that job's title and employer.
  const dateOnly = (i: number) => {
    const t = ls[i].text.replace(/\([^)]*\)/g, "");
    const rest = t.replace(/\b(?:19|20)\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?|\b(?:present|current|now|to)\b|\d{1,2}\//gi, "");
    return words(rest).length <= 3 && !/\|/.test(rest.replace(/\|[^|]*,\s*[A-Za-z]{2,}\s*\|?/g, ""));
  };
  const header = new Set<number>();
  for (const i of exp) {
    if (!isYearLine(i)) continue;
    header.add(i);
    // The line right above a dated line is always header; two above only for a date-only line.
    const reach = dateOnly(i) ? 2 : 1;
    for (let d = 1; d <= reach; d++) {
      const j = i - d;
      if (j < 0 || !inExperience(j) || isBullet(ls[j].text) || isYearLine(j)) break;
      header.add(j);
    }
    // A place line right under the dates belongs to the header too.
    if (i + 1 < ls.length && inExperience(i + 1) && isPlace(ls[i + 1].text)) header.add(i + 1);
  }
  const firstYear = exp.find((i) => isYearLine(i)) ?? -1;
  let actionBullets = 0;
  // One mark per run of non-bullet lines.
  let runStart = -1;
  const closeRun = () => {
    runStart = -1;
  };
  for (let i = 0; i < ls.length; i++) {
    if (!inExperience(i)) {
      closeRun();
      continue;
    }
    const t = ls[i].text;
    if (isBullet(t)) {
      closeRun();
      const body = bodyOf(t);
      if (startsWithVerb(body)) actionBullets++;
      if (/\d/.test(body)) continue;
      const w = words(body);
      const first = (w[0] ?? "").toLowerCase();
      if (first.length > 4 && first.endsWith("ing") && first !== "during") {
        add(i, { rule: "weak_bullet", line: t, why: WHY.gerund, severity: "weak" });
      } else if (w.length > 0 && w.length <= 3 && !startsWithVerb(body)) {
        add(i, { rule: "weak_bullet", line: t, why: WHY.weak_bullet, severity: "weak" });
      }
      continue;
    }
    if (header.has(i) || isYearLine(i) || isContact(t) || isPlace(t) || /\|/.test(t) || TITLE_AT_RE.test(t)) {
      closeRun();
      continue;
    }
    // Before the first dated line there is no job yet: only a real sentence counts.
    const inBody = firstYear >= 0 && i > firstYear;
    const w = words(t);
    let kind: "bare" | "block" | null = null;
    if (sentenceSignal(t)) kind = "block";
    else if (inBody && w.length >= 1 && w.length <= 4) kind = "bare";
    else if (inBody && w.length >= 5) kind = "block";
    if (!kind) {
      closeRun();
      continue;
    }
    if (runStart < 0) {
      runStart = i;
      add(i, { rule: "bullets", line: t, why: kind === "bare" ? WHY.bare : WHY.bullets, severity: "weak" });
    }
  }

  // 6. Headings: missing over the jobs, unknown, or styled unlike the rest.
  if (!hasExperienceHeading && entryIdx >= 0) {
    // A heading of its own words right above the jobs ("Places I've Worked:")
    // is there but unclear; nothing there means it is missing.
    let odd = -1;
    for (let j = entryIdx - 1; j >= Math.max(1, entryIdx - 2); j--) {
      if (ls[j].heading && ls[j].unknown && /:\s*$/.test(ls[j].text)) {
        odd = j;
        break;
      }
      if (ls[j].heading) break;
    }
    if (odd >= 0) add(odd, { rule: "heading", line: ls[odd].text, why: WHY.heading_odd, severity: "weak" });
    else add(entryIdx, { rule: "heading", line: ls[entryIdx].text, why: WHY.heading_missing, severity: "missing" });
  }
  const known = ls.map((l, i) => (l.heading && !l.unknown ? i : -1)).filter((i) => i >= 0);
  const caps = known.filter((i) => isAllCaps(ls[i].text));
  if (caps.length >= 2) {
    for (const i of known) {
      if (!isAllCaps(ls[i].text)) {
        add(i, { rule: "heading", line: ls[i].text, why: WHY.heading_mixed, severity: "weak" });
        break;
      }
    }
  }

  if (summaryMissing) {
    add(page.firstHeading, { rule: "summary", line: ls[page.firstHeading].text, why: WHY.summary, severity: "missing" });
  }

  // Which copy of each line a finding is about.
  const seen = new Map<string, number>();
  const occurrenceAt = new Map<number, number>();
  ls.forEach((l, i) => {
    const n = seen.get(l.text) ?? 0;
    occurrenceAt.set(i, n);
    seen.set(l.text, n + 1);
  });
  const findings = [...found.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([i, f]) => ({ ...f, occurrence: occurrenceAt.get(i) ?? 0 }));
  const strong = findings.length === 0 && hasTop && hasExperienceHeading && actionBullets >= 2;
  return { findings, strong };
}

// "Cashier at Safeway", "Cook at the Elks Lodge": a title over its employer.
const TITLE_AT_RE = /^[A-Z][A-Za-z'&./-]*(?:\s+[A-Z][A-Za-z'&./-]*){0,3}\s+(?:at|with|for)\s+(?:the\s+)?[A-Z]/;

// Small words that join names ("Department of Fish, Wildlife and Parks"), not sentences.
const CONNECTORS = new Set(["of", "and", "the", "at", "for", "in", "on", "a", "an", "to", "with", "by"]);

/**
 * A line reads as a sentence only on a real signal: "I", "my" or "we", a
 * closing period, or eight or more words with at least two small words that
 * are not name connectors.
 */
function sentenceSignal(t: string): boolean {
  const w = words(t);
  if (!w.length) return false;
  if (w.some((x) => x === "I" || /^(?:my|we|our)$/i.test(x))) return true;
  const small = w.filter((x) => /^[a-z]/.test(x) && !CONNECTORS.has(x)).length;
  if (/[.;!]$/.test(t) && small >= 1 && w.length >= 3) return true;
  return w.length >= 8 && small >= 2;
}

/** "...to plate 250 covers", "...and trained the new hires": a second action in the line. */
function hasSecondAction(body: string): boolean {
  const m = body.toLowerCase().match(/\b(?:to|and|then)\s+([a-z]+)/g) ?? [];
  return m.some((x) => {
    const v = x.split(/\s+/)[1];
    return VERBS.has(v) || IRREGULAR.has(v) || (v.endsWith("ed") && v.length > 4);
  });
}

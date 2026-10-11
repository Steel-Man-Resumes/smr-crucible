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
  ["skills", /^(?:(?:core |key |technical |job |relevant )?(?:skills|competencies|abilities)(?: (?:and|&) (?:abilities|qualities|tools))?|areas of expertise)$/],
  ["education", /^(?:education(?: (?:and|&) (?:training|certifications?|credentials?|licen[cs]es?))?|training(?: (?:and|&) education)?|schooling)$/],
  ["credentials", /^(?:certifications?(?: (?:and|&) licen[cs]es?)?|licen[cs]es?(?: (?:and|&) certifications?)?|credentials|certificates)$/],
  ["other", /^(?:references|volunteer(?: work)?|projects|awards|languages|additional information|interests|hobbies|activities)$/],
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
  if (l.includes("|") || /\d/.test(l) || isBullet(l)) return false;
  const w = words(l);
  if (!w.length || w.length > 5) return false;
  return isAllCaps(l) || /:\s*$/.test(l);
}

interface PageLine {
  text: string;
  section: Section | null;
  heading: boolean;
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
  for (const l of raw) {
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
    lines.push({ text: l, section, heading: false });
  }
  return { lines, firstHeading };
}

/** A job line: carries a year and either a "|" or a comma ("Cook, Diner, 2019 - 2021"). */
const looksLikeEntry = (l: string) => !isBullet(l) && YEAR_RE.test(l) && /[|,]|\s-\s|\bto\b/.test(l);

// ---- Word lists -------------------------------------------------------------

// Character words: true or not, nobody can test you on them. A skills list
// made of these proves nothing a bullet doesn't prove better.
const SOFT_SKILL_RE = new RegExp(
  "\\b(?:" +
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
    ].join("|") +
    ")\\b",
  "i"
);

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

// Duty phrasing: the job description, not the work.
const DUTY_RE = /\b(responsible for|duties (?:included|include|were|consisted of)|duties:|in charge of|dealt with|worked with|tasked with|job (?:was|included) to)\b/i;
const DID_START_RE = /^(?:i\s+)?(did)\b/i;

// Verbs a bullet may start with. A bullet that starts with one of these is
// doing work; a short bullet that starts with anything else names a topic.
const VERBS = new Set(
  (
    "add adjust advise aid answer apply arrange assemble assess assist audit bake balance bill book bring build buy calibrate " +
    "call care carry cashier change check clean clear close coach collect complete conduct connect cook coordinate count cover " +
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
  bullets:
    "This is a block of words, not bullets. A hiring manager skims, so each thing you did gets its own bullet that starts with the action.",
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

/**
 * Read a page and return what a Steel Man reader would mark, in page order.
 * One finding per line at most. An empty array means nothing weak was found.
 */
export function runQualityCheck(text: string): QualityFinding[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const page = readPage(text);
  const ls = page.lines;
  if (ls.length < 3) return [];

  const found = new Map<number, QualityFinding>();
  const add = (i: number, f: QualityFinding) => {
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
  const entryIdx = ls.findIndex((l, i) => i > 0 && ENTRY_SECTIONS.has(l.section) && !isContact(l.text) && looksLikeEntry(l.text));
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
    // A headline or a summary sentence under the name counts.
    for (const i of topIdx) if (words(ls[i].text).length >= 3 && i !== objectiveAt) summaryLines.push(i);
  }
  if (summaryLines.length === 0 && objectiveAt < 0 && hasJobs && page.firstHeading >= 0) {
    add(page.firstHeading, { rule: "summary", line: ls[page.firstHeading].text, why: WHY.summary, severity: "missing" });
  }
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

  // 3. Skills made of character words.
  const skillIdx = ls.map((l, i) => (l.section === "skills" && !l.heading ? i : -1)).filter((i) => i >= 0);
  if (skillIdx.length) {
    let total = 0;
    let soft = 0;
    let firstSoft = -1;
    for (const i of skillIdx) {
      for (const term of skillTermsOf(ls[i].text)) {
        total++;
        if (SOFT_SKILL_RE.test(term)) {
          soft++;
          if (firstSoft < 0) firstSoft = i;
        }
      }
    }
    if (soft >= 2 && soft * 2 >= total && firstSoft >= 0) {
      add(firstSoft, { rule: "soft_skill_list", line: ls[firstSoft].text, why: WHY.soft_skill_list, severity: "weak" });
    }
  }

  // 4. Duty phrasing, anywhere but headings and contact lines.
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (l.heading || isContact(l.text)) continue;
    const body = bodyOf(l.text);
    const m = body.match(DUTY_RE);
    if (m) {
      add(i, { rule: "duty_phrasing", line: l.text, why: dutyWhy(m[1]), severity: "weak" });
      continue;
    }
    if (DID_START_RE.test(body) && (l.section === "experience" || isBullet(l.text))) {
      add(i, { rule: "duty_phrasing", line: l.text, why: WHY.did, severity: "weak" });
    }
  }

  // 5. Job lines: written as a block instead of bullets, or bullets with no action.
  let inRun = false;
  for (let i = 0; i < ls.length; i++) {
    if (!inExperience(i)) {
      inRun = false;
      continue;
    }
    const t = ls[i].text;
    if (isBullet(t)) {
      inRun = false;
      const body = bodyOf(t);
      if (/\d/.test(body)) continue;
      const w = words(body);
      const first = (w[0] ?? "").toLowerCase();
      const gerund = first.length > 4 && first.endsWith("ing") && first !== "during";
      if (gerund || (w.length > 0 && w.length <= 3 && !startsWithVerb(body))) {
        add(i, { rule: "weak_bullet", line: t, why: WHY.weak_bullet, severity: "weak" });
      }
      continue;
    }
    // A sentence line under a job (no year, no "|"). Titles, employers and
    // places are Title Case; a sentence has small words in it.
    const w = words(t);
    const small = w.filter((x) => /^[a-z]/.test(x)).length;
    const sentence =
      !YEAR_RE.test(t) && !t.includes("|") && !isContact(t) && ((w.length >= 4 && small >= 2) || (startsWithVerb(t) && small >= 1));
    if (sentence) {
      if (!inRun) add(i, { rule: "bullets", line: t, why: WHY.bullets, severity: "weak" });
      inRun = true;
    } else {
      inRun = false;
    }
  }

  // 6. Headings: missing over the jobs, unknown, or styled unlike the rest.
  if (!hasExperienceHeading && entryIdx >= 0) {
    // A heading of its own words right above the jobs ("Places I've Worked:")
    // is there but unclear; nothing there means it is missing.
    let odd = -1;
    for (let j = entryIdx - 1; j >= Math.max(1, entryIdx - 2); j--) {
      if (!ls[j].heading && /:\s*$/.test(ls[j].text) && headingShape(ls[j].text) && !isContact(ls[j].text)) {
        odd = j;
        break;
      }
    }
    if (odd >= 0) add(odd, { rule: "heading", line: ls[odd].text, why: WHY.heading_odd, severity: "weak" });
    else add(entryIdx, { rule: "heading", line: ls[entryIdx].text, why: WHY.heading_missing, severity: "missing" });
  }
  const known = ls.map((l, i) => (l.heading ? i : -1)).filter((i) => i >= 0);
  const caps = known.filter((i) => isAllCaps(ls[i].text));
  if (caps.length >= 2) {
    for (const i of known) {
      if (!isAllCaps(ls[i].text)) {
        add(i, { rule: "heading", line: ls[i].text, why: WHY.heading_mixed, severity: "weak" });
        break;
      }
    }
  }

  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => f);
}

/**
 * ATS lenses -- score a resume the way the market scores it, honestly.
 *
 * OUR POSITION, stated plainly because the product states it to the user too:
 * there is no such thing as "your ATS score." Workday, Taleo, Greenhouse and
 * iCIMS all parse differently, so any single number claiming to be THE score is
 * invented. The resume-tool market sells that number anyway.
 *
 * We do not refuse to play. We show the person the game. Each lens below is one
 * of the criteria the industry actually grades on, scored separately, by rules
 * a person can read in this file. Nothing is averaged into a grade that hides
 * where the points went, and every point lost names the line that lost it.
 *
 * INTEGRITY BOUNDARY (the whole reason this is safe to ship): a lens may never
 * cause a claim to be added to a resume. Keyword coverage in particular reports
 * what a posting asks for and the resume does not show -- it NEVER inserts the
 * term. Inserting it is a question for the person, answered by the person. That
 * is the line between equipping someone for a keyword game and helping them lie
 * on an application, and it is not a close call.
 *
 * Deterministic on purpose: no model call, no cost, no latency, same answer
 * every time, and auditable by a skeptical evaluator.
 */

import { computeFitPlan } from "@crucible/core/src/pageFit";
import { findDiscrepancies } from "@/lib/resume-discrepancies";

export type LensId =
  | "parse_integrity"
  | "impact_evidence"
  | "format_discipline"
  | "completeness"
  | "keyword_coverage";

export interface LensFinding {
  /** What cost points, in the user's language. */
  message: string;
  /** The resume line responsible, when there is one. */
  evidence?: string;
  /**
   * A change the user can apply in one click. Absent when the fix requires a
   * decision only the person can make (see the integrity boundary above).
   */
  fix?: LensFix;
}

export type LensFix =
  | { kind: "replace"; find: string; replaceWith: string; label: string }
  | { kind: "add_section"; section: string; label: string }
  | { kind: "confirm_then_add"; term: string; label: string; question: string };

export interface LensScore {
  id: LensId;
  name: string;
  /** 0-100, or null when the lens cannot run (keyword coverage with no posting). */
  score: number | null;
  /** Why this lens exists, in one line, for the chart's tooltip. */
  what: string;
  /** Which competing product grades on this, so the user sees it is not ours alone. */
  alsoGradedBy: string;
  summary: string;
  findings: LensFinding[];
}

/* ------------------------------------------------------------- helpers -- */

const SECTION_ALIASES: Record<string, RegExp> = {
  experience: /^(work\s+)?(experience|employment|history|professional experience|work history)\b/i,
  education: /^(education|training|schooling)\b/i,
  skills: /^(skills|core competencies|competencies|technical skills|qualifications)\b/i,
  certifications: /^(certifications?|licenses?|credentials?)\b/i,
};

const BULLET_RE = /^\s*[-*•]\s*/;
const ACTION_VERB_START =
  /^(?:[A-Z][a-z]+(?:ed|s|ing)?\b)/;
const GERUND_START = /^[A-Z][a-z]+ing\b/;

function lines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Any section heading we recognize, used to bound the experience section. */
const ANY_SECTION_RE = new RegExp(
  `^(?:${Object.values(SECTION_ALIASES).map((r) => r.source.replace(/^\^/, "")).join("|")}|summary|objective|profile|career summary|about)\\b`,
  "i"
);

/** Contact details: an email, a phone, or a street address. Never an achievement. */
const CONTACT_RE =
  /[\w.+-]+@[\w-]+\.[\w.]+|\(\d{3}\)\s*\d{3}|\b\d{3}[.-]\d{3}[.-]\d{4}\b|\b\d+\s+[NSEW]?\.?\s*\w+\s+(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|way|ct|court|apt|suite)\b/i;

const MONTH_RE = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";

/**
 * A job header or date line rather than something the person did.
 *
 * Any line carrying a year is suspect: "Nov 2020 - March 2022", "ROUSTABOUT |
 * Bearpaw Well Services | 2019" and "09/2016 - 02/2019" are all structure, and
 * counting them as "a line with a number in it" inflates the impact score with
 * dates the person did not achieve.
 */
const JOB_HEADER_RE = new RegExp(
  [
    // Any date range, with or without month names.
    `(?:${MONTH_RE}\\s+)?(?:19|20)\\d{2}\\s*(?:-{1,2}|–|—|to)\\s*(?:(?:${MONTH_RE}\\s+)?(?:19|20)\\d{2}|present|current)`,
    // Numeric month/year, either side of a range.
    `\\b\\d{1,2}\\s*/\\s*(?:19|20)\\d{2}\\b`,
    // A pipe-delimited header ending in a bare year: "TITLE | Company | 2019".
    `\\|\\s*(?:19|20)\\d{2}\\s*$`,
  ].join("|"),
  "i"
);

/**
 * The lines that actually describe the person's work.
 *
 * MEASURED, NOT ASSUMED: scoring only lines with a "-" or "•" reads a typed
 * resume and a generated one differently. The fabricated Montana intake has 54
 * lines and only 8 bullet glyphs -- its other duty lines are plain text -- so a
 * glyph-only rule graded the input on its best 8 lines and the output on all
 * 26, and reported the output as worse. That was the ruler, not the resume.
 *
 * So: a content line is any bulleted line anywhere, plus any substantive line
 * inside the experience section that is not a heading and not a job header.
 * That is also closer to what a parser does, which is the point of the lens.
 */
export function contentLines(text: string): string[] {
  const ls = lines(text);
  const out: string[] = [];

  // Only the experience section counts. A bulleted line under CERTIFICATIONS
  // ("MSHA Part 46 (2018)") is a credential, not an achievement, and counting
  // it as a quantified line credits the resume for a year it did not earn.
  //
  // The header block is excluded the same way. "218 W. Nucleus Ave., Apt 4" and
  // a phone number both contain digits, and letting them through scored a
  // street address as a measured accomplishment.
  const hasHeadings = ls.some((l) => ANY_SECTION_RE.test(l));
  let inExperience = !hasHeadings; // no headings at all: read the whole document

  for (const raw of ls) {
    if (ANY_SECTION_RE.test(raw)) {
      inExperience = SECTION_ALIASES.experience.test(raw);
      continue;
    }
    if (!inExperience) continue;

    const line = raw.replace(BULLET_RE, "").trim();
    if (CONTACT_RE.test(line)) continue;
    if (JOB_HEADER_RE.test(line)) continue; // header or date line
    if (line.split(/\s+/).length < 4) continue; // bare title or company
    if (/^[A-Z][A-Z\s/&,.'-]+$/.test(line)) continue; // ALL-CAPS title line
    if (!/[a-z]/.test(line)) continue; // not prose
    out.push(line);
  }

  return out;
}

/** Clamp to 0-100 and round, so every lens reports on one scale. */
function pct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Words too common to count as a requirement keyword. */
const STOPWORDS = new Set(
  ("a an and or the to of in for on with at by from as is are be been will shall may can must" +
    " you your we our they their this that these those it its have has had do does did not no" +
    " work works working job role position candidate applicant experience ability able required" +
    " preferred plus strong excellent good years year etc including include includes other all" +
    " any more most least well also than then when while who whom which what how why if per")
    .split(/\s+/)
);

function keywordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9+#.\s-]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/^[-.]+|[-.]+$/g, ""))
      .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
  );
}

/* --------------------------------------------------------------- lenses -- */

/**
 * PARSE INTEGRITY -- can a machine actually read this document.
 *
 * The most real of all the lenses, and the one the market talks about least.
 * A resume that scores 95 on keywords and cannot be parsed scores 0 in life.
 */
function parseIntegrity(text: string): LensScore {
  const ls = lines(text);
  const findings: LensFinding[] = [];
  let score = 100;

  const hasEmail = /[\w.+-]+@[\w-]+\.[\w.]+/.test(text);
  const hasPhone = /(\+?\d[\d\s().-]{8,})/.test(text);
  if (!hasEmail) {
    score -= 25;
    findings.push({
      message:
        "No email address found. A parser that cannot find contact details often discards the application before a person sees it.",
    });
  }
  if (!hasPhone) {
    score -= 15;
    findings.push({ message: "No phone number found." });
  }

  // Recognizable section headings. Parsers key off these; invented headings
  // ("My Journey") parse as body text and the section is lost.
  const foundSections = Object.entries(SECTION_ALIASES).filter(([, re]) =>
    ls.some((l) => re.test(l))
  );
  if (!foundSections.some(([k]) => k === "experience")) {
    score -= 25;
    findings.push({
      message:
        "No standard work-experience heading found. Parsers look for a heading like EXPERIENCE or WORK HISTORY to know where jobs begin.",
      fix: { kind: "add_section", section: "PROFESSIONAL EXPERIENCE", label: "Add the heading" },
    });
  }

  // Multi-column and tabular layouts are the classic parse killer. In the text
  // rendition they show up as runs of internal whitespace or pipe grids.
  const columnish = ls.filter((l) => /\S {3,}\S/.test(l) && !BULLET_RE.test(l));
  if (columnish.length > 3) {
    score -= 20;
    findings.push({
      message: `${columnish.length} lines look like columns or a table. Many parsers read these left-to-right across the whole row and scramble the result.`,
      evidence: columnish[0],
    });
  }

  return {
    id: "parse_integrity",
    name: "Parse integrity",
    score: pct(score),
    what: "Whether software can extract your name, contact, jobs and dates at all",
    alsoGradedBy: "The thing every ATS actually does, before any scoring",
    summary:
      score >= 90
        ? "A parser can read this cleanly."
        : "Some of this document may not survive being read by software.",
    findings,
  };
}

/**
 * IMPACT & EVIDENCE -- is there anything here a hiring manager can weigh.
 *
 * Reuses the discrepancy engine rather than restating its rules, so the two
 * surfaces can never disagree about what counts as a weak line.
 */
/**
 * Numbers the person supplied, as they wrote them.
 *
 * Used to catch the worst thing a resume generator can do: drop a real measured
 * detail. On the fabricated Montana run the intake said "40 to 50 loads a week
 * during the season" and the finished resume said only "Hauls material for a
 * 6-mile MDT overlay project" -- the load count went to the cover letter and
 * was deleted from the resume. A number the person actually knows is the single
 * most valuable thing a resume can carry, and losing one is silent damage.
 */
function measuredPhrases(text: string): string[] {
  return contentLines(text)
    .flatMap((l) => l.split(/[,;.]\s+/))
    .map((s) => s.trim())
    .filter((s) => /\d/.test(s) && !CONTACT_RE.test(s) && !JOB_HEADER_RE.test(s));
}

/** The digit runs in a phrase, for comparing source against output. */
function numbersIn(s: string): string[] {
  return (s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[.,]$/, ""));
}

function impactEvidence(text: string, sourceText?: string): LensScore {
  const bs = contentLines(text);
  const findings: LensFinding[] = [];

  // Numbers present in what the person told us but absent from the resume.
  if (sourceText?.trim()) {
    const inResume = new Set(measuredPhrases(text).flatMap(numbersIn));
    const lost = measuredPhrases(sourceText).filter((p) =>
      numbersIn(p).some((n) => n.length > 1 && !inResume.has(n))
    );
    for (const phrase of lost.slice(0, 4)) {
      findings.push({
        message:
          "You gave us this detail and it is not on the finished resume. A number you actually know is the strongest thing a resume can carry -- it should not have been dropped.",
        evidence: phrase,
      });
    }
  }

  if (bs.length === 0) {
    return {
      id: "impact_evidence",
      name: "Impact and evidence",
      score: 0,
      what: "Whether your lines show what you did, with something measured",
      alsoGradedBy: "Rezi and Teal call this a content score",
      summary: "There are no bullet lines to evaluate yet.",
      findings: [],
    };
  }

  const quantified = bs.filter((b) => /\d/.test(b));
  const verbLed = bs.filter((b) => ACTION_VERB_START.test(b) && !GERUND_START.test(b));

  const discrepancies = findDiscrepancies(text);
  const weak = discrepancies.filter(
    (d) => d.kind === "vague_bullet" || d.kind === "first_person"
  );

  const quantRatio = quantified.length / bs.length;
  const verbRatio = verbLed.length / bs.length;
  const weakPenalty = Math.min(30, weak.length * 8);

  // Weighted: something measured matters most, then verb-led phrasing.
  const score = pct(quantRatio * 55 + verbRatio * 45 - weakPenalty);

  if (quantRatio < 0.4) {
    findings.push({
      message: `Only ${quantified.length} of ${bs.length} lines carry a number. One real number does more than a paragraph of description -- a crew size, a count per shift, a percentage, a dollar figure.`,
    });
  }
  for (const d of weak.slice(0, 5)) {
    findings.push({
      message: d.question,
      evidence: d.evidence,
      fix:
        d.kind === "first_person"
          ? {
              kind: "replace",
              find: d.evidence,
              replaceWith: stripFirstPerson(d.evidence),
              label: "Drop \"I\" and \"my\"",
            }
          : undefined,
    });
  }

  return {
    id: "impact_evidence",
    name: "Impact and evidence",
    score,
    what: "Whether your lines show what you did, with something measured",
    alsoGradedBy: "Rezi and Teal call this a content score",
    summary:
      score >= 75
        ? "Your lines show real, specific work."
        : "Several lines describe the job rather than your contribution.",
    findings,
  };
}

/** Rewrite a bullet out of first person without changing its meaning. */
export function stripFirstPerson(bullet: string): string {
  return bullet
    .replace(/\bon my shift\b/gi, "per shift")
    .replace(/\bmy\s+/gi, "the ")
    .replace(/\bI\s+(?:have\s+|had\s+)?/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^([a-z])/, (m) => m.toUpperCase())
    .trim();
}

/**
 * FORMAT DISCIPLINE -- length, consistency, and whether it looks finished.
 * Delegates page geometry to the existing page-fit engine.
 */
function formatDiscipline(text: string): LensScore {
  const findings: LensFinding[] = [];
  let score = 100;

  const plan = computeFitPlan(text, {});
  const { band, pageCount, finalPageFullness } = plan.result;

  if (band === "over") {
    score -= 35;
    findings.push({
      message: `This runs about ${pageCount} pages. Two is the practical ceiling for almost every role.`,
    });
  } else if (band === "under") {
    score -= 20;
    findings.push({
      message: `The last page is only about ${Math.round(finalPageFullness * 100)}% full. Either fill it with real achievements or tighten to ${pageCount - 1} page${pageCount - 1 === 1 ? "" : "s"}. Never pad.`,
    });
  }

  // Inconsistent date formats read as unfinished to a human and can defeat a
  // parser's date extraction.
  const dateStyles = new Set<string>();
  for (const l of lines(text)) {
    if (/\b\d{1,2}\/\d{4}\b/.test(l)) dateStyles.add("numeric");
    if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/i.test(l))
      dateStyles.add("month-name");
    if (/^\S.*\b(?:19|20)\d{2}\s*[-–]\s*(?:(?:19|20)\d{2}|present)\b/i.test(l))
      dateStyles.add("year-only");
  }
  if (dateStyles.size > 1) {
    score -= 15;
    findings.push({
      message: `Dates are written ${dateStyles.size} different ways (${Array.from(dateStyles).join(", ")}). Pick one and use it everywhere.`,
    });
  }

  const long = contentLines(text).filter((b) => b.length > 220);
  if (long.length) {
    score -= Math.min(15, long.length * 5);
    findings.push({
      message: `${long.length} bullet${long.length === 1 ? " is" : "s are"} long enough to be skipped. Two lines is the reading limit.`,
      evidence: long[0].slice(0, 100) + "...",
    });
  }

  return {
    id: "format_discipline",
    name: "Format discipline",
    score: pct(score),
    what: "Length, consistent dates, and bullets short enough to actually get read",
    alsoGradedBy: "Every resume grader on the market scores some version of this",
    summary:
      score >= 85 ? "Cleanly formatted." : "A few formatting choices are working against you.",
    findings,
  };
}

/** COMPLETENESS -- are the sections an employer expects present. */
function completeness(text: string): LensScore {
  const ls = lines(text);
  const findings: LensFinding[] = [];
  const expected: Array<[string, string]> = [
    ["experience", "PROFESSIONAL EXPERIENCE"],
    ["skills", "SKILLS"],
    ["education", "EDUCATION"],
  ];

  let present = 0;
  for (const [key, heading] of expected) {
    if (ls.some((l) => SECTION_ALIASES[key].test(l))) {
      present++;
    } else {
      findings.push({
        message: `No ${key} section. Employers scan for it, and its absence reads as an omission rather than a choice.`,
        fix: { kind: "add_section", section: heading, label: `Add ${heading}` },
      });
    }
  }

  // Deliberately NOT penalized: a missing summary. A summary is a stylistic
  // choice, and for someone whose strongest evidence is their work history it
  // can cost space better spent on a bullet.
  return {
    id: "completeness",
    name: "Completeness",
    score: pct((present / expected.length) * 100),
    what: "Whether the sections employers look for are all here",
    alsoGradedBy: "Kickresume and Enhancv score section coverage",
    summary:
      present === expected.length
        ? "Every expected section is present."
        : `${expected.length - present} expected section${expected.length - present === 1 ? "" : "s"} missing.`,
    findings,
  };
}

/**
 * KEYWORD COVERAGE -- the lens the market is actually selling.
 *
 * Reports terms the posting emphasizes that the resume does not show. It NEVER
 * supplies them: each is returned as a question for the person, because the
 * only honest way to add a keyword is for the human to confirm it is true.
 * That is what separates this from keyword stuffing.
 */
function keywordCoverage(text: string, posting?: string): LensScore {
  const base = {
    id: "keyword_coverage" as const,
    name: "Keyword coverage",
    what: "How much of this specific posting's language your resume already shows",
    alsoGradedBy: "This is the number Jobscan sells",
  };

  if (!posting?.trim()) {
    return {
      ...base,
      score: null,
      summary: "Paste a job posting to score this. Without one there is nothing to match against, and a keyword score with no posting would be invented.",
      findings: [],
    };
  }

  const resumeWords = keywordsOf(text);
  const postingWords = Array.from(keywordsOf(posting));

  // Terms the posting repeats are the ones it cares about.
  const counts = new Map<string, number>();
  for (const w of postingWords) counts.set(w, (counts.get(w) ?? 0) + 1);
  const emphasized = Array.from(new Set(postingWords))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
    .slice(0, 40);

  const missing = emphasized.filter((w) => !resumeWords.has(w));
  const covered = emphasized.length - missing.length;
  const score = pct(emphasized.length ? (covered / emphasized.length) * 100 : 0);

  return {
    ...base,
    score,
    summary: `Your resume already shows ${covered} of the ${emphasized.length} terms this posting leans on.`,
    findings: missing.slice(0, 12).map((term) => ({
      message: `The posting asks about "${term}" and your resume does not mention it.`,
      fix: {
        kind: "confirm_then_add",
        term,
        label: `I have done this`,
        question: `Have you actually done work involving "${term}"? If yes, we will add it in your own words. If no, it stays off -- a keyword you cannot back up fails at the interview instead of the filter.`,
      },
    })),
  };
}

/* ----------------------------------------------------------------- run -- */

export interface AtsReport {
  lenses: LensScore[];
  /**
   * Our own composite of the lenses that could run. Labeled as ours, never as
   * "your ATS score," because no such single number exists.
   */
  composite: number;
  hasPosting: boolean;
}

export function scoreResume(
  text: string,
  posting?: string,
  sourceText?: string
): AtsReport {
  const lenses: LensScore[] = [
    parseIntegrity(text),
    impactEvidence(text, sourceText),
    formatDiscipline(text),
    completeness(text),
    keywordCoverage(text, posting),
  ];
  const scored = lenses.filter((l) => l.score !== null) as Array<LensScore & { score: number }>;
  return {
    lenses,
    composite: pct(scored.reduce((a, l) => a + l.score, 0) / (scored.length || 1)),
    hasPosting: Boolean(posting?.trim()),
  };
}

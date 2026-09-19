/**
 * Resume discrepancies -- the things a person should look at before sending.
 *
 * WHY THIS EXISTS. A fabricated Montana resume was run end to end and the tool
 * silently resolved four ambiguities instead of surfacing them:
 *
 *   - "2008 -" with a dangling hyphen became "2008 - Present", and a strength
 *     was then built on the invented duration.
 *   - "MSHA Part 46 (2018)" shipped as a current credential in 2026, and the
 *     cover letter asserted it in the present tense. MSHA Part 46 needs annual
 *     refresher training.
 *   - "Assisted with various tasks around the property" and "Helped out at the
 *     front desk" survived verbatim onto the finished resume.
 *   - A 15-month employment gap was never mentioned to anyone.
 *
 * The fix is not a smarter model, it is an honest handoff. Every item here is a
 * QUESTION FOR THE PERSON, never an assumption and never an edit. The tool says
 * what it noticed and what it cannot know; the human decides. That is also the
 * only version of this that is safe to show an evaluator, because every claim
 * it makes is about the document, not about the person's life.
 *
 * Deliberately deterministic: no model call, no cost, no latency, same answer
 * every time. A reviewer can read this file and check the rules themselves.
 */

export type DiscrepancyKind =
  | "open_end_date"
  | "employment_gap"
  | "aging_credential"
  | "vague_bullet"
  | "first_person"
  | "unquantified_role";

export interface Discrepancy {
  kind: DiscrepancyKind;
  /** Short label for the list row. */
  label: string;
  /** The text we actually saw, quoted back so the person can find it. */
  evidence: string;
  /** What we want them to decide. Always a question, never a verdict. */
  question: string;
}

/* ------------------------------------------------------------------ dates -- */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

interface DateRange {
  line: string;
  startYear: number;
  startMonth: number;
  /** null = the line gave no end at all (dangling or open). */
  endYear: number | null;
  endMonth: number;
  /** The line explicitly said Present/Current. */
  explicitPresent: boolean;
}

/** Parse "Sept 2016 - Feb 2019", "03/2019 - 08/2019", "2011 - 2016", "2008 -". */
function parseDateRange(line: string): DateRange | null {
  const YEAR = "(?:19|20)\\d{2}";
  const MON = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";
  const part = `(?:(${MON})[a-z]*\\.?\\s+)?(?:(\\d{1,2})\\s*[/-]\\s*)?(${YEAR})`;
  // An end side that may be a date, "Present"/"Current", or entirely absent.
  const re = new RegExp(
    `${part}\\s*(?:-{1,2}|–|—|\\bto\\b)\\s*(?:(present|current)|${part})?`,
    "i"
  );
  const m = line.match(re);
  if (!m) return null;

  const startMonth = m[1]
    ? MONTHS[m[1].slice(0, 3).toLowerCase()]
    : m[2]
      ? Number(m[2])
      : 1;
  const startYear = Number(m[3]);
  const explicitPresent = Boolean(m[4]);

  let endYear: number | null = null;
  let endMonth = 12;
  if (!explicitPresent && m[7]) {
    endYear = Number(m[7]);
    endMonth = m[5] ? MONTHS[m[5].slice(0, 3).toLowerCase()] : m[6] ? Number(m[6]) : 12;
  }

  return { line, startYear, startMonth, endYear, endMonth, explicitPresent };
}

/** Lines that are a job header rather than a bullet or a prose paragraph. */
function isBullet(line: string): boolean {
  return /^\s*[-*•]/.test(line);
}

/* ---------------------------------------------------------- credentials -- */

/**
 * Credentials with a real recurrence requirement, and the interval in years.
 * Conservative on purpose: we ask whether it is current, we never assert it is
 * expired. Getting that wrong in either direction is a claim about the person.
 */
const RECURRING_CREDENTIALS: Array<{ match: RegExp; years: number; why: string }> = [
  { match: /msha\b.*\bpart\s*46|part\s*46\b/i, years: 1, why: "MSHA Part 46 requires annual refresher training" },
  { match: /msha\b.*\bpart\s*48|part\s*48\b/i, years: 1, why: "MSHA Part 48 requires annual refresher training" },
  { match: /\bflagger\b/i, years: 3, why: "flagger certification is typically renewed every few years" },
  { match: /\b(cpr|aed|first\s*aid|bls)\b/i, years: 2, why: "first aid and CPR certification typically lapse after two years" },
  { match: /\bforklift\b|\bpowered industrial truck\b/i, years: 3, why: "forklift operator certification is typically re-evaluated every three years" },
  { match: /\bhazwoper\b/i, years: 1, why: "HAZWOPER requires annual refresher training" },
  { match: /\bservsafe\b|\bfood handler\b/i, years: 3, why: "food safety certification expires" },
  { match: /\bdot\b.*\bmedical\b|\bmedical (card|certificate)\b/i, years: 2, why: "a DOT medical card expires" },
];

/* ------------------------------------------------------------- bullets -- */

/** Duty language: describes a job description, not a person's contribution. */
const VAGUE_PATTERNS: Array<{ match: RegExp; label: string }> = [
  { match: /\bresponsible for\b/i, label: "Duty language" },
  { match: /\bassisted with\b/i, label: "Duty language" },
  { match: /\bhelped (out |with )?\b/i, label: "Duty language" },
  { match: /\bvarious (tasks|duties|projects)\b/i, label: "Unspecified work" },
  { match: /\bduties includ(ed|e)\b/i, label: "Duty language" },
  { match: /\bother duties\b/i, label: "Unspecified work" },
  { match: /\bas needed\b|\bas required\b/i, label: "Unspecified work" },
  { match: /\bworked on\b/i, label: "Duty language" },
];

const FIRST_PERSON = /\b(?:I|my|me|mine)\b/;

const CURRENT_YEAR = new Date().getFullYear();

/* ---------------------------------------------------------------- main -- */

/**
 * Inspect resume text and return what a person should look at.
 *
 * `text` should be the resume as the person will send it. Pass the INTAKE text
 * as well when available: a dangling date in the source is the strongest signal
 * that a resolved date in the output was guessed.
 */
export function findDiscrepancies(
  text: string,
  options: { sourceText?: string; now?: number } = {}
): Discrepancy[] {
  const found: Discrepancy[] = [];
  const year = options.now ? new Date(options.now).getFullYear() : CURRENT_YEAR;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const sourceLines = (options.sourceText ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // --- Open-ended and dangling dates -------------------------------------
  //
  // Two separate cases, and only one is a real problem. A CURRENT job ending in
  // "Present" is ordinary. The problem is a SECOND open-ended range, or a
  // source line whose end date was missing entirely: someone has to say whether
  // that work is still going on, because the tool cannot know.
  const ranges = lines.filter((l) => !isBullet(l)).map(parseDateRange).filter(Boolean) as DateRange[];
  const openEnded = ranges.filter((r) => r.explicitPresent || r.endYear === null);

  const danglingInSource = sourceLines
    .map(parseDateRange)
    .filter((r): r is DateRange => Boolean(r && r.endYear === null && !r.explicitPresent));

  for (const d of danglingInSource) {
    found.push({
      kind: "open_end_date",
      label: "A job with no end date",
      evidence: d.line,
      question: `Your resume listed this as starting in ${d.startYear} with no end date. Is this work still going on today, or did it end? Nothing was assumed for you.`,
    });
  }

  if (danglingInSource.length === 0 && openEnded.length > 1) {
    const overlapping = openEnded.slice(1);
    for (const o of overlapping) {
      found.push({
        kind: "open_end_date",
        label: "Two jobs both show as current",
        evidence: o.line,
        question: `This shows as ongoing at the same time as another role. If you hold both, that is worth saying plainly. If this one ended, it needs an end year.`,
      });
    }
  }

  // --- Employment gaps ----------------------------------------------------
  //
  // Read gaps from the INTAKE when we have it, not the finished resume. The
  // generated resume deliberately reduces dates to years ("Roustabout | 2019"),
  // which is normal resume practice and is exactly what hides a gap: a job that
  // ran March to August 2019 followed by one starting November 2020 is a
  // 15-month gap that looks like one month once both are printed as years.
  const gapSource = sourceLines.length ? sourceLines : lines;
  const gapRanges = gapSource
    .filter((l) => !isBullet(l))
    .map(parseDateRange)
    .filter(Boolean) as DateRange[];

  const dated = gapRanges
    .filter((r) => !r.explicitPresent && r.endYear !== null)
    .map((r) => ({
      ...r,
      startAbs: r.startYear * 12 + r.startMonth,
      endAbs: (r.endYear as number) * 12 + r.endMonth,
    }))
    .sort((a, b) => a.startAbs - b.startAbs);

  for (let i = 1; i < dated.length; i++) {
    const prevEnd = Math.max(...dated.slice(0, i).map((d) => d.endAbs));
    const gapMonths = dated[i].startAbs - prevEnd;
    if (gapMonths >= 12) {
      found.push({
        kind: "employment_gap",
        label: `A gap of about ${Math.round(gapMonths / 12) === 1 ? "a year" : `${Math.round(gapMonths / 12)} years`}`,
        evidence: dated[i].line,
        question:
          "There is a gap before this role. You are not required to explain a gap you are not asked about, and the resume does not draw attention to it. Worth deciding now what you would say if someone asks.",
      });
      break; // One gap note is enough. A list of them reads like an accusation.
    }
  }

  // --- Aging credentials --------------------------------------------------
  for (const line of lines) {
    const yearMatch = line.match(/\b((?:19|20)\d{2})\b/);
    if (!yearMatch) continue;
    const credYear = Number(yearMatch[1]);
    const age = year - credYear;
    if (age < 1) continue;

    for (const c of RECURRING_CREDENTIALS) {
      if (!c.match.test(line)) continue;
      if (age < c.years) continue;
      found.push({
        kind: "aging_credential",
        label: "A certification that may need renewing",
        evidence: line,
        question: `This shows ${credYear}, and ${c.why}. Is it current? If it is, the year is fine to leave off. If it lapsed, it should come off the resume rather than go to an employer as a current credential.`,
      });
      break;
    }
  }

  // --- Bullet quality -----------------------------------------------------
  const bullets = lines.filter(isBullet).map((l) => l.replace(/^\s*[-*•]\s*/, ""));

  for (const b of bullets) {
    const vague = VAGUE_PATTERNS.find((p) => p.match.test(b));
    if (vague) {
      found.push({
        kind: "vague_bullet",
        label: vague.label,
        evidence: b,
        question:
          "This line tells an employer the job existed, not what you did in it. What is one specific thing you handled here, and roughly how much or how often?",
      });
    }
  }

  for (const b of bullets) {
    if (FIRST_PERSON.test(b)) {
      found.push({
        kind: "first_person",
        label: "First person on a resume line",
        evidence: b,
        question:
          "Resume bullets normally drop \"I\" and \"my\". This one kept them, which reads as copied rather than written. Want it rephrased?",
      });
    }
  }

  // Whole-role check: a role where nothing is measured at all.
  if (bullets.length >= 3 && !bullets.some((b) => /\d/.test(b))) {
    found.push({
      kind: "unquantified_role",
      label: "Nothing measured anywhere",
      evidence: bullets[0],
      question:
        "No line on this resume carries a number -- a count, a size, a crew, a frequency. One real number does more than a page of description. What is a number you actually know?",
    });
  }

  return found;
}

/** Group for display: same question type collapses into one row with a count. */
export function groupDiscrepancies(
  items: Discrepancy[]
): Array<{ kind: DiscrepancyKind; label: string; items: Discrepancy[] }> {
  const groups = new Map<DiscrepancyKind, { kind: DiscrepancyKind; label: string; items: Discrepancy[] }>();
  for (const d of items) {
    const g = groups.get(d.kind);
    if (g) g.items.push(d);
    else groups.set(d.kind, { kind: d.kind, label: d.label, items: [d] });
  }
  return Array.from(groups.values());
}

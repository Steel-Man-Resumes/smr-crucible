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
  | "unsupported_claim"
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

/* ---------------------------------------------------- unsupported claims -- */

/**
 * Claims about WHO SOMEONE IS, and the evidence that would license them.
 *
 * WHY THIS IS SEPARATE FROM THE AI VERIFIER. The grounding verifier is told to
 * flag "assertions of specific fact a background check could disprove" and to
 * leave "general professional framing" alone. That is a sound rule for most
 * prose and it has one bad consequence: character claims read as framing, so
 * they sail straight through. On a real run, two sentences about washing dishes
 * produced "Reliability and consistent attendance across every shift, on time
 * and ready to work" -- a claim the person never made about themselves.
 *
 * These are the MOST dangerous inventions for this product's users, not the
 * least. A hiring manager asks "tell me about your attendance at that job" and
 * a person who never claimed it is now defending someone else's sentence in an
 * interview. Unfalsifiable on paper is exactly what makes it tempting to write
 * and brutal to be asked about.
 *
 * Deterministic and enumerable, so a skeptic can read the rules and a run is
 * reproducible. Each entry: the claim as it appears in output, and the words in
 * the person's OWN source that would make it theirs to make.
 */
/**
 * Claims about WHO SOMEONE IS, and what would actually license them.
 *
 * WHY THIS IS SEPARATE FROM THE AI VERIFIER. The grounding verifier is told to
 * flag "assertions of specific fact a background check could disprove" and to
 * leave "general professional framing" alone. A character claim reads as
 * framing, so it sails through. On a real run, two sentences about washing
 * dishes produced "Reliability and consistent attendance across every shift".
 *
 * These are the MOST dangerous inventions for this product's users, not the
 * least: nothing on paper disproves them, which is what makes them tempting to
 * write and brutal to be asked about in an interview.
 *
 * VOCABULARY IS NOT EVIDENCE -- the correction that shaped this version.
 * The first cut licensed a claim whenever a related WORD appeared anywhere in
 * the source. A review broke it in one line each: "Completed safety training"
 * licensed "Clean safety record"; "Worked on a crew" licensed "Supervised a
 * crew of six"; "CPR certification" licensed "Licensed electrician"; and, worst
 * of all, "I was often late and had poor attendance" licensed "Perfect
 * attendance" -- the source said the OPPOSITE and the checker called it
 * supported.
 *
 * Three rules now, and each one closes one of those:
 *   1. NEGATION. If the source says the opposite nearby, nothing licenses the
 *      claim. Checked first, because a negated source is worse than a silent
 *      one -- the resume is contradicting the person.
 *   2. SPECIFICITY. The licence must be as strong as the claim. Training is not
 *      a record; being on a crew is not running one. Each claim names the
 *      phrases that actually establish it, not the topic it belongs to.
 *   3. SUBJECT MATCH for credentials. Holding a CPR card does not license
 *      "licensed electrician" -- the licence must name the same thing.
 *
 * This is still a deterministic check with an enumerated vocabulary, so it
 * cannot catch a claim nobody listed ("Won employee of the year" is not in
 * here). It narrows a known-dangerous class; it is not a proof of truth, and
 * the panel no longer says otherwise.
 */
const CHARACTER_CLAIMS: Array<{
  claim: RegExp;
  /** Phrases that genuinely establish the claim, not merely its topic. */
  licensedBy: RegExp;
  /** Source wording that contradicts the claim outright. */
  contradictedBy?: RegExp;
  label: string;
}> = [
  {
    label: "attendance or punctuality",
    claim: /\b(?:consistent |perfect |strong |excellent |reliable )?attendance\b|\bpunctual(?:ity)?\b|\bon time,? (?:every|ready|and)\b|\bnever (?:late|missed)\b|\bshows? up on time\b/i,
    // Being present is not a record of attendance. The source has to make the
    // claim about reliability itself.
    licensedBy: /\b(?:perfect|great|good|strong|excellent|consistent|reliable)\s+attendance\b|\bnever (?:late|missed)\b|\balways on time\b|\bshows? up (?:on time|every day)\b|\bnot missed a (?:day|shift)\b|\bpunctual\b/i,
    contradictedBy: /\b(?:poor|bad|spotty|inconsistent)\s+attendance\b|\boften late\b|\bwas late\b|\bmissed (?:a lot|many|several|shifts|days)\b|\bshowed up late\b|\battendance (?:was |problem|issue)/i,
  },
  {
    label: "a safety record",
    claim: /\b(?:clean|strong|spotless|excellent|proven)\s+safety\s+record\b|\bzero\s+(?:accidents|injuries|incidents)\b|\bno\s+(?:lost[- ]time\s+)?(?:accidents|injuries|incidents)\b/i,
    // Safety TRAINING is not a safety RECORD. The source must speak to
    // outcomes over time, which is what a record is.
    licensedBy: /\bno\s+(?:lost[- ]time\s+)?(?:accidents|injuries|incidents)\b|\bzero\s+(?:accidents|injuries|incidents)\b|\bsafety record\b|\baccident[- ]free\b|\bwithout (?:an )?(?:accident|injury|incident)\b/i,
    contradictedBy: /\b(?:had|an|one)\s+(?:accident|injury|incident)\b|\bosha violation\b|\bsafety violation\b|\bgot hurt\b|\bwas injured\b/i,
  },
  {
    label: "leading or supervising people",
    claim: /\b(?:led|managed|supervised|oversaw|directed)\s+(?:a\s+)?(?:team|crew|staff|shift|department)\b|\bteam lead(?:er)?\b|\bsupervis(?:or|ory)\b/i,
    // Being ON a crew is not running one. The source must show authority over
    // other people, not membership alongside them.
    licensedBy: /\b(?:led|ran|supervis\w*|managed|oversaw|in charge of|responsible for)\s+(?:a\s+)?(?:\w+\s+){0,3}(?:team|crew|staff|shift|department|people|guys|men|workers|hires)\b|\bforeman\b|\blead(?:er)?\b(?!\s*(?:to|into))|\btrained\s+(?:new\s+)?(?:hires|staff|people|employees|workers)\b|\bcrew (?:lead|chief)\b/i,
    contradictedBy: /\bnever (?:led|supervised|managed)\b|\bno (?:supervisory|leadership) (?:experience|role)\b/i,
  },
  {
    label: "a work ethic or attitude",
    claim: /\bstrong work ethic\b|\bgoes? above and beyond\b|\bself[- ]motivated\b|\bhighly (?:motivated|dedicated)\b|\btakes? initiative\b/i,
    licensedBy: /\bwork ethic\b|\bhard work(?:er|ing)\b|\bgo(?:es)? above and beyond\b|\bself[- ]motivated\b|\btook initiative\b|\bvolunteered for\b/i,
  },
  {
    label: "customer service",
    claim: /\bcustomer service\b|\bclient[- ]facing\b|\bcustomer satisfaction\b/i,
    licensedBy: /\bcustomer\w*\b|\bclient\w*\b|\bguest\w*\b|\bfront desk\b|\bcashier\b|\bserved\b|\bretail\b|\bwaited on\b|\bthe public\b/i,
  },
];

/**
 * Credentials get SUBJECT matching, not topic matching.
 *
 * "CPR certification" in the source used to license "Licensed electrician" in
 * the output, because both contain a certification word. A credential claim is
 * only supported when the source names the SAME credential, so this compares
 * the words around the claim against the words around every licence in the
 * source.
 */
// Looks BOTH WAYS around the credential word. "OSHA certified" puts the
// subject BEFORE it, and a forward-only pattern captured just "certified" --
// an empty subject, which then matched anything and silently passed. Found by
// the test that was supposed to prove the opposite.
const CREDENTIAL_CLAIM =
  /(?:[\w-]+\s+){0,3}\b(?:certified|licensed|credentialed)\b(?:\s+(?:in|as|for))?(?:\s+[\w-]+){0,3}|\b[A-Za-z][\w/ -]{2,40}?\s+(?:certifications?|certificates?|licen[sc]es?)\b/gi;

const STOP = new Set([
  "certified", "licensed", "credentialed", "certification", "certificate",
  "license", "licence", "and", "the", "with", "for", "in", "of", "a", "an",
]);

/** The meaningful words in a credential phrase: "OSHA 10 certified" -> {osha,10}. */
function credentialSubject(phrase: string): Set<string> {
  return new Set(
    phrase
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
  );
}

/** Does the source name a credential sharing a subject word with this claim? */
function credentialSupported(claimPhrase: string, source: string): boolean {
  const want = credentialSubject(claimPhrase);
  // A bare "certified" with no subject names nothing checkable. Treat it as
  // supported rather than flagging every stray word -- the specific-subject
  // cases are the ones that matter and the ones that were getting through.
  if (want.size === 0) return true;
  for (const found of source.match(CREDENTIAL_CLAIM) ?? []) {
    const have = credentialSubject(found);
    for (const w of Array.from(want)) if (have.has(w)) return true;
  }
  return false;
}

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

  // --- Claims the person never made about themselves ----------------------
  //
  // Only runs when we have the person's own source to compare against. With
  // nothing to check a claim against, silence is the honest answer.
  if (options.sourceText?.trim()) {
    const source = options.sourceText;
    const ask =
      "This says something about you that you did not tell us, so we cannot stand behind it and neither should you. If it is true, say it in your own words and it stays. If it is not, take it out -- an employer who asks about it in an interview is the worst place to find out.";

    for (const rule of CHARACTER_CLAIMS) {
      const hit = lines.find((l) => rule.claim.test(l));
      if (!hit) continue;
      // Contradiction first: a source that says the opposite is worse than one
      // that says nothing, because the resume is now arguing with the person.
      const contradicted = rule.contradictedBy?.test(source) ?? false;
      if (!contradicted && rule.licensedBy.test(source)) continue;
      found.push({
        kind: "unsupported_claim",
        label: contradicted
          ? `This contradicts what you told us about ${rule.label}`
          : `A claim about ${rule.label}`,
        evidence: hit,
        question: contradicted
          ? "This says the opposite of what you told us. Whatever the truth is, it has to be yours -- take this out or rewrite it in your own words."
          : ask,
      });
    }

    // Credentials, matched by SUBJECT: holding one certification does not
    // license claiming a different one.
    for (const line of lines) {
      for (const phrase of line.match(CREDENTIAL_CLAIM) ?? []) {
        if (credentialSupported(phrase, source)) continue;
        found.push({
          kind: "unsupported_claim",
          label: "A credential we cannot find in what you told us",
          evidence: line,
          question: ask,
        });
        break;
      }
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

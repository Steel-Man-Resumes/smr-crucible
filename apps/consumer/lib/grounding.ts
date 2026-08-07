/**
 * Grounding gauge -- the deterministic, user-facing honest contract (F2).
 *
 * The gauge scores how much real material the user has given us, per job:
 * employer? dates? at least one concrete duty? an outcome/result? -- rolled up
 * into a RED/AMBER/GREEN band. It is the honest contract made visible: thin data
 * means a shorter, sparser-but-true resume, never invention. No AI, no network --
 * pure and instant so it can update live on the intake/review screen.
 */

export type GroundingBand = "red" | "amber" | "green";

export interface GroundingJobInput {
  employer?: string;
  title?: string;
  dates?: string;
  /** Free text of duties/responsibilities for this role. */
  duties?: string;
}

export interface GroundingJobScore {
  label: string;
  hasEmployer: boolean;
  hasDates: boolean;
  hasDuty: boolean;
  hasOutcome: boolean;
  filled: number; // 0-4
}

export interface GroundingScore {
  band: GroundingBand;
  percent: number; // 0-100
  jobCount: number;
  jobs: GroundingJobScore[];
  /** Human-readable gaps we'll leave blank rather than fill. */
  missing: string[];
  headline: string;
  detail: string;
}

function hasText(v?: string): boolean {
  return !!v && v.trim().length > 0;
}

// A 4-digit calendar year (1900-2099) is a DATE, not a result. Stripped before any
// numeric check so "Worked in 2022" cannot read as an outcome (Codex 13).
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;

// Content words = alphabetic tokens of 3+ letters, after years are removed. Tells a
// substantive duty ("Loaded and unloaded trucks") from a bare date fragment
// ("Worked in 2022").
function contentWordCount(text: string): number {
  const matches = text.replace(YEAR_RE, " ").match(/[A-Za-z]{3,}/g);
  return matches ? matches.length : 0;
}

// A real quantified metric: a percentage, a dollar figure, or any number that is not
// just a year (headcount, counts, quantities). Years are removed first.
function hasMetric(text: string): boolean {
  if (/\d\s*(?:%|percent|per\s?cent)/i.test(text)) return true;
  if (/\$\s?\d/.test(text)) return true;
  return /\d/.test(text.replace(YEAR_RE, " "));
}

// Genuine achievement / impact / scope verbs -- a claimed result, not a routine task.
// The old list also matched task verbs (maintained, processed, worked, reached, hit,
// beat), which inflated the gauge; those are dropped (Codex 13).
const ACHIEVEMENT_VERB_RE =
  /\b(increased|decreased|reduced|improved|cut|saved|grew|raised|lowered|boosted|exceeded|achieved|earned|awarded|promoted|generated|eliminated|streamlined|negotiated|secured|launched|delivered|led|trained|mentored|supervised|managed)\b/i;

// An OUTCOME is a real metric (never a bare year) OR a genuine achievement verb --
// never just any digit or any verb (Codex 13).
function dutyHasOutcome(duties?: string): boolean {
  if (!hasText(duties)) return false;
  return hasMetric(duties!) || ACHIEVEMENT_VERB_RE.test(duties!);
}

function scoreJob(job: GroundingJobInput, index: number): GroundingJobScore {
  const hasEmployer = hasText(job.employer);
  const hasDates = hasText(job.dates);
  // A substantive duty, not a bare date fragment: real length AND at least two content
  // words after years are stripped ("Worked in 2022" -> 1 word -> not a duty; Codex 13).
  const hasDuty =
    hasText(job.duties) &&
    job.duties!.trim().length >= 12 &&
    contentWordCount(job.duties!) >= 2;
  const hasOutcome = dutyHasOutcome(job.duties);
  const filled =
    (hasEmployer ? 1 : 0) +
    (hasDates ? 1 : 0) +
    (hasDuty ? 1 : 0) +
    (hasOutcome ? 1 : 0);
  const label =
    job.title?.trim() ||
    job.employer?.trim() ||
    `Job ${index + 1}`;
  return { label, hasEmployer, hasDates, hasDuty, hasOutcome, filled };
}

const BAND_COPY: Record<GroundingBand, { headline: string; detail: string }> = {
  red: {
    headline: "We'd have to guess -- add detail so your resume stays 100% true",
    detail:
      "There isn't much here yet. We will never invent duties, numbers, or tools to fill the gaps -- so with this little, your resume will be short. Add employers, dates, and what you actually did to make it stronger and still true.",
  },
  amber: {
    headline: "Good -- a few gaps we'll leave blank, not fill",
    detail:
      "We have solid material to work with. Where something's missing, we leave it out rather than make it up. Adding the missing pieces below will make your resume fuller -- and still only what's true about you.",
  },
  green: {
    headline: "Strong -- your resume will contain only what you told us",
    detail:
      "You've given us real, specific material. Your resume will be built entirely from it -- nothing invented, nothing padded.",
  },
};

/**
 * Score a set of jobs into the grounding gauge. Everything downstream (the meter,
 * the band copy, the "what we'll leave blank" list) derives from this.
 */
export function computeGrounding(jobs: GroundingJobInput[]): GroundingScore {
  const realJobs = jobs.filter(
    (j) => hasText(j.employer) || hasText(j.title) || hasText(j.duties)
  );
  const scored = realJobs.map(scoreJob);

  const jobCount = scored.length;
  const maxPoints = Math.max(1, jobCount * 4);
  const points = scored.reduce((sum, j) => sum + j.filled, 0);
  const percent = jobCount === 0 ? 0 : Math.round((points / maxPoints) * 100);

  // Band: no jobs, or very thin, is RED regardless of percent arithmetic.
  let band: GroundingBand;
  if (jobCount === 0 || percent < 40) band = "red";
  else if (percent < 75) band = "amber";
  else band = "green";

  const missing: string[] = [];
  if (jobCount === 0) {
    missing.push("Your work history -- even one job, in your own words");
  }
  for (const j of scored) {
    const gaps: string[] = [];
    if (!j.hasEmployer) gaps.push("employer");
    if (!j.hasDates) gaps.push("dates");
    if (!j.hasDuty) gaps.push("what you did");
    else if (!j.hasOutcome) gaps.push("a result or number");
    if (gaps.length) missing.push(`${j.label}: ${gaps.join(", ")}`);
  }

  return {
    band,
    percent,
    jobCount,
    jobs: scored,
    missing: missing.slice(0, 8),
    headline: BAND_COPY[band].headline,
    detail: BAND_COPY[band].detail,
  };
}

// ─── Adapters -----------------------------------------------------------------

/** Build gauge input from a /api/parse profile's work_history. */
export function jobsFromParsedProfile(profile: any): GroundingJobInput[] {
  const wh = Array.isArray(profile?.work_history) ? profile.work_history : [];
  return wh.map((w: any) => ({
    employer: w?.company || "",
    title: w?.title || "",
    dates: [w?.start_date, w?.end_date].filter(Boolean).join(" - "),
    duties: Array.isArray(w?.bullets) ? w.bullets.join(" ") : (w?.bullets || ""),
  }));
}

/**
 * Gamification -- private, grace-based milestones and streaks (Phase 4.3).
 *
 * Doctrine (non-negotiable, from Troy):
 *   - Private only. No leaderboards, no ranks, no cross-user comparison. There
 *     is deliberately no rank/position/percentile field anywhere in this file.
 *   - Every reward is backed by a REAL recorded fact. A milestone is "earned"
 *     only when its backing fact is true, and it carries the fact string that
 *     proves it (earnedFact).
 *   - Streaks come WITH GRACE. A single missed day never resets the streak and
 *     never shames the person. People whose lives get interrupted are protected,
 *     not punished. The copy frames a gap as "your streak is protected" and a
 *     return as a welcome, never as a failure.
 *   - Celebration is in brand voice: warm, plain, value-first, NO emojis.
 *
 * Everything here is PURE -- no DB, no network, no clock reads except where a
 * caller passes dates in. computeStreak reasons relative to the most recent
 * recorded day (not wall-clock now) so it is deterministic and unit-testable.
 */

// ─── Milestones ───────────────────────────────────────────────────────────────

/**
 * The real, recorded facts a milestone can be backed by. Each field maps to a
 * named server signal (journey snapshot metric or a derived event fact) so no
 * milestone can ever be "earned" without something true behind it.
 */
export interface MilestoneFacts {
  /** getUserProfile.hasResumeTailoredToTarget / journey resumeTailored. */
  resumeTailored: boolean;
  /** countApplicationsSent -- application_status_event ledger. */
  applicationsSent: number;
  /** user_progress_event "interview_completed" count. */
  interviewsCompleted: number;
  /** getUserProfile.hasDisclosurePlan -- a disclosure_plan artifact exists. */
  hasDisclosurePlan: boolean;
  /** user_progress_event "disclosure_plan_created" count. */
  disclosurePlansCreated: number;
  /** detectComeback(eventDates) -- returned to activity after a real absence. */
  comeback: boolean;
}

export interface Milestone {
  id: string;
  title: string;
  /** True only when the backing fact is true. Never set optimistically. */
  earned: boolean;
  /** The real fact that proves an earned milestone. "" when not yet earned. */
  earnedFact: string;
  /** Brand-voice celebration copy. Value first, warm, no emojis, never shaming. */
  celebration: string;
  /** Gentle "next up" copy shown when not yet earned. Never a locked/shaming frame. */
  nextUp: string;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Derive the full milestone set from real facts. Pure. Every milestone is
 * present in the output every time; `earned` is what changes. An unearned
 * milestone always has earnedFact === "" and earned === false, so a caller can
 * never render it as achieved.
 */
export function computeMilestones(facts: MilestoneFacts): Milestone[] {
  const appsEarned = facts.applicationsSent >= 1;
  const practiceEarned = facts.interviewsCompleted >= 1;
  const disclosureEarned = facts.hasDisclosurePlan || facts.disclosurePlansCreated >= 1;

  return [
    {
      id: "first_tailored_resume",
      title: "First tailored resume",
      earned: facts.resumeTailored,
      earnedFact: facts.resumeTailored
        ? "You tailored a resume to a specific job."
        : "",
      celebration:
        "Your resume now speaks straight to a real job. That is the version employers actually stop on.",
      nextUp: "Tailor a resume to a job you want. That is the step that unlocks the rest.",
    },
    {
      id: "first_application",
      title: "First application sent",
      earned: appsEarned,
      earnedFact: appsEarned
        ? `You have sent ${facts.applicationsSent} ${plural(facts.applicationsSent, "application", "applications")}.`
        : "",
      celebration:
        "You put yourself in the running. Hitting send is the hardest part, and you did it.",
      nextUp: "Send one application. You do not have to feel ready, you just have to send it.",
    },
    {
      id: "first_practice",
      title: "First practice interview",
      earned: practiceEarned,
      earnedFact: practiceEarned
        ? `You finished ${facts.interviewsCompleted} practice ${plural(facts.interviewsCompleted, "interview", "interviews")}.`
        : "",
      celebration:
        "You practiced out loud. The real interview gets smaller every time you rehearse.",
      nextUp: "Run one practice interview. Five minutes now saves you a lot of nerves later.",
    },
    {
      id: "first_disclosure_plan",
      title: "First disclosure plan",
      earned: disclosureEarned,
      earnedFact: disclosureEarned ? "You built a disclosure plan." : "",
      celebration:
        "You have a plan for the hard conversation. Walking in with a script is walking in with control.",
      nextUp: "Build a disclosure plan on your terms, so the conversation goes the way you choose.",
    },
    {
      id: "comeback",
      title: "Back at it",
      earned: facts.comeback,
      earnedFact: facts.comeback
        ? "You returned to your job search after time away and logged new activity."
        : "",
      celebration:
        "You came back. Momentum was never about never stopping. It is about starting again, and you just did.",
      nextUp: "Whenever you pick this back up, it counts. Your progress is saved and waiting.",
    },
  ];
}

// ─── Streaks (with grace) ─────────────────────────────────────────────────────

export interface StreakResult {
  /** Distinct active days in the current run, ending at the most recent day. */
  current: number;
  /** Longest run of active days ever, grace gaps bridged. */
  longest: number;
  /** True when a grace day is currently cushioning the run (a gap was bridged). */
  protected: boolean;
  /** Brand-voice status line. Never shames a lapse. */
  message: string;
}

const MS_PER_DAY = 86_400_000;

/** A missed day is forgiven: two active days up to this many calendar days
 *  apart still belong to the same streak (one quiet day in between). */
const GRACE_DAYS = 1;

function toDayNumber(d: string | number | Date): number | null {
  const date = d instanceof Date ? d : new Date(d);
  const t = date.getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor(t / MS_PER_DAY);
}

/**
 * Compute the active-day streak from a list of event dates, WITH GRACE. Pure
 * and deterministic: it reasons relative to the most recent recorded day, not
 * the wall clock, so the same input always gives the same result.
 *
 * Grace: two active days that are at most GRACE_DAYS + 1 calendar days apart
 * stay in the same run. A single missed day never resets the streak. A longer
 * gap starts a fresh run (a gentle reset, never framed as a loss), and the
 * message welcomes the return.
 */
export function computeStreak(eventDates: Array<string | number | Date>): StreakResult {
  const days = Array.from(
    new Set(
      eventDates
        .map(toDayNumber)
        .filter((n): n is number => n !== null)
    )
  ).sort((a, b) => a - b);

  if (days.length === 0) {
    return {
      current: 0,
      longest: 0,
      protected: false,
      message: "No activity yet. The day you start is day one, and it counts.",
    };
  }

  const maxGap = GRACE_DAYS + 1; // same run if consecutive active days differ by <= this

  // Longest run anywhere (grace gaps bridged).
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = days[i] - days[i - 1] <= maxGap ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  // Current run: the run ending at the most recent recorded day.
  let current = 1;
  let usedGrace = false;
  for (let i = days.length - 1; i > 0; i--) {
    const gap = days[i] - days[i - 1];
    if (gap > maxGap) break;
    if (gap === maxGap) usedGrace = true;
    current++;
  }

  // Did a real run exist before this current run started? (a return after a gap)
  const currentRunStartIndex = days.length - current;
  const isComeback = current === 1 && currentRunStartIndex > 0;

  let message: string;
  if (isComeback) {
    message = "Welcome back. Every day you show up counts, starting today.";
  } else if (usedGrace) {
    message = "Your streak is protected. A quiet day or two will not end it.";
  } else if (current >= 2) {
    message = `${current} active days in a row. Keep the momentum going.`;
  } else {
    message = "Day one. This is where it starts.";
  }

  return { current, longest, protected: usedGrace, message };
}

/**
 * Detect a comeback: an absence of at least `gapDays` between two recorded
 * active days, with activity on the far side of the gap. Pure. Used to back the
 * "comeback" milestone with a real fact (a return after real time away).
 */
export function detectComeback(
  eventDates: Array<string | number | Date>,
  gapDays = 14
): boolean {
  const days = Array.from(
    new Set(
      eventDates
        .map(toDayNumber)
        .filter((n): n is number => n !== null)
    )
  ).sort((a, b) => a - b);

  for (let i = 1; i < days.length; i++) {
    if (days[i] - days[i - 1] >= gapDays) return true;
  }
  return false;
}

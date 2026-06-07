/**
 * computeProactiveMessage -- the coach speaks first (master plan Section 5).
 *
 * Deterministic, profile-driven openers shown when the user opens the coach with
 * no conversation yet. No AI cost, no latency, fully testable. Priority order
 * roughly tracks the journey: the most valuable nudge for where the user is.
 *
 * NOTE: the "inactive 7+ days" trigger needs last-active tracking, which is not
 * in the profile yet -- added when that field lands.
 */

import type { UserProfile } from "./getUserProfile";

export interface ProactiveMessage {
  message: string;
  reason: string;
}

export function computeProactiveMessage(p: UserProfile): ProactiveMessage | null {
  // Foundation just built, nothing saved yet -> point at the first target.
  if (p.forgeComplete && p.savedJobs.length === 0) {
    return {
      message:
        "Your foundation is built -- I have your story now. The next move is finding a target job that fits. Open the Job Board and I will help you read the matches.",
      reason: "forge_complete",
    };
  }

  // A follow-up has come due.
  const now = Date.now();
  const due = p.savedJobs.find(
    (j) => j.followUpAt !== null && new Date(j.followUpAt).getTime() <= now
  );
  if (due) {
    return {
      message: `It is time to follow up with ${due.company}. Around five days out is the sweet spot -- want me to help you draft the message?`,
      reason: "follow_up_due",
    };
  }

  // Saved a job but no resume tailored to it.
  if (p.savedJobs.length > 0 && !p.hasResumeTailoredToTarget) {
    const job = p.savedJobs[0];
    return {
      message: `You saved ${job.jobTitle} at ${job.company}. The thing that gets callbacks is tailoring your resume to that posting. Want to start it?`,
      reason: "tailor_resume",
    };
  }

  // Resume tailored but no disclosure plan yet.
  if (p.hasResumeTailoredToTarget && !p.hasDisclosurePlan) {
    return {
      message:
        "Your resume is tailored. Before you apply, let's plan how you talk about your background. It is strategy and timing, not confession.",
      reason: "disclosure",
    };
  }

  // Practiced recently -> offer a debrief.
  if (p.practiceSessionsThisWeek > 0) {
    const n = p.practiceSessionsThisWeek;
    return {
      message: `You practiced ${n} time${n === 1 ? "" : "s"} this week. That repetition is what changes how you answer under pressure. Want to debrief your last session?`,
      reason: "practice_debrief",
    };
  }

  return null;
}

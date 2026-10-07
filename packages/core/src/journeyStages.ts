/**
 * journeyStages -- THE canonical seven-stage journey vocabulary.
 *
 * Before this module, four drifting copies existed (StageProgressBar,
 * NextStepCard, the partner cohort table, coach prompt STAGE_NAMES). Every
 * surface that names a stage must read from here.
 *
 * PURE DATA -- no I/O, and the only import is the pure gateRank map. Client components in apps/consumer
 * deep-import "@crucible/core/src/journeyStages" (safe because core has no
 * package.json exports map and next.config transpiles @crucible/core; the
 * barrel would drag db/pg into the client bundle). If an exports map is ever
 * added to core, add a "./src/journeyStages" subpath for this.
 */

import { GATE_STATE_RANK } from "./gateRank";

export interface JourneyStage {
  /** Engine stage number (computeNextStep), 0-6 */
  stage: number;
  /** One-word label (progress bar) */
  short: string;
  /** Descriptive label (cohort tables, reports) */
  long: string;
  /** "Your next step" framing (next-step card) */
  nextStepLabel: string;
  /** Where this stage's work happens */
  href: string;
}

export const JOURNEY_STAGES: readonly JourneyStage[] = [
  { stage: 0, short: "Take the tour", long: "Getting oriented", nextStepLabel: "Take the tour", href: "/dashboard" },
  { stage: 1, short: "Your resume", long: "Building foundation", nextStepLabel: "Finish your resume", href: "/intro" },
  { stage: 2, short: "Pick a job to aim at", long: "Finding work", nextStepLabel: "Pick a job to aim at", href: "/dashboard/jobs" },
  { stage: 3, short: "Tailor it", long: "Tailoring resume", nextStepLabel: "Tailor your resume to the job", href: "/dashboard/application-tailor" },
  { stage: 4, short: "Plan what to say", long: "Planning disclosure", nextStepLabel: "Plan what to say", href: "/dashboard/disclosure" },
  { stage: 5, short: "Practice the interview", long: "Practicing interviews", nextStepLabel: "Practice the interview", href: "/dashboard/interview" },
  { stage: 6, short: "Apply", long: "Applying & tracking", nextStepLabel: "Apply and keep track", href: "/dashboard/applications" },
];

/** Steps on the progress arc a person sees (stages 1-6; stage 0 is the tour). */
export const JOURNEY_STEP_COUNT = 6;

/**
 * The one sentence that tells a first-timer what the Forge resume is and what
 * the Refinery adds. Shown with the progress arc and in the tour so both say
 * the same thing.
 */
export const FORGE_VS_REFINERY_LINE =
  "Your Forge resume is a general one. The Refinery tools make it fit each job.";

/**
 * Plain-words reason for each step (stages 0-6). Pure data so the dashboard card
 * can show it the moment it renders. computeNextStep re-exports this as
 * NEXT_STEP_WHY, and the AI-phrased line only adds to it, never replaces the
 * step itself.
 */
export const STAGE_WHY: Record<number, string> = {
  0: "A short tour shows you where everything is, so the rest goes faster.",
  1: "Every other tool starts from your resume, so it comes first.",
  2: "The Refinery fits your resume to one real job. Pick the job first.",
  3: "Your Forge resume is a general one. Tailoring it makes it fit this job and opens your other tools.",
  4: "Planning what you will say about your record means you walk in ready.",
  5: "A little practice makes the real interview feel familiar.",
  6: "Applying and tracking keeps your search moving and tells you when to follow up.",
};

/**
 * The plain reason shown with a next step. Looks at the engine's reason code for
 * the two cases that reuse a stage but mean something else.
 */
export function whyForNextStep(next: { stage: number; reason?: string }): string {
  if (next.reason === "default_matches") return "New listings come in often, so it pays to check back.";
  if (next.reason === "follow_up_due") return "A short follow-up keeps you on their radar.";
  return STAGE_WHY[next.stage] ?? STAGE_WHY[2];
}

/**
 * One plain line for a locked tool: what unlocks it. Pure, so the sidebar and the
 * dashboard cards say the same thing. `state` is the onboarding gate state.
 */
export function lockedToolLine(args: {
  state: string;
  requiresDisclosure?: boolean;
  disclosureComplete?: boolean;
}): string {
  if (args.state === "needs_profile") return "Opens once your profile is saved.";
  if (args.state === "needs_resume") return "Opens after you tailor a resume to one job.";
  if (args.requiresDisclosure && !args.disclosureComplete) return "Opens after you plan what to say.";
  return "Opens as you finish the steps.";
}

/** "Step 2 of 6" for an arc stage (1-6). Orientation and past-the-arc get their own words. */
export function stepPositionLabel(arcStage: number): string {
  if (arcStage < 1) return "Start here";
  if (arcStage > JOURNEY_STEP_COUNT) return "Keep going";
  return `Step ${arcStage} of ${JOURNEY_STEP_COUNT}`;
}

/** Label for stage 7 / past-the-arc states. */
export const JOURNEY_COMPLETE_LABEL = "Keep going";

export function stageLong(stage: number): string {
  return JOURNEY_STAGES[stage]?.long ?? JOURNEY_COMPLETE_LABEL;
}

export function stageNextStepLabel(stage: number): string {
  return JOURNEY_STAGES[stage]?.nextStepLabel ?? JOURNEY_COMPLETE_LABEL;
}

/**
 * Where the orientation steps send the user. The dashboard reads the `tour`
 * query value and reopens the guided tour on request, so this link always
 * does something visible.
 */
export const TOUR_PARAM = "tour";
export const TOUR_HREF = `/dashboard?${TOUR_PARAM}=1`;

/**
 * Which stage the progress arc should show as current for a given next step.
 *
 * Stage 0 is orientation, which is not on the arc. The arc starts at stage 1
 * (Foundation), so showing Foundation as current while the Forge is already
 * done contradicts the page. When orientation is pending only because the tour
 * was not taken ("onboarding_pending", which the ladder returns after the Forge
 * is done), the Foundation is finished and the arc points at Target. When the
 * tour is mandatory after two deferrals ("onboarding_required"), the ladder does
 * not say whether the Forge is done, so the arc stays at Foundation.
 */
export function arcStageForNextStep(next: { stage: number; reason?: string }): number {
  // Every step is done: the engine reuses stage 2 ("check new matches") and
  // stage 6 ("follow up") for these. Show the whole arc complete, not "Step 2".
  if (next.reason === "default_matches" || next.reason === "follow_up_due") return 7;
  if (next.stage === 0) return next.reason === "onboarding_pending" ? 2 : 1;
  return Math.min(Math.max(next.stage, 1), 7);
}

/**
 * The ONE answer to "is this client tool open?" for the sidebar and the
 * dashboard cards. `minState` is the gate state the tool needs; tools that build
 * on a disclosure plan also need `disclosureComplete`.
 */
export function clientToolUnlocked(args: {
  state: string;
  minState: string;
  requiresDisclosure?: boolean;
  disclosureComplete?: boolean;
}): boolean {
  const rank = GATE_STATE_RANK as Record<string, number>;
  if ((rank[args.state] ?? 3) > (rank[args.minState] ?? 3)) return false;
  if (args.requiresDisclosure && !args.disclosureComplete) return false;
  return true;
}

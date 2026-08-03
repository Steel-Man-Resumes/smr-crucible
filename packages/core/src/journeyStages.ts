/**
 * journeyStages -- THE canonical seven-stage journey vocabulary.
 *
 * Before this module, four drifting copies existed (StageProgressBar,
 * NextStepCard, the partner cohort table, coach prompt STAGE_NAMES). Every
 * surface that names a stage must read from here.
 *
 * PURE DATA -- no imports, no I/O. Client components in apps/consumer
 * deep-import "@crucible/core/src/journeyStages" (safe because core has no
 * package.json exports map and next.config transpiles @crucible/core; the
 * barrel would drag db/pg into the client bundle). If an exports map is ever
 * added to core, add a "./src/journeyStages" subpath for this.
 */

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
  { stage: 0, short: "Orientation", long: "Getting oriented", nextStepLabel: "Get oriented", href: "/dashboard" },
  { stage: 1, short: "Foundation", long: "Building foundation", nextStepLabel: "Build your foundation", href: "/intro" },
  { stage: 2, short: "Target", long: "Finding work", nextStepLabel: "Know your target", href: "/dashboard/jobs" },
  { stage: 3, short: "Materials", long: "Tailoring resume", nextStepLabel: "Prepare your materials", href: "/dashboard/application-tailor" },
  { stage: 4, short: "Approach", long: "Planning disclosure", nextStepLabel: "Plan your approach", href: "/dashboard/disclosure" },
  { stage: 5, short: "Practice", long: "Practicing interviews", nextStepLabel: "Practice", href: "/dashboard/interview" },
  { stage: 6, short: "Apply", long: "Applying & tracking", nextStepLabel: "Apply and track", href: "/dashboard/applications" },
];

/** Label for stage 7 / past-the-arc states. */
export const JOURNEY_COMPLETE_LABEL = "Keep going";

export function stageLong(stage: number): string {
  return JOURNEY_STAGES[stage]?.long ?? JOURNEY_COMPLETE_LABEL;
}

export function stageNextStepLabel(stage: number): string {
  return JOURNEY_STAGES[stage]?.nextStepLabel ?? JOURNEY_COMPLETE_LABEL;
}

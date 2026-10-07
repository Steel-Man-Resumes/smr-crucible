/**
 * Pure rules for the first-run guided tour (no React, no I/O) so they can be
 * unit tested. GuidedTour.tsx wires these to the page.
 *
 * Two ways the tour opens:
 *  - on its own, the first time a client lands on the dashboard home, until it
 *    is completed or deferred;
 *  - on request, when the page URL carries ?tour=1 (the "Your next step" card
 *    links there). A request always wins over "closed" and "deferred this
 *    session", and it opens even after the tour was completed, so the button
 *    never lands on a page where nothing happens.
 */

import { TOUR_PARAM } from "@crucible/core/src/journeyStages";

/** Fired on window after the tour is completed or deferred, so the next-step card refetches. */
export const NEXT_STEP_CHANGED_EVENT = "next-step-changed";

export interface TourState {
  tourComplete: boolean;
  tourDeferrals: number;
  coachName: string;
}

/** Shown when the tour state cannot be read, so an explicit request still opens. */
export const FALLBACK_TOUR_STATE: TourState = {
  tourComplete: false,
  tourDeferrals: 0,
  coachName: "Guide",
};

/** True when the URL asks for the tour. Accepts URLSearchParams or ReadonlyURLSearchParams. */
export function isTourRequested(params: { get(name: string): string | null } | null | undefined): boolean {
  return params?.get(TOUR_PARAM) === "1";
}

export function isTourVisible(args: {
  tier: string;
  onHome: boolean;
  closed: boolean;
  state: TourState | null;
  requested: boolean;
}): boolean {
  const { tier, onHome, closed, state, requested } = args;
  if (tier !== "client" || !onHome || closed || !state) return false;
  // A request opens the tour even if it was already completed (replay).
  return requested || !state.tourComplete;
}

/** "Remind me next login" only applies to a first run that still has deferrals left. */
export function canDeferTour(state: TourState | null): boolean {
  return !!state && !state.tourComplete && state.tourDeferrals < 2;
}

/** A replay of a completed tour can always be closed. */
export function canCloseTour(state: TourState | null): boolean {
  return !!state && state.tourComplete;
}

/**
 * What the tour teaches. REAL tools only: each entry points at a page that
 * exists today (a test checks the file is there). Planned tools are named once,
 * plainly, in TOUR_NOT_BUILT_YET and never get a row of their own.
 */
export interface TourTool {
  name: string;
  line: string;
  /** Route segment under /dashboard/ that the tool lives at. */
  segment: string;
}

export const TOUR_TOOLS: readonly TourTool[] = [
  { name: "Job Board", line: "Find a real job, then tap Tailor My Resume for This Job.", segment: "jobs" },
  { name: "Application Tailor", line: "Aims your resume at one job, with a cover letter and a disclosure brief.", segment: "application-tailor" },
  { name: "Library", line: "Every resume and letter you make, saved in one place.", segment: "vault" },
  { name: "Disclosure Planner", line: "Plan what to say about your record, and practice it out loud.", segment: "disclosure" },
  { name: "Interview Prep", line: "Mock interviews by text or voice, with feedback.", segment: "interview" },
  { name: "Vault", line: "A private place for your ID, certificates and reference letters.", segment: "documents" },
  { name: "Applications", line: "Track each job from saved to offered.", segment: "applications" },
];

/**
 * Settings features the tour names. `proof` is text that must appear in the
 * named source file, so a rename or removal there fails a test here.
 */
export interface TourSettingsPick {
  name: string;
  line: string;
  proofFile: string;
  proofText: string;
}

export const TOUR_SETTINGS_PICKS: readonly TourSettingsPick[] = [
  { name: "Your coach", line: "Name it, and pick how warm or direct it is.", proofFile: "components/CoachSettingsSection.tsx", proofText: "Coaching style" },
  { name: "Why t.ROY suggested things", line: "See the reason behind each suggestion it made.", proofFile: "components/DecisionLogViewer.tsx", proofText: "Why t.ROY suggested things" },
  { name: "What a partner can see", line: "You choose what a partner organization sees of your progress.", proofFile: "components/SharingConsentSection.tsx", proofText: "SETTINGS_SHARING_TEXT" },
];

export const TOUR_NOT_BUILT_YET =
  "On the list, not built yet: one-click apply, an employer map, a resources map.";

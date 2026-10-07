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

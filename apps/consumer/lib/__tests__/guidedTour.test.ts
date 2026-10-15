/**
 * Guided tour rules + the next-step link that depends on them.
 * Run: npm test  (node --import tsx --test)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTourRequested,
  isTourVisible,
  canDeferTour,
  canCloseTour,
  FALLBACK_TOUR_STATE,
  type TourState,
} from "../guidedTour";
import { TOUR_HREF, arcStageForNextStep } from "@crucible/core/src/journeyStages";

const fresh: TourState = { tourComplete: false, tourDeferrals: 0, coachName: "Guide" };
const done: TourState = { tourComplete: true, tourDeferrals: 0, coachName: "Coach" };
const base = { tier: "client", onHome: true, closed: false, state: fresh, requested: false };

test("the next-step tour link is recognized as a tour request", () => {
  const url = new URL(TOUR_HREF, "https://example.test");
  assert.equal(url.pathname, "/dashboard");
  assert.equal(isTourRequested(url.searchParams), true);
});

test("isTourRequested: only tour=1 counts", () => {
  assert.equal(isTourRequested(new URLSearchParams("")), false);
  assert.equal(isTourRequested(new URLSearchParams("tour=0")), false);
  assert.equal(isTourRequested(new URLSearchParams("tour=1")), true);
  assert.equal(isTourRequested(null), false);
});

test("first run: opens on its own until completed", () => {
  assert.equal(isTourVisible(base), true);
  assert.equal(isTourVisible({ ...base, state: done }), false);
});

test("closed or deferred this session stays closed without a request", () => {
  assert.equal(isTourVisible({ ...base, closed: true }), false);
});

test("a request reopens the tour after it was closed or deferred (the dead button)", () => {
  assert.equal(isTourVisible({ ...base, closed: false, requested: true }), true);
});

test("a request replays a tour that was already completed", () => {
  assert.equal(isTourVisible({ ...base, state: done, requested: true }), true);
});

test("never shows off the dashboard home, for non-clients, or before state loads", () => {
  assert.equal(isTourVisible({ ...base, onHome: false, requested: true }), false);
  assert.equal(isTourVisible({ ...base, tier: "partner", requested: true }), false);
  assert.equal(isTourVisible({ ...base, state: null, requested: true }), false);
});

test("a request still opens when the tour state could not be read", () => {
  assert.equal(isTourVisible({ ...base, state: FALLBACK_TOUR_STATE, requested: true }), true);
});

test("defer is offered only on a first run with deferrals left; replay gets a close", () => {
  assert.equal(canDeferTour(fresh), true);
  assert.equal(canDeferTour({ ...fresh, tourDeferrals: 2 }), false);
  assert.equal(canDeferTour(done), false);
  assert.equal(canDeferTour(null), false);
  assert.equal(canCloseTour(done), true);
  assert.equal(canCloseTour(fresh), false);
});

test("progress arc: Foundation is not current once the Forge is done", () => {
  // Forge done, tour not taken -> arc points at Target (stage 2).
  assert.equal(arcStageForNextStep({ stage: 0, reason: "onboarding_pending" }), 2);
  // Mandatory orientation: the ladder does not know the Forge state.
  assert.equal(arcStageForNextStep({ stage: 0, reason: "onboarding_required" }), 1);
  assert.equal(arcStageForNextStep({ stage: 1 }), 1);
  assert.equal(arcStageForNextStep({ stage: 3 }), 3);
  assert.equal(arcStageForNextStep({ stage: 9 }), 7);
});

/**
 * GATE_STATE_RANK -- THE one gate-state ordering (Phase 4.1).
 *
 * Before this, the same rank map was copy-pasted into OnboardingGate,
 * RefineryShell, and the dashboard tool grid, which could silently drift apart.
 * All three now import this single constant.
 *
 * PURE DATA -- no imports at runtime (the GateState import is type-only, so it
 * is erased). Client components deep-import "@crucible/core/src/gateRank" to
 * avoid pulling the core barrel (db/pg) into the client bundle, exactly like
 * journeyStages.ts.
 *
 * Higher number = further from full_access. A feature is LOCKED when the user's
 * rank is GREATER than the feature's required rank.
 */

import type { GateState } from "./journey";

export const GATE_STATE_RANK: Record<GateState, number> = {
  full_access: 0,
  needs_resume: 1,
  needs_profile: 2,
  loading: 3,
};

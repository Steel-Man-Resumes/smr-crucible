/**
 * Every tour the store knows (TOOL-REVISIONS T1). The saved place lives in
 * consumer_profile.preferences.tours.<id>, one slot per tour, each with its
 * own version, stop, runId, sequence, startedAt and completedAt. A second tour
 * can never overwrite the entrance tour's place or fail its version check.
 *
 * Migration on read: before this map, the entrance tour had the single slot
 * preferences.guidedTour. Reads for 'entrance' fall back to it while
 * tours.entrance does not exist; the first write puts the place in
 * tours.entrance (guidedTour is left as it was, so a rollback still finds it).
 */
import { TOUR_STOP_COUNT, TOUR_VERSION } from '../guidedTour';
import { TOUR_MIN_WATCH_MS, TOUR_REWARD_KEY, TOUR_REWARD_LABEL } from './reward';
import { SETTINGS_STOP_COUNT } from './settings-beats';

export const TOUR_IDS = ['entrance', 'settings'] as const;
export type TourId = (typeof TOUR_IDS)[number];

export interface TourDef {
  id: TourId;
  version: number;
  /** Saved stops are 0 .. stopCount - 1. */
  stopCount: number;
  /** progression_grant.grant_key for this tour's one-time bonus. Each tour has its own; the entrance key is the one production rows carry. */
  rewardKey: string;
  /** progression_grant.label written with the grant. */
  rewardLabel: string;
  /** False while the bonus is reserved but not granted. */
  grants: boolean;
  /** Most calls one grant may add: LEAST(rewardCalls, policy bonus_calls). Absent = the policy amount (the entrance tour). */
  rewardCalls?: number;
  minWatchMs: number;
  /** Completing it marks users.onboarding_tour_complete (the entrance tour only). */
  completesOnboarding: boolean;
}

export const TOURS: Record<TourId, TourDef> = {
  entrance: { id: 'entrance', version: TOUR_VERSION, stopCount: TOUR_STOP_COUNT, rewardKey: TOUR_REWARD_KEY, rewardLabel: TOUR_REWARD_LABEL, grants: true, minWatchMs: TOUR_MIN_WATCH_MS, completesOnboarding: true },
  // SETTINGS-TOUR.md: stops are absolute indexes into SETTINGS_BEATS (14 beats
  // across all paths) plus the ending card. The reward is 1 call at most, once
  // per account, after at least 45 s by the database clock (the shortest path is 101.5 s).
  settings: { id: 'settings', version: 1, stopCount: SETTINGS_STOP_COUNT, rewardKey: 'tour:settings', rewardLabel: 'Settings tour finished: extra AI action', grants: true, rewardCalls: 1, minWatchMs: 45_000, completesOnboarding: false },
};

export function isTourId(value: unknown): value is TourId {
  return typeof value === 'string' && (TOUR_IDS as readonly string[]).includes(value);
}

export interface TourSlot {
  version?: number; stop?: number; inProgress?: boolean; runId?: string; sequence?: number;
  startedAt?: string; completedAt?: string | null;
}

const slotOf = (v: unknown): TourSlot | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as TourSlot) : null);

/** The saved place for one tour, reading the old single slot for the entrance tour. */
export function readTourSlot(prefs: { tours?: unknown; guidedTour?: unknown } | null | undefined, id: TourId): TourSlot | null {
  const map = slotOf(prefs?.tours) as Record<string, unknown> | null;
  const own = slotOf(map?.[id]);
  if (own) return own;
  return id === 'entrance' ? slotOf(prefs?.guidedTour) : null;
}

/**
 * The same read in SQL, for the store's compare-and-set. $n is the tour id
 * parameter; table names the row (consumer_profile in ON CONFLICT updates).
 */
export function slotSql(param: string, table = ''): string {
  const p = `${table ? table + '.' : ''}preferences`;
  return `COALESCE(${p}->'tours'->${param}::text, CASE WHEN ${param}::text = 'entrance' THEN ${p}->'guidedTour' END)`;
}

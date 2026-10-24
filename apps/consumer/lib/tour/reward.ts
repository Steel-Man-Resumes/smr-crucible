/**
 * The tour's one-time reward, pure part. The database part is
 * grantTourReward in lib/progression-server.ts, which runs the lock, the read
 * of any earlier grant and the conditional insert in one transaction, then
 * hands both results here.
 */
import { TOUR_REWARD_COPY } from './beats';

export const TOUR_REWARD_KEY = 'tour:complete';

/** early: the run finished less than TOUR_MIN_WATCH_MS after it started, so nothing was granted. */
export type TourRewardStatus = 'granted' | 'already' | 'capped' | 'early' | 'unavailable';
/** The bonus is for watching the tour: a run must be at least this old, by the server clock, when it completes. */
export const TOUR_MIN_WATCH_MS = 60_000;
export interface TourReward { status: TourRewardStatus; calls: number; grantedAt?: string; expiresAt?: string | null }
export interface TourRewardRow { calls: number; created_at: string | Date; expires_at: string | Date | null; request_key?: string | null }

const iso = (v: string | Date | null | undefined) => v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/**
 * prior: the grant that existed before this request (read under the lock).
 * inserted: the row this request created, if any.
 * runId: this tour run. A retry of the same run (a lost response) is the same
 * grant, not a second one, so it reads as granted again with the same amount.
 */
export function tourRewardOutcome(input: { prior: TourRewardRow | null; inserted: TourRewardRow | null; runId: string }): TourReward {
  const { prior, inserted, runId } = input;
  if (prior) {
    if (prior.request_key && prior.request_key === runId) return { status: 'granted', calls: prior.calls, grantedAt: iso(prior.created_at)!, expiresAt: iso(prior.expires_at) };
    return { status: 'already', calls: 0, grantedAt: iso(prior.created_at)! };
  }
  if (inserted) return { status: 'granted', calls: inserted.calls, grantedAt: iso(inserted.created_at)!, expiresAt: iso(inserted.expires_at) };
  // Nothing existed and nothing was inserted: the daily or monthly bonus cap held it back.
  return { status: 'capped', calls: 0 };
}

/** Client side: accept only a well-formed server reward. Anything else is "unavailable". */
export function readTourReward(raw: unknown): TourReward {
  const r = raw as TourReward | null;
  if (!r || typeof r !== 'object' || !['granted', 'already', 'capped', 'early', 'unavailable'].includes(r.status)) return { status: 'unavailable', calls: 0 };
  const calls = Number.isInteger(r.calls) && r.calls >= 0 && r.calls <= 10 ? r.calls : 0;
  if (r.status === 'granted' && calls < 1) return { status: 'unavailable', calls: 0 };
  return { status: r.status, calls, grantedAt: typeof r.grantedAt === 'string' ? r.grantedAt : undefined, expiresAt: typeof r.expiresAt === 'string' ? r.expiresAt : null };
}

/** Only a confirmed new grant earns the confetti. */
export function rewardCelebrates(r: TourReward): boolean {
  return r.status === 'granted' && r.calls > 0;
}

function formatDay(iso?: string) {
  if (!iso) return 'an earlier day';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'an earlier day' : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Title and words for a confirmed reward, every status. */
export function rewardMessage(reward: TourReward): [string, string] {
  switch (reward.status) {
    case 'granted': return [TOUR_REWARD_COPY.grantedTitle, TOUR_REWARD_COPY.granted(reward.calls)];
    case 'already': return [TOUR_REWARD_COPY.alreadyTitle, TOUR_REWARD_COPY.already(formatDay(reward.grantedAt))];
    case 'capped': return [TOUR_REWARD_COPY.cappedTitle, TOUR_REWARD_COPY.capped];
    case 'early': return [TOUR_REWARD_COPY.earlyTitle, TOUR_REWARD_COPY.early];
    default: return [TOUR_REWARD_COPY.unavailableTitle, TOUR_REWARD_COPY.unavailable];
  }
}

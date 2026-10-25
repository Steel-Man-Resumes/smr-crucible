/**
 * The tour's SQL, with the database calls injected so the real statements run
 * in production (queryAsUser / runAsUser from @crucible/core, RLS as the user)
 * and in a pglite test against the real migrations. No @crucible/core import here.
 */
import { TOUR_REWARD_KEY, tourRewardOutcome, type TourReward, type TourRewardRow } from './reward';
import type { TourWriteStore } from './tour-write';
import { TOURS, slotSql } from './registry';

type Tag = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
export interface TourDb {
  /** One statement as the user (queryAsUser). */
  asUser<T = Record<string, unknown>>(userId: string, text: string, params: unknown[]): Promise<T[]>;
  /** Several statements in one transaction as the user (runAsUser); results per statement. */
  batchAsUser(userId: string, build: (sql: Tag) => unknown[]): Promise<unknown[][]>;
  invalidate(userId: string): Promise<void>;
}

/**
 * One-time tour bonus (grant key 'tour:complete'), under the same advisory lock
 * and daily and monthly caps as every other bonus, with the amount from
 * progression_policy. The earlier grant is read under the lock before the
 * conditional insert, so a second run grants nothing and is told so; a retry
 * of the same run reads as the same grant. The tour grant lasts 24 hours from
 * now (other bonuses end at the next UTC midnight).
 */
export async function grantTourRewardWith(db: Pick<TourDb, 'batchAsUser'>, userId: string, runId: string): Promise<TourReward> {
  const rows = await db.batchAsUser(userId, sql => [
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 874))`,
    sql`SELECT calls,created_at,expires_at,request_key FROM progression_grant WHERE user_id=${userId}::uuid AND grant_key=${TOUR_REWARD_KEY}`,
    sql`INSERT INTO progression_grant(user_id,grant_key,request_key,kind,step_id,calls,label,expires_at)
     SELECT ${userId}::uuid,${TOUR_REWARD_KEY},${runId},'bonus','foundation',p.bonus_calls,'Tour finished: extra AI actions',now()+interval '24 hours'
     FROM progression_policy p WHERE p.id=true
      AND NOT EXISTS(SELECT 1 FROM progression_grant WHERE user_id=${userId}::uuid AND grant_key=${TOUR_REWARD_KEY})
      AND COALESCE((SELECT sum(calls) FROM progression_grant WHERE user_id=${userId}::uuid AND kind='bonus' AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)+p.bonus_calls<=p.bonus_daily_cap
      AND COALESCE((SELECT sum(calls) FROM progression_grant WHERE user_id=${userId}::uuid AND kind='bonus' AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)+p.bonus_calls<=p.bonus_monthly_cap
     ON CONFLICT DO NOTHING RETURNING calls,created_at,expires_at,request_key`,
  ]);
  return tourRewardOutcome({ prior: (rows[1]?.[0] as TourRewardRow | undefined) ?? null, inserted: (rows[2]?.[0] as TourRewardRow | undefined) ?? null, runId });
}

/**
 * The saved place, one slot per tour: consumer_profile.preferences.tours.<id>
 * (lib/tour/registry.ts). Reads for the entrance tour fall back to the old
 * single slot preferences.guidedTour; every write lands in tours.<id>, so the
 * compare-and-set below reads the old slot once and the new one after.
 */
export function createTourStore(db: TourDb): TourWriteStore {
  return {
    async start(userId, runId, previousRunId, stop, tourId = 'entrance') {
      const def = TOURS[tourId];
      const slot = slotSql('$6', 'consumer_profile');
      // startedAt comes from the database clock, never from the browser.
      const started = await db.asUser<{ user_id: string }>(userId, `INSERT INTO consumer_profile (user_id, preferences)
        VALUES ($1, jsonb_build_object('tours', jsonb_build_object($6::text, $2::jsonb || jsonb_build_object('startedAt', now()))))
        ON CONFLICT (user_id) DO UPDATE SET preferences = jsonb_set(COALESCE(consumer_profile.preferences, '{}'::jsonb),
        '{tours}', COALESCE(consumer_profile.preferences->'tours', '{}'::jsonb) || jsonb_build_object($6::text, $2::jsonb || jsonb_build_object('startedAt', now()))), updated_at = now()
        WHERE ${slot}->>'runId' IS NOT DISTINCT FROM $4::text
          AND ${slot}->>'runId' IS DISTINCT FROM $3::text
          AND COALESCE((${slot}->>'version')::int, 0) <= $5::int
        RETURNING user_id`,
        [userId, JSON.stringify({ version: def.version, runId, sequence: 0, stop, inProgress: true }), runId, previousRunId, def.version, tourId]);
      if (started.length) return 'started';
      const [same] = await db.asUser<{ run_id: string }>(userId, `SELECT ${slotSql('$3')}->>'runId' AS run_id FROM consumer_profile WHERE user_id=$1 AND ${slotSql('$3')}->>'version'=$2::text`, [userId, String(def.version), tourId]);
      return same?.run_id === runId ? 'same' : 'conflict';
    },
    async advance(userId, runId, sequence, stop, complete, tourId = 'entrance') {
      const def = TOURS[tourId];
      const slot = slotSql('$7');
      // A replay owns a new run. Old tabs and delayed saves cannot overwrite it
      // or reopen a completed run. The completion flag and stop commit together.
      // startedAt rides along; completedAt is stamped once, by the database, on the
      // write that completes the run, so a later re-POST cannot move it.
      // Only the entrance tour marks onboarding complete ($8).
      const rows = await db.asUser<{ user_id: string }>(userId, `WITH saved AS (
        UPDATE consumer_profile SET preferences = jsonb_set(preferences, '{tours}', COALESCE(preferences->'tours', '{}'::jsonb) || jsonb_build_object($7::text,
          jsonb_build_object('version', $2::int, 'runId', $3::text, 'sequence', $4::int, 'stop', $5::int, 'inProgress', $6::boolean,
            'startedAt', ${slot}->'startedAt',
            'completedAt', CASE WHEN $6::boolean THEN NULL ELSE to_jsonb(now()) END))),
          updated_at = now()
        WHERE user_id = $1 AND ${slot}->>'runId' = $3
          AND ${slot}->>'version' = $2::int::text
          AND ${slot}->>'inProgress' = 'true'
          AND COALESCE((${slot}->>'sequence')::int, 0) < $4 RETURNING user_id
      ), completed AS (
        UPDATE users SET onboarding_tour_complete = true
        WHERE id IN (SELECT user_id FROM saved) AND $6::boolean = false AND $8::boolean RETURNING id
      ) SELECT user_id FROM saved`,
        [userId, def.version, runId, sequence, stop, !complete, tourId, def.completesOnboarding]);
      if (rows.length) return 'saved';
      const [done] = await db.asUser<{ done: boolean }>(userId,
        `SELECT true AS done FROM consumer_profile WHERE user_id=$1
         AND ${slotSql('$4')}->>'runId'=$2 AND ${slotSql('$4')}->>'inProgress'='false'
         AND ${slotSql('$4')}->>'version'=$3::text`, [userId, runId, String(def.version), tourId]);
      return done?.done ? 'already-complete' : 'conflict';
    },
    async watchedMs(userId, runId, tourId = 'entrance') {
      // From start to the write that completed the run (or to now, if still open).
      const [row] = await db.asUser<{ ms: number | null }>(userId,
        `SELECT (EXTRACT(EPOCH FROM (COALESCE((g->>'completedAt')::timestamptz, now()) - (g->>'startedAt')::timestamptz)) * 1000)::float8 AS ms
         FROM (SELECT ${slotSql('$3')} AS g FROM consumer_profile WHERE user_id=$1) x WHERE g->>'runId'=$2`, [userId, runId, tourId]);
      return row?.ms == null ? null : Number(row.ms);
    },
    grant: (userId, runId) => grantTourRewardWith(db, userId, runId),
    invalidate: userId => db.invalidate(userId),
  };
}

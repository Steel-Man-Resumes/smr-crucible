/**
 * The tour's SQL, with the database calls injected so the real statements run
 * in production (queryAsUser / runAsUser from @crucible/core, RLS as the user)
 * and in a pglite test against the real migrations. No @crucible/core import here.
 */
import { TOUR_VERSION } from '../guidedTour';
import { TOUR_REWARD_KEY, tourRewardOutcome, type TourReward, type TourRewardRow } from './reward';
import type { TourWriteStore } from './tour-write';

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

/** The saved place in consumer_profile.preferences.guidedTour. */
export function createTourStore(db: TourDb): TourWriteStore {
  return {
    async start(userId, runId, previousRunId, stop) {
      // startedAt comes from the database clock, never from the browser.
      const started = await db.asUser<{ user_id: string }>(userId, `INSERT INTO consumer_profile (user_id, preferences)
        VALUES ($1, jsonb_build_object('guidedTour', $2::jsonb || jsonb_build_object('startedAt', now())))
        ON CONFLICT (user_id) DO UPDATE SET preferences = jsonb_set(COALESCE(consumer_profile.preferences, '{}'::jsonb),
        '{guidedTour}', $2::jsonb || jsonb_build_object('startedAt', now())), updated_at = now()
        WHERE consumer_profile.preferences->'guidedTour'->>'runId' IS NOT DISTINCT FROM $4::text
          AND consumer_profile.preferences->'guidedTour'->>'runId' IS DISTINCT FROM $3::text
          AND COALESCE((consumer_profile.preferences->'guidedTour'->>'version')::int, 0) <= $5::int
        RETURNING user_id`,
        [userId, JSON.stringify({ version: TOUR_VERSION, runId, sequence: 0, stop, inProgress: true }), runId, previousRunId, TOUR_VERSION]);
      if (started.length) return 'started';
      const [same] = await db.asUser<{ run_id: string }>(userId, `SELECT preferences->'guidedTour'->>'runId' AS run_id FROM consumer_profile WHERE user_id=$1 AND preferences->'guidedTour'->>'version'=$2::text`, [userId, String(TOUR_VERSION)]);
      return same?.run_id === runId ? 'same' : 'conflict';
    },
    async advance(userId, runId, sequence, stop, complete) {
      // A replay owns a new run. Old tabs and delayed saves cannot overwrite it
      // or reopen a completed run. The completion flag and stop commit together.
      // startedAt rides along; completedAt is stamped once, by the database, on the
      // write that completes the run, so a later re-POST cannot move it.
      const rows = await db.asUser<{ user_id: string }>(userId, `WITH saved AS (
        UPDATE consumer_profile SET preferences = jsonb_set(preferences, '{guidedTour}',
          jsonb_build_object('version', $2::int, 'runId', $3::text, 'sequence', $4::int, 'stop', $5::int, 'inProgress', $6::boolean,
            'startedAt', preferences->'guidedTour'->'startedAt',
            'completedAt', CASE WHEN $6::boolean THEN NULL ELSE to_jsonb(now()) END)),
          updated_at = now()
        WHERE user_id = $1 AND preferences->'guidedTour'->>'runId' = $3
          AND preferences->'guidedTour'->>'version' = $2::int::text
          AND preferences->'guidedTour'->>'inProgress' = 'true'
          AND COALESCE((preferences->'guidedTour'->>'sequence')::int, 0) < $4 RETURNING user_id
      ), completed AS (
        UPDATE users SET onboarding_tour_complete = true
        WHERE id IN (SELECT user_id FROM saved) AND $6::boolean = false RETURNING id
      ) SELECT user_id FROM saved`,
        [userId, TOUR_VERSION, runId, sequence, stop, !complete]);
      if (rows.length) return 'saved';
      const [done] = await db.asUser<{ done: boolean }>(userId,
        `SELECT true AS done FROM consumer_profile WHERE user_id=$1
         AND preferences->'guidedTour'->>'runId'=$2 AND preferences->'guidedTour'->>'inProgress'='false'
         AND preferences->'guidedTour'->>'version'=$3::text`, [userId, runId, String(TOUR_VERSION)]);
      return done?.done ? 'already-complete' : 'conflict';
    },
    async watchedMs(userId, runId) {
      // From start to the write that completed the run (or to now, if still open).
      const [row] = await db.asUser<{ ms: number | null }>(userId,
        `SELECT (EXTRACT(EPOCH FROM (COALESCE((g->>'completedAt')::timestamptz, now()) - (g->>'startedAt')::timestamptz)) * 1000)::float8 AS ms
         FROM (SELECT preferences->'guidedTour' AS g FROM consumer_profile WHERE user_id=$1 AND preferences->'guidedTour'->>'runId'=$2) x`, [userId, runId]);
      return row?.ms == null ? null : Number(row.ms);
    },
    grant: (userId, runId) => grantTourRewardWith(db, userId, runId),
    invalidate: userId => db.invalidate(userId),
  };
}

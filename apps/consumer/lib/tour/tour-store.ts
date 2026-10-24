/** The tour's saved place in consumer_profile.preferences.guidedTour, read and written as the user (RLS). */
import { getOneAsUser, queryAsUser, invalidateNextStep } from '@crucible/core';
import { TOUR_VERSION } from '../guidedTour';
import { grantTourReward } from '../progression-server';
import type { TourWriteStore } from './tour-write';

export const tourStore: TourWriteStore = {
  async start(userId, runId, previousRunId, stop) {
    // startedAt comes from the database clock, never from the browser.
    const started = await queryAsUser<{ user_id: string }>(userId, `INSERT INTO consumer_profile (user_id, preferences)
      VALUES ($1, jsonb_build_object('guidedTour', $2::jsonb || jsonb_build_object('startedAt', now())))
      ON CONFLICT (user_id) DO UPDATE SET preferences = jsonb_set(COALESCE(consumer_profile.preferences, '{}'::jsonb),
      '{guidedTour}', $2::jsonb || jsonb_build_object('startedAt', now())), updated_at = now()
      WHERE consumer_profile.preferences->'guidedTour'->>'runId' IS NOT DISTINCT FROM $4::text
        AND consumer_profile.preferences->'guidedTour'->>'runId' IS DISTINCT FROM $3::text
        AND COALESCE((consumer_profile.preferences->'guidedTour'->>'version')::int, 0) <= $5::int
      RETURNING user_id`,
      [userId, JSON.stringify({ version: TOUR_VERSION, runId, sequence: 0, stop, inProgress: true }), runId, previousRunId, TOUR_VERSION]);
    if (started.length) return 'started';
    const sameRun = await getOneAsUser<{ run_id: string }>(userId, `SELECT preferences->'guidedTour'->>'runId' AS run_id FROM consumer_profile WHERE user_id=$1 AND preferences->'guidedTour'->>'version'=$2::text`, [userId, String(TOUR_VERSION)]);
    return sameRun?.run_id === runId ? 'same' : 'conflict';
  },
  async advance(userId, runId, sequence, stop, complete) {
    // A replay owns a new run. Old tabs and delayed saves cannot overwrite it
    // or reopen a completed run. The completion flag and stop commit together,
    // and startedAt rides along unchanged.
    const rows = await queryAsUser<{ user_id: string }>(userId, `WITH saved AS (
      UPDATE consumer_profile SET preferences = jsonb_set(preferences, '{guidedTour}',
        jsonb_build_object('version', $2::int, 'runId', $3::text, 'sequence', $4::int, 'stop', $5::int, 'inProgress', $6::boolean,
          'startedAt', preferences->'guidedTour'->'startedAt')),
        updated_at = now()
      WHERE user_id = $1 AND preferences->'guidedTour'->>'runId' = $3
        AND preferences->'guidedTour'->>'version' = $2::int::text
        AND preferences->'guidedTour'->>'inProgress' = 'true'
        AND COALESCE((preferences->'guidedTour'->>'sequence')::int, 0) < $4 RETURNING user_id
    ), completed AS (
      UPDATE users SET onboarding_tour_complete = true
      WHERE id IN (SELECT user_id FROM saved) AND $6 = false RETURNING id
    ) SELECT user_id FROM saved`,
      [userId, TOUR_VERSION, runId, sequence, stop, !complete]);
    if (rows.length) return 'saved';
    const done = await getOneAsUser<{ done: boolean }>(userId,
      `SELECT true AS done FROM consumer_profile WHERE user_id=$1
       AND preferences->'guidedTour'->>'runId'=$2 AND preferences->'guidedTour'->>'inProgress'='false'
       AND preferences->'guidedTour'->>'version'=$3::text`, [userId, runId, String(TOUR_VERSION)]);
    return done?.done ? 'already-complete' : 'conflict';
  },
  async watchedMs(userId, runId) {
    const row = await getOneAsUser<{ ms: number | null }>(userId,
      `SELECT (EXTRACT(EPOCH FROM (now() - (preferences->'guidedTour'->>'startedAt')::timestamptz)) * 1000)::float8 AS ms
       FROM consumer_profile WHERE user_id=$1 AND preferences->'guidedTour'->>'runId'=$2`, [userId, runId]);
    return row?.ms == null ? null : Number(row.ms);
  },
  grant: grantTourReward,
  invalidate: (userId) => invalidateNextStep(userId),
};

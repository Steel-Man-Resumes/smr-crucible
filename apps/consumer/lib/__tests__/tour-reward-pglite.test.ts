/**
 * Real SQL: the tour store and grantTourReward (lib/tour/tour-sql.ts) against
 * the repo's migrations in pglite, as a non-superuser role with app.user_id set
 * (RLS on). Skipped unless SMR_PGLITE_DIR points at a node_modules folder that
 * holds @electric-sql/pglite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createTourStore, type TourDb } from '../tour/tour-sql';
import { handleTourWrite } from '../tour/tour-write';
import type { TourReward } from '../tour/reward';
import { TOUR_STOP_COUNT, TOUR_VERSION } from '../guidedTour';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite tour test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

test('tour completion and bonus on the real schema: 59 s early, 60 s granted for 24 h, a second run already, re-POST stays early', { skip }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const pg = new PGlite({ extensions: { pgcrypto } });
  await pg.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  for (const f of readdirSync(MIG).filter(x => /^\d{3}_.*\.sql$/.test(x)).sort()) {
    try { await pg.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); }
    catch { await pg.exec('ROLLBACK').catch(() => {}); } // 088-091 resource chain refuses on its own guards; unrelated tables
  }
  const applied = (await pg.query(`SELECT count(*)::int AS n FROM _migrations WHERE filename LIKE '092_%'`)).rows[0] as { n: number };
  assert.equal(applied.n, 1, 'migration 092 (progression) applied');
  await pg.exec(`CREATE ROLE tester NOSUPERUSER; GRANT USAGE ON SCHEMA public TO tester; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO tester;`);

  const asTester = async (userId: string, statements: { text: string; params: unknown[] }[]) => {
    await pg.exec('BEGIN; SET LOCAL ROLE tester;');
    const out: unknown[][] = [];
    try {
      await pg.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      for (const s of statements) out.push((await pg.query(s.text, s.params)).rows as unknown[]);
      await pg.exec('COMMIT');
    } catch (e) { await pg.exec('ROLLBACK'); throw e; }
    return out;
  };
  const tag = (s: TemplateStringsArray, ...v: unknown[]) => ({ text: s.reduce((a, x, i) => a + '$' + i + x), params: v });
  const db: TourDb = {
    asUser: async (userId, text, params) => (await asTester(userId, [{ text, params }]))[0] as never,
    batchAsUser: (userId, build) => asTester(userId, build(tag as never) as { text: string; params: unknown[] }[]),
    invalidate: async () => {},
  };
  const store = createTourStore(db);
  const u = '00000000-0000-0000-0000-0000000000c1', other = '00000000-0000-0000-0000-0000000000c2';
  for (const id of [u, other]) await pg.query('INSERT INTO users(id,email) VALUES ($1,$2)', [id, id + '@x.test']);
  const RUN1 = '11111111-1111-4111-8111-111111111111', RUN2 = '22222222-2222-4222-8222-222222222222', RUN3 = '33333333-3333-4333-8333-333333333333';
  const write = (body: Record<string, unknown>) => handleTourWrite(store, u, { version: TOUR_VERSION, stop: 0, ...body });
  const backdate = (seconds: number) => pg.query(`UPDATE consumer_profile SET preferences = jsonb_set(preferences, '{guidedTour,startedAt}', to_jsonb(now() - make_interval(secs => $2))) WHERE user_id=$1`, [u, seconds]);
  const last = TOUR_STOP_COUNT - 1;

  // Run 1: completed 59 s after it started. Early, nothing granted.
  assert.equal((await write({ action: 'start', runId: RUN1, sequence: 0, previousRunId: null })).status, 200);
  const saved = (await pg.query(`SELECT preferences->'guidedTour' AS g FROM consumer_profile WHERE user_id=$1`, [u])).rows[0] as { g: { startedAt?: string } };
  assert.ok(saved.g.startedAt, 'startedAt recorded by the database at start');
  await write({ action: 'progress', runId: RUN1, sequence: 1, stop: 5 });
  const kept = (await pg.query(`SELECT preferences->'guidedTour'->>'startedAt' AS s FROM consumer_profile WHERE user_id=$1`, [u])).rows[0] as { s: string };
  assert.equal(kept.s, saved.g.startedAt, 'progress keeps startedAt');
  await backdate(59);
  const early = await write({ action: 'complete', runId: RUN1, sequence: 2, stop: last });
  assert.equal(early.status, 200);
  assert.equal((early.json.reward as TourReward).status, 'early');
  // Posting complete again later still reads the stamped completion time: early.
  const stamped = (await pg.query(`SELECT preferences->'guidedTour'->>'completedAt' AS c FROM consumer_profile WHERE user_id=$1`, [u])).rows[0] as { c: string };
  assert.ok(stamped.c, 'completedAt stamped on the completing write');
  assert.equal(((await write({ action: 'complete', runId: RUN1, sequence: 3, stop: last })).json.reward as TourReward).status, 'early');
  const still = (await pg.query(`SELECT preferences->'guidedTour'->>'completedAt' AS c FROM consumer_profile WHERE user_id=$1`, [u])).rows[0] as { c: string };
  assert.equal(still.c, stamped.c, 'a re-POST does not move completedAt');
  assert.equal(((await pg.query(`SELECT count(*)::int AS n FROM progression_grant WHERE grant_key='tour:complete'`)).rows[0] as { n: number }).n, 0);

  // Run 2: completed 60 s after start. Granted, from policy, for 24 hours.
  assert.equal((await write({ action: 'start', runId: RUN2, sequence: 0, previousRunId: RUN1 })).status, 200);
  await backdate(60);
  const granted = await write({ action: 'complete', runId: RUN2, sequence: 1, stop: last });
  const g = granted.json.reward as TourReward;
  assert.equal(g.status, 'granted');
  const policy = (await pg.query('SELECT bonus_calls FROM progression_policy WHERE id=true')).rows[0] as { bonus_calls: number };
  assert.equal(g.calls, policy.bonus_calls);
  const row = (await pg.query(`SELECT user_id, request_key, kind, extract(epoch from expires_at - created_at)::int AS life FROM progression_grant WHERE grant_key='tour:complete'`)).rows as { user_id: string; request_key: string; kind: string; life: number }[];
  assert.equal(row.length, 1);
  assert.deepEqual([row[0].user_id, row[0].request_key, row[0].kind], [u, RUN2, 'bonus']);
  assert.ok(Math.abs(row[0].life - 86_400) <= 2, `lasts ${row[0].life} s`);
  assert.equal(((await write({ action: 'complete', runId: RUN2, sequence: 2, stop: last })).json.reward as TourReward).status, 'granted', 'a retry of the same run is the same grant');

  // Run 3: a replay watched in full. Already granted; nothing new.
  await write({ action: 'start', runId: RUN3, sequence: 0, previousRunId: RUN2 });
  await backdate(120);
  const again = (await write({ action: 'complete', runId: RUN3, sequence: 1, stop: last })).json.reward as TourReward;
  assert.equal(again.status, 'already');
  assert.equal(again.calls, 0);
  assert.equal(((await pg.query(`SELECT count(*)::int AS n FROM progression_grant WHERE grant_key='tour:complete'`)).rows[0] as { n: number }).n, 1);

  // RLS: another account cannot see the grant.
  const seen = await db.asUser(other, `SELECT id FROM progression_grant WHERE grant_key='tour:complete'`, []);
  assert.equal(seen.length, 0);
});

/**
 * The tour store keyed by tour id (TOOL-REVISIONS T1), real SQL in pglite as a
 * non-superuser with app.user_id set (RLS on). Skipped unless SMR_PGLITE_DIR
 * points at a node_modules folder holding @electric-sql/pglite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createTourStore, type TourDb } from '../tour/tour-sql';
import { handleTourWrite } from '../tour/tour-write';
import { TOURS } from '../tour/registry';
import type { TourReward } from '../tour/reward';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite tour-store test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

test('tour store map: old slot migrates to entrance on read, settings has its own place, run, CAS and no grant', { skip }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const pg = new PGlite({ extensions: { pgcrypto } });
  await pg.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  for (const f of readdirSync(MIG).filter(x => /^\d{3}_.*\.sql$/.test(x)).sort()) {
    try { await pg.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); }
    catch { await pg.exec('ROLLBACK').catch(() => {}); }
  }
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
  const u = '00000000-0000-0000-0000-0000000000d1', other = '00000000-0000-0000-0000-0000000000d2';
  for (const id of [u, other]) await pg.query('INSERT INTO users(id,email) VALUES ($1,$2)', [id, id + '@x.test']);
  const OLD = '44444444-4444-4444-8444-444444444444', S1 = '55555555-5555-4555-8555-555555555555', S2 = '66666666-6666-4666-8666-666666666666';
  const E = TOURS.entrance, S = TOURS.settings;
  const prefs = async (who = u) => ((await pg.query(`SELECT preferences AS p FROM consumer_profile WHERE user_id=$1`, [who])).rows[0] as { p: Record<string, any> } | undefined)?.p;

  // A person mid-tour on the old single slot, from before the map.
  await pg.query(`INSERT INTO consumer_profile(user_id, preferences) VALUES ($1, jsonb_build_object('guidedTour', jsonb_build_object('version', $2::int, 'runId', $3::text, 'sequence', 4, 'stop', 6, 'inProgress', true, 'startedAt', now() - interval '90 seconds')))`, [u, E.version, OLD]);

  // The old run keeps going: a stale sequence is refused, a newer one saves into tours.entrance.
  assert.equal((await handleTourWrite(store, u, { version: E.version, runId: OLD, sequence: 4, stop: 7, action: 'progress' })).status, 409, 'CAS reads the old slot');
  assert.equal((await handleTourWrite(store, u, { version: E.version, runId: OLD, sequence: 5, stop: 7, action: 'progress' })).status, 200);
  let p = await prefs();
  assert.equal(p!.tours.entrance.runId, OLD);
  assert.equal(p!.tours.entrance.stop, 7);
  assert.equal(p!.tours.entrance.startedAt, p!.guidedTour.startedAt, 'startedAt carried over from the old slot');
  assert.equal(p!.guidedTour.stop, 6, 'the old slot is left as it was');

  // The settings tour starts its own run without touching the entrance place.
  const sw = (body: Record<string, unknown>) => handleTourWrite(store, u, { tourId: 'settings', version: S.version, stop: 0, ...body });
  assert.equal((await sw({ action: 'start', runId: S1, sequence: 0, previousRunId: null })).status, 200);
  assert.equal((await sw({ action: 'start', runId: S2, sequence: 0, previousRunId: null })).status, 409, 'a second start needs the current run as previousRunId');
  assert.equal((await sw({ action: 'progress', runId: S1, sequence: 1, stop: 5 })).status, 200);
  assert.equal((await sw({ action: 'progress', runId: S1, sequence: 1, stop: 6 })).status, 409, 'sequence must rise per tour');
  assert.equal((await sw({ action: 'progress', runId: S1, sequence: 2, stop: S.stopCount })).status, 400, 'settings stop range');
  assert.equal((await sw({ action: 'progress', runId: S1, sequence: 2, stop: 1, version: E.version })).status, 400, 'settings version, not the entrance one');
  p = await prefs();
  assert.equal(p!.tours.settings.stop, 5);
  assert.equal(p!.tours.entrance.stop, 7, 'the entrance place is unchanged');
  assert.equal(p!.tours.entrance.inProgress, true);

  // The entrance run's sequence is its own: settings writes did not move it.
  assert.equal((await handleTourWrite(store, u, { version: E.version, runId: OLD, sequence: 6, stop: 8, action: 'progress' })).status, 200);

  // Completing settings: stamped, onboarding untouched, and no grant (tour:settings is reserved).
  await pg.query(`UPDATE consumer_profile SET preferences = jsonb_set(preferences, '{tours,settings,startedAt}', to_jsonb(now() - interval '5 minutes')) WHERE user_id=$1`, [u]);
  const done = await sw({ action: 'complete', runId: S1, sequence: 3, stop: S.stopCount - 1 });
  assert.equal(done.status, 200);
  assert.equal(done.json.reward, null);
  p = await prefs();
  assert.equal(p!.tours.settings.inProgress, false);
  assert.ok(p!.tours.settings.completedAt);
  const flags = (await pg.query(`SELECT onboarding_tour_complete AS c FROM users WHERE id=$1`, [u])).rows[0] as { c: boolean };
  assert.equal(flags.c, false, 'only the entrance tour marks onboarding complete');
  assert.equal(((await pg.query(`SELECT count(*)::int AS n FROM progression_grant WHERE user_id=$1`, [u])).rows[0] as { n: number }).n, 0);
  assert.equal((await sw({ action: 'progress', runId: S1, sequence: 4, stop: 2 })).status, 409, 'a completed run never reopens');

  // The entrance tour still completes and grants from its own slot (90 s+ watched).
  const ent = await handleTourWrite(store, u, { version: E.version, runId: OLD, sequence: 7, stop: E.stopCount - 1, action: 'complete' });
  assert.equal((ent.json.reward as TourReward).status, 'granted');
  assert.equal(((await pg.query(`SELECT onboarding_tour_complete AS c FROM users WHERE id=$1`, [u])).rows[0] as { c: boolean }).c, true);

  // Account bound: another account's writes never reach this row.
  assert.equal((await handleTourWrite(store, other, { tourId: 'settings', version: S.version, runId: S1, sequence: 9, stop: 1, action: 'progress' })).status, 409);
  assert.equal((await prefs())!.tours.settings.sequence, 3);
  assert.equal((await handleTourWrite(store, u, { tourId: 'nope', version: 1, runId: S2, sequence: 0, stop: 0, action: 'start', previousRunId: null })).status, 400);
});

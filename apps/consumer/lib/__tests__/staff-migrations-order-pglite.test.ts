/**
 * Staff pass integration (2026-10-28): every migration, 001 to the newest,
 * applied IN ORDER on one database, the way production will get them. Each
 * lane's own pglite test applies 001-106 and then only its own file; this one
 * proves 108 (S3), 109 (S4) and 110 (S5), and any later file merged after
 * them, coexist: the shared org_activity entity CHECK keeps every lane's
 * values, 103's org_profile guard keeps 109's module key, and a second run of
 * each staff file changes nothing.
 *
 * Needs SMR_PGLITE_DIR (a node_modules folder holding @electric-sql/pglite),
 * like the other pglite tests; skipped without it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the migration order test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

test('migrations 001 to the newest apply in order; the staff files coexist and run twice cleanly', { skip, timeout: 900_000 }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const { pg_trgm } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pg_trgm.js'));
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  await db.exec(`CREATE ROLE smr_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO smr_app;`);
  const files = readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x)).sort();
  const failed: string[] = [];
  const apply = async (f: string) => {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); }
    catch (e) { await db.exec('ROLLBACK').catch(() => {}); failed.push(`${f}: ${(e as Error).message}`); }
  };
  for (const f of files) await apply(f);
  // The organization layer and every staff pass file (099 onward) must apply on the real chain.
  const ours = failed.filter((f) => Number(f.slice(0, 3)) >= 99);
  if (failed.length > ours.length) console.log(`older files pglite cannot run (not this pass's): ${failed.filter((f) => Number(f.slice(0, 3)) < 99).map((f) => f.slice(0, 60)).join(' | ')}`);
  assert.deepEqual(ours, [], `every file from 099 applies in order: ${ours.join(' | ')}`);
  for (const n of ['108_', '109_', '110_']) assert.ok(files.some((f) => f.startsWith(n)), `${n} is on this branch`);

  const entities = async () => {
    const r = await db.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'public.org_activity'::regclass AND conname = 'org_activity_entity_check'`);
    return String((r.rows[0] as { d: string }).d);
  };
  const want = ['note', 'task', 'outcome', 'referral', 'org', 'view', 'comment', 'change_request', 'suggestion', 'handoff'];
  const before = await entities();
  for (const v of want) assert.ok(before.includes(`'${v}'`), `org_activity keeps '${v}' after 108, 109 and 110: ${before}`);
  const checks = await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.org_activity'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ '\\(entity = ANY'`);
  assert.equal((checks.rows[0] as { n: number }).n, 1, 'one entity CHECK, not two');

  const guard = await db.query(`SELECT pg_get_functiondef('public.org_profile_guard()'::regprocedure) AS d`);
  assert.match(String((guard.rows[0] as { d: string }).d), /note_review/, "109's module key survives in 103's org_profile guard");
  assert.match(String((guard.rows[0] as { d: string }).d), /ai_assist/);

  const triggers = await db.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY($1) ORDER BY tgname`,
    [['org_profile_ai_owner_only', 'staff_task_assign_guard', 'case_note_review_lock', 'staff_handoff_close_items', 'staff_handoff_has_items']]);
  assert.deepEqual((triggers.rows as { tgname: string }[]).map((r) => r.tgname).sort(),
    ['case_note_review_lock', 'org_profile_ai_owner_only', 'staff_handoff_close_items', 'staff_handoff_has_items', 'staff_task_assign_guard']);
  const kinds = await db.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'public.staff_suggestion'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ 'next_step'`);
  assert.ok(kinds.rows.length >= 1, "110's new suggestion kinds are in place");

  // Re-running each staff file (a retried release) changes nothing and fails nothing.
  for (const f of files.filter((x) => Number(x.slice(0, 3)) >= 107)) await apply(f);
  const again = failed.filter((f) => Number(f.slice(0, 3)) >= 99);
  assert.deepEqual(again, [], `every staff file runs twice cleanly: ${again.join(' | ')}`);
  assert.equal(await entities(), before, 'a second run leaves the entity CHECK as it was');
});

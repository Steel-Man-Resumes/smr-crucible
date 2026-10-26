/**
 * C4 staff t.ROY: the access-log open a skill writes, in real SQL. The exact
 * statement the app runs (STAFF_ASSISTANT_OPEN_SQL) against migrations
 * 001-098 in pglite, as a non-superuser role with the org scope set (RLS on).
 * Proves: one row per allowed read, the participant's own log query shows it,
 * and a volunteer or another organization writes nothing for someone outside
 * their reach. Skipped unless SMR_PGLITE_DIR points at a node_modules folder
 * holding @electric-sql/pglite (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 * Run alone (three pglite files in one process are flaky, plan item 17).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { STAFF_ASSISTANT_OPEN_SQL, SHARED_OPEN_LOG_SQL, CLIENT_HEADER_WHO_SQL } from '@crucible/core/src/orgClientView';
import { WORK_QUEUE_LOG_SQL } from '@crucible/core/src/orgToday';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite staff t.ROY log test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

test('a t.ROY staff read logs one open the participant can see, and nothing outside reach', { skip }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  const failed: string[] = [];
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 98).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); }
    catch { await db.exec('ROLLBACK').catch(() => {}); failed.push(f); }
  }
  assert.ok(!failed.includes('097_org_seats.sql'), `097 must apply; failed: ${failed.join(', ')}`);
  // The staff reach checks ask the database's rule (smr_staff_reach, 102; units, 103): apply both.
  for (const f of ['102_reach_activity_audit.sql', '103_org_structure.sql']) await db.exec('BEGIN;' + readFileSync(MIG + f, 'utf8') + ';COMMIT;');
  await db.exec(`CREATE ROLE tester NOSUPERUSER; GRANT USAGE ON SCHEMA public TO tester; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO tester; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO tester;
    GRANT EXECUTE ON FUNCTION public.smr_staff_reach(uuid, uuid, uuid), public.smr_staff_sees_all(uuid, uuid), public.smr_staff_unit_reach(uuid, uuid, uuid) TO tester;`);
  const q = (t: string, p: unknown[] = []) => db.query(t, p);
  const scoped = async (orgId: string, actor: string, role: string, text: string, params: unknown[]) => {
    await db.exec('BEGIN; SET LOCAL ROLE tester;');
    try {
      await db.query(`SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.org_role', $3, true)`, [orgId, actor, role]);
      const r = await db.query(text, params);
      await db.exec('COMMIT');
      return r.rows as Record<string, unknown>[];
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  };
  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const [owner, cm, volunteer, otherOwner, otherStaff, dana, sam] = [1, 2, 3, 4, 5, 6, 7].map(id);
  for (const u of [owner, cm, volunteer, otherOwner, otherStaff, dana, sam]) await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `${u}@x.test`, `Person ${u.slice(-2)}`]);
  const org = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2, max_redemptions) VALUES ('PGLOG0001', 'PG org (Demo)', 'client', $1, true, 10) RETURNING id`, [owner])).rows[0] as { id: string }).id;
  const other = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2, max_redemptions) VALUES ('PGLOG0002', 'Other org', 'client', $1, true, 10) RETURNING id`, [otherOwner])).rows[0] as { id: string }).id;
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'staff'), ($1, $3, 'staff'), ($4, $5, 'staff')`, [org, cm, volunteer, other, otherStaff]);
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $3), ($2, $3)`, [dana, sam, org]);
  // Dana is on the case manager's list; Sam is on the volunteer's.
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $3, $5), ($1, $4, $6, $5)`, [org, dana, cm, sam, owner, volunteer]);

  const open = (orgId: string, actor: string, client: string, seesAll: boolean, what = 'assistant:overview') =>
    scoped(orgId, actor, 'staff', STAFF_ASSISTANT_OPEN_SQL, [client, orgId, seesAll, actor, what]);
  const logFor = async (client: string) => (await q(
    // The participant's own "Who has opened what" filter (sharing.ts getMyAccessLog).
    `SELECT accessor_id, resource_type, access_reason, fields_accessed FROM data_access_log
      WHERE target_user_id = $1 AND accessor_type = 'staff' AND access_reason IN ('org_client_view', 'org_work_queue') ORDER BY accessed_at`, [client])).rows as Record<string, unknown>[];

  assert.equal((await open(org, cm, dana, false)).length, 1, 'an allowed read writes one row');
  assert.equal((await open(org, cm, dana, false, 'assistant:changes')).length, 1, 'a second, different read writes its own row');
  const rows = await logFor(dana);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.accessor_id, r.resource_type, r.access_reason]), [[cm, 'assistant:overview', 'org_client_view'], [cm, 'assistant:changes', 'org_client_view']]);
  assert.deepEqual(rows[0].fields_accessed, { orgId: org, via: 't.ROY' });

  // The volunteer reaches Sam only. Reading Dana writes nothing, and the header read finds nothing either.
  assert.equal((await open(org, volunteer, dana, false)).length, 0, 'volunteer outside caseload: no row');
  assert.equal((await scoped(org, volunteer, 'staff', CLIENT_HEADER_WHO_SQL, [dana, org, false, volunteer])).length, 0, 'and no header');
  assert.equal((await open(org, volunteer, sam, false)).length, 1, 'their own person: one row');
  // Another organization's staff, even claiming sees-all, writes nothing about our participant.
  assert.equal((await open(other, otherStaff, dana, true)).length, 0, 'another org: no row');
  // A scope set to our org with an actor from elsewhere and sees-all off finds nothing.
  assert.equal((await open(org, otherStaff, dana, false)).length, 0, 'not our staff, not assigned: no row');
  assert.equal((await logFor(dana)).length, 2, 'refused reads left no trace on Dana');
  assert.equal((await logFor(sam)).length, 1);

  // Fix round 1: the four header and task tools log as assistant:progress / assistant:tasks, same predicate.
  assert.equal((await open(org, cm, dana, false, 'assistant:progress')).length, 1);
  assert.equal((await open(org, volunteer, dana, false, 'assistant:tasks')).length, 0, 'volunteer outside caseload: no tasks row');
  // A shared-applications open t.ROY made says "via t.ROY"; the tab's own open does not.
  await q(`INSERT INTO sharing_grant (user_id, access_code_id, scope, text_version) VALUES ($1, $2, 'applications', 'pglite-test')`, [dana, org]);
  const shared = (via: string | null, actor = cm, viewer: string | null = null) => scoped(org, actor, 'staff', SHARED_OPEN_LOG_SQL + ' RETURNING fields_accessed, accessor_id', [dana, org, false, actor, 'applications', via, viewer]);
  assert.deepEqual((await shared('t.ROY'))[0]?.fields_accessed, { orgId: org, via: 't.ROY' });
  assert.deepEqual((await shared(null))[0]?.fields_accessed, { orgId: org });
  assert.equal((await shared('t.ROY', volunteer)).length, 0, 'not in reach: no applications open');
  // House lane L2: an admin viewing as the case manager is logged as the admin, with whose view it was.
  const adminViewer = '00000000-0000-4000-8000-0000000000ad';
  const viewed = (await shared(null, cm, adminViewer))[0];
  assert.equal(viewed?.accessor_id, adminViewer, 'the admin, not the case manager, is recorded as the opener');
  assert.deepEqual(viewed?.fields_accessed, { orgId: org, via: 'admin view', viewedAs: cm });
  assert.equal((await shared(null, volunteer, adminViewer)).length, 0, 'reach is still the viewed staff member\'s');

  // House lane L2 fix round 1: the Today work-queue entry is once a day per
  // opener, and for an admin once per staff member viewed, so viewing as one
  // staff member never hides the entry for viewing as another.
  await q(`INSERT INTO job_application (user_id, job_title, company, status) VALUES ($1, 'Line cook', 'Sample Diner', 'interviewing')`, [dana]);
  const queue = (actor: string, seesAll: boolean, viewer: string | null) =>
    scoped(org, actor, 'staff', WORK_QUEUE_LOG_SQL + ' RETURNING accessor_id, fields_accessed', [org, seesAll, actor, ['pglite-test'], viewer]);
  const cmOwn = await queue(cm, false, null);
  assert.deepEqual(cmOwn.map((r) => r.accessor_id), [cm], 'the case manager\'s own list: one row, as them');
  assert.equal((await queue(cm, false, null)).length, 0, 'once a day');
  const viaCm = await queue(cm, false, adminViewer);
  assert.equal(viaCm.length, 1, 'the admin viewing as the case manager: their own row');
  assert.equal(viaCm[0].accessor_id, adminViewer);
  assert.deepEqual(viaCm[0].fields_accessed, { orgId: org, via: 'admin view', viewedAs: cm });
  assert.equal((await queue(cm, false, adminViewer)).length, 0, 'once a day for that view');
  const viaVol = await queue(volunteer, true, adminViewer);
  assert.equal(viaVol.length, 1, 'the same admin viewing as another staff member the same day still gets a row');
  assert.deepEqual(viaVol[0].fields_accessed, { orgId: org, via: 'admin view', viewedAs: volunteer });
  assert.equal((await queue(volunteer, true, null)).length, 1, 'and the admin\'s rows never stand in for the staff member\'s own');
});

/**
 * Real SQL for outbound branding (migration 107, staff pass 2026-10-27 lane
 * S2): the exact statements orgOutboundBrand.ts runs, against migrations
 * 001-106 then 107 in pglite, as the NOSUPERUSER app role (RLS on).
 *
 * Proves: 107 applies twice; the default is co_brand; the owner cannot pick
 * exclusive on a first save or flip it later, nor can an org admin or staff,
 * by UPDATE or through the setter; another organization cannot; a platform
 * admin can, through smr_set_org_branding only, with one audit row per
 * change; an unknown value is refused; staff read their own setting and a
 * member of another organization reads nothing; the owner still saves the
 * rest of the profile; setting it for an organization with no profile
 * creates the row and leaves setup unfinished.
 *
 * Run it alone (pglite files in one process are flaky). Skipped unless
 * SMR_PGLITE_DIR points at a node_modules folder holding @electric-sql/pglite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ORG_OUTBOUND_BRAND_SQL as Q } from '@crucible/core/src/orgOutboundBrand';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite outbound brand test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

test('org_profile.branding: platform admin only, read by the organization only, audited', { skip, timeout: 300_000 }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  await db.exec(`CREATE ROLE smr_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO smr_app;`);
  const apply = async (f: string) => db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;');
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) < 107).sort()) {
    try { await apply(f); } catch { await db.exec('ROLLBACK').catch(() => {}); } // 088-091 refuse on their own guards; unrelated
  }
  assert.ok(((await db.query(`SELECT to_regclass('public.org_profile') IS NOT NULL AS h`)).rows[0] as { h: boolean }).h, '103 applied first');
  await apply('107_org_outbound_brand.sql');
  await db.exec(readFileSync(MIG + '107_org_outbound_brand.sql', 'utf8').replace(/^SET LOCAL.*$/m, '')); // and again: idempotent

  const q = (t: string, p: unknown[] = []) => db.query(t, p);
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const [owner, admin, cm, owner2, cm2, platform, member] = Array.from({ length: 7 }, (_, i) => id(i + 1));
  for (const u of [owner, admin, cm, owner2, cm2, platform, member]) await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `${u}@x.test`, `Person ${u.slice(-2)}`]);
  const org = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2) VALUES ('PGOB1', 'Lakeshore Works (Demo)', 'client', $1, true) RETURNING id`, [owner])).rows[0] as { id: string }).id;
  const org2 = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2) VALUES ('PGOB2', 'Other Org (Demo)', 'client', $1, true) RETURNING id`, [owner2])).rows[0] as { id: string }).id;
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'staff'), ($4, $5, 'staff')`, [org, admin, cm, org2, cm2]);
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [member, org2]);
  await q(`INSERT INTO platform_admin (user_id) VALUES ($1)`, [platform]).catch(async () => q(`INSERT INTO platform_admin (user_id, note) VALUES ($1, 'test')`, [platform]));

  const as = async (who: { orgId?: string; userId: string; role?: string }, text: string, params: unknown[] = []) => {
    await db.exec('BEGIN; SET LOCAL ROLE smr_app;');
    try {
      if (who.orgId) await db.query(`SELECT set_config('app.org_id', $1, true), set_config('app.org_role', $2, true)`, [who.orgId, who.role ?? 'staff']);
      await db.query(`SELECT set_config('app.user_id', $1, true)`, [who.userId]);
      const r = await db.query(text, params);
      await db.exec('COMMIT');
      return r.rows as Record<string, unknown>[];
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  };
  const fails = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };
  const stored = async (o: string) => ((await q(`SELECT branding FROM org_profile WHERE access_code_id = $1`, [o])).rows[0] as { branding?: string } | undefined)?.branding;

  // Owner's first save.
  assert.ok(await fails(as({ orgId: org, userId: owner, role: 'owner' }, `INSERT INTO org_profile (access_code_id, branding) VALUES ($1, 'exclusive')`, [org])), 'no exclusive on a first save');
  await as({ orgId: org, userId: owner, role: 'owner' }, `INSERT INTO org_profile (access_code_id) VALUES ($1)`, [org]);
  assert.equal(await stored(org), 'co_brand', 'the default');

  // Nobody in the organization flips it, by UPDATE or through the setter.
  for (const [who, uid, role] of [['owner', owner, 'owner'], ['org admin', admin, 'org_admin'], ['staff', cm, 'staff']] as const) {
    const upd = as({ orgId: org, userId: uid, role }, `UPDATE org_profile SET branding = 'exclusive' WHERE access_code_id = $1 RETURNING branding`, [org]);
    const refusedOrNoRows = await upd.then((rows) => rows.length === 0).catch(() => true);
    assert.ok(refusedOrNoRows, `${who}: UPDATE refused`);
    assert.ok(await fails(as({ orgId: org, userId: uid, role }, Q.set, [org, 'exclusive'])), `${who}: setter refused`);
    assert.equal(await stored(org), 'co_brand');
  }
  assert.ok(await fails(as({ orgId: org2, userId: owner2, role: 'owner' }, Q.set, [org, 'exclusive'])), 'another organization cannot');
  assert.ok(await fails(as({ userId: member }, Q.set, [org, 'exclusive'])), 'a member cannot');

  // A platform admin can, through the setter, audited once per change.
  assert.deepEqual(await as({ userId: platform }, Q.set, [org, 'exclusive']), [{ branding: 'exclusive' }]);
  assert.deepEqual(await as({ userId: platform }, Q.set, [org, 'exclusive']), [{ branding: 'exclusive' }], 'setting the same value again is fine');
  assert.ok(await fails(as({ userId: platform }, Q.set, [org, 'full'])), 'an unknown value is refused');
  const audits = (await q(`SELECT row_summary FROM org_audit WHERE org_id = $1 AND table_name = 'org_profile' AND action = 'BRANDING'`, [org])).rows as { row_summary: Record<string, string> }[];
  assert.deepEqual(audits.map((a) => [a.row_summary.branding_from, a.row_summary.branding_to]), [['co_brand', 'exclusive']], 'one audit row: no row for a no-op');
  // The app role cannot touch the audit table directly (sanity: 045/046 unchanged).
  assert.ok(await fails(as({ userId: platform }, `INSERT INTO org_audit (table_name, action, actor) VALUES ('x', 'y', 'z')`)));

  // Readers.
  assert.deepEqual(await as({ orgId: org, userId: cm }, Q.read, [org]), [{ display_name: null, branding: 'exclusive' }], 'staff read their own');
  assert.deepEqual(await as({ orgId: org2, userId: cm2 }, Q.read, [org]), [], 'staff of another organization read nothing');
  assert.deepEqual(await as({ userId: member }, Q.read, [org]), [], 'a member of another organization reads nothing');
  assert.deepEqual(await as({ userId: cm }, Q.read, [org]), [{ display_name: null, branding: 'exclusive' }], 'by user id alone (runAsUser), staff still read their own');

  // Owner can still save the rest, cannot undo exclusive by hand.
  await as({ orgId: org, userId: owner, role: 'owner' }, `UPDATE org_profile SET timezone = 'America/Denver' WHERE access_code_id = $1`, [org]);
  assert.ok(await fails(as({ orgId: org, userId: owner, role: 'owner' }, `UPDATE org_profile SET branding = 'co_brand' WHERE access_code_id = $1`, [org])), 'the owner cannot take exclusive off');
  assert.equal(await stored(org), 'exclusive');

  // No profile yet: the setter creates it, setup stays unfinished.
  assert.deepEqual(await as({ userId: platform }, Q.set, [org2, 'exclusive']), [{ branding: 'exclusive' }]);
  const p2 = (await q(`SELECT branding, setup_completed_at FROM org_profile WHERE access_code_id = $1`, [org2])).rows[0] as { branding: string; setup_completed_at: unknown };
  assert.deepEqual(p2, { branding: 'exclusive', setup_completed_at: null });
  assert.ok(await fails(as({ userId: platform }, Q.set, ['00000000-0000-4000-8000-00000000ffff', 'exclusive'])), 'no such organization');

  // Grants: smr_app runs the setter, PUBLIC does not, and nobody deletes a profile.
  const fn = (await q(`SELECT has_function_privilege('smr_app', 'public.smr_set_org_branding(uuid, text)', 'EXECUTE') AS app, has_function_privilege('public', 'public.smr_set_org_branding(uuid, text)', 'EXECUTE') AS pub, has_table_privilege('smr_app', 'org_profile', 'DELETE') AS del`)).rows[0] as { app: boolean; pub: boolean; del: boolean };
  assert.deepEqual(fn, { app: true, pub: false, del: false });
});

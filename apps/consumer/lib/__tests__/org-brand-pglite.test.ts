/**
 * Real SQL for the organization brand (migration 099, C3 brand): the exact
 * statements orgBrand.ts runs, against migrations 001-099 in pglite, as a
 * NOSUPERUSER role (RLS on). Proves: the owner can set and remove the logo;
 * staff, an admin, another org and a platform admin cannot; only a platform
 * admin changes the tier; members read the logo and outsiders do not; the
 * audit row lands without the bytes. Run it alone (three pglite files in one
 * process are flaky). Skipped unless SMR_PGLITE_DIR points at a node_modules
 * folder holding @electric-sql/pglite (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ORG_BRAND_SQL } from '@crucible/core/src/orgBrand';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite brand test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

test('org_brand: owner-only logo, admin-only tier, members-only read, audited without bytes', { skip }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  const failed: string[] = [];
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 99).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); }
    catch { await db.exec('ROLLBACK').catch(() => {}); failed.push(f); } // 088-091 resource chain refuses on its own guards; unrelated tables
  }
  assert.ok(readdirSync(MIG).includes('099_org_brand.sql') && !failed.includes('099_org_brand.sql'), `099 must apply; failed: ${failed.join(', ')}`);
  await db.exec(`CREATE ROLE tester NOSUPERUSER; GRANT USAGE ON SCHEMA public TO tester; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO tester; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO tester;`);
  const q = (t: string, p: unknown[] = []) => db.query(t, p);

  /** As the app role: org scope when orgId is set (runScoped), else the user id only (runAsUser), else nothing. */
  const as = async (who: { orgId?: string; userId?: string; role?: string }, text: string, params: unknown[] = []) => {
    await db.exec('BEGIN; SET LOCAL ROLE tester;');
    try {
      if (who.orgId) await db.query(`SELECT set_config('app.org_id', $1, true), set_config('app.org_role', $2, true)`, [who.orgId, who.role ?? 'staff']);
      if (who.userId) await db.query(`SELECT set_config('app.user_id', $1, true)`, [who.userId]);
      const r = await db.query(text, params);
      await db.exec('COMMIT');
      return r.rows as Record<string, unknown>[];
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  };
  const refused = async (p: Promise<unknown>) => { try { const r = await p; return Array.isArray(r) && r.length === 0; } catch { return true; } };

  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const [owner, admin, staff, member, outsider, otherOwner, platform] = [1, 2, 3, 4, 5, 6, 7].map(id);
  for (const u of [owner, admin, staff, member, outsider, otherOwner, platform]) {
    await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `${u}@x.test`, `Account ${u.slice(-2)}`]);
  }
  const org = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2) VALUES ('PGBRAND01', 'Hope House (Demo)', 'client', $1, true) RETURNING id`, [owner])).rows[0] as { id: string }).id;
  const other = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id) VALUES ('PGBRAND02', 'Other Org (Demo)', 'client', $1) RETURNING id`, [otherOwner])).rows[0] as { id: string }).id;
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'staff')`, [org, admin, staff]);
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [member, org]);
  await q(`INSERT INTO platform_admin (user_id) VALUES ($1)`, [platform]).catch(async () => q(`INSERT INTO platform_admin (user_id, note) VALUES ($1, 'test')`, [platform]));

  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452000000400000004008060000', 'hex'), Buffer.alloc(64, 7)]);
  const sha = createHash('sha256').update(png).digest('hex');
  const setArgs = (o: string) => [o, png.toString('hex'), 'image/png', sha, png.length];

  // ---- writes: owner only for the logo --------------------------------------
  assert.ok(await refused(as({ orgId: org, userId: staff, role: 'staff' }, ORG_BRAND_SQL.setLogo, setArgs(org))), 'staff cannot set the logo');
  assert.ok(await refused(as({ orgId: org, userId: admin, role: 'org_admin' }, ORG_BRAND_SQL.setLogo, setArgs(org))), 'an org admin cannot set the logo');
  assert.ok(await refused(as({ orgId: org, userId: platform, role: 'owner' }, ORG_BRAND_SQL.setLogo, setArgs(org))), 'a platform admin acting as owner cannot set the logo');
  assert.ok(await refused(as({ orgId: org, userId: otherOwner, role: 'owner' }, ORG_BRAND_SQL.setLogo, setArgs(org))), 'another org owner, even with this org id in scope, cannot');
  assert.ok(await refused(as({ orgId: org, userId: owner, role: 'staff' }, `UPDATE org_brand SET tier = 'full' WHERE access_code_id = $1 RETURNING 1`, [org])) , 'no row yet, nothing to change');
  assert.equal((await as({ orgId: org, userId: owner, role: 'owner' }, ORG_BRAND_SQL.setLogo, setArgs(org))).length, 1, 'the owner sets the logo');
  assert.equal((await q(`SELECT updated_by FROM org_brand WHERE access_code_id = $1`, [org])).rows[0]?.updated_by, owner, 'updated_by is the actor, set by the database');

  // ---- tier: platform admin only ---------------------------------------------
  assert.ok(await refused(as({ orgId: org, userId: owner, role: 'owner' }, ORG_BRAND_SQL.setTier, [org, 'full'])), 'the owner cannot change the tier');
  assert.ok(await refused(as({ orgId: other, userId: otherOwner, role: 'owner' }, `INSERT INTO org_brand (access_code_id, tier) VALUES ($1, 'cobrand') RETURNING 1`, [other])), 'nor give themselves a tier on first insert');
  assert.ok(await refused(as({ orgId: org, userId: staff, role: 'staff' }, `UPDATE org_brand SET tier = 'cobrand' WHERE access_code_id = $1 RETURNING 1`, [org])), 'staff cannot change the tier');
  assert.deepEqual((await as({ userId: platform }, ORG_BRAND_SQL.setTier, [org, 'cobrand'])).map((r) => r.tier), ['cobrand'], 'a platform admin sets the tier');
  assert.ok(await refused(as({ userId: platform }, `UPDATE org_brand SET logo = NULL, logo_mime = NULL, logo_sha256 = NULL, logo_bytes = NULL WHERE access_code_id = $1 RETURNING 1`, [org])), 'and cannot touch the logo');

  // ---- reads: members yes, outsiders no --------------------------------------
  const readAs = async (who: { orgId?: string; userId?: string; role?: string }) => (await as(who, ORG_BRAND_SQL.readLogo, [org])).length;
  assert.equal(await readAs({ userId: owner }), 1, 'owner reads');
  assert.equal(await readAs({ userId: admin }), 1, 'admin reads');
  assert.equal(await readAs({ userId: staff }), 1, 'staff read');
  assert.equal(await readAs({ userId: member }), 1, 'a member who joined with the code reads');
  assert.equal(await readAs({ userId: platform }), 1, 'a platform admin reads');
  assert.equal(await readAs({ orgId: org, userId: staff }), 1, 'the org scope reads');
  assert.equal(await readAs({ userId: outsider }), 0, 'a signed-in non-member cannot read the logo');
  assert.equal(await readAs({ userId: otherOwner }), 0, 'another organization owner cannot read it');
  assert.equal(await readAs({ orgId: other, userId: otherOwner, role: 'owner' }), 0, 'another organization scope cannot read it');
  assert.equal(await readAs({}), 0, 'an unscoped read sees nothing');
  const got = (await as({ userId: member }, ORG_BRAND_SQL.readLogo, [org]))[0] as { logo_b64: string; logo_mime: string };
  assert.ok(Buffer.from(got.logo_b64, 'base64').equals(png), 'bytes round-trip exactly');
  assert.equal(got.logo_mime, 'image/png');

  // ---- the participant co-brand read -----------------------------------------
  assert.deepEqual((await as({ userId: member }, ORG_BRAND_SQL.participantCoBrand, [member])).map((r) => r.partner_name), ['Hope House (Demo)'], 'a member of a co-brand org sees it');
  assert.equal((await as({ userId: outsider }, ORG_BRAND_SQL.participantCoBrand, [outsider])).length, 0, 'a solo participant sees no org');
  assert.equal((await as({ userId: outsider }, ORG_BRAND_SQL.participantCoBrand, [member])).length, 0, 'and cannot look up someone else');

  // ---- limits the table itself keeps -----------------------------------------
  const big = Buffer.alloc(524289, 1);
  await assert.rejects(q(ORG_BRAND_SQL.setLogo, [other, big.toString('hex'), 'image/png', sha, big.length]), 'over 512 KB is refused by the table');
  await assert.rejects(q(ORG_BRAND_SQL.setLogo, [other, png.toString('hex'), 'image/svg+xml', sha, png.length]), 'SVG is refused by the table');
  await assert.rejects(q(ORG_BRAND_SQL.setLogo, [other, png.toString('hex'), 'image/png', sha, png.length + 1]), 'a byte count that does not match is refused');

  // ---- removal keeps the tier; delete is not possible ------------------------
  assert.ok(await refused(as({ orgId: org, userId: staff, role: 'staff' }, ORG_BRAND_SQL.removeLogo, [org])), 'staff cannot remove the logo');
  assert.equal(await readAs({ userId: owner }), 1, 'still there');
  assert.equal((await as({ orgId: org, userId: owner, role: 'owner' }, `DELETE FROM org_brand WHERE access_code_id = $1 RETURNING 1`, [org])).length, 0, 'no delete policy: the owner cannot delete the row');
  assert.equal((await as({ orgId: org, userId: owner, role: 'owner' }, ORG_BRAND_SQL.removeLogo, [org])).length, 1, 'the owner removes the logo');
  const after = (await q(`SELECT logo, tier FROM org_brand WHERE access_code_id = $1`, [org])).rows[0] as { logo: unknown; tier: string };
  assert.equal(after.logo, null); assert.equal(after.tier, 'cobrand', 'the tier survives a removal');

  // ---- audit: set, tier, removed; never the bytes ----------------------------
  const audit = (await q(`SELECT action, actor, row_summary FROM org_audit WHERE table_name = 'org_brand' AND org_id = $1 ORDER BY id`, [org])).rows as { action: string; actor: string; row_summary: Record<string, unknown> }[];
  assert.deepEqual(audit.map((a) => [a.action, a.row_summary.logo ?? null, a.row_summary.tier_to ?? null, a.actor]),
    [['INSERT', 'set', null, owner], ['UPDATE', null, 'cobrand', platform], ['UPDATE', 'removed', null, owner]], JSON.stringify(audit));
  const text = JSON.stringify(audit);
  assert.ok(!text.includes(png.toString('hex').slice(0, 40)) && !text.includes(png.toString('base64').slice(0, 24)) && !text.includes(sha), 'no bytes and no full hash in org_audit');
});

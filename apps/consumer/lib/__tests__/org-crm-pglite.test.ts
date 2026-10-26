/**
 * Real SQL for the org workspace fixes (B8 crm, review BL1 and SF4): the
 * exact statements the app runs, against migrations 001-097 in pglite, as a
 * non-superuser role with the org scope set (RLS on). The friendly pre-checks
 * in orgStaffAdmin.ts are bypassed on purpose: these assert the statement
 * itself refuses. Skipped unless SMR_PGLITE_DIR points at a node_modules
 * folder holding @electric-sql/pglite
 * (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { STAFF_SQL } from '@crucible/core/src/orgStaffAdmin';
import { CLIENT_HEADER_WHO_SQL } from '@crucible/core/src/orgClientView';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite org test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

test('owner-only staff writes and the consent-gated client header, in real SQL', { skip }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  const failed: string[] = [];
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 97).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); }
    catch { await db.exec('ROLLBACK').catch(() => {}); failed.push(f); } // 088-091 resource chain refuses on its own guards; unrelated tables
  }
  assert.ok(!failed.includes('097_org_seats.sql') && readdirSync(MIG).includes('097_org_seats.sql'), `097 must apply; failed: ${failed.join(', ')}`);
  // The staff reach checks ask the database's rule (smr_staff_reach, 102; units, 103): apply both.
  for (const f of ['102_reach_activity_audit.sql', '103_org_structure.sql']) await db.exec('BEGIN;' + readFileSync(MIG + f, 'utf8') + ';COMMIT;');
  await db.exec(`CREATE ROLE tester NOSUPERUSER; GRANT USAGE ON SCHEMA public TO tester; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO tester; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO tester;
    GRANT EXECUTE ON FUNCTION public.smr_staff_reach(uuid, uuid, uuid), public.smr_staff_sees_all(uuid, uuid) TO tester;`);
  const q = (t: string, p: unknown[] = []) => db.query(t, p);
  /** One statement as the app role, scoped to an org and an actor (what runScoped does). */
  const scoped = async (orgId: string, actor: string, text: string, params: unknown[]) => {
    await db.exec('BEGIN; SET LOCAL ROLE tester;');
    try {
      await db.query(`SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.org_role', 'org_admin', true)`, [orgId, actor]);
      const r = await db.query(text, params);
      await db.exec('COMMIT');
      return r.rows as Record<string, unknown>[];
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  };

  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const [owner, admin, admin2, cm, outsiderAdmin, invited, sharer, selfJoin] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
  for (const u of [owner, admin, admin2, cm, outsiderAdmin, invited, sharer, selfJoin]) {
    await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `${u}@x.test`, `Account ${u.slice(-2)}`]);
  }
  await q(`UPDATE users SET current_stage = 3 WHERE id IN ($1, $2, $3)`, [invited, sharer, selfJoin]);
  const org = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2, max_redemptions) VALUES ('PGORG0001', 'PG org', 'client', $1, true, 10) RETURNING id`, [owner])).rows[0] as { id: string }).id;
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'org_admin'), ($1, $4, 'staff')`, [org, admin, admin2, cm]);
  await q(`INSERT INTO platform_admin (user_id) VALUES ($1)`, [outsiderAdmin]).catch(async () => q(`INSERT INTO platform_admin (user_id, note) VALUES ($1, 'test')`, [outsiderAdmin]));
  const roleOf = async (u: string) => ((await q(`SELECT role FROM org_staff WHERE access_code_id = $1 AND user_id = $2`, [org, u])).rows[0] as { role?: string } | undefined)?.role ?? null;

  // ---- SF4: the binding predicates, with the pre-check bypassed ------------
  assert.equal((await scoped(org, admin, STAFF_SQL.setRole(), [org, cm, 'org_admin', admin])).length, 0, 'an admin cannot promote');
  assert.equal(await roleOf(cm), 'staff');
  assert.equal((await scoped(org, admin, STAFF_SQL.setRole(), [org, admin2, 'staff', admin])).length, 0, 'an admin cannot demote another admin');
  assert.equal((await scoped(org, admin, STAFF_SQL.add(), [org, admin2, 'staff', null, admin])).length, 0, 'nor demote through the add re-role');
  assert.equal(await roleOf(admin2), 'org_admin');
  assert.equal((await scoped(org, admin, STAFF_SQL.remove(), [org, admin2, admin])).length, 0, 'an admin cannot remove another admin');
  assert.equal(await roleOf(admin2), 'org_admin');
  assert.equal((await scoped(org, outsiderAdmin, STAFF_SQL.setRole(), [org, admin2, 'staff', outsiderAdmin])).length, 0, 'the org console path does not let a platform admin re-role an admin');
  // Staff-only changes stay with admins; the owner can do the rest; the support path admits a platform admin.
  assert.equal((await scoped(org, owner, STAFF_SQL.setRole(), [org, cm, 'org_admin', owner])).length, 1, 'the owner can promote');
  assert.equal((await scoped(org, owner, STAFF_SQL.setRole(), [org, cm, 'staff', owner])).length, 1, 'and demote');
  assert.equal((await scoped(org, outsiderAdmin, STAFF_SQL.setRole('owner_or_platform_admin'), [org, admin2, 'staff', outsiderAdmin])).length, 1, 'the support path lets a platform admin');
  assert.equal(await roleOf(admin2), 'staff');
  assert.equal((await scoped(org, admin, STAFF_SQL.remove(), [org, admin2, admin])).length, 1, 'an admin can remove plain staff');

  // Staff cap (097): a new staff row needs a free place.
  await q(`UPDATE access_code SET max_staff = 2 WHERE id = $1`, [org]); // now admin + cm on staff = 2
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [selfJoin, org]);
  assert.equal((await scoped(org, owner, STAFF_SQL.add(), [org, selfJoin, 'staff', null, owner])).length, 0, 'no new staff past the cap');
  assert.equal((await scoped(org, owner, STAFF_SQL.add(), [org, cm, 'staff', 'Volunteer', owner])).length, 1, 'a re-role of current staff is not a new place');
  await q(`UPDATE access_code SET max_staff = 10 WHERE id = $1`, [org]);

  // Audit trigger (097) recorded the cap change without the code.
  const audit = (await q(`SELECT row_summary FROM org_audit WHERE table_name = 'access_code' AND org_id = $1`, [org])).rows as { row_summary: Record<string, unknown> }[];
  assert.ok(audit.some((a) => a.row_summary.max_staff_to === 2), JSON.stringify(audit));
  assert.ok(!JSON.stringify(audit).includes('PGORG0001'), 'the code never lands in org_audit');

  // ---- BL1: identity and stage only with progress sharing -----------------
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $3), ($2, $3)`, [invited, sharer, org]);
  await q(`INSERT INTO org_invite (access_code_id, user_id, invited_by, invited_name, invited_email) VALUES ($1, $2, $3, 'Typed Name', 'typed@org.test')`, [org, invited, owner]);
  await q(`INSERT INTO consumer_consent (user_id, consent_layer, status, consent_text_version, collection_context) VALUES ($1, 'sharing', 'granted', 'pglite-test', '{}'::jsonb)`, [sharer]);
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $4, $5), ($1, $3, $4, $5)`, [org, invited, sharer, cm, owner]);
  const header = async (client: string) => (await scoped(org, cm, CLIENT_HEADER_WHO_SQL, [client, org, false, cm]))[0] as Record<string, unknown> | undefined;

  const inv = await header(invited);
  assert.deepEqual({ name: inv?.name, email: inv?.email, src: inv?.identity_source, stage: inv?.current_stage },
    { name: 'Typed Name', email: 'typed@org.test', src: 'invite', stage: null }, 'invited non-sharer: only what the org typed, no stage');
  const sh = await header(sharer);
  assert.equal(sh?.identity_source, 'account'); assert.equal(sh?.current_stage, 3); assert.equal(sh?.email, `${sharer}@x.test`);
  const self = await scoped(org, owner, CLIENT_HEADER_WHO_SQL, [selfJoin, org, true, owner]);
  assert.deepEqual({ name: self[0]?.name, email: self[0]?.email, stage: self[0]?.current_stage, src: self[0]?.identity_source },
    { name: null, email: null, stage: null, src: 'none' }, 'self-joined non-sharer: nothing from their account, even for the owner');
  // Not in reach: a plain staff member with no assignment. (Since 103 the app check also asks the
  // database's rule, under which an org admin reaches everyone, so an admin is no longer the example.)
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'staff')`, [org, admin2]);
  assert.equal((await scoped(org, admin2, CLIENT_HEADER_WHO_SQL, [invited, org, false, admin2])).length, 0, 'not in reach: no row');

  // ---- SF2: a saved check-in draft is kind 'draft' (097 widened the check) --
  const draftNote = await scoped(org, cm, `INSERT INTO case_note (access_code_id, client_user_id, author_user_id, kind, body) VALUES ($1, $2, $3, 'draft', 'Hi, checking in.') RETURNING id`, [org, invited, cm]);
  assert.equal(draftNote.length, 1);
  await scoped(org, cm, `UPDATE case_note SET kind = 'email' WHERE id = $1`, [draftNote[0].id]);
  const kept = (await q(`SELECT kind FROM case_note_version WHERE note_id = $1`, [draftNote[0].id])).rows as { kind: string }[];
  assert.deepEqual(kept.map((k) => k.kind), ['draft'], 'marking it sent keeps the draft as an earlier version');
});

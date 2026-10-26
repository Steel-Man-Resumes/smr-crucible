/**
 * Real SQL for migration 100 (house build 2026-10-26, L1): organization
 * lifecycle stamps and audit, staff invitations (RLS, grants, guard), the
 * invitee's accept and decline, and delete-only-when-empty. Migrations
 * 001-100 in pglite, the app statements run as a NOSUPERUSER smr_app role
 * (RLS on). Fictional people and organizations only.
 *
 * Run it alone (several pglite files in one process are flaky). Skipped unless
 * SMR_PGLITE_DIR points at a node_modules folder holding @electric-sql/pglite
 * (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { STAFF_INVITE_LIST_SQL, STAFF_PLACES_SQL, inviteDeniesFor } from '@crucible/core/src/staffInvites';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite lifecycle test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

test('migration 100: lifecycle stamps, staff invitations, accept, delete only when empty', { skip }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  await db.exec(`CREATE ROLE smr_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO smr_app;`);
  const failed: string[] = [];
  const apply = async (f: string) => {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); return true; }
    catch { await db.exec('ROLLBACK').catch(() => {}); return false; }
  };
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 103).sort()) {
    if (!(await apply(f))) failed.push(f); // 088-091 resource chain refuses on its own guards; unrelated tables
  }
  assert.ok(!failed.includes('100_org_lifecycle_invites.sql'), `100 must apply; failed: ${failed.join(', ')}`);
  assert.ok(await apply('100_org_lifecycle_invites.sql'), '100 applies a second time (idempotent)');

  const q = (t: string, p: unknown[] = []) => db.query(t, p);
  const as = async (who: { orgId?: string; userId?: string; role?: string }, text: string, params: unknown[] = []) => {
    await db.exec('BEGIN; SET LOCAL ROLE smr_app;');
    try {
      if (who.orgId) await db.query(`SELECT set_config('app.org_id', $1, true), set_config('app.org_role', $2, true)`, [who.orgId, who.role ?? 'staff']);
      if (who.userId) await db.query(`SELECT set_config('app.user_id', $1, true)`, [who.userId]);
      const r = await db.query(text, params);
      await db.exec('COMMIT');
      return r.rows as Record<string, unknown>[];
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  };
  const refused = async (p: Promise<unknown>) => { try { const r = await p; return Array.isArray(r) && r.length === 0; } catch { return true; } };
  const one = async (who: { orgId?: string; userId?: string; role?: string }, text: string, params: unknown[] = []) =>
    Object.values((await as(who, text, params))[0] ?? {})[0];

  // ---- grants -------------------------------------------------------------
  const priv = async (p: string) => ((await q(`SELECT has_table_privilege('smr_app', 'org_staff_invite', $1) AS ok`, [p])).rows[0] as { ok: boolean }).ok;
  assert.deepEqual([await priv('SELECT'), await priv('INSERT'), await priv('DELETE')], [true, true, false], 'select and insert, never delete');
  assert.equal(await priv('UPDATE'), true, 'update by table (the guard trigger decides which columns)');
  const rls = (await q(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'org_staff_invite'`)).rows[0] as { relrowsecurity: boolean; relforcerowsecurity: boolean };
  assert.deepEqual([rls.relrowsecurity, rls.relforcerowsecurity], [true, true]);

  // ---- people and organizations --------------------------------------------
  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const [owner, admin, cm, invitee, other, otherOwner, platform, newbie, member] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id);
  for (const u of [owner, admin, cm, invitee, other, otherOwner, platform, newbie, member]) {
    await q(`INSERT INTO users(id, email, name, "emailVerified") VALUES ($1, $2, $3, now())`, [u, `${u.slice(-4)}@agency.test`, `Person ${u.slice(-2)}`]);
  }
  await q(`UPDATE users SET "emailVerified" = NULL WHERE id = $1`, [newbie]);
  const org = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2, max_staff) VALUES ('PGLIFE01', 'Southside Bridge (Demo)', 'client', $1, true, 3) RETURNING id`, [owner])).rows[0] as { id: string }).id;
  const orgB = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id) VALUES ('PGLIFE02', 'Other Program (Demo)', 'client', $1) RETURNING id`, [otherOwner])).rows[0] as { id: string }).id;
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'staff')`, [org, admin, cm]);
  await q(`INSERT INTO platform_admin (user_id) VALUES ($1)`, [platform]).catch(async () => q(`INSERT INTO platform_admin (user_id, note) VALUES ($1, 'test')`, [platform]));
  const OWN = { orgId: org, userId: owner, role: 'owner' };
  const ADM = { orgId: org, userId: admin, role: 'org_admin' };
  const CM = { orgId: org, userId: cm, role: 'staff' };

  const ins = (who: { orgId: string; userId: string; role?: string }, target: string, opts: { role?: string; path?: string; denies?: string[]; orgFor?: string } = {}) =>
    as(who, `INSERT INTO org_staff_invite (access_code_id, user_id, invited_email, invited_name, role, capability_denies, path)
             VALUES ($1, $2, $3, 'Typed Name', $4, $5::text[], $6) RETURNING id, invited_by, accepted_at`,
       [opts.orgFor ?? who.orgId, target, `${target.slice(-4)}@agency.test`, opts.role ?? 'staff', opts.denies ?? [], opts.path ?? 'existing_account']);

  // ---- staff invitation writes: guard and RLS -------------------------------
  assert.ok(await refused(ins(ADM, invitee, { role: 'org_admin' })), 'an org admin cannot invite an admin');
  assert.ok(await refused(ins(OWN, invitee, { orgFor: orgB })), 'scoped to org A, nobody writes an invitation into org B');
  assert.ok(await refused(ins(OWN, invitee, { denies: ['org.staff.manage'] })), 'an invitation cannot carry a non-delegable capability');
  assert.ok(await refused(ins(OWN, invitee, { path: 'admin_added' })), 'only a platform admin adds an existing account directly');
  const volDenies = inviteDeniesFor('volunteer');
  const inv = (await ins(ADM, invitee, { denies: volDenies }))[0] as { id: string; invited_by: string; accepted_at: string | null };
  assert.equal(inv.invited_by, admin, 'invited_by is stamped by the database from app.user_id');
  assert.equal(inv.accepted_at, null);
  assert.ok(await refused(ins(ADM, invitee)), 'one open invitation per person per organization');

  // Reads: the org's scope and the invitee; never another org, never a stranger.
  assert.equal((await as(OWN, STAFF_INVITE_LIST_SQL, [org])).length, 1, 'the owner reads the list');
  assert.equal((await as({ orgId: orgB, userId: otherOwner, role: 'owner' }, `SELECT id FROM org_staff_invite`)).length, 0, 'another org reads nothing (cross-org leak check)');
  assert.equal((await as({ orgId: orgB, userId: otherOwner, role: 'owner' }, STAFF_INVITE_LIST_SQL, [org])).length, 0, "naming org A's id while scoped to B returns nothing");
  assert.equal((await as({ userId: invitee }, `SELECT id FROM org_staff_invite`)).length, 1, 'the invitee reads their own invitation');
  assert.equal((await as({ userId: other }, `SELECT id FROM org_staff_invite`)).length, 0, 'a stranger reads nothing');
  assert.equal((await as({}, `SELECT id FROM org_staff_invite`)).length, 0, 'no scope reads nothing');

  // Updates: only the lifecycle columns, only in scope, never accept by hand.
  assert.ok(await refused(as(OWN, `UPDATE org_staff_invite SET accepted_at = now() WHERE id = $1 RETURNING id`, [inv.id])), 'the app cannot mark an invitation accepted');
  assert.ok(await refused(as(OWN, `UPDATE org_staff_invite SET declined_at = now() WHERE id = $1 RETURNING id`, [inv.id])), 'or declined');
  assert.ok(await refused(as(OWN, `UPDATE org_staff_invite SET role = 'org_admin' WHERE id = $1 RETURNING id`, [inv.id])), 'nobody changes the role on an invitation');
  assert.ok(await refused(as(OWN, `UPDATE org_staff_invite SET user_id = $2 WHERE id = $1 RETURNING id`, [inv.id, other])), 'or who it is for');
  assert.ok(await refused(as(OWN, `UPDATE org_staff_invite SET capability_denies = '{}' WHERE id = $1 RETURNING id`, [inv.id])), 'or lifts its restrictions');
  assert.ok(await refused(as(OWN, `DELETE FROM org_staff_invite WHERE id = $1 RETURNING id`, [inv.id])), 'the app cannot delete an invitation');
  assert.ok(await refused(as({ orgId: orgB, userId: otherOwner, role: 'owner' }, `UPDATE org_staff_invite SET revoked_at = now() WHERE id = $1 RETURNING id`, [inv.id])), 'another org cannot revoke it');
  assert.ok(await refused(as({ userId: invitee }, `UPDATE org_staff_invite SET revoked_at = now() WHERE id = $1 RETURNING id`, [inv.id])), 'the invitee cannot edit the row, only answer through the function');
  assert.equal((await as(OWN, `UPDATE org_staff_invite SET send_count = send_count + 1, last_sent_at = now(), expires_at = now() + interval '90 days' WHERE id = $1 RETURNING send_count, expires_at <= now() + interval '14 days 1 minute' AS capped`, [inv.id]))[0]?.capped, true, 'a resend renews to 14 days, never longer');
  const places = (await as(OWN, STAFF_PLACES_SQL, [org]))[0] as { n: number; max: number };
  assert.deepEqual([Number(places.n), Number(places.max)], [3, 3], 'two staff plus one open invitation to an existing account fill the three places');

  // ---- accept and decline ----------------------------------------------------
  const answer = (user: string, inviteId: string, yes: boolean) => one({ userId: user }, `SELECT smr_answer_staff_invite($1::uuid, $2::boolean) AS r`, [inviteId, yes]);
  assert.equal(await answer(other, inv.id, true), 'not_found', 'nobody answers another person\'s invitation');
  await q(`UPDATE access_code SET max_staff = 2 WHERE id = $1`, [org]);
  assert.equal(await answer(invitee, inv.id, true), 'full', 'the places filled up after the invitation went out (lowered by an admin)');
  await q(`UPDATE access_code SET max_staff = 10 WHERE id = $1`, [org]);
  await q(`UPDATE access_code SET is_active = false WHERE id = $1`, [org]);
  assert.equal(await answer(invitee, inv.id, true), 'closed', 'a closed organization takes nobody');
  await q(`UPDATE access_code SET is_active = true WHERE id = $1`, [org]);
  assert.equal(await answer(invitee, inv.id, true), 'ok', 'the invitee accepts');
  assert.equal((await q(`SELECT role FROM org_staff WHERE access_code_id = $1 AND user_id = $2`, [org, invitee])).rows.length, 1, 'and is on staff');
  const denies = (await q(`SELECT capability FROM org_capability_override WHERE org_id = $1 AND user_id = $2 AND effect = 'deny' ORDER BY 1`, [org, invitee])).rows.map((r: unknown) => (r as { capability: string }).capability);
  assert.deepEqual(denies, [...volDenies].sort(), 'with the volunteer restrictions, in the same transaction');
  assert.equal(await answer(invitee, inv.id, true), 'answered', 'an answered invitation stays answered');
  assert.ok(await refused(as(OWN, `UPDATE org_staff_invite SET revoked_at = now() WHERE id = $1 RETURNING id`, [inv.id])), 'an accepted invitation cannot be revoked afterwards');

  // Decline, expiry, revoke, and an inviter who lost the right.
  const inv2 = ((await ins(OWN, other))[0] as { id: string }).id;
  assert.equal(await answer(other, inv2, false), 'declined');
  assert.equal((await q(`SELECT count(*)::int AS n FROM org_staff WHERE access_code_id = $1 AND user_id = $2`, [org, other])).rows[0]?.n, 0, 'declining attaches nothing');
  const inv3 = ((await ins(OWN, member))[0] as { id: string }).id;
  await db.exec(`ALTER TABLE org_staff_invite DISABLE TRIGGER org_staff_invite_guard; UPDATE org_staff_invite SET expires_at = now() - interval '1 minute' WHERE id = '${inv3}'; ALTER TABLE org_staff_invite ENABLE TRIGGER org_staff_invite_guard;`);
  assert.equal(await answer(member, inv3, true), 'expired');
  assert.equal((await as(OWN, `UPDATE org_staff_invite SET revoked_at = now() WHERE id = $1 RETURNING revoked_by`, [inv3]))[0]?.revoked_by, owner, 'revoked_by is the actor');
  assert.equal(await answer(member, inv3, true), 'revoked');
  const inv4 = ((await ins(ADM, newbie))[0] as { id: string }).id;
  await q(`DELETE FROM org_staff WHERE access_code_id = $1 AND user_id = $2`, [org, admin]);
  assert.equal(await answer(newbie, inv4, true), 'inviter_gone', 'an admin who left cannot bring anyone in');

  // ---- platform admin adds an existing account directly ----------------------
  const added = (await ins({ orgId: org, userId: platform, role: 'org_admin' }, otherOwner, { path: 'admin_added' }))[0] as { accepted_at: string | null };
  assert.ok(added.accepted_at, 'admin_added is accepted when written');

  // ---- B2: a new address is an invitation only, accepted through the function --
  const [shellA, shellB] = [10, 11].map(id);
  for (const u of [shellA, shellB]) await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, 'Shell')`, [u, `${u.slice(-4)}@agency.test`]);
  const newA = ((await ins(OWN, shellA, { path: 'new_account', denies: volDenies }))[0] as { id: string }).id;
  const newB = ((await ins(OWN, shellB, { path: 'new_account', denies: volDenies }))[0] as { id: string }).id;
  const staffRow = async (u: string) => (await q(`SELECT role FROM org_staff WHERE access_code_id = $1 AND user_id = $2`, [org, u])).rows as { role: string }[];
  assert.equal((await staffRow(shellA)).length + (await staffRow(shellB)).length, 0, 'inviting a new address writes no staff row');
  await db.exec(`ALTER TABLE org_staff_invite DISABLE TRIGGER org_staff_invite_guard; UPDATE org_staff_invite SET expires_at = now() - interval '1 day' WHERE id = '${newA}'; ALTER TABLE org_staff_invite ENABLE TRIGGER org_staff_invite_guard;`);
  await q(`UPDATE users SET "emailVerified" = now() WHERE id = $1`, [shellA]); // they sign in, 15 days later
  assert.equal(await answer(shellA, newA, true), 'expired', 'an expired invitation cannot be accepted');
  assert.equal((await staffRow(shellA)).length, 0, 'an expired invitation plus a sign-in grants no workspace');
  assert.equal((await q(`SELECT count(*)::int AS n FROM org_capability_override WHERE org_id = $1 AND user_id = $2`, [org, shellA])).rows[0]?.n, 0);
  assert.equal((await as({ orgId: org, userId: shellA, role: 'staff' }, `SELECT count(*)::int AS n FROM org_staff WHERE access_code_id = $1 AND user_id = $2`, [org, shellA]))[0]?.n, 0);
  assert.equal(await answer(shellB, newB, true), 'ok', 'within 14 days, the new address accepts');
  assert.deepEqual((await staffRow(shellB)).map((r) => r.role), ['staff'], 'with the role it was invited to');
  const newDenies = (await q(`SELECT capability FROM org_capability_override WHERE org_id = $1 AND user_id = $2 AND effect = 'deny' ORDER BY 1`, [org, shellB])).rows.map((r: unknown) => (r as { capability: string }).capability);
  assert.deepEqual(newDenies, [...volDenies].sort(), 'and the volunteer restrictions stored on the invitation');

  // ---- guard: revoked_by and the inviter of record ---------------------------
  const inv5 = ((await ins(OWN, member))[0] as { id: string }).id;
  assert.equal((await as(OWN, `UPDATE org_staff_invite SET send_count = send_count + 1, revoked_by = $2 WHERE id = $1 RETURNING revoked_by`, [inv5, other]))[0]?.revoked_by, null, 'revoked_by stays empty unless it is being revoked');
  assert.ok(await refused(as(OWN, `UPDATE org_staff_invite SET invited_by = $2 WHERE id = $1 RETURNING id`, [inv5, other])), 'the inviter of record can only become the person acting');
  assert.equal((await as(OWN, `UPDATE org_staff_invite SET invited_by = $2 WHERE id = $1 RETURNING invited_by`, [inv5, owner]))[0]?.invited_by, owner, 'the resender may take it over');

  // ---- audit: who, never the address ----------------------------------------
  const audit = (await q(`SELECT actor, row_summary::text AS s FROM org_audit WHERE table_name = 'org_staff_invite' AND org_id = $1`, [org])).rows as { actor: string; s: string }[];
  assert.ok(audit.length >= 5);
  assert.ok(audit.every((a) => !/agency\.test|Typed Name/.test(a.s)), 'no address or typed name in the audit');

  // ---- lifecycle stamps and audit --------------------------------------------
  assert.equal((await as({ userId: platform }, `UPDATE access_code SET is_active = false, close_reason = 'Program ended' WHERE id = $1 RETURNING closed_by`, [orgB]))[0]?.closed_by, platform, 'closing stamps who');
  const closed = (await q(`SELECT closed_at IS NOT NULL AS stamped, close_reason FROM access_code WHERE id = $1`, [orgB])).rows[0] as { stamped: boolean; close_reason: string };
  assert.deepEqual([closed.stamped, closed.close_reason], [true, 'Program ended']);
  await as({ userId: platform }, `UPDATE access_code SET is_active = true WHERE id = $1 RETURNING id`, [orgB]);
  const reopened = (await q(`SELECT closed_at, closed_by, close_reason FROM access_code WHERE id = $1`, [orgB])).rows[0] as Record<string, unknown>;
  assert.deepEqual(reopened, { closed_at: null, closed_by: null, close_reason: null }, 'reopening clears every close stamp');
  await as({ userId: platform }, `UPDATE access_code SET partner_name = 'Other Program Renamed (Demo)' WHERE id = $1 RETURNING id`, [orgB]);
  const lifeAudit = (await q(`SELECT row_summary::text AS s FROM org_audit WHERE table_name = 'access_code' AND org_id = $1 ORDER BY id`, [orgB])).rows.map((r: unknown) => (r as { s: string }).s).join(' ');
  assert.match(lifeAudit, /"reason_given": true/);
  assert.match(lifeAudit, /"name_to": "Other Program Renamed \(Demo\)"/);
  assert.doesNotMatch(lifeAudit, /Program ended/, 'the reason text stays out of the audit staff can read');

  // ---- history and delete ----------------------------------------------------
  const empty = ((await q(`INSERT INTO access_code (code, partner_name, tier) VALUES ('PGLIFE03', 'Made By Mistake', 'client') RETURNING id`)).rows[0] as { id: string }).id;
  const hist = (who: string, o: string) => one({ userId: who }, `SELECT smr_admin_org_history($1::uuid) AS h`, [o]);
  assert.equal(await hist(owner, empty), null, 'only a platform admin reads history');
  assert.deepEqual(await hist(platform, empty), {}, 'a fresh organization has none (its own setup audit does not count)');
  const orgHist = await hist(platform, org) as Record<string, number>;
  assert.ok(orgHist.org_staff >= 1 && orgHist.org_staff_invite >= 1 && orgHist.audited_changes >= 1, JSON.stringify(orgHist));
  const del = (who: string, o: string, name: string) => one({ userId: who }, `SELECT smr_admin_delete_org($1::uuid, $2) AS r`, [o, name]);
  assert.equal(await del(owner, empty, 'Made By Mistake'), 'refused', 'only a platform admin deletes');
  assert.equal(await del(platform, empty, 'Made By Mistak'), 'name_mismatch');
  const used = ((await q(`INSERT INTO access_code (code, partner_name, tier) VALUES ('PGLIFE04', 'Used Once', 'client') RETURNING id`)).rows[0] as { id: string }).id;
  await q(`INSERT INTO partner_usage_event (code, endpoint) VALUES ('PGLIFE04', '/api/forge')`);
  assert.deepEqual(await hist(platform, used), { partner_usage_event: 1 }, 'usage recorded against the code is history');
  assert.equal(await del(platform, used, 'Used Once'), 'has_history');
  assert.equal(await del(platform, org, 'Southside Bridge (Demo)'), 'has_history', 'an organization with history is closed, never deleted');
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [member, orgB]);
  assert.equal(await del(platform, orgB, 'Other Program Renamed (Demo)'), 'has_history', 'one member is history');
  assert.equal(await del(platform, empty, ' Made By Mistake '), 'ok');
  assert.equal((await q(`SELECT count(*)::int AS n FROM access_code WHERE id = $1`, [empty])).rows[0]?.n, 0, 'gone');
  assert.equal((await q(`SELECT count(*)::int AS n FROM org_audit WHERE org_id = $1 AND action = 'DELETE' AND actor = $2`, [empty, platform])).rows[0]?.n, 1, 'and the delete is recorded');
  assert.equal(await del(platform, empty, 'Made By Mistake'), 'not_found');
  await db.close();
});

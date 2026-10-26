/**
 * Real SQL for organization structure (migration 103, house lane L3a): the
 * exact statements orgStructure.ts runs, against migrations 001-099 plus 103
 * in pglite, as the NOSUPERUSER app role (RLS on).
 *
 * Proves: only the owner or an org admin shapes the structure (never staff,
 * another org, or a platform admin acting for the org); depth 4, no cycles,
 * one open name per parent, close only when empty, never a delete; staff only
 * in units; the enrollment writer rule (volunteers out); REACH on every
 * enrollment row and on writes (nobody enrolls a stranger to widen their own
 * reach); a unit member reaches the people enrolled there and a lead reaches
 * the units below, a viewer and an outsider reach nobody; status moves, exit
 * dates and reasons; leaving an org exits its enrollments; removing a staff
 * member drops their unit seats; the label rule on words; the activity log
 * when 102's table exists (never the program id); 103 re-applies cleanly and
 * keeps a 102-style function's argument names; existing volunteers gain the
 * new deny.
 *
 * Run it alone (pglite files in one process are flaky). Skipped unless
 * SMR_PGLITE_DIR points at a node_modules folder holding @electric-sql/pglite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ORG_STRUCTURE_SQL as Q } from '@crucible/core/src/orgStructure';
import { CLIENT_HEADER_WHO_SQL } from '@crucible/core/src/orgClientView';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite structure test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

test('org structure: profile, units, unit staff, enrollments, reach', { skip, timeout: 240_000 }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  await db.exec(`CREATE ROLE smr_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO smr_app;`);
  const apply = async (f: string) => db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;');
  // Everything before 103 that is in the tree: 001-099 today, plus 100-102 once the
  // house lanes are merged (then 103 takes its 102 path: replace the hook only).
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) < 103).sort()) {
    try { await apply(f); } catch { await db.exec('ROLLBACK').catch(() => {}); } // 088-091 refuse on their own guards; unrelated
  }
  const had102 = ((await db.query(`SELECT to_regprocedure('public.smr_staff_unit_reach(uuid, uuid, uuid)') IS NOT NULL AS h`)).rows[0] as { h: boolean }).h;
  const q = (t: string, p: unknown[] = []) => db.query(t, p);
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const [owner, admin, cmA, cmB, lead, viewer, cmC, vol, otherOwner, platform, p1, p2, p3, p4] = Array.from({ length: 14 }, (_, i) => id(i + 1));
  for (const u of [owner, admin, cmA, cmB, lead, viewer, cmC, vol, otherOwner, platform, p1, p2, p3, p4]) {
    await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `${u}@x.test`, `Person ${u.slice(-2)}`]);
  }
  const org = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2) VALUES ('PGSTRUCT1', 'Hope House (Demo)', 'client', $1, true) RETURNING id`, [owner])).rows[0] as { id: string }).id;
  const org2 = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id) VALUES ('PGSTRUCT2', 'Other Org (Demo)', 'client', $1) RETURNING id`, [otherOwner])).rows[0] as { id: string }).id;
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'staff'), ($1, $4, 'staff'), ($1, $5, 'staff'), ($1, $6, 'staff'), ($1, $7, 'staff'), ($1, $8, 'staff')`,
    [org, admin, cmA, cmB, lead, viewer, cmC, vol]);
  for (const p of [p1, p2, p4]) await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [p, org]);
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [p3, org2]);
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id) VALUES ($1, $2, $3), ($1, $4, $5)`, [org, p1, cmA, p4, vol]);
  await q(`INSERT INTO platform_admin (user_id) VALUES ($1)`, [platform]).catch(async () => q(`INSERT INTO platform_admin (user_id, note) VALUES ($1, 'test')`, [platform]));
  // A volunteer made before 103: the preset's two staff-role denies.
  await q(`INSERT INTO org_capability_override (org_id, user_id, capability, effect) VALUES ($1, $2, 'org.participant.invite', 'deny'), ($1, $2, 'org.outcome.write', 'deny')`, [org, vol]);

  await apply('103_org_structure.sql');
  await apply('103_org_structure.sql').catch(() => assert.fail('103 must apply twice'));
  // Re-run for real (the ledger row makes apply() a no-op in a runner, not here: exec runs the file again).
  await db.exec(readFileSync(MIG + '103_org_structure.sql', 'utf8').replace(/^SET LOCAL.*$/m, ''));

  const defs = (await q(`SELECT proname, pg_get_functiondef(oid) AS d FROM pg_proc WHERE proname IN ('smr_staff_reach', 'smr_staff_unit_reach')`)).rows as { proname: string; d: string }[];
  assert.equal(defs.length, 2, 'one reach function and one unit hook');
  assert.ok(defs.find((x) => x.proname === 'smr_staff_reach')!.d.includes('smr_staff_unit_reach'), 'reach goes through the hook');
  assert.ok(defs.find((x) => x.proname === 'smr_staff_unit_reach')!.d.includes('unit_member'), "the hook is 103's, not 102's placeholder");
  console.log(`  (103 applied on ${had102 ? 'top of 102: hook path' : '099: standalone reach'})`);
  const delegable = ((await q(`SELECT public.smr_delegable_capabilities() AS l`)).rows[0] as { l: string[] }).l;
  assert.equal(delegable.filter((c) => c === 'org.enrollment.write').length, 1, 'appended once, however often 103 runs');
  assert.ok(delegable.includes('org.suggest.write'), 'the earlier list is kept');
  const volDeny = (await q(`SELECT effect FROM org_capability_override WHERE org_id = $1 AND user_id = $2 AND capability = 'org.enrollment.write'`, [org, vol])).rows as { effect: string }[];
  assert.deepEqual(volDeny.map((r) => r.effect), ['deny'], 'an existing volunteer gains the new deny');
  assert.equal((await q(`SELECT count(*)::int AS n FROM org_capability_override WHERE capability = 'org.enrollment.write'`)).rows[0]!.n, 1, 'and nobody else does');
  assert.equal(((await q(`SELECT count(*)::int AS n FROM org_audit WHERE org_id = $1 AND row_summary->>'capability' = 'org.enrollment.write'`, [org])).rows[0] as { n: number }).n, 1, 'audited once');

  const priv = async (t: string, p: string) => ((await q(`SELECT has_table_privilege('smr_app', $1, $2) AS ok`, [t, p])).rows[0] as { ok: boolean }).ok;
  assert.deepEqual([await priv('org_unit', 'DELETE'), await priv('enrollment', 'DELETE'), await priv('org_profile', 'DELETE'), await priv('unit_member', 'DELETE')], [false, false, false, true]);

  // Without 102: an activity table and writer shaped like 102's, so the logging path runs.
  if (!had102) {
    await q(`CREATE TABLE org_activity (id bigserial PRIMARY KEY, access_code_id uuid NOT NULL, actor_user_id uuid, participant_user_id uuid, staff_user_id uuid,
      entity text NOT NULL, entity_id text, action text NOT NULL, summary text NOT NULL CHECK (length(summary) BETWEEN 3 AND 200), at timestamptz NOT NULL DEFAULT now())`);
    await q(`REVOKE ALL ON org_activity FROM smr_app`);
    await q(`CREATE FUNCTION public.org_activity_write(p_org uuid, p_participant uuid, p_staff uuid, p_entity text, p_entity_id text, p_action text, p_summary text)
      RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO public.org_activity (access_code_id, actor_user_id, participant_user_id, staff_user_id, entity, entity_id, action, summary)
      VALUES (p_org, NULLIF(current_setting('app.user_id', true), '')::uuid, p_participant, p_staff, p_entity, p_entity_id, p_action, p_summary) $$`);
    await q(`REVOKE ALL ON FUNCTION public.org_activity_write(uuid, uuid, uuid, text, text, text, text) FROM PUBLIC`);
  }

  type Who = { orgId?: string; userId?: string; role?: string };
  const as = async (who: Who, text: string, params: unknown[] = []) => {
    await db.exec('BEGIN; SET LOCAL ROLE smr_app;');
    try {
      if (who.orgId) await db.query(`SELECT set_config('app.org_id', $1, true), set_config('app.org_role', $2, true)`, [who.orgId, who.role ?? 'staff']);
      if (who.userId) await db.query(`SELECT set_config('app.user_id', $1, true)`, [who.userId]);
      const r = await db.query(text, params);
      await db.exec('COMMIT');
      return r.rows as Record<string, unknown>[];
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  };
  const err = async (p: Promise<unknown>): Promise<string> => { try { const r = await p; return Array.isArray(r) && r.length === 0 ? 'no rows' : 'OK'; } catch (e) { return String((e as Error).message); } };
  const refused = async (p: Promise<unknown>) => (await err(p)) !== 'OK';
  const O = { orgId: org, userId: owner, role: 'owner' };
  const at = (u: string, role = 'staff') => ({ orgId: org, userId: u, role });

  // ---- profile ---------------------------------------------------------------
  const prof = (terms: object, done = false) => [org, 'reentry_nonprofit', null, 'America/Chicago', JSON.stringify(terms), JSON.stringify({ sites: true }), done];
  assert.ok(await refused(as(at(cmA), Q.upsertProfile, prof({}))), 'staff cannot write the profile');
  assert.ok(await refused(as({ orgId: org, userId: platform, role: 'owner' }, Q.upsertProfile, prof({}))), 'a platform admin acting as owner cannot');
  assert.ok(await refused(as({ orgId: org, userId: otherOwner, role: 'owner' }, Q.upsertProfile, prof({}))), 'another org owner with this org in scope cannot');
  assert.match(await err(as(O, Q.upsertProfile, prof({ participants: 'Offenders' }))), /names the person, not their record/, 'the label rule holds in the database');
  assert.match(await err(as(O, Q.upsertProfile, prof({ nickname: 'x' }))), /unknown word key/);
  assert.match(await err(as(O, Q.upsertProfile, [org, 'reentry_nonprofit', null, 'Mars/Base', '{}', '{}', false])), /time zone/i);
  assert.match(await err(as(O, Q.upsertProfile, [org, 'bank', null, 'America/Chicago', '{}', '{}', false])), /check constraint/);
  assert.equal((await as(O, Q.upsertProfile, prof({ participant: 'resident', participants: 'residents' }, true))).length, 1, 'the owner saves');
  assert.equal((await as(at(admin, 'org_admin'), Q.upsertProfile, prof({ participant: 'resident', participants: 'residents', site: 'house' }, true))).length, 1, 'an org admin may too (the route asks for org.settings.manage)');
  const p0 = (await q(`SELECT updated_by, setup_completed_at FROM org_profile WHERE access_code_id = $1`, [org])).rows[0] as { updated_by: string; setup_completed_at: string };
  assert.equal(p0.updated_by, admin, 'updated_by is set by the database');
  assert.ok(p0.setup_completed_at);
  const readTerms = async (who: Who) => ((await as(who, Q.readProfile, [org]))[0]?.terminology as Record<string, string> | undefined)?.participant ?? null;
  assert.equal(await readTerms({ userId: p1 }), 'resident', 'a member reads the words');
  assert.equal(await readTerms({ userId: cmC }), 'resident', 'any staff member reads them');
  assert.equal(await readTerms({ userId: p3 }), null, 'a member of another org does not');
  assert.equal(await readTerms({ orgId: org2, userId: otherOwner, role: 'owner' }), null, "another org's scope does not");
  assert.equal(await readTerms({}), null, 'nobody unscoped');

  // ---- units -----------------------------------------------------------------
  const U = { S: id(101), X: id(102), C: id(103), Y: id(104), D: id(105), E: id(106), Z: id(107) };
  const unit = (uid: string, parent: string | null, kind: string, name: string) => [org, uid, parent, kind, name, null, null, null, null, null];
  assert.ok(await refused(as(at(cmA), Q.insertUnit, unit(U.S, null, 'site', 'Main site'))), 'staff cannot add a unit');
  assert.ok(await refused(as({ orgId: org, userId: platform, role: 'owner' }, Q.insertUnit, unit(U.S, null, 'site', 'Main site'))), 'a platform admin acting for the org cannot');
  assert.ok(await refused(as({ orgId: org2, userId: otherOwner, role: 'owner' }, Q.insertUnit, [org2, U.S, null, 'site', 'Theirs', null, null, null, null, null].map((v, i) => (i === 0 ? org : v)))), 'another org cannot write into this one');
  await as(O, Q.insertUnit, unit(U.S, null, 'site', 'Main site'));
  await as(O, Q.insertUnit, unit(U.X, U.S, 'program', 'Job readiness'));
  await as(O, Q.insertUnit, unit(U.C, U.X, 'cohort', 'Fall cohort'));
  await as(at(admin, 'org_admin'), Q.insertUnit, unit(U.Y, null, 'program', 'Case management'));
  await as(O, Q.insertUnit, unit(U.D, U.C, 'team', 'Level four'));
  assert.match(await err(as(O, Q.insertUnit, unit(U.E, U.D, 'team', 'Level five'))), /at most 4 levels/, 'a fifth level is refused');
  assert.match(await err(as(O, Q.insertUnit, unit(U.E, null, 'program', 'job READINESS '))), /OK/, 'same name at another level is fine');
  assert.match(await err(as(O, Q.insertUnit, unit(U.Z, U.S, 'program', ' JOB readiness'))), /duplicate key/, 'one open name per parent, case and spaces ignored');
  assert.match(await err(as(O, Q.moveUnit, [org, U.S, U.C])), /inside itself/, 'no cycles');
  assert.match(await err(as(O, Q.moveUnit, [org, U.Y, U.D])), /at most 4 levels/, 'a move cannot make a fifth level');
  assert.match(await err(as(O, Q.moveUnit, [org, U.S, U.Y])), /at most 4 levels/, 'moving a four-level branch under a top unit would make five');
  assert.match(await err(as({ orgId: org2, userId: otherOwner, role: 'owner' }, Q.moveUnit, [org2, U.X, null])), /no rows/, 'another org sees nothing to move');
  assert.ok(await refused(as(O, `DELETE FROM org_unit WHERE id = $1 RETURNING id`, [U.D])), 'a unit is never deleted');
  assert.match(await err(as(O, Q.setUnitStatus, [org, U.C, 'closed'])), /units inside it first/, 'close inside out');
  assert.equal((await as(O, Q.setUnitStatus, [org, U.D, 'closed'])).length, 1, 'an empty unit closes');
  const closed = (await q(`SELECT closed_at, closed_by FROM org_unit WHERE id = $1`, [U.D])).rows[0] as { closed_at: string; closed_by: string };
  assert.ok(closed.closed_at && closed.closed_by === owner, 'closed_at and closed_by are set by the database');
  await as(O, Q.insertUnit, unit(U.Z, U.C, 'team', 'Level four'));
  assert.match(await err(as(O, Q.setUnitStatus, [org, U.D, 'active'])), /duplicate key/, 'reopening into a name now taken is refused');
  assert.match(await err(as(O, Q.insertUnit, unit(id(108), U.D, 'team', 'Under closed'))), /closed/, 'nothing new under a closed unit');
  const seen = async (who: Who) => (await as(who, Q.listUnits, [org])).length;
  assert.equal(await seen(at(cmC)), 7, 'all staff see the tree');
  assert.equal(await seen({ orgId: org2, userId: otherOwner, role: 'owner' }), 0, 'another org sees none of it');
  assert.equal(await seen({ userId: p1 }), 0, 'a participant sees none of it');

  // ---- unit staff ------------------------------------------------------------
  await as(O, Q.upsertMember, [org, U.X, cmB, 'member']);
  await as(O, Q.upsertMember, [org, U.S, lead, 'lead']);
  await as(at(admin, 'org_admin'), Q.upsertMember, [org, U.X, viewer, 'viewer']);
  assert.ok(await refused(as(at(cmC), Q.upsertMember, [org, U.X, cmC, 'member'])), 'staff cannot put themselves in a unit (it would widen their reach)');
  assert.match(await err(as(O, Q.upsertMember, [org, U.X, p1, 'member'])), /only staff/, 'a participant is never unit staff');
  assert.match(await err(as(O, Q.upsertMember, [org, U.X, otherOwner, 'member'])), /only staff/, "another org's people cannot be added");
  assert.match(await err(as(O, Q.upsertMember, [org, U.D, cmA, 'member'])), /closed/, 'not into a closed unit');
  assert.match(await err(as(O, Q.upsertMember, [org, U.X, cmA, 'boss'])), /check constraint/);
  assert.equal((await as(at(cmC), Q.listMembers, [org])).length, 3, 'staff see who works where');

  // ---- enrollments -----------------------------------------------------------
  const enr = (unitId: string, p: string, status = 'enrolled', pid: string | null = null) => [org, unitId, p, status, null, pid, null];
  assert.match(await err(as(at(cmC), Q.insertEnrollment, enr(U.X, p2))), /row-level security/, 'staff who do not reach someone cannot enroll them');
  assert.match(await err(as(at(cmC), Q.insertEnrollment, enr(U.X, p1))), /row-level security/, 'nor anyone assigned to a colleague');
  assert.match(await err(as(at(vol), Q.insertEnrollment, enr(U.Y, p4))), /row-level security/, 'a volunteer cannot enroll even their own person');
  assert.match(await err(as({ orgId: org, userId: platform, role: 'owner' }, Q.insertEnrollment, enr(U.X, p2))), /row-level security/, 'a platform admin acting for the org cannot');
  assert.match(await err(as(O, Q.insertEnrollment, enr(U.S, p2))), /program, cohort or caseload/, 'not into a site');
  assert.match(await err(as(O, Q.insertEnrollment, enr(U.X, p3))), /row-level security|not joined/, 'not someone from another org');
  assert.match(await err(as(O, Q.insertEnrollment, enr(U.X, p2, 'completed'))), /starts as/);
  assert.match(await err(as(O, Q.insertEnrollment, enr(U.X, p2, 'enrolled', 'DOC#12'))), /check constraint/, 'the own-id field takes plain characters only');
  const e2 = (await as(O, Q.insertEnrollment, enr(U.X, p2, 'active', 'HH-0042')))[0].id as string;
  const e1 = (await as(at(cmA), Q.insertEnrollment, enr(U.Y, p1)))[0].id as string;
  assert.match(await err(as(O, Q.insertEnrollment, enr(U.X, p2))), /duplicate key/, 'one open enrollment per person per unit');
  const created = (await q(`SELECT created_by, enrolled_on FROM enrollment WHERE id = $1`, [e1])).rows[0] as { created_by: string; enrolled_on: string };
  assert.equal(created.created_by, cmA, 'created_by is the actor');
  assert.ok(created.enrolled_on, 'enrolled_on is filled');

  const list = async (who: Who, participant: string | null = null) =>
    (await as(who, Q.listEnrollments, [org, participant, null, true])).map((r) => r.participant_user_id as string).sort();
  assert.deepEqual(await list(O), [p1, p2].sort(), 'the owner reaches everyone');
  assert.deepEqual(await list(at(admin, 'org_admin')), [p1, p2].sort(), 'an org admin reaches everyone');
  assert.deepEqual(await list(at(cmA)), [p1], 'assigned staff reach their own person only');
  assert.deepEqual(await list(at(cmB)), [p2], 'a unit member reaches the people enrolled in that unit');
  assert.deepEqual(await list(at(lead)), [p2], 'a site lead reaches the programs below');
  assert.deepEqual(await list(at(viewer)), [], 'a viewer reaches nobody');
  assert.deepEqual(await list(at(cmC)), [], 'an outsider on staff reaches nobody');
  assert.deepEqual(await list({ orgId: org2, userId: otherOwner, role: 'owner' }), [], 'another org reaches nobody');
  assert.deepEqual(await list({ orgId: org, userId: otherOwner, role: 'owner' }), [], 'even with this org id in its scope');
  assert.deepEqual(await list({ orgId: org, userId: platform, role: 'owner' }), [], 'a platform admin acting for the org sees no participant records');
  assert.deepEqual(await list({ userId: p2 }), [], 'unscoped, nothing');
  assert.equal((await as(at(cmB), `SELECT count(*)::int AS n FROM enrollment`))[0].n, 1, 'a raw read that forgets its WHERE still returns only reached rows');
  // Reach answers only inside the caller's own organization scope (102's rule).
  const reach = async (s: string, p: string) => (await as(at(s), `SELECT smr_staff_reach($1, $2, $3) AS r`, [org, s, p]))[0].r as boolean;
  assert.equal(((await q(`SELECT smr_staff_reach($1, $2, $3) AS r`, [org, cmB, p2])).rows[0] as { r: boolean }).r, false, 'never an oracle outside the org scope');
  assert.equal(await reach(cmB, p2), true);
  assert.equal(await reach(cmB, p1), false);
  assert.equal(await reach(viewer, p2), false);
  assert.equal(await reach(cmA, p1), true, '102 conditions kept: assigned');
  // The app's own second wall agrees (orgClientView IN_REACH, the person page header).
  const header = async (s: string, p: string) => (await as(at(s), CLIENT_HEADER_WHO_SQL, [p, org, false, s])).length;
  assert.equal(await header(cmB, p2), 1, 'a unit member opens the person page of someone enrolled in their unit');
  assert.equal(await header(lead, p2), 1, 'so does the site lead above it');
  assert.equal(await header(viewer, p2), 0, 'a viewer does not');
  assert.equal(await header(cmC, p2), 0, 'nor an outsider');
  assert.equal(await header(cmB, p1), 0, 'nor a unit member, for someone not enrolled there');
  assert.equal(await reach(owner, p4), true, '102 conditions kept: owner');
  assert.equal(await reach(admin, p4), true, '102 conditions kept: org admin');

  // ---- status moves ----------------------------------------------------------
  assert.equal((await as(at(cmB), Q.moveEnrollment, [org, e2, 'paused', 'needs_a_pause'])).length, 1, 'a unit member moves an enrollment they reach');
  assert.equal(await reach(cmB, p2), true, 'paused still reaches');
  assert.match(await err(as(at(cmB), Q.moveEnrollment, [org, e2, 'referred', null])), /cannot go from paused to referred/);
  assert.ok(await refused(as(at(cmC), Q.moveEnrollment, [org, e1, 'paused', 'other'])), 'an outsider cannot touch it');
  assert.ok(await refused(as(at(cmB), `UPDATE enrollment SET participant_user_id = $2 WHERE id = $1 RETURNING id`, [e2, p1])), 'cannot move to another person');
  await as(at(cmB), Q.moveEnrollment, [org, e2, 'exited', 'moved_away']);
  const ex = (await q(`SELECT status, exited_on, exit_reason FROM enrollment WHERE id = $1`, [e2])).rows[0] as { exited_on: string; exit_reason: string };
  assert.ok(ex.exited_on && ex.exit_reason === 'moved_away', 'exit date and reason are kept');
  assert.equal(await reach(cmB, p2), false, 'an ended enrollment reaches nobody');
  assert.deepEqual(await list(at(cmB)), [], 'and its row is gone from their view');
  assert.equal((await as(O, Q.moveEnrollment, [org, e2, 'active', null])).length, 1, 'the owner reopens a mistake');
  assert.equal(await reach(cmB, p2), true);
  const reopened = (await q(`SELECT exited_on, exit_reason FROM enrollment WHERE id = $1`, [e2])).rows[0] as { exited_on: string | null };
  assert.equal(reopened.exited_on, null);
  assert.ok(await refused(as(O, `DELETE FROM enrollment WHERE id = $1 RETURNING id`, [e2])), 'an enrollment is never deleted');
  assert.match(await err(as(O, Q.setUnitStatus, [org, U.Y, 'closed'])), /still enrolled/, 'a unit with people in it cannot close');

  // ---- details ---------------------------------------------------------------
  assert.equal((await as(O, Q.updateEnrollment, [org, e2, cmB, 'HH-0043', null])).length, 1);
  assert.match(await err(as(O, Q.updateEnrollment, [org, e2, p1, null, null])), /primary staff member/, 'the primary staff member is on staff');

  // ---- leaving and removal ---------------------------------------------------
  await q(`DELETE FROM org_staff WHERE access_code_id = $1 AND user_id = $2`, [org, cmB]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM unit_member WHERE user_id = $1`, [cmB])).rows[0]!.n, 0, 'a removed staff member leaves every unit');
  assert.equal((await q(`SELECT primary_staff_id FROM enrollment WHERE id = $1`, [e2])).rows[0]!.primary_staff_id, null, 'and is nobody\'s primary staff member');
  assert.equal(await reach(cmB, p2), false, 'and reaches nobody');
  await q(`DELETE FROM access_code_redemption WHERE user_id = $1 AND access_code_id = $2`, [p2, org]);
  const left = (await q(`SELECT status, exit_reason FROM enrollment WHERE id = $1`, [e2])).rows[0] as { status: string; exit_reason: string };
  assert.deepEqual([left.status, left.exit_reason], ['exited', 'left_organization'], 'leaving the organization ends its enrollments');
  assert.equal(await reach(lead, p2), false);

  // ---- activity --------------------------------------------------------------
  const acts = (await q(`SELECT entity, action, summary, actor_user_id, participant_user_id FROM org_activity WHERE access_code_id = $1 ORDER BY id`, [org])).rows as
    { entity: string; action: string; summary: string; actor_user_id: string | null; participant_user_id: string | null }[];
  const text = JSON.stringify(acts);
  assert.ok(acts.some((a) => a.entity === 'unit' && a.action === 'created' && a.summary === 'added a program'), text);
  assert.ok(acts.some((a) => a.entity === 'unit' && a.action === 'closed' && a.summary === 'closed a team'), 'closing is logged');
  assert.ok(acts.some((a) => a.entity === 'unit' && a.action === 'assigned' && a.summary === 'added a staff member to a site as lead'), 'unit staff changes are logged');
  assert.ok(acts.some((a) => a.entity === 'unit' && a.action === 'unassigned'), 'removal is logged');
  assert.ok(acts.some((a) => a.entity === 'enrollment' && a.action === 'status_changed' && a.summary === 'moved an enrollment in a program from paused to exited (moved away)'
    && a.participant_user_id === p2 && a.actor_user_id === cmB), text);
  assert.ok(acts.some((a) => a.entity === 'enrollment' && a.action === 'reopened'));
  assert.ok(acts.some((a) => a.entity === 'enrollment' && /left the organization/.test(a.summary)));
  assert.ok(acts.some((a) => a.entity === 'org' && a.summary === 'finished setup as reentry nonprofit'));
  for (const typed of ['HH-0042', 'HH-0043', 'Job readiness', 'Main site', 'Fall cohort', 'Person ']) assert.ok(!text.includes(typed), `nothing typed reaches the log: ${typed}`);
  assert.ok(await refused(as(O, `INSERT INTO org_activity (access_code_id, entity, action, summary) VALUES ($1, 'unit', 'created', 'forged') RETURNING id`, [org])), 'the app cannot forge a log row');
  assert.ok(await refused(as(O, `SELECT public.smr_structure_activity($1, NULL, NULL, 'unit', NULL, 'created', 'forged')`, [org])), 'nor through the 103 writer');
  assert.ok(await refused(as(O, `SELECT public.org_activity_write($1, NULL, NULL, 'unit', NULL, 'created', 'forged')`, [org])), 'nor through the 102 writer');

  // ---- an organization deleted with all of this still goes cleanly ----------
  await q(`DELETE FROM access_code_redemption WHERE access_code_id = $1`, [org]); // redemptions do not cascade (006); the org delete path removes them first
  await q(`DELETE FROM access_code WHERE id = $1`, [org]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM org_unit`)).rows[0]!.n, 0, 'units go with their organization');
});

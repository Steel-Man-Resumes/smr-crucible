/**
 * Real SQL for migration 102 (house lane L3b): reach in row policies, the
 * organization activity log, and the outcome audit trail. Migrations 001-102
 * in pglite, with the app role (smr_app, NOSUPERUSER, NOBYPASSRLS) created
 * BEFORE them so every migration's own revoke-then-grant block really runs,
 * then each statement as smr_app with the scope runScoped / runAsUser set.
 *
 * What it proves, against raw scoped queries (no app-level IN_REACH):
 *   a volunteer cannot read an unassigned person's note, note version, task,
 *   placement, retention check, suggestion, ask or activity, and cannot write
 *   one; the assigned staff member, an org admin and the owner can; someone
 *   granted "see everyone" can and someone denied it cannot; another org gets
 *   nothing, even when it forges the org scope; the participant still reads
 *   what is theirs; the app cannot write, edit or erase the activity log; a
 *   retention correction is a new row and the old one stays; a placement
 *   correction needs a reason and keeps every earlier value.
 *
 * Also runs the exact statements orgOutcomes.ts and orgActivity.ts send.
 * Run it alone (several pglite files in one process are flaky). Skipped unless
 * SMR_PGLITE_DIR points at a node_modules folder holding @electric-sql/pglite
 * (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { OUTCOME_SQL } from '@crucible/core/src/orgOutcomes';
import { ACTIVITY_SQL } from '@crucible/core/src/orgActivity';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite reach test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

type Row = Record<string, unknown>;

test('102: reach in policy, append-only activity, outcome corrections', { skip }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  await db.exec(`CREATE ROLE smr_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO smr_app;`);
  const failed: string[] = [];
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 102).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); }
    catch { await db.exec('ROLLBACK').catch(() => {}); failed.push(f); } // 088-091 resource chain refuses on its own guards; unrelated tables
  }
  for (const need of ['051_sharing.sql', '055_staff_tasks.sql', '056_outcomes.sql', '057_staff_suggestions.sql', '096_refinery_access.sql', '102_reach_activity_audit.sql']) {
    assert.ok(!failed.includes(need), `${need} must apply; failed: ${failed.join(', ')}`);
  }
  // Idempotent: a second apply of 102 changes nothing and does not fail.
  await db.exec('BEGIN;' + readFileSync(MIG + '102_reach_activity_audit.sql', 'utf8') + ';COMMIT;');

  const q = async (t: string, p: unknown[] = []) => (await db.query(t, p)).rows as Row[];

  // A FRESH database: the app role is created AFTER the migrations (rls-stage1), so 102's
  // "if smr_app exists, grant EXECUTE" block never ran for it. restricted-grants.mjs must
  // grant the reach functions, or every scoped read of a protected table would fail.
  const grantsLib = await import(new URL('../../../../scripts/lib/restricted-grants.mjs', import.meta.url).href);
  await db.exec(`CREATE ROLE fresh_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO fresh_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fresh_app;`);
  const runText = async (t: string) => (await db.query(t)).rows as Row[];
  await grantsLib.applyRestrictedGrants(runText, 'fresh_app');
  const mine = ((await grantsLib.checkRestrictedGrants(runText, 'fresh_app')) as string[])
    .filter((x) => /org_activity|outcome_correction|retention_check|smr_|forge the activity/.test(x));
  assert.deepEqual(mine, [], 'a fresh app role ends up with exactly the 102 grants');
  await db.exec(`BEGIN; SET LOCAL ROLE fresh_app; SELECT set_config('app.org_id', '00000000-0000-0000-0000-00000000ffff', true);
    SELECT set_config('app.user_id', '00000000-0000-0000-0000-00000000fffe', true); SELECT count(*) FROM case_note; COMMIT;`);
  /** As smr_app: org scope + user (runScoped), or the user only (runAsUser). Several statements, one transaction; returns the last result. */
  const as = async (who: { orgId?: string; userId?: string }, stmts: [string, unknown[]?][] | string, params: unknown[] = []) => {
    const list: [string, unknown[]?][] = typeof stmts === 'string' ? [[stmts, params]] : stmts;
    await db.exec('BEGIN; SET LOCAL ROLE smr_app;');
    try {
      if (who.orgId) await db.query(`SELECT set_config('app.org_id', $1, true), set_config('app.org_role', 'staff', true)`, [who.orgId]);
      if (who.userId) await db.query(`SELECT set_config('app.user_id', $1, true)`, [who.userId]);
      let last: Row[] = [];
      for (const [t, p] of list) last = (await db.query(t, p ?? [])).rows as Row[];
      await db.exec('COMMIT');
      return last;
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  };
  const err = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return String((e as Error).message); } };
  const n = async (who: { orgId?: string; userId?: string }, text: string, params: unknown[] = []) => Number((await as(who, text, params))[0]?.n ?? -1);

  const id = (k: number) => `00000000-0000-0000-0000-${String(k).padStart(12, '0')}`;
  const [owner, admin, vol, cm, seer, deniedAdmin, p1, p2, spy, spyStaff] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id);
  for (const u of [owner, admin, vol, cm, seer, deniedAdmin, p1, p2, spy, spyStaff]) {
    await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `${u}@x.test`, `Account ${u.slice(-2)}`]);
  }
  const orgA = (await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2) VALUES ('PGREACH1', 'Reach org', 'client', $1, true) RETURNING id`, [owner]))[0].id as string;
  const orgB = (await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2) VALUES ('PGREACH2', 'Other org', 'client', $1, true) RETURNING id`, [spy]))[0].id as string;
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'staff'), ($1, $4, 'staff'), ($1, $5, 'staff'), ($1, $6, 'org_admin'), ($7, $8, 'staff')`,
    [orgA, admin, vol, cm, seer, deniedAdmin, orgB, spyStaff]);
  // The volunteer preset as exceptions (capabilities.ts STAFF_PRESETS.volunteer), a "see everyone" grant, and an admin denied it.
  await q(`INSERT INTO org_capability_override (org_id, user_id, capability, effect) VALUES
    ($1, $2, 'org.client.view_all', 'deny'), ($1, $2, 'org.outcome.write', 'deny'), ($1, $2, 'org.participant.invite', 'deny'),
    ($1, $3, 'org.client.view_all', 'grant'), ($1, $4, 'org.client.view_all', 'deny')`, [orgA, vol, seer, deniedAdmin]);
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $3), ($2, $3)`, [p1, p2, orgA]);
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $3, $5), ($1, $4, $6, $5)`, [orgA, p1, vol, p2, owner, cm]);

  const A = (u: string) => ({ orgId: orgA, userId: u });

  // ---- the assigned case manager writes a full record about p2 (WITH CHECK admits them)
  const note = (await as(A(cm), `INSERT INTO case_note (access_code_id, client_user_id, author_user_id, kind, body) VALUES ($1, $2, $3, 'call', 'SECRET-BODY-TEXT on probation') RETURNING id`, [orgA, p2, cm]))[0].id as string;
  await as(A(cm), `UPDATE case_note SET body = 'SECRET-BODY-TEXT corrected' WHERE id = $1`, [note]);
  const task = (await as(A(cm), `INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title, shared_with_participant) VALUES ($1, $2, $3, $3, 'SECRET-TASK-TITLE parole office', true) RETURNING id`, [orgA, p2, cm]))[0].id as string;
  const outcome = (await as(A(cm), `INSERT INTO outcome_record (access_code_id, client_user_id, employer, start_date, source, created_by) VALUES ($1, $2, 'SECRET-EMPLOYER', current_date - 100, 'staff_reported', $3) RETURNING id`, [orgA, p2, cm]))[0].id as string;
  const check = (await as(A(cm), OUTCOME_SQL.addCheck, [orgA, false, cm, outcome, 30, 'employed', 'participant_told_me', 'SECRET-CHECK-NOTE']))[0].id as string;
  assert.ok(check, 'the assigned case manager records a check through the app statement');
  assert.equal((await as(A(cm), OUTCOME_SQL.addCheck, [orgA, false, cm, outcome, 30, 'not_employed', 'participant_told_me', null])).length, 0, 'and a second answer to the same mark is quietly refused (current-answer index)');
  await as(A(cm), `INSERT INTO staff_suggestion (access_code_id, client_user_id, author_user_id, kind, job_title, company, body) VALUES ($1, $2, $3, 'job', 'Prep Cook', 'River Cafe', 'SECRET-SUGGESTION-BODY')`, [orgA, p2, cm]);
  await as(A(cm), `INSERT INTO sharing_request (access_code_id, user_id, scope, requested_by, reason) VALUES ($1, $2, 'resume', $3, 'SECRET-ASK-REASON')`, [orgA, p2, cm]);

  // ---- 1. the volunteer, by raw scoped query, sees nothing about p2
  const V = A(vol);
  for (const [label, sql] of [
    ['note', `SELECT count(*)::int AS n FROM case_note WHERE client_user_id = '${p2}'`],
    ['note version', `SELECT count(*)::int AS n FROM case_note_version WHERE note_id = '${note}'`],
    ['task', `SELECT count(*)::int AS n FROM staff_task WHERE client_user_id = '${p2}'`],
    ['placement', `SELECT count(*)::int AS n FROM outcome_record WHERE client_user_id = '${p2}'`],
    ['retention check', `SELECT count(*)::int AS n FROM retention_check WHERE outcome_id = '${outcome}'`],
    ['suggestion', `SELECT count(*)::int AS n FROM staff_suggestion WHERE client_user_id = '${p2}'`],
    ['ask', `SELECT count(*)::int AS n FROM sharing_request WHERE user_id = '${p2}'`],
    ['activity', `SELECT count(*)::int AS n FROM org_activity WHERE participant_user_id = '${p2}'`],
  ] as const) {
    assert.equal(await n(V, sql), 0, `a volunteer reads no ${label} about someone not assigned to them`);
    assert.ok(await n(A(cm), sql) > 0, `the assigned case manager reads the ${label}`);
    assert.ok(await n(A(admin), sql) > 0, `an org admin reads the ${label}`);
    assert.ok(await n(A(owner), sql) > 0, `the owner reads the ${label}`);
    assert.ok(await n(A(seer), sql) > 0, `staff granted "see everyone" read the ${label}`);
    assert.equal(await n(A(deniedAdmin), sql), 0, `an admin DENIED "see everyone" reads no ${label}`);
    assert.equal(await n({ orgId: orgB, userId: spy }, sql), 0, `another org reads no ${label}`);
    assert.equal(await n({ orgId: orgA, userId: spyStaff }, sql), 0, `another org's staff FORGING this org's scope read no ${label}`);
    assert.equal(await n({ orgId: orgA }, sql), 0, `an org scope with no user reads no ${label}`);
  }
  // ...and the volunteer still works their own caseload.
  await as(V, `INSERT INTO case_note (access_code_id, client_user_id, author_user_id, body) VALUES ($1, $2, $3, 'Met today.')`, [orgA, p1, vol]);
  assert.equal(await n(V, `SELECT count(*)::int AS n FROM case_note WHERE client_user_id = '${p1}'`), 1, 'a volunteer reads and writes notes for their own person');

  // ---- 2. nor write about p2, by any raw route
  assert.match(String(await err(as(V, `INSERT INTO case_note (access_code_id, client_user_id, author_user_id, body) VALUES ($1, $2, $3, 'x')`, [orgA, p2, vol]))), /row-level security/i, 'a volunteer cannot write a note about an unassigned person');
  assert.match(String(await err(as(V, `INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title, shared_with_participant) VALUES ($1, $2, $3, $3, 'x task', true)`, [orgA, p2, vol]))), /row-level security/i, 'nor a task, even one they own');
  assert.match(String(await err(as(V, `INSERT INTO outcome_record (access_code_id, client_user_id, employer, start_date, source, created_by) VALUES ($1, $2, 'X Co', current_date, 'staff_reported', $3)`, [orgA, p2, vol]))), /row-level security/i, 'nor a placement');
  assert.match(String(await err(as(V, `INSERT INTO sharing_request (access_code_id, user_id, scope, requested_by, reason) VALUES ($1, $2, 'applications', $3, 'Let me see it')`, [orgA, p2, vol]))), /row-level security/i, 'nor an ask');
  assert.equal((await as(V, `UPDATE staff_task SET cancelled_at = now() WHERE id = $1 RETURNING id`, [task])).length, 0, 'nor cancel their task');
  assert.equal((await as(V, `UPDATE outcome_record SET ended_on = current_date, end_reason = 'unknown' WHERE id = $1 RETURNING id`, [outcome])).length, 0, 'nor end their placement');
  assert.equal(await n(V, `SELECT count(*)::int AS n FROM staff_task WHERE client_user_id IS NULL`), 0, 'a to-do about nobody is its owner\'s');
  await as(A(cm), `INSERT INTO staff_task (access_code_id, owner_user_id, created_by, title) VALUES ($1, $2, $2, 'Call Job Service back')`, [orgA, cm]);
  assert.equal(await n(A(cm), `SELECT count(*)::int AS n FROM staff_task WHERE client_user_id IS NULL`), 1, 'the owner of a to-do sees it');
  assert.equal(await n(V, `SELECT count(*)::int AS n FROM staff_task WHERE client_user_id IS NULL`), 0, 'a colleague does not');
  assert.equal(await n(A(admin), `SELECT count(*)::int AS n FROM staff_task WHERE client_user_id IS NULL`), 1, 'someone who sees everyone does');

  // ---- 3. the participant still reads what is theirs (no org scope)
  const P = { userId: p2 };
  assert.equal(await n(P, `SELECT count(*)::int AS n FROM staff_task WHERE shared_with_participant`), 1, 'the participant reads the task shared with them');
  assert.equal(await n(P, `SELECT count(*)::int AS n FROM outcome_record`), 1, 'and the placement on file about them');
  assert.equal(await n(P, `SELECT count(*)::int AS n FROM retention_check`), 1, 'and its check-in');
  assert.equal(await n(P, `SELECT count(*)::int AS n FROM sharing_request`), 1, 'and the ask made of them');
  assert.equal(await n(P, `SELECT count(*)::int AS n FROM staff_suggestion`), 1, 'and the suggestion made to them');
  assert.equal(await n(P, `SELECT count(*)::int AS n FROM case_note`), 0, 'and still not a note that was not shown to them');
  assert.equal(await n(P, `SELECT count(*)::int AS n FROM org_activity`), 0, 'and not the organization\'s activity log');
  const ticked = (await as(P, `SELECT smr_tick_my_task($1::uuid, true) AS r`, [task]))[0].r;
  assert.equal(ticked, true, 'the participant can still tick a shared task through its definer function');

  // ---- 4. the reach functions are no oracle outside the caller's own org scope
  assert.equal((await as({ orgId: orgB, userId: spy }, `SELECT smr_staff_sees_all($1, $2) AS r`, [orgA, admin]))[0].r, false, 'asked from another org scope, "sees all" says no');
  assert.match(String(await err(as({ orgId: orgB, userId: spy }, `SELECT smr_org_role($1, $2) AS r`, [orgA, admin]))), /permission denied/i, 'and the app cannot ask who works where at all');
  assert.equal((await as({ orgId: orgB, userId: spy }, `SELECT smr_staff_reach($1, $2, $3) AS r`, [orgA, cm, p2]))[0].r, false, 'asked from another org scope it says no');
  assert.equal((await as(A(cm), `SELECT smr_staff_reach($1, $2, $3) AS r`, [orgA, cm, p2]))[0].r, true, 'asked inside the scope it answers');

  // ---- 5. reassignment moves reach with the person
  await as(A(owner), `UPDATE client_staff_assignment SET staff_user_id = $1 WHERE access_code_id = $2 AND client_user_id = $3`, [vol, orgA, p2]);
  assert.ok(await n(V, `SELECT count(*)::int AS n FROM case_note WHERE client_user_id = '${p2}'`) > 0, 'once assigned, the volunteer reads the notes');
  assert.equal(await n(A(cm), `SELECT count(*)::int AS n FROM case_note WHERE client_user_id = '${p2}'`), 0, 'and the previous case manager no longer does');
  await as(A(owner), `UPDATE client_staff_assignment SET staff_user_id = $1 WHERE access_code_id = $2 AND client_user_id = $3`, [cm, orgA, p2]);

  // ---- 6. the activity log: written by triggers, plain, append-only
  const acts = await as(A(owner), `SELECT entity, action, summary, actor_user_id, actor_role, participant_user_id FROM org_activity WHERE access_code_id = $1 ORDER BY id`, [orgA]);
  const flat = JSON.stringify(acts);
  for (const secret of ['SECRET-BODY', 'SECRET-TASK', 'SECRET-EMPLOYER', 'SECRET-CHECK', 'SECRET-SUGGESTION', 'SECRET-ASK', 'probation', 'parole']) {
    assert.ok(!flat.includes(secret), `no summary holds typed text or record words (${secret})`);
  }
  const has = (entity: string, action: string, re: RegExp) => acts.some((a) => a.entity === entity && a.action === action && re.test(String(a.summary)));
  assert.ok(has('note', 'created', /^added a call note$/), flat);
  assert.ok(has('note', 'corrected', /corrected a note/), flat);
  assert.ok(has('task', 'created', /added a task shared with them/), flat);
  assert.ok(has('task', 'closed', /ticked off a task shared with them/), 'the participant ticking is recorded');
  assert.ok(has('outcome', 'created', /recorded a placement \(known, not confirmed\)/), flat);
  assert.ok(has('retention', 'created', /recorded the 30-day check-in \(still there\)/), flat);
  assert.ok(has('assignment', 'assigned', /caseload/), flat);
  assert.ok(has('staff', 'created', /added a team member/), flat);
  assert.ok(has('sharing', 'created', /asked them to share their resumes/), flat);
  assert.ok(acts.some((a) => a.entity === 'note' && a.actor_user_id === cm && a.actor_role === 'staff'), 'the actor and their role at the time are recorded');
  assert.ok(acts.some((a) => a.entity === 'task' && a.actor_user_id === p2 && a.actor_role === 'participant'), 'a participant action is attributed to them as a participant');
  assert.match(String(await err(as(A(owner), `INSERT INTO org_activity (access_code_id, entity, action, summary) VALUES ($1, 'org', 'created', 'forged entry')`, [orgA]))), /permission denied/i, 'the app cannot write an activity row');
  assert.match(String(await err(as(A(owner), `UPDATE org_activity SET summary = 'rewritten' WHERE access_code_id = $1`, [orgA]))), /permission denied/i, 'nor rewrite one');
  assert.match(String(await err(as(A(owner), `DELETE FROM org_activity WHERE access_code_id = $1`, [orgA]))), /permission denied/i, 'nor erase one');
  assert.match(String(await err(as(A(owner), `SELECT org_activity_write($1, NULL, NULL, 'org', NULL, 'created', 'forged')`, [orgA]))), /permission denied/i, 'nor call the writer');
  assert.equal(await n({ orgId: orgB, userId: spy }, `SELECT count(*)::int AS n FROM org_activity WHERE access_code_id = '${orgA}'`), 0, 'another org reads none of it');
  assert.equal(await n({ userId: owner }, `SELECT count(*)::int AS n FROM org_activity`), 0, 'an unscoped read returns nothing');

  // ---- 7. retention corrections: a new row; the old one stays
  assert.equal((await as(V, `SELECT smr_correct_retention_check($1, 'not_employed', 'participant_told_me', NULL, 'They told me they left in week two') AS r`, [check]))[0].r, 'refused', 'a volunteer (outcome.write denied) cannot correct a check');
  assert.equal((await as({ orgId: orgB, userId: spy }, `SELECT smr_correct_retention_check($1, 'not_employed', 'participant_told_me', NULL, 'They told me they left') AS r`, [check]))[0].r, 'not_found', 'another org cannot (it is not theirs to find)');
  assert.equal((await as(A(cm), `SELECT smr_correct_retention_check($1, 'not_employed', 'participant_told_me', NULL, 'x') AS r`, [check]))[0].r, 'invalid', 'a correction needs a real reason');
  assert.equal((await as(A(cm), `SELECT smr_correct_retention_check($1, 'employed', 'participant_told_me', NULL, 'Same answer again') AS r`, [check]))[0].r, 'unchanged', 'the same answer is not a correction');
  assert.equal((await as(A(cm), `SELECT smr_correct_retention_check($1, 'employed', 'could_not_reach', NULL, 'Mixed up the answer') AS r`, [check]))[0].r, 'invalid', "'could not reach' only goes with 'do not know'");
  assert.equal((await as(A(cm), OUTCOME_SQL.correctCheck, [check, 'not_employed', 'participant_told_me', null, 'They told me they left in week two']))[0].r, 'ok', 'the case manager corrects it through the app statement');
  const rows = await q(`SELECT id, status, superseded_by, correction_reason, checked_by FROM retention_check WHERE outcome_id = $1 ORDER BY checked_at, superseded_by NULLS LAST`, [outcome]);
  assert.equal(rows.length, 2, 'both answers are kept');
  const old = rows.find((r) => r.id === check)!, fresh = rows.find((r) => r.id !== check)!;
  assert.equal(old.status, 'employed'); assert.equal(old.superseded_by, fresh.id);
  assert.equal(fresh.status, 'not_employed'); assert.equal(fresh.superseded_by, null); assert.match(String(fresh.correction_reason), /week two/);
  assert.equal((await as(A(cm), `SELECT smr_correct_retention_check($1, 'unknown', 'could_not_reach', NULL, 'Correcting the old one again') AS r`, [check]))[0].r, 'not_found', 'a superseded answer cannot be corrected again; correct the current one');
  assert.match(String(await err(as(A(cm), `UPDATE retention_check SET status = 'employed' WHERE id = $1`, [fresh.id]))), /permission denied/i, 'the app cannot edit a check in place');
  assert.match(String(await err(q(`UPDATE retention_check SET status = 'employed' WHERE id = $1`, [fresh.id]))), /never edited/i, 'nor can the owner credential: the guard holds for every role');
  const listed = await as(A(cm), `SELECT ${OUTCOME_SQL.cols} FROM outcome_record o JOIN users c ON c.id = o.client_user_id LEFT JOIN users vb ON vb.id = o.verified_by LEFT JOIN users cb ON cb.id = o.created_by WHERE o.id = $1`, [outcome]);
  const checks = listed[0].checks as { day_mark: number; status: string }[];
  const history = listed[0].history as { kind: string; reason: string | null }[];
  assert.deepEqual(checks.map((c) => [c.day_mark, c.status]), [[30, 'not_employed']], 'the list shows only the current answer per mark');
  assert.ok(history.some((h) => h.kind === 'check' && /week two/.test(String(h.reason))), 'and the correction, with its reason, in the history');
  assert.equal(listed[0].checks && (await as(V, `SELECT ${OUTCOME_SQL.cols} FROM outcome_record o JOIN users c ON c.id = o.client_user_id LEFT JOIN users vb ON vb.id = o.verified_by LEFT JOIN users cb ON cb.id = o.created_by WHERE o.id = $1`, [outcome])).length, 0, 'the volunteer gets none of it');

  // ---- 8. placement corrections: a reason or nothing, and every earlier value kept
  assert.match(String(await err(as(A(cm), `UPDATE outcome_record SET employer = 'Right Co' WHERE id = $1`, [outcome]))), /needs a reason/i, 'a correction without a reason is refused by the database');
  const corrected = await as(A(cm), [[`SELECT set_config('app.correction_reason', $1, true)`, ['Typed the wrong employer']], [OUTCOME_SQL.correct, [orgA, false, cm, outcome, 'Right Co', null, null, null, null, null, null]]]);
  assert.equal(corrected.length, 1, 'with a reason it saves');
  const kept = await as(A(cm), `SELECT kind, changed, reason, corrected_by FROM outcome_correction WHERE outcome_id = $1`, [outcome]);
  assert.equal(kept.length, 1);
  assert.deepEqual((kept[0].changed as Record<string, { from: unknown; to: unknown }>).employer, { from: 'SECRET-EMPLOYER', to: 'Right Co' }, 'the earlier value is kept');
  assert.equal(kept[0].reason, 'Typed the wrong employer'); assert.equal(kept[0].corrected_by, cm);
  await as(A(cm), OUTCOME_SQL.end, [orgA, false, cm, outcome, new Date().toISOString().slice(0, 10), 'laid_off']);
  const kinds = (await as(A(cm), `SELECT kind FROM outcome_correction WHERE outcome_id = $1 ORDER BY id`, [outcome])).map((r) => r.kind);
  assert.deepEqual(kinds, ['corrected', 'ended'], 'ending needs no reason and is still kept');
  assert.equal(await n(V, `SELECT count(*)::int AS n FROM outcome_correction WHERE outcome_id = '${outcome}'`), 0, 'a volunteer reads none of the history');
  assert.equal(await n({ userId: p2 }, `SELECT count(*)::int AS n FROM outcome_correction`), 0, 'it is the organization\'s record, not shown to the participant');
  const oActs = (await as(A(owner), `SELECT action, summary FROM org_activity WHERE entity IN ('outcome', 'retention') ORDER BY id`)).map((r) => `${r.action}: ${r.summary}`);
  assert.ok(oActs.includes('corrected: corrected the 30-day check-in (no longer there)'), oActs.join(' | '));
  assert.ok(oActs.includes('corrected: corrected a placement (employer)'), oActs.join(' | '));
  assert.ok(oActs.includes('closed: ended a placement (laid off)'), oActs.join(' | '));
  assert.ok(!JSON.stringify(oActs).includes('wrong employer'), 'the typed reason never reaches the activity log');

  // ---- 9. the exact org audit read the screen runs, reach-scoped twice
  const audit = await as(A(owner), ACTIVITY_SQL.list, [orgA, null, null, null, null, null, null, 50, true, owner, 'America/Chicago']);
  assert.ok(audit.length > 5 && audit.every((r) => typeof r.summary === 'string'), 'the audit read returns rows');
  assert.ok(audit.some((r) => r.participant_name === null || typeof r.participant_name === 'string'));
  // A route that FORGOT the app-level check: "sees all" passed as true for a volunteer. The policy still holds.
  const volAudit = await as(V, ACTIVITY_SQL.list, [orgA, null, null, null, null, null, null, 50, true, vol, 'America/Chicago']);
  assert.ok(volAudit.length > 0 && !volAudit.some((r) => r.participant_user_id === p2), 'a volunteer\'s read, even through a route that forgot the app check, holds nobody they do not reach');
  const byPerson = await as(A(owner), ACTIVITY_SQL.list, [orgA, p2, null, 'retention', null, null, null, 50, true, owner, 'America/Chicago']);
  assert.ok(byPerson.length >= 2 && byPerson.every((r) => r.participant_user_id === p2 && r.entity === 'retention'), 'filters by person and kind');
  const named = await as(A(owner), ACTIVITY_SQL.list, [orgA, p2, null, null, null, null, null, 50, true, owner, 'America/Chicago']);
  assert.ok(named.every((r) => r.participant_name === null), 'a person who has not shared progress and was not invited by name is not named');

  // ---- 10. the participant's own paths and the definer paths keep working, and are logged
  const askId = (await q(`SELECT id FROM sharing_request WHERE user_id = $1 AND status = 'pending'`, [p2]))[0].id as string;
  assert.equal((await as({ userId: p2 }, `UPDATE sharing_request SET status = 'approved' WHERE id = $1 RETURNING id`, [askId])).length, 1, 'the participant answers an ask');
  await as({ userId: p2 }, `INSERT INTO sharing_grant (user_id, access_code_id, scope, text_version) VALUES ($1, $2, 'resume', 'pglite')`, [p2, orgA]);
  await q(`INSERT INTO org_invite (access_code_id, user_id, invited_by, invited_name, invited_email) VALUES ($1, $2, $3, 'Typed Name', 'typed@org.test')`, [orgA, p2, owner]);
  const afterInvite = await as(A(owner), ACTIVITY_SQL.list, [orgA, p2, null, 'sharing', null, null, null, 50, true, owner, 'America/Chicago']);
  assert.ok(afterInvite.some((r) => r.summary === 'said yes to sharing their resumes' && r.actor_role === 'participant'), JSON.stringify(afterInvite));
  assert.ok(afterInvite.some((r) => r.summary === 'started sharing their resumes'));
  assert.ok(afterInvite.every((r) => r.participant_name === 'Typed Name'), 'once the org typed a name on an invite, the log uses that name and only that');
  assert.equal((await as({ userId: p1 }, `SELECT smr_leave_org($1, $2) AS n`, [p1, orgA]))[0].n, 1, 'leaving one organization still works through its definer function');
  const left = (await q(`SELECT summary FROM org_activity WHERE participant_user_id = $1 ORDER BY id DESC LIMIT 3`, [p1])).map((r) => r.summary);
  assert.ok(left.includes('took them off a caseload'), left.join(' | '));
  await q(`UPDATE access_code SET is_active = false WHERE id = $1`, [orgB]);
  assert.equal(await n({ orgId: orgB, userId: spy }, `SELECT count(*)::int AS n FROM org_activity WHERE entity = 'org' AND action = 'closed'`), 1, 'closing an organization is logged');
  // Deleting an account and an organization cascades through every audited table without tripping a trigger.
  assert.equal(await err(q(`DELETE FROM users WHERE id = $1`, [p2])), null, 'deleting a person (delete-my-data) still cascades');
  assert.equal(await err(q(`DELETE FROM access_code WHERE id = $1`, [orgB])), null, 'deleting an organization still cascades');
  assert.equal(Number((await q(`SELECT count(*)::int AS n FROM retention_check WHERE outcome_id = $1`, [outcome]))[0].n), 0, 'and takes the corrected check-ins with it (deferred self-reference)');
});

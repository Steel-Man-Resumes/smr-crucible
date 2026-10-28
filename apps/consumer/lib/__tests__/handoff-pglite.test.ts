/**
 * Real SQL for handoffs (migration 110, staff pass S5): the exact statements
 * staffHandoff and the connections door run, against migrations 001-106 and
 * 110 in pglite, as the NOSUPERUSER app role (RLS on).
 *
 * Proves: only staff who reach the person can send (app predicate AND raw
 * insert); a colleague, another org and another participant read nothing;
 * items join their handoff only in the sending transaction, at most ten; the
 * person reads their live handoffs with no org scope, opens and answers, and
 * nobody else can; a next step taken lands on their shared task list, once;
 * withdrawn handoffs vanish for them and close what was open; nothing is
 * deleted; the activity log holds fixed words only and 102's entities still
 * work; 057's loose jobs and comments still work; the connections reads see
 * only shared scopes and log every open for the person.
 *
 * Run it alone. Skipped unless SMR_PGLITE_DIR points at a node_modules folder
 * holding @electric-sql/pglite (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HANDOFF_SQL, itemsJson } from '@crucible/core/src/staffHandoff';
import { CONNECTION_APPS_SQL, CONNECTION_RESUMES_SQL, CONNECTION_CANDIDATES_SQL, SHARED_OPEN_LOG_SQL } from '@crucible/core/src/orgClientView';
import type { HandoffItemInput } from '@crucible/core/src/staffHandoffShared';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite handoff test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

test('handoffs (110): reach-sealed sending, the person answers, next steps land on their list, connections log every open', { skip, timeout: 600_000 }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const { pg_trgm } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pg_trgm.js'));
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  await db.exec(`CREATE ROLE smr_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO smr_app;`);
  const files = readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 110).sort();
  const failed: string[] = [];
  const apply = async (f: string) => {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); }
    catch (e) { await db.exec('ROLLBACK').catch(() => {}); failed.push(`${f}: ${(e as Error).message}`); }
  };
  for (const f of files.filter((x) => Number(x.slice(0, 3)) < 110)) await apply(f);
  for (const n of ['057_', '102_', '103_', '105_']) assert.ok(files.some((f) => f.startsWith(n)) && !failed.some((f) => f.startsWith(n)), `110 is tested against the real ${n}: ${failed.join(' | ')}`);
  await apply('110_staff_handoff.sql');
  assert.ok(!failed.some((f) => f.startsWith('110_')), `110 must apply: ${failed.filter((f) => f.startsWith('110_')).join(' | ')}`);
  await apply('110_staff_handoff.sql');
  assert.ok(!failed.some((f) => f.startsWith('110_')), `110 is idempotent (a second run changes nothing and fails nothing): ${failed.join(' | ')}`);

  const q = (t: string, p: unknown[] = []) => db.query(t, p);
  const priv = async (t: string, p: string) => ((await q(`SELECT has_table_privilege('smr_app', $1, $2) AS ok`, [t, p])).rows[0] as { ok: boolean }).ok;
  assert.deepEqual([await priv('staff_handoff', 'SELECT'), await priv('staff_handoff', 'INSERT'), await priv('staff_handoff', 'UPDATE'), await priv('staff_handoff', 'DELETE'), await priv('staff_suggestion', 'DELETE')],
    [true, true, true, false, false], 'grants as designed');

  /** As the app role in ONE transaction: org + user (runScoped) or user only (runAsUser). */
  const asTx = async (who: { orgId?: string; userId?: string }, stmts: [string, unknown[]][]) => {
    await db.exec('BEGIN; SET LOCAL ROLE smr_app;');
    try {
      if (who.orgId) await db.query(`SELECT set_config('app.org_id', $1, true), set_config('app.org_role', 'staff', true)`, [who.orgId]);
      if (who.userId) await db.query(`SELECT set_config('app.user_id', $1, true)`, [who.userId]);
      const out: Record<string, any>[][] = [];
      for (const [t, p] of stmts) out.push((await db.query(t, p)).rows as Record<string, any>[]);
      await db.exec('COMMIT');
      return out;
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  };
  const as = async (who: { orgId?: string; userId?: string }, t: string, p: unknown[] = []) => (await asTx(who, [[t, p]]))[0];
  const fails = async (p: Promise<unknown>, re?: RegExp) => { try { await p; return false; } catch (e) { return re ? re.test((e as Error).message) : true; } };

  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const [owner, admin, cm, cm2, owner2, p1, p2, p3] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
  for (const u of [owner, admin, cm, cm2, owner2, p1, p2, p3]) await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `acct-${u.slice(-2)}@example.test`, `Person ${u.slice(-2)}`]);
  const mkOrg = async (code: string, by: string) => ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2, max_redemptions) VALUES ($1, $1, 'client', $2, true, 100) RETURNING id`, [code, by])).rows[0] as { id: string }).id;
  const org = await mkOrg('PGHO0001', owner), org2 = await mkOrg('PGHO0002', owner2);
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'staff'), ($1, $4, 'staff')`, [org, admin, cm, cm2]);
  for (const [u, o] of [[p1, org], [p2, org], [p3, org2]]) await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [u, o]);
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $3, $5), ($1, $4, $6, $5)`, [org, p1, cm, p2, owner, cm2]);

  const R = (actor: string, seesAll: boolean, person: string) => [person, org, seesAll, actor];
  const step = (s: string): HandoffItemInput => ({ kind: 'next_step', step: s, why: 'So we can start the class' });
  let n = 100;
  const send = (actor: string, seesAll: boolean, person: string, items: HandoffItemInput[], o = org) => {
    const hid = id(++n);
    return asTx({ orgId: o, userId: actor }, [
      [HANDOFF_SQL.insert, [person, o, seesAll, actor, hid, 'A few things for this week', false]],
      [HANDOFF_SQL.items, [hid, itemsJson(items)]],
    ]).then(([h, it]) => ({ id: h[0]?.id as string | undefined, hid, items: it.map((r) => r.id as string) }));
  };

  // --------------------------------------------------------------- sending
  const h1 = await send(cm, false, p1, [step('Bring your state ID Tuesday'), { kind: 'resource', resourceId: id(901), name: 'Capital Area Job Center', why: 'Free help with applications' },
    { kind: 'employer', employerId: id(902), name: 'Harbor Docks', role: 'Forklift operator', location: 'Lansing, MI', why: 'Hires for forklift work' }]);
  assert.ok(h1.id && h1.items.length === 3, 'a case manager sends their person a handoff with three items');
  const none = await send(cm, false, p2, [step('Not mine')]);
  assert.ok(!none.id && none.items.length === 0, 'not to a colleague\'s person (app predicate), and no orphan items');
  assert.ok(await fails(as({ orgId: org, userId: cm }, `INSERT INTO staff_handoff (access_code_id, participant_user_id, author_user_id, note) VALUES ($1, $2, $3, 'raw note')`, [org, p2, cm])),
    'the database refuses it written directly (restrictive reach)');
  assert.ok(await fails(as({ orgId: org, userId: cm }, `INSERT INTO staff_handoff (access_code_id, participant_user_id, author_user_id, note) VALUES ($1, $2, $3, 'forged')`, [org, p1, admin])),
    'not in someone else\'s name');
  assert.ok(await fails(as({ orgId: org, userId: cm }, `INSERT INTO staff_handoff (access_code_id, participant_user_id, author_user_id, note) VALUES ($1, $2, $3, 'other org')`, [org, p3, cm])),
    'not about another organization\'s member');
  assert.ok(await fails(as({ orgId: org, userId: cm }, `INSERT INTO staff_handoff (access_code_id, participant_user_id, author_user_id, note, status, seen_at) VALUES ($1, $2, $3, 'pre-seen', 'seen', now())`, [org, p1, cm])),
    'a handoff starts as sent');
  assert.ok(await fails(as({ orgId: org, userId: cm }, `INSERT INTO staff_suggestion (access_code_id, client_user_id, author_user_id, kind, step_title, body, handoff_id) VALUES ($1, $2, $3, 'next_step', 'later', 'later', $4)`, [org, p1, cm, h1.id]), /while it is being sent/),
    'nothing is added to a handoff after it was sent');
  assert.ok(await fails(as({ orgId: org, userId: cm }, `INSERT INTO staff_suggestion (access_code_id, client_user_id, author_user_id, kind, step_title, body) VALUES ($1, $2, $3, 'next_step', 'loose', 'loose')`, [org, p1, cm])),
    'a next step only travels in a handoff (shape)');
  const eleven = await fails(send(cm, false, p1, Array.from({ length: 11 }, (_, i) => step(`Step ${i}`))), /at most ten/);
  assert.ok(eleven, 'a handoff holds at most ten items');
  assert.equal((await q(`SELECT count(*)::int AS n FROM staff_handoff`)).rows[0].n, 1, 'the refused eleven-item send left no handoff behind');

  // --------------------------------------------------------------- reading
  const seen = async (who: { orgId?: string; userId?: string }) => (await as(who, `SELECT id FROM staff_handoff`)).length;
  assert.equal(await seen({ orgId: org, userId: cm }), 1, 'the sender reads it');
  assert.equal(await seen({ orgId: org, userId: cm2 }), 0, 'a colleague does not, even from the table');
  assert.equal((await as({ orgId: org, userId: cm2 }, `SELECT id FROM staff_suggestion WHERE handoff_id IS NOT NULL`)).length, 0, 'nor its items');
  assert.equal(await seen({ orgId: org, userId: admin }), 1, 'an admin does');
  assert.equal(await seen({ orgId: org2, userId: owner2 }), 0, 'another organization does not');
  assert.equal(await seen({ userId: p2 }), 0, 'another participant does not');
  const listed = await as({ orgId: org, userId: cm }, HANDOFF_SQL.listFor, R(cm, false, p1));
  assert.deepEqual(listed[0].items.map((i: { kind: string }) => i.kind), ['next_step', 'resource', 'employer'], 'items keep the order staff chose');
  assert.equal((await as({ orgId: org, userId: cm2 }, HANDOFF_SQL.listFor, R(cm2, false, p1))).length, 0, 'the list carries reach too');

  const mine = await as({ userId: p1 }, HANDOFF_SQL.mine, [p1]);
  assert.equal(mine.length, 1, 'the person reads their handoff with no org scope');
  assert.equal(mine[0].items.length, 3);
  assert.equal(mine[0].org_name, 'PGHO0001');
  assert.equal((await as({ orgId: org, userId: p1 }, HANDOFF_SQL.mine, [p1])).length, 0, 'not under an organization scope');

  // ------------------------------------------------------------- answering
  const [stepItem, resItem, empItem] = mine[0].items.map((i: { id: string }) => i.id);
  assert.ok(await fails(as({ orgId: org, userId: cm }, `UPDATE staff_suggestion SET status = 'saved' WHERE id = $1`, [resItem]), /withdraw a suggestion, not answer/), 'staff cannot answer for the person');
  assert.ok(await fails(as({ userId: p1 }, `UPDATE staff_suggestion SET status = 'withdrawn' WHERE id = $1`, [resItem])), 'the person cannot withdraw (only take or pass)');
  assert.ok(await fails(as({ userId: p1 }, `UPDATE staff_suggestion SET body = 'changed' WHERE id = $1`, [resItem]), /only the status/), 'nor change the words');
  assert.ok(await fails(as({ userId: p1 }, `UPDATE staff_handoff SET status = 'withdrawn' WHERE id = $1`, [h1.id]), /only open a handoff/), 'the person can only open a handoff');
  assert.ok(await fails(as({ userId: p1 }, `UPDATE staff_handoff SET note = 'mine now' WHERE id = $1`, [h1.id]), /only the status/), 'and never change its note');
  assert.equal((await as({ userId: p2 }, HANDOFF_SQL.answer, [p2, resItem, 'dismissed'])).length, 0, 'another person cannot answer it');
  assert.equal((await as({ userId: p2 }, HANDOFF_SQL.takeStep, [stepItem]))[0].task_id, null, 'nor take its next step');
  assert.equal((await as({ orgId: org, userId: p1 }, HANDOFF_SQL.takeStep, [stepItem]))[0].task_id, null, 'the step taker refuses under an org scope');

  const [ans] = await asTx({ userId: p1 }, [[HANDOFF_SQL.answer, [p1, resItem, 'saved']], [HANDOFF_SQL.seenByItem, [p1, resItem]]]);
  assert.equal(ans.length, 1, 'the person takes a place for help (after the page saved it to their list)');
  assert.equal((await as({ userId: p1 }, HANDOFF_SQL.answer, [p1, stepItem, 'saved'])).length, 0, 'a next step is not "taken" by a bare status change');
  const took = (await as({ userId: p1 }, HANDOFF_SQL.takeStep, [stepItem]))[0].task_id as string;
  assert.ok(took, 'taking a next step makes a task');
  const task = (await q(`SELECT title, shared_with_participant, owner_user_id, client_user_id, access_code_id FROM staff_task WHERE id = $1`, [took])).rows[0] as Record<string, unknown>;
  assert.deepEqual(task, { title: 'Bring your state ID Tuesday', shared_with_participant: true, owner_user_id: cm, client_user_id: p1, access_code_id: org }, 'shared with them, owned by the sender');
  assert.equal((await as({ userId: p1 }, `SELECT id FROM staff_task WHERE shared_with_participant`)).length, 1, 'it is on their "From your case manager" list');
  assert.equal((await as({ userId: p1 }, HANDOFF_SQL.takeStep, [stepItem]))[0].task_id, null, 'taking it twice makes nothing');
  assert.equal((await as({ userId: p1 }, HANDOFF_SQL.answer, [p1, empItem, 'dismissed'])).length, 1, 'passing needs no reason');
  const after = await as({ orgId: org, userId: cm }, HANDOFF_SQL.listFor, R(cm, false, p1));
  assert.equal(after[0].status, 'seen', 'answering opened the handoff');
  assert.deepEqual(after[0].items.map((i: { status: string }) => i.status), ['saved', 'saved', 'dismissed'], 'staff see taken and passed, nothing more');

  // The sender's Inbox (integration 2026-10-28): one unread item per handoff, refreshed in place, fixed words, no actor.
  const box = (await q(`SELECT recipient_user_id, kind, ref_table, ref_id, summary, actor_user_id, participant_user_id, read_at FROM staff_inbox_item WHERE ref_id = $1`, [h1.id])).rows as Record<string, unknown>[];
  assert.deepEqual(box, [{ recipient_user_id: cm, kind: 'handoff', ref_table: 'staff_handoff', ref_id: h1.id, summary: 'passed on something in your handoff', actor_user_id: null, participant_user_id: p1, read_at: null }],
    'three answers, one unread item for the sender, showing the latest');
  assert.equal((await as({ orgId: org, userId: cm }, `SELECT id FROM staff_inbox_item WHERE ref_id = $1`, [h1.id])).length, 1, 'the sender reads it in their inbox');
  assert.equal((await as({ orgId: org, userId: cm2 }, `SELECT id FROM staff_inbox_item WHERE ref_id = $1`, [h1.id])).length, 0, 'a colleague does not');
  assert.equal((await as({ userId: p1 }, `SELECT id FROM staff_inbox_item`)).length, 0, 'the person never reads staff inboxes');
  // The trigger scopes its reach check to the handoff's organization and puts the setting back.
  const ibA = await send(cm, false, p1, [step('Call the shelter about Monday')]);
  const ibItemA = (await q(`SELECT id FROM staff_suggestion WHERE handoff_id = $1`, [ibA.id])).rows[0].id as string;
  const [ans4, scopeAfter] = await asTx({ userId: p1 }, [[HANDOFF_SQL.answer, [p1, ibItemA, 'dismissed']], [`SELECT NULLIF(current_setting('app.org_id', true), '') AS o`, []]]);
  assert.equal(ans4.length, 1);
  assert.equal(scopeAfter[0].o, null, 'the person answers with no org scope, before and after the trigger');
  assert.equal((await q(`SELECT count(*)::int AS n FROM staff_inbox_item WHERE ref_id = $1`, [ibA.id])).rows[0].n, 1);
  // A sender who no longer reaches the person gets nothing.
  const ibB = await send(cm2, false, p2, [step('Bring your work boots')]);
  await q(`DELETE FROM client_staff_assignment WHERE access_code_id = $1 AND client_user_id = $2 AND staff_user_id = $3`, [org, p2, cm2]);
  const ibItemB = (await q(`SELECT id FROM staff_suggestion WHERE handoff_id = $1`, [ibB.id])).rows[0].id as string;
  assert.equal((await as({ userId: p2 }, HANDOFF_SQL.answer, [p2, ibItemB, 'dismissed'])).length, 1, 'the person can still answer');
  assert.equal((await q(`SELECT count(*)::int AS n FROM staff_inbox_item WHERE ref_id = $1`, [ibB.id])).rows[0].n, 0, 'no inbox item for a sender out of reach');
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $3, $4)`, [org, p2, cm2, owner]);

  // ------------------------------------------------------------ withdrawing
  const h2 = await send(cm, false, p1, [step('Call the training desk'), step('Ask about boots')]);
  const firstOfH2 = (await as({ userId: p1 }, HANDOFF_SQL.mine, [p1])).find((h) => h.id === h2.id)!.items[0].id;
  await as({ userId: p1 }, HANDOFF_SQL.answer, [p1, firstOfH2, 'dismissed']);
  assert.equal((await as({ orgId: org, userId: cm2 }, HANDOFF_SQL.withdraw, [org, h2.id, false, cm2])).length, 0, 'a colleague cannot withdraw it');
  const [w] = await asTx({ orgId: org, userId: cm }, [[HANDOFF_SQL.withdraw, [org, h2.id, false, cm]]]);
  assert.equal(w.length, 1, 'the sender withdraws it');
  assert.equal((await q(`SELECT summary FROM staff_inbox_item WHERE ref_id = $1`, [h2.id])).rows.map((r: any) => r.summary).join(), 'passed on something in your handoff', 'withdrawing adds no inbox item');
  assert.deepEqual((await q(`SELECT status FROM staff_suggestion WHERE handoff_id = $1 ORDER BY position`, [h2.id])).rows.map((r: any) => r.status), ['dismissed', 'withdrawn'],
    'the database closed the open item; the answered one keeps its answer');
  assert.ok(!(await as({ userId: p1 }, HANDOFF_SQL.mine, [p1])).some((h) => h.id === h2.id), 'a withdrawn handoff is gone for the person');
  assert.equal((await q(`SELECT status FROM staff_suggestion WHERE id = $1`, [firstOfH2])).rows[0].status, 'dismissed', 'their answer stays');
  assert.ok(await fails(as({ orgId: org, userId: cm }, `UPDATE staff_handoff SET status = 'sent' WHERE id = $1`, [h2.id]), /withdrawn handoff cannot/), 'withdrawn stays withdrawn');
  assert.ok(await fails(as({ orgId: org, userId: owner }, `DELETE FROM staff_handoff WHERE id = $1`, [h1.id]), /permission denied/), 'nobody deletes a handoff');

  // ------------------------------------------------- review round 1 (DB rules)
  const h3 = await send(cm, false, p1, [step('Pick up the bus pass'), step('Bring two forms of ID')]);
  await as({ orgId: org, userId: cm }, `UPDATE staff_handoff SET status = 'withdrawn' WHERE id = $1`, [h3.id]);
  assert.deepEqual((await q(`SELECT DISTINCT status FROM staff_suggestion WHERE handoff_id = $1`, [h3.id])).rows.map((r: any) => r.status), ['withdrawn'],
    'a raw UPDATE that skips core still closes every open item (trigger)');
  const h3item = (await q(`SELECT id FROM staff_suggestion WHERE handoff_id = $1 LIMIT 1`, [h3.id])).rows[0].id as string;
  assert.equal((await as({ userId: p1 }, HANDOFF_SQL.answer, [p1, h3item, 'dismissed'])).length, 0, 'nothing in a withdrawn handoff can be answered');
  // A staff member who reaches the person but neither sent it nor sees everyone: refused by the database.
  const h4 = await send(admin, true, p2, [step('Call the clinic')]);
  assert.ok(h4.id, 'an admin sends to a colleague\'s person');
  assert.ok(await fails(as({ orgId: org, userId: cm2 }, `UPDATE staff_handoff SET status = 'withdrawn' WHERE id = $1`, [h4.id]), /only the sender/),
    'the assigned case manager cannot withdraw what the admin sent (guard)');
  assert.equal((await as({ orgId: org, userId: owner }, HANDOFF_SQL.withdraw, [org, h4.id, true, owner])).length, 1, 'someone who sees everyone can');
  // A next step is never "taken" by a bare status change, even skipping core.
  const h5 = await send(cm, false, p1, [step('Visit the job center')]);
  const h5item = (await q(`SELECT id FROM staff_suggestion WHERE handoff_id = $1`, [h5.id])).rows[0].id as string;
  assert.ok(await fails(as({ userId: p1 }, `UPDATE staff_suggestion SET status = 'saved' WHERE id = $1`, [h5item]), /its own path/), 'raw next step -> saved is refused');
  assert.ok(await fails(as({ userId: p1 }, `UPDATE staff_suggestion SET status = 'saved' WHERE id = $1 AND kind IN ('job', 'comment') AND to_jsonb(staff_suggestion)->>'handoff_id' IS NULL RETURNING id`, [h5item]).then((r) => { if (r.length === 0) throw new Error('no row'); }), /no row/),
    'answerSuggestion\'s statement no longer reaches handoff items');
  assert.ok((await as({ userId: p1 }, HANDOFF_SQL.takeStep, [h5item]))[0].task_id, 'the definer path still takes it');
  // A handoff with no items never commits.
  assert.ok(await fails(asTx({ orgId: org, userId: cm }, [[HANDOFF_SQL.insert, [p1, org, false, cm, id(990), 'Only a note', false]]]), /at least one item/),
    'an empty handoff is refused when the transaction commits');
  assert.equal((await q(`SELECT count(*)::int AS n FROM staff_handoff WHERE id = $1`, [id(990)])).rows[0].n, 0);

  // --------------------------------------------------------------- activity
  const acts = (await q(`SELECT entity, action, summary, actor_role FROM org_activity WHERE participant_user_id = $1 AND entity IN ('handoff', 'suggestion') ORDER BY id`, [p1])).rows as Record<string, string>[];
  const said = acts.map((a) => a.summary);
  for (const s of ['sent them a handoff', 'they saved a suggested place for help', 'they took on a suggested next step', 'they passed on a suggestion', 'they opened a handoff', 'withdrew a handoff'])
    assert.ok(said.includes(s), `the log says: ${s} (${said.join(' | ')})`);
  assert.ok(!said.some((s) => /ID Tuesday|Job Center|Harbor|few things|training desk/.test(s)), 'and never the words anyone typed or a place');
  assert.ok(acts.some((a) => a.actor_role === 'participant'), 'the person\'s answers are logged as theirs');
  assert.ok((await q(`SELECT summary FROM org_activity WHERE participant_user_id = $1 AND entity = 'task'`, [p1])).rows.some((r: any) => r.summary === 'added a task shared with them'),
    '102\'s task log still works for the new task');

  // ----------------------------------------------------- 057 keeps working
  const job = await as({ orgId: org, userId: cm }, `INSERT INTO staff_suggestion (access_code_id, client_user_id, author_user_id, kind, job_title, company, body) VALUES ($1, $2, $3, 'job', 'Line cook', 'Riverside Diner', 'Day shift') RETURNING id`, [org, p1, cm]);
  assert.equal(job.length, 1, 'a loose suggested job still works');
  assert.ok((await q(`SELECT summary FROM org_activity WHERE entity_id = $1`, [job[0].id])).rows.some((r: any) => r.summary === 'suggested a job'));
  assert.equal((await as({ userId: p1 }, `UPDATE staff_suggestion SET status = 'saved' WHERE id = $1 RETURNING id`, [job[0].id])).length, 1, 'and the person still saves it');
  assert.equal((await q(`SELECT count(*)::int AS n FROM org_activity WHERE entity = 'note'`)).rows[0].n, 0);
  await as({ orgId: org, userId: cm }, `INSERT INTO case_note (access_code_id, client_user_id, author_user_id, body, kind) VALUES ($1, $2, $3, 'Called about boots', 'call')`, [org, p1, cm]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM org_activity WHERE entity = 'note'`)).rows[0].n, 1, '102\'s entities still log after the widening');

  // ------------------------------------------------------ connections reads
  await q(`INSERT INTO job_application (user_id, job_title, company, location, status, notes, salary) VALUES ($1, 'Warehouse Associate', 'Old Co', 'Lansing, MI', 'saved', 'my private note', '$19')`, [p1]);
  await q(`INSERT INTO refinery_artifact (user_id, artifact_type, target_context, content, iteration_number, scaffold_level) VALUES ($1, 'resume', '{"targetJob":"Shipping clerk"}'::jsonb, '{}'::jsonb, 1, 1)`, [p1]);
  const P = (actor: string, seesAll: boolean, person: string, scope: string) => [person, org, seesAll, actor, scope];
  const logCount = async () => (await q(`SELECT count(*)::int AS n FROM data_access_log WHERE target_user_id = $1 AND fields_accessed->>'via' = 'connections'`, [p1])).rows[0].n as number;
  const readAll = (actor: string, seesAll: boolean) => asTx({ orgId: org, userId: actor }, [
    [CONNECTION_APPS_SQL, P(actor, seesAll, p1, 'applications')],
    [SHARED_OPEN_LOG_SQL, [...P(actor, seesAll, p1, 'applications'), 'connections', null]],
    [CONNECTION_RESUMES_SQL, P(actor, seesAll, p1, 'resume')],
    [SHARED_OPEN_LOG_SQL, [...P(actor, seesAll, p1, 'resume'), 'connections', null]],
  ]);
  let [apps, , resumes] = await readAll(cm, false);
  assert.equal(apps.length + resumes.length, 0, 'nothing shared: nothing read');
  assert.equal(await logCount(), 0, 'and nothing logged');
  await as({ userId: p1 }, `INSERT INTO sharing_grant (user_id, access_code_id, scope, text_version) VALUES ($1, $2, 'applications', 'test')`, [p1, org]);
  [apps, , resumes] = await readAll(cm, false);
  assert.deepEqual(apps, [{ job_title: 'Warehouse Associate', company: 'Old Co', location: 'Lansing, MI' }], 'their shared jobs: title, employer, place only');
  assert.equal(resumes.length, 0, 'resumes stay closed until shared');
  assert.equal(await logCount(), 1, 'the open is in their log');
  const logRow = (await q(`SELECT resource_type, access_reason, accessor_id FROM data_access_log WHERE target_user_id = $1 AND fields_accessed->>'via' = 'connections'`, [p1])).rows[0] as Record<string, string>;
  assert.deepEqual(logRow, { resource_type: 'shared:applications', access_reason: 'org_client_view', accessor_id: cm }, 'logged like any open of their applications');
  [apps, , resumes] = await readAll(cm2, false);
  assert.equal(apps.length, 0, 'a colleague who does not reach them reads nothing');
  assert.equal(await logCount(), 1, 'and logs nothing');
  await as({ userId: p1 }, `INSERT INTO sharing_grant (user_id, access_code_id, scope, text_version) VALUES ($1, $2, 'resume', 'test')`, [p1, org]);
  [apps, , resumes] = await readAll(cm, false);
  assert.deepEqual(resumes, [{ target: 'Shipping clerk' }], 'a shared resume gives its target only');
  const cands = await as({ orgId: org, userId: cm }, CONNECTION_CANDIDATES_SQL, [org, false, cm, 25]);
  assert.deepEqual(cands.map((c) => c.id), [p1], 'the caseload list starts from people in reach who share');
  assert.equal((await as({ orgId: org, userId: cm2 }, CONNECTION_CANDIDATES_SQL, [org, false, cm2, 25])).length, 0, 'not a colleague\'s');
  assert.equal((await as({ orgId: org2, userId: owner2 }, CONNECTION_CANDIDATES_SQL, [org2, true, owner2, 25])).length, 0, 'not another organization\'s');
});

/**
 * Real SQL for team talk (migration 109, staff side lane S4): the exact
 * statements teamComments, staffInbox, orgChangeRequests, noteReview and the
 * timeline run, against migrations 001-106 plus 109 in pglite, as the
 * NOSUPERUSER app role (RLS on). 102 to 106 are the real ones.
 *
 * Proves: comments are staff-only and reach-scoped in the DATABASE (a raw
 * read that skips the app's check sees nothing; another org and a participant
 * see nothing); a mention of a colleague who cannot reach the person is
 * refused; mentions, replies, handed-on tasks, change requests and their
 * answers land in the right inbox and nobody else's; the inbox is owner-only,
 * trigger-written and drops items about people the reader no longer reaches;
 * corrections keep the earlier wording; tasks go only to a team member who
 * reaches the person, and only from someone allowed to hand them on; change
 * requests are read by the asker and the managers and answered only by the
 * managers along the right path; note review locks a pending note and an
 * approved one and needs a comment to send one back; activity rows carry no
 * typed words; the migration applies twice.
 *
 * Run it alone. Skipped unless SMR_PGLITE_DIR points at a node_modules folder
 * holding @electric-sql/pglite (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LIST_COMMENTS_SQL, COLLEAGUES_SQL } from '@crucible/core/src/teamComments';
import { LIST_INBOX_SQL, UNREAD_COUNT_SQL } from '@crucible/core/src/staffInbox';
import { LIST_CHANGE_REQUESTS_SQL } from '@crucible/core/src/orgChangeRequests';
import { NOTE_REVIEWS_SQL, REVIEW_QUEUE_SQL } from '@crucible/core/src/noteReview';
import { timelineSql } from '@crucible/core/src/orgTimeline';
import { INBOX_KINDS } from '@crucible/core/src/teamTalkShared';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite team talk test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

test('team talk (109): sealed comments, refused mentions, owner-only inbox, handed-on tasks, change requests, note review', { skip, timeout: 600_000 }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  await db.exec(`CREATE ROLE smr_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO smr_app;`);
  const files = readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 106).sort();
  const failed: string[] = [];
  const apply = async (f: string) => {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); }
    catch (e) { await db.exec('ROLLBACK').catch(() => {}); failed.push(`${f}: ${(e as Error).message}`); }
  };
  for (const f of files) await apply(f);
  for (const n of ['102_', '103_', '104_', '105_', '106_']) assert.ok(!failed.some((f) => f.startsWith(n)), `109 is tested against the real ${n}: ${failed.join(' | ')}`);
  await apply('109_team_talk.sql');
  assert.ok(!failed.some((f) => f.startsWith('109_')), `109 must apply: ${failed.filter((f) => f.startsWith('109_')).join(' | ')}`);
  await db.exec('BEGIN;' + readFileSync(MIG + '109_team_talk.sql', 'utf8') + ';COMMIT;');

  const q = (t: string, p: unknown[] = []) => db.query(t, p);
  const priv = async (t: string, p: string) => ((await q(`SELECT has_table_privilege('smr_app', $1, $2) AS ok`, [t, p])).rows[0] as { ok: boolean }).ok;
  const colPriv = async (t: string, c: string, p: string) => ((await q(`SELECT has_column_privilege('smr_app', $1, $2, $3) AS ok`, [t, c, p])).rows[0] as { ok: boolean }).ok;
  assert.deepEqual([await priv('team_comment', 'SELECT'), await priv('team_comment', 'INSERT'), await priv('team_comment', 'DELETE'),
    await colPriv('team_comment', 'body', 'UPDATE'), await colPriv('team_comment', 'author_user_id', 'UPDATE'),
    await priv('team_comment_version', 'INSERT'), await priv('staff_inbox_item', 'INSERT'), await priv('staff_inbox_item', 'DELETE'),
    await colPriv('staff_inbox_item', 'read_at', 'UPDATE'), await colPriv('staff_inbox_item', 'summary', 'UPDATE'),
    await priv('org_change_request', 'DELETE'), await colPriv('org_change_request', 'status', 'UPDATE'), await colPriv('org_change_request', 'title', 'UPDATE'),
    await priv('note_review', 'INSERT'), await priv('note_review_event', 'INSERT')],
    [true, true, false, true, false, false, false, false, true, false, false, true, false, false, false], 'grants as designed');
  const fnPriv = async (sig: string) => ((await q(`SELECT has_function_privilege('smr_app', $1, 'EXECUTE') AS ok`, [sig])).rows[0] as { ok: boolean }).ok;
  assert.equal(await fnPriv('public.smr_inbox_write(uuid, uuid, text, uuid, text, uuid, text)'), false, 'the app cannot write an inbox item');
  assert.equal(await fnPriv('public.smr_note_review_submit(uuid)'), true);

  const as = async (who: { orgId?: string; userId?: string }, text: string, params: unknown[] = []) => {
    await db.exec('BEGIN; SET LOCAL ROLE smr_app;');
    try {
      if (who.orgId) await db.query(`SELECT set_config('app.org_id', $1, true), set_config('app.org_role', 'staff', true)`, [who.orgId]);
      if (who.userId) await db.query(`SELECT set_config('app.user_id', $1, true)`, [who.userId]);
      const r = await db.query(text, params);
      await db.exec('COMMIT');
      return r.rows as Record<string, any>[];
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  };
  const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };

  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const [owner, admin, cm, cm2, vol, owner2, staff2, p1, p2, p3] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id);
  for (const u of [owner, admin, cm, cm2, vol, owner2, staff2, p1, p2, p3]) await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `acct-${u.slice(-2)}@example.test`, `Person ${u.slice(-2)}`]);
  const mkOrg = async (code: string, by: string) => ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2, max_redemptions) VALUES ($1, $1, 'client', $2, true, 50) RETURNING id`, [code, by])).rows[0] as { id: string }).id;
  const org = await mkOrg('PGTT0001', owner), org2 = await mkOrg('PGTT0002', owner2);
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'staff'), ($1, $4, 'staff'), ($1, $5, 'staff'), ($6, $7, 'staff')`, [org, admin, cm, cm2, vol, org2, staff2]);
  await q(`INSERT INTO org_capability_override (org_id, user_id, capability, effect) VALUES ($1, $2, 'org.client.view_all', 'deny'), ($1, $2, 'org.outcome.write', 'deny'), ($1, $2, 'org.participant.invite', 'deny')`, [org, vol]);
  for (const [u, o] of [[p1, org], [p2, org], [p3, org2]]) await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [u, o]);
  // p1 is the case manager's; p2 is cm2's. The admin and owner see everyone.
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $3, $5), ($1, $4, $6, $5)`, [org, p1, cm, p2, owner, cm2]);

  const S = (userId: string, orgId = org) => ({ orgId, userId });
  const reachP = (actor: string, seesAll: boolean, person: string | null, orgId = org) => [orgId, seesAll, actor, person];

  /* ------------------------------------------------------------ comments -- */
  const add = (actor: string, person: string | null, body: string, mentions: string[] = [], parent: string | null = null, orgId = org) =>
    as(S(actor, orgId), `INSERT INTO team_comment (access_code_id, participant_user_id, parent_id, author_user_id, body, mentions) VALUES ($1, $2, $3, $4, $5, $6::uuid[]) RETURNING id, mentions`,
      [orgId, person, parent, actor, body, mentions]);
  const c1 = (await add(cm, p1, 'TT-SECRET-BODY can someone cover Thursday?', [admin, cm, admin]))[0];
  assert.deepEqual(c1.mentions, [admin], 'mentions are cleaned: no repeats, never the author');
  assert.match(await err(add(cm, p1, 'Dana, can you take this?', [cm2])), /mention_out_of_reach/, 'a colleague who cannot reach the person cannot be mentioned');
  assert.match(await err(add(cm, p1, 'Hello', [staff2])), /mention_not_team/, 'nor someone from another organization');
  assert.match(await err(add(cm2, p1, 'Not mine to talk about')), /reach|row-level security/i, 'a colleague who does not reach the person cannot comment on them');
  assert.match(await err(add(staff2, p1, 'Forged', [], null, org)), /staff|row-level security/i, 'another org\'s staff forging this org\'s scope cannot comment');
  assert.match(await err(as(S(cm), `INSERT INTO team_comment (access_code_id, participant_user_id, author_user_id, body) VALUES ($1, $2, $3, 'In your name')`, [org, p1, admin])), /written by the staff member|row-level security/i, 'nor in somebody else\'s name');

  const listC = (actor: string, seesAll: boolean, person: string | null, orgId = org) => as(S(actor, orgId), LIST_COMMENTS_SQL, reachP(actor, seesAll, person, orgId));
  assert.equal((await listC(cm, false, p1)).length, 1, 'the case manager reads the comment through the app statement');
  assert.equal((await listC(admin, true, p1)).length, 1, 'and so does the admin who was mentioned');
  assert.equal((await listC(owner, true, p1)).length, 1, 'and the owner');
  assert.equal((await listC(cm2, false, p1)).length, 0, 'a colleague who does not reach the person reads nothing');
  const raw = (actor: string, orgId = org) => as(S(actor, orgId), `SELECT count(*)::int AS n FROM team_comment WHERE participant_user_id = $1`, [p1]);
  assert.equal((await raw(cm2))[0].n, 0, 'not even by a raw scoped query that skips the app check (restrictive reach policy)');
  assert.equal((await raw(cm2, org))[0].n, 0);
  assert.equal((await raw(vol))[0].n, 0, 'nor a volunteer');
  assert.equal((await raw(staff2, org2))[0].n, 0, 'another organization reads nothing');
  assert.equal((await raw(staff2, org))[0].n, 0, 'and nothing by forging this org\'s scope');
  assert.equal((await as({ userId: p1 }, `SELECT count(*)::int AS n FROM team_comment`))[0].n, 0, 'the participant never reads team comments');
  assert.equal((await as(S(p1), `SELECT count(*)::int AS n FROM team_comment`))[0].n, 0, 'not even with a forged org scope');
  assert.equal((await as({}, `SELECT count(*)::int AS n FROM team_comment`))[0].n, 0, 'an unscoped read sees nothing');
  assert.match(await err(as(S(cm), `DELETE FROM team_comment WHERE id = $1`, [c1.id])), /permission denied/, 'a comment is never deleted');

  // Colleagues for @: the database's reach rule, per person.
  const col = await as(S(cm), COLLEAGUES_SQL, reachP(cm, false, p1));
  const reaches = Object.fromEntries(col.map((r) => [r.user_id, r.reaches]));
  assert.equal(reaches[admin], true); assert.equal(reaches[owner], true); assert.equal(reaches[cm2], false); assert.equal(reaches[vol], false);
  assert.ok(!(cm in reaches), 'the author is not offered to themselves');
  assert.ok(!(staff2 in reaches), 'nobody from another organization is offered');
  assert.ok((await as(S(cm), COLLEAGUES_SQL, reachP(cm, false, null))).every((r) => r.reaches), 'a team thread: everyone on the team can be mentioned');

  // A team thread (about nobody): the whole team reads it; mentions and replies work.
  const t1 = (await add(cm, null, 'Staff meeting moved to 2pm', [cm2]))[0];
  assert.equal((await listC(cm2, false, null)).length, 1, 'a team thread is read by the whole team');
  assert.equal((await listC(vol, false, null)).length, 1);
  assert.equal((await listC(staff2, false, null, org2)).length, 0, 'never by another organization');
  const r1 = (await add(cm2, null, 'Got it', [], t1.id))[0];
  assert.ok(r1.id, 'a reply under the thread');
  assert.match(await err(add(cm2, null, 'Nested', [], r1.id)), /reply goes under/, 'one level deep');
  assert.match(await err(add(cm, p1, 'Wrong thread', [], t1.id)), /reply goes under/, 'a reply stays in its conversation');

  // Correction keeps the earlier wording; only the author corrects.
  await as(S(cm), `UPDATE team_comment SET body = 'TT-SECRET-BODY corrected: Friday' WHERE id = $1`, [c1.id]);
  const vers = await as(S(admin), `SELECT body FROM team_comment_version WHERE comment_id = $1`, [c1.id]);
  assert.deepEqual(vers.map((v) => v.body), ['TT-SECRET-BODY can someone cover Thursday?'], 'the earlier wording is kept and readable by the team');
  assert.equal((await as(S(cm2), `SELECT count(*)::int AS n FROM team_comment_version WHERE comment_id = $1`, [c1.id]))[0].n, 0, 'but not by someone out of reach');
  assert.equal((await as(S(admin), `UPDATE team_comment SET body = 'Admin rewrite' WHERE id = $1 RETURNING id`, [c1.id])).length, 0, 'nobody else rewrites it');
  assert.match(await err(as(S(cm), `UPDATE team_comment SET author_user_id = $2 WHERE id = $1`, [c1.id, admin])), /permission denied/, 'the author cannot be changed');
  assert.match(await err(as(S(cm), `UPDATE team_comment SET mentions = ARRAY[$2]::uuid[] WHERE id = $1`, [c1.id, cm2])), /mention_out_of_reach/, 'an added mention is checked too');

  /* --------------------------------------------------------------- inbox -- */
  const inbox = (actor: string, unread = false, orgId = org) => as(S(actor, orgId), LIST_INBOX_SQL, [orgId, actor, [...INBOX_KINDS], unread, null, 100]);
  const unreadN = async (actor: string) => (await as(S(actor), UNREAD_COUNT_SQL, [org, actor]))[0].n as number;
  const adminItems = await inbox(admin);
  assert.deepEqual(adminItems.map((i) => [i.kind, i.ref_table, i.participant_user_id]), [['mention', 'team_comment', p1]], 'the mentioned admin has one item');
  assert.equal(adminItems[0].summary, 'mentioned you in a comment about them', 'fixed words, never the body');
  assert.ok(!JSON.stringify(adminItems).includes('TT-SECRET'), 'no body anywhere in the inbox');
  assert.deepEqual((await inbox(cm2)).map((i) => i.kind), ['mention'], 'cm2 was mentioned in the team thread');
  assert.deepEqual((await inbox(cm)).map((i) => i.kind), ['reply'], 'cm got the reply to their thread');
  assert.equal((await as(S(cm2), `SELECT count(*)::int AS n FROM staff_inbox_item WHERE recipient_user_id = $1`, [admin]))[0].n, 0, 'nobody reads another person\'s inbox');
  assert.equal((await as(S(owner), `SELECT count(*)::int AS n FROM staff_inbox_item WHERE recipient_user_id <> $1`, [owner]))[0].n, 0, 'not even the owner');
  assert.match(await err(as(S(cm), `INSERT INTO staff_inbox_item (access_code_id, recipient_user_id, kind, ref_table, ref_id, summary) VALUES ($1, $2, 'mention', 'team_comment', $3, 'forged')`, [org, admin, c1.id])), /permission denied/, 'the app cannot write an item');
  assert.match(await err(as(S(admin), `UPDATE staff_inbox_item SET summary = 'rewritten' WHERE recipient_user_id = $1`, [admin])), /permission denied/, 'or reword one');
  assert.match(await err(as(S(cm), `SELECT public.smr_inbox_write($1, $2, 'mention', NULL, 'team_comment', $3, 'forged')`, [org, admin, c1.id])), /permission denied/, 'or call the writer');
  assert.equal(await unreadN(admin), 1);
  assert.equal((await as(S(cm), `UPDATE staff_inbox_item SET read_at = now() WHERE recipient_user_id = $1 RETURNING id`, [admin])).length, 0, 'nobody marks another person\'s items');
  assert.equal((await as(S(admin), `UPDATE staff_inbox_item SET read_at = now() WHERE recipient_user_id = $1 AND read_at IS NULL RETURNING id`, [admin])).length, 1, 'the recipient marks theirs read');
  assert.equal(await unreadN(admin), 0);

  /* --------------------------------------------------------------- tasks -- */
  const addTask = (actor: string, person: string | null, ownerId: string, title = 'TT-TASK bring papers') =>
    as(S(actor), `INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [org, person, ownerId, actor, title]);
  const tk1 = (await addTask(cm, p1, admin))[0].id;
  assert.ok(tk1, 'a task about p1 can be given to the admin, who reaches them');
  assert.match(await err(addTask(cm, p1, cm2)), /task_assign_out_of_reach/, 'not to a colleague who cannot see the person');
  assert.match(await err(addTask(cm, p1, staff2)), /task_assign_not_team/, 'not to someone from another organization');
  assert.match(await err(addTask(cm, null, cm2)), /row-level security/i, 'a to-do about nobody stays with its maker unless they see everyone (102 policy)');
  const tAdmin = (await addTask(admin, null, cm, 'Call the workforce office back'))[0].id;
  assert.ok(tAdmin, 'someone who sees everyone hands a to-do about nobody to a colleague');
  const items = await inbox(admin);
  assert.ok(items.some((i) => i.kind === 'task_assigned' && i.ref_id === tk1 && i.summary === 'gave you a task about them'), 'the new owner gets an inbox item');
  assert.ok((await inbox(cm)).some((i) => i.kind === 'task_assigned' && i.ref_id === tAdmin && i.summary === 'gave you a task'));
  const tkAct = await q(`SELECT action, summary, staff_user_id FROM org_activity WHERE entity = 'task' AND entity_id = $1`, [tk1]);
  assert.deepEqual(tkAct.rows.map((r: any) => [r.action, r.summary, r.staff_user_id]), [['assigned', 'added a task about them for a team member', admin]], 'logged as assigned, to whom, in fixed words');
  // Handing on later.
  const tk2 = (await addTask(cm, p1, cm, 'TT-TASK call the shelter'))[0].id;
  assert.match(await err(as(S(cm), `UPDATE staff_task SET owner_user_id = $2 WHERE id = $1`, [tk2, cm2])), /task_assign_out_of_reach/, 'handing on is checked the same way');
  await as(S(cm), `UPDATE staff_task SET owner_user_id = $2 WHERE id = $1`, [tk2, owner]);
  const act2 = await q(`SELECT action, summary FROM org_activity WHERE entity = 'task' AND entity_id = $1 ORDER BY id`, [tk2]);
  assert.deepEqual(act2.rows.map((r: any) => [r.action, r.summary]), [['created', 'added a task'], ['assigned', 'handed a task about them to a team member']]);
  assert.equal((await as(S(cm2), `UPDATE staff_task SET owner_user_id = $2 WHERE id = $1 RETURNING id`, [tk2, cm2])).length, 0, 'someone who cannot see the task cannot take it');
  const tk3 = (await as(S(cm2), `INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title) VALUES ($1, $2, $3, $3, 'TT-TASK p2') RETURNING id`, [org, p2, cm2]))[0].id;
  await as(S(cm2), `UPDATE staff_task SET done_at = now(), done_by = $2 WHERE id = $1`, [tk3, cm2]);
  assert.match(await err(as(S(cm2), `UPDATE staff_task SET owner_user_id = $2 WHERE id = $1`, [tk3, owner])), /task_assign_closed/, 'a finished task stays where it is');
  // Someone who neither made nor owns it, without assign rights, cannot hand it on even when they reach the person.
  const tk4 = (await as(S(admin), `INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title) VALUES ($1, $2, $3, $3, 'TT-TASK admin own') RETURNING id`, [org, p1, admin]))[0].id;
  assert.match(await err(as(S(cm), `UPDATE staff_task SET owner_user_id = $2 WHERE id = $1`, [tk4, cm])), /task_assign_refused/, 'not their task to hand on');
  // The 105 retention task maker (a definer path) still makes tasks for the assigned case manager.
  const o1 = (await as(S(admin), `INSERT INTO outcome_record (access_code_id, client_user_id, employer, start_date, source, created_by) VALUES ($1, $2, 'Lakeshore Works (Demo)', current_date - 10, 'staff_reported', $3) RETURNING id`, [org, p1, admin]))[0].id;
  const made = await q(`SELECT owner_user_id FROM staff_task WHERE source_id = $1`, [o1]);
  assert.ok(made.rows.length >= 1 && made.rows.every((r: any) => r.owner_user_id === cm), 'system-made check-in tasks are untouched by the handoff guard');
  assert.equal((await inbox(cm)).filter((i) => i.kind === 'task_assigned').length, 1, 'and they do not flood the inbox');

  /* ------------------------------------------------------ change requests -- */
  const ask = (actor: string, title = 'Add a field for shoe size', kind = 'field') =>
    as(S(actor), `INSERT INTO org_change_request (access_code_id, requested_by, kind, title, body, target) VALUES ($1, $2, $3, $4, 'TT-CR-BODY for boots', '/dashboard/today') RETURNING id`, [org, actor, kind, title]);
  const cr = (await ask(cm))[0].id;
  assert.match(await err(as(S(cm), `INSERT INTO org_change_request (access_code_id, requested_by, kind, title) VALUES ($1, $2, 'field', 'In your name')`, [org, cm2])), /made by the staff member|row-level security/i);
  assert.match(await err(as(S(cm), `INSERT INTO org_change_request (access_code_id, requested_by, kind, title, status) VALUES ($1, $2, 'field', 'Pre-answered', 'done')`, [org, cm])), /starts open/);
  const listCR = (actor: string, queue: boolean, orgId = org) => as(S(actor, orgId), LIST_CHANGE_REQUESTS_SQL, [orgId, actor, queue, null]);
  assert.equal((await listCR(cm, false)).length, 1, 'the asker reads their own');
  assert.equal((await listCR(cm2, true)).length, 0, 'a colleague reads none, even asking for the queue');
  assert.equal((await listCR(admin, true)).length, 1, 'an org admin reads the queue');
  assert.equal((await listCR(owner, true)).length, 1, 'and the owner');
  assert.equal((await listCR(staff2, true, org2)).length, 0, 'another organization reads nothing');
  assert.equal((await listCR(staff2, true, org)).length, 0, 'even forging the scope');
  for (const m of [owner, admin]) assert.ok((await inbox(m)).some((i) => i.kind === 'change_request' && i.ref_id === cr && i.summary === 'asked for a change to the fields'), 'each manager hears about it');
  assert.ok(!(await inbox(cm2)).some((i) => i.ref_id === cr), 'other staff do not');
  assert.equal((await as(S(cm), `UPDATE org_change_request SET status = 'done' WHERE id = $1 RETURNING id`, [cr])).length, 0, 'the asker cannot answer their own request');
  assert.match(await err(as(S(admin), `UPDATE org_change_request SET title = 'Rewritten' WHERE id = $1`, [cr])), /permission denied/, 'what was asked cannot be reworded');
  assert.match(await err(as(S(admin), `UPDATE org_change_request SET status = 'declined' WHERE id = $1`, [cr])), /declined_why/, 'a no needs a reason');
  await as(S(admin), `UPDATE org_change_request SET status = 'accepted', answer = 'Yes, next week' WHERE id = $1`, [cr]);
  const after = (await as(S(cm), `SELECT status, answer, answered_by FROM org_change_request WHERE id = $1`, [cr]))[0];
  assert.deepEqual([after.status, after.answer, after.answered_by], ['accepted', 'Yes, next week', admin], 'stamped with who answered');
  assert.ok((await inbox(cm)).some((i) => i.kind === 'change_answered' && i.summary === 'said yes to your change request about the fields'), 'the asker hears back');
  await as(S(cm), `INSERT INTO org_change_reply (request_id, access_code_id, author_user_id, body) VALUES ($1, $2, $3, 'Thank you')`, [cr, org, cm]);
  await as(S(owner), `INSERT INTO org_change_reply (request_id, access_code_id, author_user_id, body) VALUES ($1, $2, $3, 'On it')`, [cr, org, owner]);
  assert.match(await err(as(S(cm2), `INSERT INTO org_change_reply (request_id, access_code_id, author_user_id, body) VALUES ($1, $2, $3, 'Me too')`, [cr, org, cm2])), /row-level security|replies here/i, 'a bystander cannot reply');
  assert.equal((await as(S(cm), `SELECT count(*)::int AS n FROM org_change_reply WHERE request_id = $1`, [cr]))[0].n, 2);
  assert.equal((await as(S(cm2), `SELECT count(*)::int AS n FROM org_change_reply WHERE request_id = $1`, [cr]))[0].n, 0, 'replies follow their request');
  await as(S(admin), `UPDATE org_change_request SET status = 'done' WHERE id = $1`, [cr]);
  assert.match(await err(as(S(admin), `UPDATE org_change_request SET status = 'open' WHERE id = $1`, [cr])), /change_request_move/, 'done stays done');
  const crAct = await q(`SELECT summary FROM org_activity WHERE entity = 'change_request' ORDER BY id`);
  assert.ok(crAct.rows.length >= 4 && crAct.rows.every((r: any) => !/TT-CR-BODY|shoe|Thank|On it/.test(r.summary)), 'activity says what happened, never what was typed');

  /* ---------------------------------------------------------- note review -- */
  const note = (await as(S(cm), `INSERT INTO case_note (access_code_id, client_user_id, author_user_id, kind, body) VALUES ($1, $2, $3, 'call', 'TT-NOTE called about boots') RETURNING id`, [org, p1, cm]))[0].id;
  const submit = async (actor: string) => (await as(S(actor), `SELECT public.smr_note_review_submit($1) AS r`, [note]))[0].r;
  const decide = async (actor: string, d: string, c: string | null) => (await as(S(actor), `SELECT public.smr_note_review_decide($1, $2, $3) AS r`, [note, d, c]))[0].r;
  assert.equal(await submit(cm), 'module_off', 'off by default');
  assert.match(await err(q(`INSERT INTO org_profile (access_code_id, org_type, modules) VALUES ($1, 'reentry_nonprofit', '{"bogus": true}')`, [org])), /known list/, 'unknown module keys are still refused');
  await q(`INSERT INTO org_profile (access_code_id, org_type, modules) VALUES ($1, 'reentry_nonprofit', '{"note_review": true}')`, [org]);
  assert.equal(await submit(cm2), 'not_found', 'someone out of reach cannot even find it');
  assert.equal(await submit(admin), 'not_author', 'only its author sends it');
  assert.equal(await submit(cm), 'ok');
  assert.equal(await submit(cm), 'already_pending');
  assert.match(await err(as(S(cm), `UPDATE case_note SET body = 'changed while pending' WHERE id = $1`, [note])), /note_pending/, 'read-only while pending');
  assert.equal(await decide(cm, 'approve', null), 'not_reviewer', 'a case manager does not review');
  assert.equal(await decide(admin, 'send_back', ''), 'needs_comment', 'sending back needs a comment');
  assert.equal(await decide(admin, 'send_back', 'Say which boots and when'), 'ok');
  assert.ok((await inbox(cm)).some((i) => i.kind === 'note_review' && i.summary === 'sent your note about them back with a comment'));
  await as(S(cm), `UPDATE case_note SET body = 'TT-NOTE called about work boots, size 10, Friday' WHERE id = $1`, [note]);
  assert.equal(await submit(cm), 'ok', 'sent again after the fix');
  assert.ok((await inbox(owner)).some((i) => i.kind === 'note_review' && i.ref_id === note), 'managers hear about it');
  const queue = await as(S(owner), REVIEW_QUEUE_SQL, [org, true, owner]);
  assert.deepEqual(queue.map((r) => r.note_id), [note], 'the review queue lists it');
  assert.equal((await as(S(cm), REVIEW_QUEUE_SQL, [org, false, cm])).length, 0, 'never your own note in your queue');
  assert.equal(await decide(owner, 'approve', null), 'ok');
  assert.match(await err(as(S(cm), `UPDATE case_note SET body = 'after approval' WHERE id = $1`, [note])), /note_locked/, 'approved notes are locked');
  const states = await as(S(cm), NOTE_REVIEWS_SQL, [org, false, cm, p1]);
  assert.deepEqual([states[0].status, states[0].events.map((e: any) => e.to_status)], ['approved', ['pending', 'sent_back', 'pending', 'approved']]);
  assert.equal(states[0].events[1].comment, 'Say which boots and when');
  assert.equal((await as(S(cm2), NOTE_REVIEWS_SQL, [org, false, cm2, p1])).length, 0, 'out of reach: no reviews');
  assert.equal((await as(S(cm2), `SELECT count(*)::int AS n FROM note_review_event`))[0].n, 0, 'not even raw');
  assert.match(await err(as(S(owner), `UPDATE note_review SET status = 'pending'`)), /permission denied/, 'reviews move only through the functions');

  /* ------------------------------------------------- timeline and reach -- */
  const tl = await as(S(cm), timelineSql(['comment']), [org, false, cm, p1, null, '', 50]);
  assert.deepEqual(tl.map((r) => r.type), ['comment'], 'the comment is on the person\'s timeline');
  assert.equal((await as(S(cm2), timelineSql(['comment']), [org, false, cm2, p1, null, '', 50])).length, 0, 'not for someone out of reach');
  assert.equal((await as(S(cm), timelineSql(['activity']), [org, false, cm, p1, null, '', 50])).filter((r) => r.f1 === 'comment').length, 0, 'and not twice through the activity branch');
  // Reassigning p1 away from cm: their comment, their inbox items about p1 and the timeline all follow the person.
  await q(`UPDATE client_staff_assignment SET staff_user_id = $3 WHERE access_code_id = $1 AND client_user_id = $2`, [org, p1, cm2]);
  assert.equal((await raw(cm))[0].n, 0, 'the old case manager no longer reads comments about them');
  assert.equal((await raw(cm2))[0].n, 1, 'the new one does');
  assert.ok((await inbox(cm)).every((i) => i.participant_user_id !== p1), 'inbox items about them leave the old case manager\'s inbox');
  await q(`UPDATE client_staff_assignment SET staff_user_id = $3 WHERE access_code_id = $1 AND client_user_id = $2`, [org, p1, cm]);

  // Leaving the staff ends that person's inbox there.
  await q(`DELETE FROM org_staff WHERE access_code_id = $1 AND user_id = $2`, [org, cm2]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM staff_inbox_item WHERE recipient_user_id = $1`, [cm2])).rows[0].n, 0);

  // Activity: entities accepted, and no typed words in any summary.
  const acts = await q(`SELECT entity, summary FROM org_activity WHERE access_code_id = $1`, [org]);
  assert.ok(acts.rows.some((r: any) => r.entity === 'comment'));
  assert.ok(acts.rows.every((r: any) => !/TT-SECRET|TT-TASK|TT-NOTE|TT-CR|Staff meeting|Got it/.test(r.summary)), 'no body, title or request text in the log');

  // A deleted staff account: their comment stays with no author; their versions and items go with them.
  await q(`DELETE FROM users WHERE id = $1`, [admin]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM team_comment WHERE id = $1`, [c1.id])).rows[0].n, 1, 'the comment stays');
  await q(`DELETE FROM users WHERE id = $1`, [cm]);
  const kept = (await q(`SELECT author_user_id FROM team_comment WHERE id = $1`, [c1.id])).rows[0] as any;
  assert.equal(kept.author_user_id, null, 'with the author cleared, which the guard allows only for a deleted account');
});

/**
 * Real SQL for the staff workflow (migration 105, house lane L5): the exact
 * statements orgDrafts, orgReferrals, orgSearch and orgTimeline run, against
 * migrations 001-105 in pglite, as the NOSUPERUSER app role (RLS on).
 *
 * Migrations 100 to 104 (and 106) are the real ones from the integration
 * branch: no stand-ins.
 *
 * Proves: drafts are owner-only (not an admin, not the owner, not another org);
 * referrals are reach-scoped and cross-org sealed in the DATABASE (a raw read
 * that skips the app's check still sees nothing); the closed-loop path, the
 * reason rules and the partner consent block hold even written directly;
 * history is trigger-only; retention tasks are made once, finished by the
 * check-in and cancelled by an end; search matches only what the header may
 * show, finds by phone and program id, and answers 10,000 members fast.
 *
 * Run it alone. Skipped unless SMR_PGLITE_DIR points at a node_modules folder
 * holding @electric-sql/pglite (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 * SMR_PGLITE_NO_TRGM=1 runs it without pg_trgm (the fallback scorer).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DRAFT_SQL } from '@crucible/core/src/orgDrafts';
import { REFERRAL_SQL, LIST_REFERRALS_SQL } from '@crucible/core/src/orgReferrals';
import { searchSql, duplicateSql, likeEscape, wordPatterns, type SearchEnv } from '@crucible/core/src/orgSearch';
import { timelineSql, timelineItemFromRow, type TimelineRow } from '@crucible/core/src/orgTimeline';
import { TIMELINE_TYPES as ALL_TIMELINE_TYPES, normalizeSearch, phoneDigits, duplicateReasons, REFERRAL_TRANSITIONS, REFERRAL_STATUSES } from '@crucible/core/src/orgWorkflowShared';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite workflow test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;
const withTrgm = process.env.SMR_PGLITE_NO_TRGM !== '1';
// This file applies migrations up to 105; team comments (109) have their own test (team-talk-pglite).
const TIMELINE_TYPES = ALL_TIMELINE_TYPES.filter((t) => t !== 'comment');

test('workflow (105): owner-only drafts, sealed referrals, retention tasks once, consent-true search', { skip, timeout: 600_000 }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const extensions: Record<string, unknown> = { pgcrypto };
  if (withTrgm) extensions.pg_trgm = (await import(join(dir!, '@electric-sql/pglite/dist/contrib/pg_trgm.js'))).pg_trgm;
  const db = new PGlite({ extensions });
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  await db.exec(`CREATE ROLE smr_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO smr_app;`);
  const files = readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 105).sort();
  const failed: string[] = [];
  const apply = async (f: string) => {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); }
    catch (e) { await db.exec('ROLLBACK').catch(() => {}); failed.push(`${f}: ${(e as Error).message}`); }
  };
  for (const f of files.filter((x) => Number(x.slice(0, 3)) < 105)) await apply(f);
  assert.ok(files.some((f) => f.startsWith('102_')) && !failed.some((f) => f.startsWith('102_')), `105 is tested against the real 102: ${failed.join(' | ')}`);
  for (const n of ['102_', '103_', '104_']) assert.ok(files.some((f) => f.startsWith(n)) && !failed.some((f) => f.startsWith(n)), `105 is tested against the real ${n}: ${failed.join(' | ')}`);
  await apply('105_workflow.sql');
  assert.ok(!failed.some((f) => f.startsWith('105_')), `105 must apply: ${failed.filter((f) => f.startsWith('105_')).join(' | ')}`);

  const q = (t: string, p: unknown[] = []) => db.query(t, p);
  const priv = async (t: string, p: string) => ((await q(`SELECT has_table_privilege('smr_app', $1, $2) AS ok`, [t, p])).rows[0] as { ok: boolean }).ok;
  assert.deepEqual([await priv('staff_draft', 'SELECT'), await priv('staff_draft', 'DELETE'), await priv('referral', 'UPDATE'), await priv('referral', 'DELETE'),
    await priv('referral_event', 'SELECT'), await priv('referral_event', 'INSERT')], [true, true, true, false, true, false], 'grants as designed');
  const trgm = ((await q(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS ok`)).rows[0] as { ok: boolean }).ok;
  assert.equal(trgm, withTrgm, 'pg_trgm is used exactly when it is available');

  /** As the app role, scoped like runScoped (org + user) or runAsUser (user only). */
  const as = async (who: { orgId?: string; userId?: string; reason?: string }, text: string, params: unknown[] = []) => {
    await db.exec('BEGIN; SET LOCAL ROLE smr_app;');
    try {
      if (who.orgId) await db.query(`SELECT set_config('app.org_id', $1, true), set_config('app.org_role', 'staff', true)`, [who.orgId]);
      if (who.reason) await db.query(`SELECT set_config('app.correction_reason', $1, true)`, [who.reason]);
      if (who.userId) await db.query(`SELECT set_config('app.user_id', $1, true)`, [who.userId]);
      const r = await db.query(text, params);
      await db.exec('COMMIT');
      return r.rows as Record<string, any>[];
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  };
  const fails = async (p: Promise<unknown>, re?: RegExp) => { try { await p; return false; } catch (e) { return re ? re.test((e as Error).message) : true; } };

  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const [owner, admin, cm, cm2, owner2, p1, p2, p3, p4] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id);
  const names: Record<string, string> = { [p1]: 'Dana Whitfield', [p2]: 'Ray Diaz', [p3]: 'Sam Cole', [p4]: 'Kim Hale' };
  for (const u of [owner, admin, cm, cm2, owner2, p1, p2, p3, p4]) {
    await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `acct-${u.slice(-2)}@example.test`, names[u] ?? `Staff ${u.slice(-2)}`]);
  }
  const mkOrg = async (code: string, by: string) => ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2, max_redemptions) VALUES ($1, $1, 'client', $2, true, 20000) RETURNING id`, [code, by])).rows[0] as { id: string }).id;
  const org = await mkOrg('PGWF0001', owner), org2 = await mkOrg('PGWF0002', owner2);
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'staff'), ($1, $4, 'staff')`, [org, admin, cm, cm2]);
  for (const [u, o] of [[p1, org], [p2, org], [p3, org], [p4, org2]]) await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [u, o]);
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $3, $5), ($1, $4, $6, $5)`, [org, p1, cm, p2, owner, cm2]);
  // p1 shares progress (the header shows their account name); p3 joined by code and shares nothing.
  await q(`INSERT INTO consumer_consent (user_id, consent_layer, status, consent_text_version, collection_context) VALUES ($1, 'sharing', 'granted', 'test', '{}'::jsonb)`, [p1]);
  await q(`INSERT INTO org_invite (access_code_id, user_id, invited_by, invited_name, invited_email) VALUES ($1, $2, $3, 'Ray Diaz', 'ray.invited@example.test')`, [org, p2, owner]);

  // ---------------------------------------------------------------- drafts
  const draftAs = (u: string, o = org) => ({ orgId: o, userId: u });
  assert.equal((await as(draftAs(cm), DRAFT_SQL.save, [org, cm, p1, 'note', 'Talked about the bus pass'])).length, 1, 'a case manager saves a draft about their person');
  await as(draftAs(cm), DRAFT_SQL.save, [org, cm, p1, 'note', 'Talked about the bus pass and the Thursday interview']);
  const mine = await as(draftAs(cm), DRAFT_SQL.get, [org, cm, p1, 'note']);
  assert.equal(mine[0]?.body, 'Talked about the bus pass and the Thursday interview', 'saving again updates the one draft');
  assert.equal(Number((await q(`SELECT count(*)::int AS n FROM staff_draft`)).rows.map((r: any) => r.n)[0]), 1, 'one row per person, field and author');
  for (const [who, label] of [[admin, 'an org admin'], [owner, 'the owner'], [cm2, 'a colleague']] as const) {
    assert.equal((await as(draftAs(who), `SELECT * FROM staff_draft`)).length, 0, `${label} sees no one else's draft, even reading the table directly`);
    assert.equal((await as(draftAs(who), DRAFT_SQL.get, [org, cm, p1, 'note'])).length, 0, `${label} cannot fetch it by naming its author`);
  }
  assert.equal((await as(draftAs(cm, org2), `SELECT * FROM staff_draft`)).length, 0, 'not from another organization scope');
  assert.equal((await as({ userId: cm }, `SELECT * FROM staff_draft`)).length, 0, 'not without an organization scope');
  assert.equal((await as({ userId: p1 }, `SELECT * FROM staff_draft`)).length, 0, 'never the participant');
  assert.ok(await fails(as(draftAs(cm), DRAFT_SQL.save, [org, admin, p1, 'note', 'forged'])), 'cannot write a draft in someone else\'s name');
  assert.ok(await fails(as(draftAs(cm), DRAFT_SQL.save, [org, cm, p2, 'note', 'about a colleague\'s person'])), 'cannot draft about someone out of reach (restrictive policy)');
  assert.ok(await fails(as(draftAs(cm), DRAFT_SQL.save, [org, cm, p4, 'note', 'another org'])), 'cannot draft about another org\'s member');
  assert.ok(await fails(as(draftAs(cm), DRAFT_SQL.save, [org, cm, p1, 'Bad Kind!', 'x'])), 'the kind shape is checked by the database');
  await as(draftAs(cm), DRAFT_SQL.clear, [org, cm, p1, 'note']);
  assert.equal((await as(draftAs(cm), DRAFT_SQL.get, [org, cm, p1, 'note'])).length, 0, 'clear removes it');
  await as(draftAs(cm), DRAFT_SQL.save, [org, cm, null, 'task', 'Order folders']);
  // Backdate it (the guard trigger stamps updated_at on every write, so step around triggers for the fixture).
  await db.exec(`SET session_replication_role = replica`);
  await q(`UPDATE staff_draft SET updated_at = now() - interval '40 days' WHERE user_id = $1`, [cm]);
  await db.exec(`SET session_replication_role = origin`);
  await as(draftAs(cm), DRAFT_SQL.purge, []);
  assert.equal((await q(`SELECT count(*)::int AS n FROM staff_draft WHERE user_id = $1`, [cm])).rows[0].n, 0, 'drafts untouched for 30 days are purged');

  // ------------------------------------------------------------- referrals
  const R = (actor: string, seesAll: boolean) => [org, seesAll, actor];
  const today = new Date().toISOString().slice(0, 10);
  const ins = (actor: string, seesAll: boolean, person: string, kind: string, name: string, status: string, owner_: string | null = actor, resource: string | null = null) =>
    as({ orgId: org, userId: actor }, REFERRAL_SQL.insert, [...R(actor, seesAll), person, kind, resource, name, 'Needs boots for the job', owner_, status, today]);
  const r1 = (await ins(cm, false, p1, 'other', 'Uncle Joe Construction', 'draft'))[0]?.id as string;
  assert.ok(r1, 'a case manager makes a referral for their person');
  assert.equal((await ins(cm, false, p2, 'other', 'X Place', 'draft')).length, 0, 'not for a colleague\'s person (app predicate)');
  assert.ok(await fails(as({ orgId: org, userId: cm }, `INSERT INTO referral (access_code_id, participant_user_id, to_kind, to_name, status, created_by) VALUES ($1, $2, 'other', 'Raw Place', 'draft', $3)`, [org, p2, cm])),
    'and the database refuses it written directly (restrictive reach policy)');
  assert.equal((await ins(cm, false, p1, 'other', 'Owner from nowhere', 'draft', p4)).length, 0, 'the owner must be on this organization\'s staff');
  assert.equal((await as({ orgId: org, userId: cm2 }, `SELECT id FROM referral`)).length, 0, 'a colleague does not see it, even reading the table');
  assert.equal((await as({ orgId: org, userId: admin }, `SELECT id FROM referral`)).length, 1, 'an admin does');
  assert.equal((await as({ orgId: org2, userId: owner2 }, `SELECT id FROM referral`)).length, 0, 'another organization sees nothing');
  assert.equal((await as({ userId: p1 }, `SELECT id FROM referral`)).length, 0, 'nor does the participant (it is the org\'s record)');

  const mv = (actor: string, rid: string, from: string, to: string, reason: string | null = null) =>
    as({ orgId: org, userId: actor }, REFERRAL_SQL.move, [...R(actor, false), rid, from, to, reason, today]);
  assert.ok(await fails(mv(cm, r1, 'draft', 'accepted'), /cannot go from draft to accepted/), 'a draft cannot jump to accepted');
  assert.equal((await mv(cm, r1, 'draft', 'sent')).length, 1, 'draft to sent');
  assert.equal((await mv(cm, r1, 'draft', 'closed', 'stale')).length, 0, 'a move from a status it is no longer in changes nothing');
  assert.equal((await mv(cm2, r1, 'sent', 'accepted')).length, 0, 'a colleague cannot move it');
  assert.ok(await fails(mv(cm, r1, 'sent', 'declined', null), /check/i), 'declined needs a reason');
  assert.equal((await mv(cm, r1, 'sent', 'declined', 'No openings this month')).length, 1, 'declined with a reason');
  assert.ok(await fails(mv(cm, r1, 'declined', 'closed', null), /needs a reason/), 'closing without help given needs a reason');
  assert.equal((await mv(cm, r1, 'declined', 'closed', 'Found work elsewhere')).length, 1, 'closed with a reason');
  assert.ok(await fails(mv(cm, r1, 'closed', 'sent')), 'closed stays closed');
  const r2 = (await ins(cm, false, p1, 'other', 'Northside Pantry', 'sent'))[0].id as string;
  for (const [a, b] of [['sent', 'accepted'], ['accepted', 'contacted'], ['contacted', 'service_delivered']]) assert.equal((await mv(cm, r2, a, b)).length, 1, `${a} to ${b}`);
  assert.equal((await mv(cm, r2, 'service_delivered', 'closed', null)).length, 1, 'after help was given, closing needs no reason');
  const r2row = (await q(`SELECT delivered_at, closed_at, due_on FROM referral WHERE id = $1`, [r2])).rows[0] as any;
  assert.ok(r2row.delivered_at && r2row.closed_at && r2row.due_on === null, 'delivered and closed are both stamped; a closed referral has no due date');
  assert.ok(await fails(as({ orgId: org, userId: cm }, `UPDATE referral SET to_name = 'Rewritten' WHERE id = $1`, [r2])), 'a referral that went out keeps its wording');

  // Partner organizations: blocked until consent.
  const rp = (await ins(cm, false, p1, 'partner_org', 'Partner Workforce Center', 'draft'))[0].id as string;
  assert.ok(await fails(ins(cm, false, p1, 'partner_org', 'Partner Workforce Center', 'sent'), /check/i), 'a partner referral cannot start as sent');
  assert.ok(await fails(mv(cm, rp, 'draft', 'sent'), /check/i), 'nor be sent without the person\'s consent');
  await as({ orgId: org, userId: cm }, `UPDATE referral SET consent_ok = true WHERE id = $1`, [rp]);
  assert.equal((await q(`SELECT consent_ok FROM referral WHERE id = $1`, [rp])).rows[0].consent_ok, false, 'the app cannot claim consent: the database decides it');
  assert.ok(await fails(mv(cm, rp, 'draft', 'sent'), /check/i), 'still blocked after that attempt');
  assert.equal((await q(`SELECT consent_ok FROM referral WHERE id = $1`, [r2])).rows[0].consent_ok, true, 'somewhere else shares nothing, so nothing is waiting on consent');

  // History: trigger-only.
  const ev = (await q(`SELECT from_status, to_status, status_reason FROM referral_event WHERE referral_id = $1 ORDER BY at, id`, [r1])).rows as any[];
  assert.deepEqual(ev.map((e) => `${e.from_status ?? '-'}>${e.to_status}`), ['->draft', 'draft>sent', 'sent>declined', 'declined>closed'], 'every move is in the history');
  assert.equal(ev[2].status_reason, 'No openings this month');
  assert.ok(await fails(as({ orgId: org, userId: cm }, `INSERT INTO referral_event (referral_id, access_code_id, participant_user_id, to_status) VALUES ($1, $2, $3, 'sent')`, [r1, org, p1]), /permission denied/),
    'the app cannot write history');
  assert.ok(await fails(as({ orgId: org, userId: cm }, `DELETE FROM referral WHERE id = $1`, [r1]), /permission denied/), 'nor delete a referral');
  assert.equal((await as({ orgId: org, userId: cm2 }, `SELECT id FROM referral_event`)).length, 0, 'a colleague does not see the history either');
  const act = (await q(`SELECT entity, action, summary FROM org_activity WHERE entity_id = $1 ORDER BY at, id`, [r1])).rows as any[];
  assert.deepEqual(act.map((a) => a.action), ['created', 'status_changed', 'status_changed', 'closed'], 'and in the activity log');
  assert.ok(act.every((a) => a.entity === 'referral' && !/Uncle|boots|openings/i.test(a.summary)), 'the activity summary never names the place or the reason');

  // Overdue list for Today.
  await q(`UPDATE referral SET due_on = current_date - 3 WHERE id = $1`, [rp]);
  const overdue = await as({ orgId: org, userId: cm }, LIST_REFERRALS_SQL, [...R(cm, false), null, 'overdue', true, today, 50]);
  assert.deepEqual(overdue.map((r) => r.id), [rp], 'past due and open, owned by me');
  assert.equal(overdue[0].participant_name, 'Dana Whitfield', 'the name shown is the consent-gated one (sharing on: their account name)');
  assert.equal((await as({ orgId: org, userId: cm2 }, LIST_REFERRALS_SQL, [...R(cm2, false), null, 'all', false, today, 50])).length, 0, 'a colleague lists none of them');

  // -------------------------------------------------------- retention tasks
  const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const o1 = ((await as({ orgId: org, userId: cm }, `INSERT INTO outcome_record (access_code_id, client_user_id, employer, start_date, source, created_by) VALUES ($1, $2, 'Riverside Fabrication', $3, 'staff_reported', $4) RETURNING id`, [org, p1, ago(100), cm]))[0] as any).id;
  const tasks = async (o: string) => (await q(`SELECT source_mark, owner_user_id, to_char(due_on, 'YYYY-MM-DD') AS due_on, title, done_at, cancelled_at FROM staff_task WHERE source_id = $1 ORDER BY source_mark`, [o])).rows as any[];
  let t = await tasks(o1);
  assert.deepEqual(t.map((x) => x.source_mark), [30, 90, 180], 'recording a placement makes the 30, 90 and 180-day tasks');
  assert.ok(t.every((x) => x.owner_user_id === cm), 'owned by the person\'s assigned case manager');
  assert.equal(t[0].due_on, ago(70), 'due on the check-in date');
  assert.equal(t[0].title, '30-day check-in: still at Riverside Fabrication?');
  assert.equal(((await q(`SELECT public.smr_make_retention_tasks($1) AS n`, [o1])).rows[0] as any).n, 0, 'making them again makes nothing (idempotent)');
  assert.equal((await tasks(o1)).length, 3);
  assert.ok(await fails(as({ orgId: org, userId: cm }, `SELECT public.smr_make_retention_tasks($1)`, [o1]), /permission denied/), 'the app cannot call the maker directly');
  assert.ok(await fails(as({ orgId: org, userId: cm }, `UPDATE staff_task SET source_mark = 90 WHERE source_id = $1 AND source_mark = 30`, [o1])), 'where a task came from cannot be edited');
  assert.ok(await fails(as({ orgId: org, userId: cm }, `INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title, source_kind, source_id, source_mark) VALUES ($1, $2, $3, $3, 'forged', 'retention', $4, 30)`, [org, p1, cm, o1])),
    'a second task for the same check-in is refused');
  await as({ orgId: org, userId: cm }, `INSERT INTO retention_check (outcome_id, access_code_id, day_mark, status, method, checked_by) VALUES ($1, $2, 30, 'employed', 'participant_told_me', $3)`, [o1, org, cm]);
  t = await tasks(o1);
  assert.ok(t[0].done_at && !t[1].done_at, 'answering the 30-day check-in finishes its task, and only that one');
  // 102: a correction is a new answer. The task stays done, and the timeline shows both answers.
  const k30 = ((await q(`SELECT id FROM retention_check WHERE outcome_id = $1 AND day_mark = 30`, [o1])).rows[0] as any).id;
  const fixed = ((await as({ orgId: org, userId: cm }, `SELECT public.smr_correct_retention_check($1, 'not_employed', 'participant_told_me', NULL, 'Called the wrong number first') AS r`, [k30]))[0] as any).r;
  assert.equal(fixed, 'ok', 'a check-in can be corrected (102)');
  assert.equal((await tasks(o1)).filter((x) => x.source_mark === 30 && x.done_at).length, 1, 'the correction leaves one finished task');
  assert.equal(((await q(`SELECT public.smr_make_retention_tasks($1) AS n`, [o1])).rows[0] as any).n, 0, 'and makes no new one');
  await as({ orgId: org, userId: cm }, `UPDATE outcome_record SET ended_on = $2, end_reason = 'laid_off' WHERE id = $1`, [o1, ago(-30)]);
  t = await tasks(o1);
  assert.ok(!t[1].cancelled_at && t[2].cancelled_at, 'ending the job cancels check-ins after the end date, not before');
  await as({ orgId: org, userId: cm, reason: 'Recorded for the wrong person' }, `UPDATE outcome_record SET end_reason = 'entered_in_error' WHERE id = $1`, [o1]);
  t = await tasks(o1);
  assert.ok(t[1].cancelled_at && t[0].done_at && !t[0].cancelled_at, 'entered by mistake cancels every open one, and a done one stays done');
  const o3 = ((await as({ orgId: org, userId: admin }, `INSERT INTO outcome_record (access_code_id, client_user_id, employer, start_date, source, created_by) VALUES ($1, $2, 'North Dock', $3, 'participant_reported', $4) RETURNING id`, [org, p3, ago(5), admin]))[0] as any).id;
  assert.ok((await tasks(o3)).every((x) => x.owner_user_id === admin), 'nobody assigned: the person who recorded it owns the tasks');
  assert.equal((await as({ orgId: org, userId: cm2 }, `SELECT id FROM staff_task WHERE source_id = $1`, [o1])).length, 0, 'a colleague does not get them (102 reach on staff_task)');

  // ------------------------------------------------------- timeline (real SQL)
  await as({ orgId: org, userId: cm }, `INSERT INTO case_note (access_code_id, client_user_id, author_user_id, kind, body) VALUES ($1, $2, $3, 'call', 'Called about the interview')`, [org, p1, cm]);
  const unitId = ((await q(`INSERT INTO org_unit (access_code_id, kind, name) VALUES ($1, 'program', 'Job readiness') RETURNING id`, [org])).rows[0] as any).id;
  await q(`INSERT INTO enrollment (access_code_id, org_unit_id, participant_user_id, status, enrolled_on, program_participant_id, created_by) VALUES ($1, $2, $3, 'active', $4, 'JR-0042', $5)`, [org, unitId, p1, ago(20), cm]);
  const tl = (actor: string, seesAll: boolean, types = [...TIMELINE_TYPES], cursor: { at: string; key: string } | null = null, limit = 100) =>
    as({ orgId: org, userId: actor }, timelineSql(types), [org, seesAll, actor, p1, cursor?.at ?? null, cursor?.key ?? '', limit + 1]);
  const all = await tl(cm, false);
  const kinds = new Set(all.map((r) => r.type));
  for (const k of ['note', 'task', 'outcome', 'retention', 'referral', 'enrollment']) assert.ok(kinds.has(k), `the timeline has ${k}`);
  assert.ok(all.every((r, i) => i === 0 || new Date(all[i - 1].at).getTime() >= new Date(r.at).getTime()), 'newest first');
  const items = all.map((r) => timelineItemFromRow(r as TimelineRow, p1));
  assert.ok(items.some((i) => i.title === '30-day check-in at Riverside Fabrication: still working there (since corrected)'), 'the old answer stays, marked');
  assert.ok(items.some((i) => i.title === 'Corrected the 30-day check-in at Riverside Fabrication: no longer there' && i.detail === 'Why: Called the wrong number first'), 'the correction shows with its reason');
  assert.ok(items.some((i) => i.title === 'Placement at Riverside Fabrication corrected (end reason)' && i.detail === 'Why: Recorded for the wrong person'), 'a placement correction shows which field and why, never the values');
  assert.ok(items.some((i) => i.title === 'Referral to Uncle Joe Construction: they turned it down' && i.detail === 'No openings this month'));
  assert.ok(items.some((i) => i.title.startsWith('Active in Job readiness')));
  assert.ok(items.every((i) => !i.title.includes('Dana') && i.href.startsWith(`/dashboard/clients/${p1}`)), 'no participant name in any line; every line links into their page');
  assert.equal((await tl(cm2, false)).length, 0, 'a colleague gets an empty timeline');
  assert.equal((await as({ orgId: org2, userId: owner2 }, timelineSql([...TIMELINE_TYPES]), [org2, true, owner2, p1, null, '', 50])).length, 0, 'another organization gets nothing');
  const notesOnly = await tl(cm, false, ['note', 'correction']);
  assert.ok(notesOnly.length >= 1 && notesOnly.every((r) => r.type === 'note' || r.type === 'correction'), 'a filter chip narrows it');
  const page1 = await tl(cm, false, [...TIMELINE_TYPES], null, 3);
  const page2 = await tl(cm, false, [...TIMELINE_TYPES], { at: page1[2].atx, key: page1[2].key }, 3);
  assert.equal(page1.length, 4, 'a page reads one extra row to know there is more');
  assert.deepEqual([...page1.slice(0, 3), ...page2].map((r) => r.key).slice(0, 6), all.slice(0, 6).map((r) => r.key), 'pages join without a gap or a repeat');

  // ----------------------------------------------------- search and duplicates
  await as({ orgId: org, userId: cm }, `INSERT INTO participant_contact (access_code_id, participant_user_id, phone, aliases) VALUES ($1, $2, '(555) 010-0142', ARRAY['Dee Whit'])`, [org, p1]);
  const env: SearchEnv = { enrollment: true, trgm: trgm ? 'public' : null };
  const S = (actor: string, seesAll: boolean, text: string, scope = 'all') => {
    const n = normalizeSearch(text), d = phoneDigits(n);
    return as({ orgId: org, userId: actor }, searchSql(env), [org, seesAll, actor, n, likeEscape(n), d.length >= 4 ? d : '', scope, 20, wordPatterns(n)]);
  };
  assert.deepEqual((await S(admin, true, 'WHITFIELD')).map((r) => r.user_id), [p1], 'case-insensitive');
  assert.deepEqual((await S(admin, true, 'dana whitfeld')).map((r) => r.user_id), withTrgm ? [p1] : [], withTrgm ? 'a typo still finds them (trigram)' : 'no trigram: a typo misses, honestly');
  assert.deepEqual((await S(admin, true, 'dan whit')).map((r) => r.user_id), [p1], 'word starts');
  assert.equal((await S(admin, true, '555-010-0142'))[0]?.matched_on, 'phone', 'by phone, however it is typed');
  assert.equal((await S(admin, true, 'jr-0042'))[0]?.matched_on, 'program_id', 'by program id');
  assert.equal((await S(admin, true, 'dee whit'))[0]?.user_id, p1, 'by another name they go by');
  assert.equal((await S(admin, true, 'ray.invited@example'))[0]?.user_id, p2, 'a non-sharer by the email the org typed on the invite');
  assert.equal((await S(admin, true, 'acct-07@example')).length, 0, 'never by their account email when they do not share (no oracle)');
  assert.equal((await S(admin, true, 'Sam Cole')).length, 0, 'someone who joined by code and shares nothing is not found by account name');
  assert.equal((await S(cm, false, 'ray')).length, 0, 'a case manager does not find a colleague\'s person');
  assert.equal((await S(cm, false, 'dana', 'mine'))[0]?.mine, true, 'my caseload');
  assert.equal((await as({ orgId: org2, userId: owner2 }, searchSql(env), [org2, true, owner2, 'dana', 'dana', '', 'all', 20, wordPatterns('dana')])).length, 0, 'another organization finds nothing');

  const D = (actor: string, seesAll: boolean, name: string, email: string, phone: string) =>
    as({ orgId: org, userId: actor }, duplicateSql(env), [org, seesAll, actor, normalizeSearch(name), email.includes('@') ? normalizeSearch(email) : '', phoneDigits(phone).length >= 7 ? phoneDigits(phone) : '', wordPatterns(normalizeSearch(name))]);
  const d1 = await D(cm, false, 'Dana Whitfield', '', '');
  assert.equal(d1[0]?.user_id, p1);
  assert.deepEqual(duplicateReasons({ name: d1[0].name, email: d1[0].email, phoneDigits: d1[0].phone_digits, nameScore: d1[0].name_score }, { name: 'Dana Whitfield' }), ['name']);
  assert.equal((await D(cm, false, '', 'ACCT-06@example.test', ''))[0]?.user_id, p1, 'same account email, sharing on');
  assert.equal((await D(cm, false, '', 'acct-08@example.test', '')).length, 0, 'not the account email of someone who shares nothing');
  assert.equal((await D(cm, false, '', '', '1 555 010 0142'))[0]?.user_id, p1, 'same phone');
  const out = (await D(cm, false, 'Ray Diaz', '', ''))[0];
  assert.ok(out && out.in_reach === false, 'a colleague\'s person is found but marked out of reach (the app counts it, never names it)');

  // -------------------------------------- 10,000 members: search stays fast
  await q(`INSERT INTO users (id, email, name)
           SELECT ('10000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'bulk' || g || '@example.test',
                  (ARRAY['Alex','Jordan','Taylor','Morgan','Casey','Riley','Avery','Quinn'])[1 + g % 8] || ' ' || (ARRAY['Brooks','Ortiz','Nguyen','Hale','Moss','Grant','Lee','Kim','Diaz','Cole'])[1 + (g / 8) % 10] || ' ' || g
             FROM generate_series(1, 10000) g`);
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) SELECT ('10000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, $1 FROM generate_series(1, 10000) g`, [org]);
  await q(`INSERT INTO consumer_consent (user_id, consent_layer, status, consent_text_version, collection_context)
           SELECT ('10000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'sharing', 'granted', 'test', '{}'::jsonb FROM generate_series(1, 10000, 2) g`);
  await q(`INSERT INTO participant_contact (access_code_id, participant_user_id, phone) SELECT $1, ('10000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '555' || lpad(g::text, 7, '0') FROM generate_series(1, 10000, 3) g`, [org]);
  await q(`ANALYZE`);
  const timed = async (text: string) => { await S(admin, true, text); const t0 = performance.now(); const r = await S(admin, true, text); return { ms: performance.now() - t0, n: r.length }; };
  const runs = [await timed('jordan ortiz 4321'), await timed('5550004321'), await timed('qinn'), await timed('dana whitfield')];
  console.log(`  search at 10,000 members (${withTrgm ? 'pg_trgm' : 'fallback'}, pglite): ${runs.map((r) => `${r.ms.toFixed(0)} ms/${r.n}`).join(', ')}`);
  const worst = Math.max(...runs.map((r) => r.ms));
  assert.ok(worst < 500, `every search under 500 ms at 10,000 members, even in pglite (worst ${worst.toFixed(0)} ms)`);
  assert.ok(runs[1].n >= 1, 'the bulk phone is found');

  // ------------------------------------------------ fix round 1 (review B1, S1, S3-S5, notes)
  const [leaver, p6, p7] = [21, 22, 23].map(id);
  for (const u of [leaver, p6, p7]) await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `acct-${u.slice(-2)}@example.test`, `Person ${u.slice(-2)}`]);
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'staff')`, [org, leaver]);
  for (const u of [p6, p7]) await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [u, org]);
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $3, $5), ($1, $4, $6, $5)`, [org, p6, leaver, p7, owner, cm]);

  // S3: the owner must reach the person, in the database too.
  assert.ok(await fails(as({ orgId: org, userId: admin }, REFERRAL_SQL.insert.replace(/AND \(\$9::uuid IS NULL OR public\.smr_staff_reach[^\n]*\)\)/, ''), [org, true, admin, p1, 'other', null, 'Owner check', null, cm2, 'draft', today])),
    'a referral cannot be handed to someone who does not reach the person, even skipping core');
  assert.equal((await ins(admin, true, p1, 'other', 'Handed to the right person', 'draft', cm)).length, 1, 'an admin can hand it to the case manager who reaches them');

  // S1: only the person's own choice, in this org's scope, unblocks a partner referral.
  await q(`INSERT INTO sharing_grant (user_id, access_code_id, scope, basis, text_version) VALUES ($1, $2, 'referrals', 'program_requirement', 'test')`, [p1, org]);
  assert.ok(await fails(mv(cm, rp, 'draft', 'sent'), /check/i), 'a program requirement is not consent to send their name elsewhere');
  await q(`UPDATE sharing_grant SET revoked_at = now(), revoked_reason = 'participant_stopped_required' WHERE user_id = $1 AND scope = 'referrals' AND revoked_at IS NULL`, [p1]);
  await q(`INSERT INTO sharing_grant (user_id, access_code_id, scope, basis, text_version) VALUES ($1, $2, 'referrals', 'participant_choice', 'test')`, [p1, org]);
  assert.equal((await mv(cm, rp, 'draft', 'sent')).length, 1, 'their own choice does');
  assert.equal(((await q(`SELECT public.smr_referral_consent($1, $2) AS ok`, [org, p1])).rows[0] as any).ok, false, 'and the consent function answers nothing outside an org scope');

  // Note: a status_reason change alone is history.
  const before = Number(((await q(`SELECT count(*)::int AS n FROM referral_event WHERE referral_id = $1`, [rp])).rows[0] as any).n);
  await as({ orgId: org, userId: cm }, `UPDATE referral SET status_reason = 'Called them on Tuesday' WHERE id = $1`, [rp]);
  assert.equal(Number(((await q(`SELECT count(*)::int AS n FROM referral_event WHERE referral_id = $1`, [rp])).rows[0] as any).n), before + 1, 'a changed reason writes a referral event');

  // Note: only the definer marks a task as system-made.
  assert.ok(await fails(as({ orgId: org, userId: cm }, `INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title, source_kind, source_id, source_mark) VALUES ($1, $2, $3, $3, 'forged', 'retention', $4, 90)`, [org, p1, cm, o3]), /only the system/),
    'the app cannot insert a task marked as made by the system');

  // S5: owner fallback, and corrections move the tasks.
  const o5 = ((await q(`INSERT INTO outcome_record (access_code_id, client_user_id, employer, start_date, source, created_by) VALUES ($1, $2, 'Plain Staff Co', $3, 'staff_reported', $4) RETURNING id`, [org, p3, ago(10), cm2])).rows[0] as any).id;
  assert.ok((await tasks(o5)).every((x) => x.owner_user_id === null), 'recorded by staff who neither is assigned nor sees everyone: unassigned, for the owner and admins');
  assert.ok((await as({ orgId: org, userId: admin }, `SELECT id FROM staff_task WHERE source_id = $1`, [o5])).length === 3, 'and the admins see them');
  const o6 = ((await as({ orgId: org, userId: cm }, `INSERT INTO outcome_record (access_code_id, client_user_id, employer, start_date, source, created_by) VALUES ($1, $2, 'Lakeside Mill', $3, 'staff_reported', $4) RETURNING id`, [org, p7, ago(20), cm]))[0] as any).id;
  await as({ orgId: org, userId: cm, reason: 'The first day was a week later' }, `UPDATE outcome_record SET start_date = $2 WHERE id = $1`, [o6, ago(13)]);
  assert.equal((await tasks(o6))[0].due_on, ago(-17), 'a corrected start date re-dates the open tasks');
  await as({ orgId: org, userId: cm }, `UPDATE outcome_record SET ended_on = $2, end_reason = 'laid_off' WHERE id = $1`, [o6, ago(-40)]);
  assert.deepEqual((await tasks(o6)).map((x) => !!x.cancelled_at), [false, true, true], 'ending it cancels the later check-ins');
  await as({ orgId: org, userId: cm, reason: 'Still working there; ended by mistake' }, `UPDATE outcome_record SET ended_on = NULL, end_reason = NULL WHERE id = $1`, [o6]);
  assert.deepEqual((await tasks(o6)).map((x) => !!x.cancelled_at), [false, false, false], 'un-ending it brings them back');
  await as({ orgId: org, userId: cm, reason: 'Wrong person' }, `UPDATE outcome_record SET end_reason = 'entered_in_error', ended_on = $2 WHERE id = $1`, [o6, ago(0)]);
  await as({ orgId: org, userId: cm, reason: 'It was the right person after all' }, `UPDATE outcome_record SET end_reason = NULL, ended_on = NULL WHERE id = $1`, [o6]);
  assert.deepEqual((await tasks(o6)).map((x) => !!x.cancelled_at), [false, false, false], 'and un-marking "entered by mistake" does too');

  // B1: a staff member who made, closed and handed referrals, kept a contact row and a draft deletes their account.
  const rl1 = (await ins(leaver, false, p6, 'other', 'Leaver Place', 'sent'))[0].id as string;
  const rl2 = (await ins(leaver, false, p6, 'other', 'Leaver Closed Place', 'draft'))[0].id as string;
  assert.equal((await mv(leaver, rl2, 'draft', 'closed', 'Not needed')).length, 1);
  await as({ orgId: org, userId: leaver }, `INSERT INTO participant_contact (access_code_id, participant_user_id, phone) VALUES ($1, $2, '555-010-0166')`, [org, p6]);
  await as(draftAs(leaver), DRAFT_SQL.save, [org, leaver, p6, 'note', 'leaver draft']);
  const org3 = await mkOrg('PGWF0003', owner2);
  const rpo = ((await q(`INSERT INTO referral (access_code_id, participant_user_id, to_kind, to_access_code_id, to_name, status, created_by) VALUES ($1, $2, 'partner_org', $3, 'Gone Partner', 'draft', $4) RETURNING id`, [org, p6, org3, leaver])).rows[0] as any).id;
  const contactBefore = (await q(`SELECT updated_at::text AS u FROM participant_contact WHERE participant_user_id = $1`, [p6])).rows[0] as any;
  const evBefore = Number(((await q(`SELECT count(*)::int AS n FROM referral_event`)).rows[0] as any).n);
  const actBefore = Number(((await q(`SELECT count(*)::int AS n FROM org_activity WHERE entity = 'referral'`)).rows[0] as any).n);
  await q(`DELETE FROM client_staff_assignment WHERE staff_user_id = $1`, [leaver]);
  await q(`DELETE FROM org_staff WHERE user_id = $1`, [leaver]);
  assert.equal(((await q(`SELECT count(*)::int AS n FROM staff_draft WHERE user_id = $1`, [leaver])).rows[0] as any).n, 0, 'leaving the staff drops their drafts at once (S4)');
  await q(`DELETE FROM users WHERE id = $1`, [leaver]);
  await q(`DELETE FROM access_code WHERE id = $1`, [org3]);
  const kept = (await q(`SELECT id, status, created_by, updated_by, owner_staff_id, to_access_code_id, closed_at FROM referral WHERE id = ANY($1::uuid[]) ORDER BY to_name`, [[rl1, rl2, rpo]])).rows as any[];
  assert.equal(kept.length, 3, 'the account delete succeeds and every referral is kept');
  assert.ok(kept.every((r) => r.created_by === null && r.owner_staff_id === null && r.to_access_code_id === null), 'with the gone account and organization cleared');
  assert.ok(kept.some((r) => r.status === 'closed' && r.closed_at), 'closed ones included, still closed');
  const contactAfter = (await q(`SELECT updated_by, updated_at::text AS u FROM participant_contact WHERE participant_user_id = $1`, [p6])).rows[0] as any;
  assert.equal(contactAfter.updated_by, null, 'the contact row is kept, its editor cleared');
  assert.equal(contactAfter.u, contactBefore.u, 'and it is not re-stamped (the generated phone digits do not count as a change)');
  assert.equal(((await q(`SELECT count(*)::int AS n FROM referral_event WHERE actor_user_id IS NULL AND referral_id = $1`, [rl1])).rows[0] as any).n >= 1, true, 'history is kept, its actor cleared');
  assert.equal(Number(((await q(`SELECT count(*)::int AS n FROM referral_event`)).rows[0] as any).n), evBefore, 'clearing a column wrote no history');
  assert.equal(Number(((await q(`SELECT count(*)::int AS n FROM org_activity WHERE entity = 'referral'`)).rows[0] as any).n), actBefore, 'nor an activity row');
  assert.ok(await fails(as({ orgId: org, userId: admin }, `UPDATE referral SET created_by = NULL WHERE id = $1`, [r2])), 'nobody can clear a live account off a referral');

  // Re-review (2): an owner who left the staff (account still there) does not freeze the referral.
  const [gone] = [24].map(id);
  await q(`INSERT INTO users(id, email, name) VALUES ($1, 'acct-24@example.test', 'Staff 24')`, [gone]);
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'staff')`, [org, gone]);
  const rg = (await ins(admin, true, p1, 'other', 'Owner Left Place', 'sent', gone)).length ? ((await q(`SELECT id FROM referral WHERE to_name = 'Owner Left Place'`)).rows[0] as any).id : null;
  assert.equal(rg, null, 'a staff member who does not reach the person cannot be the owner');
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $3, $4)`, [org, p6, gone, owner]);
  const rg2 = (await ins(admin, true, p6, 'other', 'Owner Left Place', 'sent', gone))[0].id as string;
  await q(`DELETE FROM client_staff_assignment WHERE staff_user_id = $1`, [gone]);
  await q(`DELETE FROM org_staff WHERE user_id = $1`, [gone]);
  assert.equal((await as({ orgId: org, userId: admin }, REFERRAL_SQL.move, [org, true, admin, rg2, 'sent', 'accepted', null, today])).length, 1, 'someone who reaches the person can still move it');
  assert.ok(await fails(as({ orgId: org, userId: admin }, `UPDATE referral SET owner_staff_id = $2 WHERE id = $1`, [rg2, cm2])), 'handing it to someone who does not reach the person is refused (guard, on change only)');
  await as({ orgId: org, userId: admin }, `UPDATE referral SET owner_staff_id = $2 WHERE id = $1`, [rg2, admin]);
  assert.equal(((await q(`SELECT owner_staff_id FROM referral WHERE id = $1`, [rg2])).rows[0] as any).owner_staff_id, admin, 'and it can be taken over');

  // S4: a person leaving the organization takes the drafts about them with them.
  await as(draftAs(cm), DRAFT_SQL.save, [org, cm, p7, 'note', 'about someone who is leaving']);
  await q(`DELETE FROM client_staff_assignment WHERE client_user_id = $1`, [p7]);
  await q(`DELETE FROM access_code_redemption WHERE user_id = $1 AND access_code_id = $2`, [p7, org]);
  assert.equal(((await q(`SELECT count(*)::int AS n FROM staff_draft WHERE participant_user_id = $1`, [p7])).rows[0] as any).n, 0, 'drafts about someone who left are gone');

  // Transition table: SQL and TypeScript agree.
  for (const from of REFERRAL_STATUSES) {
    const next = ((await q(`SELECT public.smr_referral_next($1) AS n`, [from])).rows[0] as any).n as string[];
    assert.deepEqual(next, [...REFERRAL_TRANSITIONS[from]], `moves from ${from}`);
  }
});

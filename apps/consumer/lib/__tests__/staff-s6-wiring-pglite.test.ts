/**
 * Staff pass integration round 3 (2026-10-28): S6 joined to S4's Inbox and
 * S5's handoffs, on every migration applied in order (001 to 112).
 *  - a good catch received, a recognition note waiting for an answer, and the
 *    directory team's answer to a contribution each land in the right Inbox,
 *    read only by its owner;
 *  - "Passed it on" (first_handoff_sent) is granted when a handoff is sent,
 *    only for someone with Wins on, and found again by refresh when Wins is
 *    turned on later.
 * Fictional people only. Needs SMR_PGLITE_DIR, like the other pglite tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HANDOFF_SQL, itemsJson } from '@crucible/core/src/staffHandoff';
import { inboxHref, inboxSentence } from '@crucible/core/src/teamTalkShared';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the S6 wiring test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

test('S6 wired: good catches, recognition and directory answers reach the Inbox; Passed it on on send', { skip, timeout: 900_000 }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const { pg_trgm } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pg_trgm.js'));
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  await db.exec("SET TIME ZONE 'UTC'");
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  await db.exec(`CREATE ROLE smr_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO smr_app;`);
  const failed: string[] = [];
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x)).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); }
    catch (e) { await db.exec('ROLLBACK').catch(() => {}); failed.push(`${f}: ${(e as Error).message}`); }
  }
  assert.deepEqual(failed.filter((f) => Number(f.slice(0, 3)) >= 99), [], 'every file from 099 applies in order');

  const q = (t: string, p: unknown[] = []) => db.query(t, p);
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

  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const [owner, admin, s1, s2, p1, platform] = [1, 2, 3, 4, 5, 6].map(id);
  for (const u of [owner, admin, s1, s2, p1, platform]) await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `${u}@example.invalid`, `Alma${u.slice(-2)} Reyes`]);
  const org = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2, max_redemptions) VALUES ('PGS6W1', 'Lakeshore Works (Demo)', 'client', $1, true, 100) RETURNING id`, [owner])).rows[0] as { id: string }).id;
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'staff'), ($1, $4, 'staff')`, [org, admin, s1, s2]);
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [p1, org]);
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $3, $4)`, [org, p1, s1, owner]);
  await q(`INSERT INTO platform_admin (user_id) VALUES ($1)`, [platform]).catch(async () => q(`INSERT INTO platform_admin (user_id, note) VALUES ($1, 'test')`, [platform]));
  const A = (u: string) => ({ orgId: org, userId: u });
  const inbox = async (who: string) => (await as(A(who), `SELECT kind, ref_table, ref_id, summary, actor_user_id, participant_user_id FROM staff_inbox_item ORDER BY created_at`));

  // The Inbox's kind and source lists keep 109's values and gain S6's, in one CHECK each.
  const defs = (await q(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'public.staff_inbox_item'::regclass AND contype = 'c'`)).rows.map((r: any) => String(r.d));
  const kinds = defs.filter((d: string) => /\(kind = ANY/.test(d));
  assert.equal(kinds.length, 1);
  for (const k of ['mention', 'reply', 'task_assigned', 'change_request', 'change_answered', 'note_review', 'kudos', 'handoff', 'recognition', 'contribution_answered']) assert.ok(kinds[0].includes(`'${k}'`), k);
  const refs = defs.filter((d: string) => /\(ref_table = ANY/.test(d));
  assert.equal(refs.length, 1);
  for (const r of ['team_comment', 'staff_task', 'org_change_request', 'case_note', 'staff_kudos', 'staff_handoff', 'staff_recognition_note', 'directory_contribution']) assert.ok(refs[0].includes(`'${r}'`), r);

  // ---- a good catch -------------------------------------------------------------
  const [k] = await as(A(s1), `INSERT INTO staff_kudos (access_code_id, from_user_id, to_user_id, body) VALUES ($1, $2, $3, 'Great catch on the bus pass deadline') RETURNING id`, [org, s1, s2]);
  const s2box = await inbox(s2);
  assert.deepEqual(s2box.map((r) => [r.kind, r.ref_table, r.ref_id, r.summary, r.actor_user_id]), [['kudos', 'staff_kudos', k.id, 'sent you a good catch', s1]]);
  assert.equal((await inbox(s1)).length, 0, 'the sender gets nothing');
  assert.equal(inboxHref(s2box[0] as never), '/dashboard/wins');

  // ---- a recognition note waiting for an answer ------------------------------------
  const [rn] = await as(A(admin), `INSERT INTO staff_recognition_note (access_code_id, about_user_id, written_by, body) VALUES ($1, $2, $3, 'Built the bus pass checklist the whole team uses now') RETURNING id`, [org, s1, admin]);
  const s1box = await inbox(s1);
  assert.deepEqual(s1box.map((r) => [r.kind, r.ref_id, r.actor_user_id]), [['recognition', rn.id, admin]]);
  assert.match(String(s1box[0].summary), /used only if you say yes/);
  assert.equal((await inbox(s2)).filter((r) => r.kind === 'recognition').length, 0, 'only the person it is about');

  // ---- the directory team's answer -------------------------------------------------
  const [sub] = (await as(A(s1), `SELECT public.submit_directory_contribution($1::jsonb) AS r`,
    [JSON.stringify({ flow: 'new_place', target_kind: 'employer', details: { name: 'Harbor Freight Lines (Demo)', state: 'MI', city: 'Muskegon' } })])).map((x) => x.r as { id: string });
  await as(A(platform), `SELECT public.decide_directory_contribution($1, 'approved', 'new_row', 'Thank you, added to the import list')`, [sub.id]);
  const answered = (await inbox(s1)).filter((r) => r.kind === 'contribution_answered');
  assert.deepEqual(answered.map((r) => [r.ref_table, r.ref_id, r.summary, r.actor_user_id]), [['directory_contribution', sub.id, 'your update to the directory was approved', null]]);
  assert.equal(inboxSentence({ ...answered[0], actor_name: null, participant_name: null } as never), 'Your update to the directory was approved.');
  assert.equal((await as(A(owner), `SELECT id FROM staff_inbox_item WHERE kind = 'contribution_answered'`)).length, 0, 'only the person who sent it');

  // ---- Passed it on --------------------------------------------------------------
  const sendHandoff = (who: string, hid: string) => asTx(A(who), [
    [HANDOFF_SQL.insert, [p1, org, who === admin, who, hid, 'A few things for this week', false]],
    [HANDOFF_SQL.items, [hid, itemsJson([{ kind: 'next_step', step: 'Bring your state ID Tuesday', why: 'So we can start the class' }])]],
  ]);
  const milestone = async (who: string) => (await q(`SELECT source_ref FROM staff_milestone WHERE user_id = $1 AND access_code_id = $2 AND key = 'first_handoff_sent'`, [who, org])).rows as { source_ref: string | null }[];
  await as(A(s1), `INSERT INTO staff_rewards_setting (user_id, access_code_id, rewards_on) VALUES ($1, $2, true)`, [s1, org]);
  const [h1] = await sendHandoff(s1, id(901));
  assert.ok(h1[0]?.id, 's1 sent a handoff');
  assert.deepEqual(await milestone(s1), [{ source_ref: id(901) }], 'granted when sent, with Wins on');
  const [h2] = await sendHandoff(admin, id(902));
  assert.ok(h2[0]?.id, 'the admin sent one too');
  assert.deepEqual(await milestone(admin), [], 'Wins off: nothing recorded');
  await as(A(admin), `INSERT INTO staff_rewards_setting (user_id, access_code_id, rewards_on) VALUES ($1, $2, true)`, [admin, org]);
  await as(A(admin), `SELECT public.staff_rewards_refresh()`);
  assert.equal((await milestone(admin)).length, 1, 'turning Wins on later finds it from the facts');
  assert.equal((await as(A(s1), `SELECT has_function_privilege('smr_app', 'public.staff_handoff_sent_milestone()', 'EXECUTE') AS ok`))[0].ok, false);
});

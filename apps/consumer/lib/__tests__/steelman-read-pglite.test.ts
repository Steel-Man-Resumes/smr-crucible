/**
 * Real SQL: the meter read against migrations 001-093 in pglite, as a
 * non-superuser role with app.user_id set (RLS on). Skipped unless
 * SMR_PGLITE_DIR points at a node_modules folder holding @electric-sql/pglite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSteelMan, type RunAsUser } from '../steelman/read';
import { valueDue } from '../steelman/moments';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite read test' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;

test('meter read against the real schema: counts land in the right slots, RLS holds, no client-paid bonus', { skip }, async () => {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x)).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); }
    catch { await db.exec('ROLLBACK').catch(() => {}); } // 088-091 resource chain refuses on its own guards; unrelated tables
  }
  await db.exec(`CREATE ROLE tester NOSUPERUSER; GRANT USAGE ON SCHEMA public TO tester; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO tester;`);
  const run: RunAsUser = async (userId, build) => {
    const tag = (s: TemplateStringsArray, ...v: unknown[]) => ({ text: s.reduce((a, x, i) => a + '$' + i + x), params: v });
    const qs = [tag`SELECT set_config('app.user_id', ${userId}, true)`, ...(build(tag) as Array<{ text: string; params: unknown[] }>)];
    const out: unknown[] = [];
    await db.exec('BEGIN; SET LOCAL ROLE tester;');
    try { for (const q of qs) out.push((await db.query(q.text, q.params)).rows); await db.exec('COMMIT'); } catch (e) { await db.exec('ROLLBACK'); throw e; }
    return out.slice(1); // same as db.ts: results.slice(setup.length)
  };
  const u = '00000000-0000-0000-0000-0000000000aa', other = '00000000-0000-0000-0000-0000000000bb', H = 'a'.repeat(64);
  const q = (t: string, p: unknown[] = []) => db.query(t, p);
  for (const id of [u, other]) await q('INSERT INTO users(id,email) VALUES ($1,$2)', [id, id + '@x.test']);
  await q('INSERT INTO consumer_profile(user_id,profile_data) VALUES ($1,$2::jsonb)', [u, JSON.stringify({ masterDraft: { revision: 1, facts: Array.from({ length: 12 }, (_, i) => ({ id: 'f' + i, text: 'fact ' + i, status: i < 11 ? 'confirmed' : 'needs_check' })) } })]);
  const L1 = (await q(`INSERT INTO career_lane(user_id,name) VALUES ($1,'Warehouse') RETURNING id`, [u])).rows[0] as { id: string };
  const L2 = (await q(`INSERT INTO career_lane(user_id,name) VALUES ($1,'Example') RETURNING id`, [u])).rows[0] as { id: string };
  const A1 = ((await q(`INSERT INTO refinery_artifact(user_id,artifact_type,content,lane_id) VALUES ($1,'resume','{}'::jsonb,$2) RETURNING id`, [u, L1.id])).rows[0] as { id: string }).id;
  const A2 = ((await q(`INSERT INTO refinery_artifact(user_id,artifact_type,content,lane_id,is_demo) VALUES ($1,'resume','{}'::jsonb,$2,true) RETURNING id`, [u, L2.id])).rows[0] as { id: string }).id;
  await q(`INSERT INTO refinery_artifact(user_id,artifact_type,content) VALUES ($1,'disclosure_plan','{}'::jsonb)`, [u]);
  const answers = [...Array.from({ length: 10 }, (_, i) => ({ line: 'Line ' + i, answer: 'Line ' + i, verdict: 'stands' })), { line: 'Line 0', answer: 'x', verdict: 'stands' }, { line: 'Assisted', answer: 'a', verdict: 'stands', kind: 'assisted' }, { line: 'Cut', answer: '', verdict: 'cut' }];
  const rev = (a: string, n: number, status: string, src: string) => q(`INSERT INTO artifact_revision(user_id,artifact_id,revision_number,source,resume_text,confirmed_credentials,defend_answers,checker_version,status,page_count,page_limit,content_hash)
    VALUES ($1,$2,$3,$4,'text',$5::jsonb,$6::jsonb,'v1',$7,1,1,$8)`, [u, a, n, src, JSON.stringify(['Forklift', { text: 'forklift ' }, { text: 'OSHA 10' }]), JSON.stringify(answers), status, H]);
  await rev(A1, 1, 'finished', 'forge_finish'); await rev(A1, 2, 'draft', 'refinery_edit'); await rev(A2, 1, 'finished', 'forge_import');
  const J = ((await q(`INSERT INTO job_application(user_id,job_title,company) VALUES ($1,'Picker','Acme') RETURNING id`, [u])).rows[0] as { id: string }).id;
  await q(`INSERT INTO application_document(application_id,user_id,document_type,provenance,content_snapshot,content_hash) VALUES ($1,$2,'resume','tailored','{}'::jsonb,$3),($1,$2,'resume','fine_tuned','{}'::jsonb,$3)`, [J, u, H]);
  await q(`INSERT INTO application_status_event(application_id,user_id,from_status,to_status) VALUES ($1,$2,'saved','applied'),($1,$2,'applied','interviewing')`, [J, u]);
  await q(`INSERT INTO user_progress_event(user_id,event_type,context) VALUES ($1,'interview_completed','{"mode":"text"}'),($1,'interview_completed','{"mode":"voice"}')`, [u]);
  await q(`INSERT INTO disclosure_rehearsal_session(owner_user_id,consent_layer,status,ended_at) VALUES ($1,'x','ended',now())`, [u]);
  await q(`INSERT INTO progression_request(id,user_id,idempotency_key,kind,step_id,summary_encrypted) VALUES (gen_random_uuid(),$1,'idem-0001','feedback','foundation','{}'),(gen_random_uuid(),$1,'idem-0002','bug','foundation','{}'),(gen_random_uuid(),$1,'idem-0003','ai_bonus','foundation','{}')`, [u]);
  await q(`UPDATE progression_request SET status='denied' WHERE idempotency_key='idem-0002'`);
  await q(`INSERT INTO progression_grant(user_id,grant_key,kind,step_id,label) VALUES ($1,'moment:first:facts','milestone','foundation','x'),($1,'first-tailored','milestone','tailor','y')`, [u]);
  await q(`INSERT INTO user_progress_event(user_id,event_type,context) VALUES ($1,'interview_completed','{}')`, [other]); // must not leak

  const r = await loadSteelMan(u, run);
  assert.deepEqual(r.counts, { facts: 11, lines: 10, resumes: 1, lanes: 1, tailored: 1, sent: 1, practice: 1, disclosure: 2, proof: 2, feedback: 1 });
  assert.equal(r.serverCounts.practice, 0); assert.equal(r.serverCounts.feedback, 0); // text ping and pending feedback carry no value
  assert.equal(r.firstVoicePractice, false); assert.equal(r.planExists, true); assert.equal(r.forgeArrival, true);
  assert.deepEqual(r.outcomes, ['interviewing']);
  assert.deepEqual([...r.grantKeys], ['moment:first:facts']);
  assert.ok(r.recent.some((g) => g.grant_key === 'first-tailored'));
  assert.equal(valueDue(r).some((v) => v.key === 'meter:first-voice-practice'), false);
  const o = await loadSteelMan(other, run);
  assert.equal(o.counts.practice, 1); assert.equal(o.counts.facts, 0);
});

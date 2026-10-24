/**
 * Real-schema proof for two walk fixes (2026-10-24), run in pglite as a
 * NOSUPERUSER role with app.user_id set, like production's smr_app.
 * - Meter S10: a voice practice without a saved transcript counts from its
 *   server voice lease; short, failed and already-counted calls do not.
 * - Resume link: the PATCH-time link fills a missing application link both
 *   ways and never replaces one, and never reaches another person's rows.
 * SMR_PGLITE_DIR points at a node_modules folder holding @electric-sql/pglite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadSteelMan, type RunAsUser } from '../steelman/read';
import { valueDue } from '../steelman/moments';
import { LINK_APPLICATION_SQL, LINK_ARTIFACT_CONTEXT_SQL } from '../resume-application-link';
import { LANE_RESUME_PICK_SQL } from '@crucible/core/src/refineryArtifact';

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, '@electric-sql/pglite')) ? 'set SMR_PGLITE_DIR to run the pglite tests' : false;
const MIG = new URL('../../../../packages/core/migrations/', import.meta.url).pathname;
const U = '00000000-0000-0000-0000-0000000000aa', OTHER = '00000000-0000-0000-0000-0000000000bb';

async function setup() {
  const { PGlite } = await import(join(dir!, '@electric-sql/pglite/dist/index.js'));
  const { pgcrypto } = await import(join(dir!, '@electric-sql/pglite/dist/contrib/pgcrypto.js'));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x)).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, 'utf8') + ';COMMIT;'); }
    catch { await db.exec('ROLLBACK').catch(() => {}); }
  }
  await db.exec(`CREATE ROLE tester NOSUPERUSER; GRANT USAGE ON SCHEMA public TO tester; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO tester;`);
  const q = (t: string, p: unknown[] = []) => db.query(t, p);
  for (const id of [U, OTHER]) await q('INSERT INTO users(id,email) VALUES ($1,$2)', [id, id + '@x.test']);
  /** One statement as the person, the way db.ts queryAsUser runs it. */
  const asUser = async (userId: string, sql: string, params: unknown[]) => {
    await db.exec('BEGIN; SET LOCAL ROLE tester;');
    try {
      await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const rows = (await db.query(sql, params)).rows; await db.exec('COMMIT'); return rows;
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  };
  const run: RunAsUser = async (userId, build) => {
    const tag = (s: TemplateStringsArray, ...v: unknown[]) => ({ text: s.reduce((a, x, i) => a + '$' + i + x), params: v });
    const qs = [tag`SELECT set_config('app.user_id', ${userId}, true)`, ...(build(tag) as Array<{ text: string; params: unknown[] }>)];
    const out: unknown[] = [];
    await db.exec('BEGIN; SET LOCAL ROLE tester;');
    try { for (const s of qs) out.push((await db.query(s.text, s.params)).rows); await db.exec('COMMIT'); } catch (e) { await db.exec('ROLLBACK'); throw e; }
    return out.slice(1);
  };
  return { q, run, asUser };
}

test('meter: voice practice without a saved transcript counts from its server lease', { skip }, async () => {
  const { q, run } = await setup();
  const lease = (user: string, startMinAgo: number, seconds: number, status: string, reason: string | null, callId: string | null = 'rtc_test') =>
    q(`INSERT INTO voice_session(user_id,call_id,status,reserved_seconds,started_at,expires_at,ended_at,ended_reason)
       VALUES ($1,$6,$2,900, now() - make_interval(mins => $3), now() + interval '1 hour', now() - make_interval(mins => $3) + make_interval(secs => $4), $5)`,
      [user, status, startMinAgo, seconds, reason, callId]);
  await lease(U, 300, 420, 'ended', 'user_ended');        // counts: 7 min connected call, ended by the person, no transcript
  await lease(U, 200, 61, 'ended', 'user_ended');         // counts: just over the floor
  await lease(U, 160, 59, 'ended', 'user_ended');         // just under the floor
  await lease(U, 150, 30, 'ended', 'user_ended');         // too short
  await lease(U, 140, 70, 'ended', 'user_ended', null);   // never connected (mic prompt then a denied start)
  await lease(U, 130, 70, 'ended', 'user_ended', 'pending'); // the call never finished connecting
  await lease(U, 120, 400, 'ended', 'provider_error');    // the call failed
  await lease(U, 110, 400, 'expired', null);              // abandoned
  await lease(U, 100, 400, 'ended', 'user_ended');        // has a saved transcript below: counted once, from the transcript
  await q(`INSERT INTO interview_voice_session(owner_user_id,consent_layer,status,started_at,ended_at)
           VALUES ($1,'x','ended', now() - interval '99 minutes', now() - interval '94 minutes')`, [U]);
  await lease(OTHER, 50, 400, 'ended', 'user_ended');     // another person's: must not leak
  await q(`INSERT INTO user_progress_event(user_id,event_type,context) VALUES ($1,'interview_completed','{"mode":"voice"}')`, [U]);

  const r = await loadSteelMan(U, run);
  assert.equal(r.counts.practice, 3, 'two leases plus one transcript; the voice ping is not counted again');
  assert.equal(r.serverCounts.practice, 3, 'voice is server truth');
  assert.equal(r.firstVoicePractice, true);
  // valueDue also waits for a finished resume (moments.ts), which this seed does not hold.
  assert.equal(valueDue(r).some((v) => v.key === 'meter:first-voice-practice'), false);
  const o = await loadSteelMan(OTHER, run);
  assert.equal(o.counts.practice, 1);
});

test('meter: text practice pings from before today are still read', { skip }, async () => {
  const { q, run } = await setup();
  await q(`INSERT INTO user_progress_event(user_id,event_type,context,created_at) VALUES ($1,'interview_completed','{}', now() - interval '2 days'),($1,'interview_completed','{"mode":"text"}', now() - interval '1 day')`, [U]);
  const r = await loadSteelMan(U, run);
  assert.equal(r.counts.practice, 2);
  assert.equal(r.serverCounts.practice, 0, 'text practice counts toward the score, never toward value');
});

test('resume link: fills a missing link both ways, never replaces one, never crosses accounts', { skip }, async () => {
  const { q, asUser } = await setup();
  const art = async (user: string, ctx: object) => ((await q(`INSERT INTO refinery_artifact(user_id,artifact_type,content,target_context) VALUES ($1,'resume','{}'::jsonb,$2::jsonb) RETURNING id`, [user, JSON.stringify(ctx)])).rows[0] as { id: string }).id;
  const app = async (user: string, resume: string | null = null) => ((await q(`INSERT INTO job_application(user_id,job_title,company,resume_artifact_id) VALUES ($1,'Picker','Acme',$2) RETURNING id`, [user, resume])).rows[0] as { id: string }).id;

  // The Snap On shape: the application has no resume; the resume has no applicationId.
  const R1 = await art(U, { source: 'job', targetJob: 'Picker', targetCompany: 'Acme' });
  const J1 = await app(U);
  assert.equal((await asUser(U, LINK_APPLICATION_SQL, [R1, J1, U])).length, 1);
  assert.equal((await asUser(U, LINK_ARTIFACT_CONTEXT_SQL, [R1, J1, U])).length, 1);
  const j1 = (await q('SELECT resume_artifact_id FROM job_application WHERE id=$1', [J1])).rows[0] as { resume_artifact_id: string };
  const r1 = (await q('SELECT target_context FROM refinery_artifact WHERE id=$1', [R1])).rows[0] as { target_context: Record<string, unknown> };
  assert.equal(j1.resume_artifact_id, R1);
  assert.equal(r1.target_context.applicationId, J1);
  assert.equal(r1.target_context.targetJob, 'Picker', 'the rest of the context is kept');
  // Running again changes nothing.
  assert.equal((await asUser(U, LINK_APPLICATION_SQL, [R1, J1, U])).length, 0);
  assert.equal((await asUser(U, LINK_ARTIFACT_CONTEXT_SQL, [R1, J1, U])).length, 0);

  // An application already linked to another resume keeps its link, and the
  // other resume does not claim it in its context either.
  const R2 = await art(U, { source: 'job' });
  assert.equal((await asUser(U, LINK_APPLICATION_SQL, [R2, J1, U])).length, 0);
  assert.equal((await asUser(U, LINK_ARTIFACT_CONTEXT_SQL, [R2, J1, U])).length, 0);
  assert.equal(((await q('SELECT resume_artifact_id FROM job_application WHERE id=$1', [J1])).rows[0] as { resume_artifact_id: string }).resume_artifact_id, R1);

  // A hidden example resume is never linked, and a job already sent is left as it is.
  const DEMO = ((await q(`INSERT INTO refinery_artifact(user_id,artifact_type,content,is_demo) VALUES ($1,'resume','{}'::jsonb,true) RETURNING id`, [U])).rows[0] as { id: string }).id;
  const J2 = await app(U);
  assert.equal((await asUser(U, LINK_APPLICATION_SQL, [DEMO, J2, U])).length, 0, 'example resume');
  const J3 = ((await q(`INSERT INTO job_application(user_id,job_title,company,status) VALUES ($1,'Loader','Acme','applied') RETURNING id`, [U])).rows[0] as { id: string }).id;
  assert.equal((await asUser(U, LINK_APPLICATION_SQL, [R2, J3, U])).length, 0, 'already applied');
  assert.equal((await asUser(U, LINK_APPLICATION_SQL, [R2, J2, U])).length, 1, 'a saved job and a real resume still link');

  // Another person's application or resume is never touched.
  const JO = await app(OTHER);
  const RO = await art(OTHER, {});
  assert.equal((await asUser(U, LINK_APPLICATION_SQL, [R2, JO, U])).length, 0);
  assert.equal((await asUser(U, LINK_APPLICATION_SQL, [RO, (await app(U)), U])).length, 0);
  assert.equal(((await q('SELECT resume_artifact_id FROM job_application WHERE id=$1', [JO])).rows[0] as { resume_artifact_id: string | null }).resume_artifact_id, null);
});

test('lane resume: the id-only pick takes the finished base over a newer copy with no version', { skip }, async () => {
  const { q, asUser } = await setup();
  const H = 'a'.repeat(64);
  const art = async (user: string, ago: number, demo = false, lane: string | null = null) => ((await q(`INSERT INTO refinery_artifact(user_id,artifact_type,content,updated_at,is_demo,lane_id) VALUES ($1,'resume','{}'::jsonb, now() - make_interval(mins => $2), $3, $4) RETURNING id`, [user, ago, demo, lane])).rows[0] as { id: string }).id;
  const rev = (user: string, a: string, n: number, status: string) => q(`INSERT INTO artifact_revision(user_id,artifact_id,revision_number,source,resume_text,confirmed_credentials,defend_answers,checker_version,status,page_count,page_limit,content_hash)
    VALUES ($1,$2,$3,'forge_finish','text','[]'::jsonb,'[]'::jsonb,'v1',$4,1,1,$5)`, [user, a, n, status, H]);
  const pick = async (lane: string | null = null) => ((await asUser(U, LANE_RESUME_PICK_SQL, [U, lane])) as Array<{ id: string }>)[0]?.id ?? null;

  const BASE = await art(U, 100);
  await rev(U, BASE, 1, 'finished'); await rev(U, BASE, 2, 'draft');
  const TAILORED = await art(U, 10);                       // newer, no version: the Valjean shape
  assert.equal(await pick(), BASE, 'any version beats none');
  await q(`UPDATE artifact_revision SET status='finished' WHERE artifact_id=$1 AND revision_number=2`, [BASE]);
  const DRAFTED = await art(U, 5); await rev(U, DRAFTED, 1, 'draft');
  assert.equal(await pick(), BASE, 'a finished latest version beats a newer draft');
  const NEWER = await art(U, 1); await rev(U, NEWER, 1, 'finished');
  assert.equal(await pick(), NEWER, 'among finished ones the newest edit wins');
  const DEMO = await art(U, 0, true); await rev(U, DEMO, 1, 'finished');
  assert.equal(await pick(), NEWER, 'examples never stand for a lane');
  const THEIRS = await art(OTHER, 0); await rev(OTHER, THEIRS, 1, 'finished');
  assert.equal(await pick(), NEWER, 'another person never');
  const L = ((await q(`INSERT INTO career_lane(user_id,name) VALUES ($1,'Warehouse') RETURNING id`, [U])).rows[0] as { id: string }).id;
  assert.equal(await pick(L), null, 'an empty named lane picks nothing');
  const LANED = await art(U, 50, false, L);
  assert.equal(await pick(L), LANED);
  assert.equal(await pick(), NEWER, 'named-lane work is not main-lane work');
  void TAILORED; void DRAFTED;
});

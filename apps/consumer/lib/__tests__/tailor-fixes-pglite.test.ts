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
import { LATEST_REVISION_STATUS_SQL, pickLaneResume } from '../lane-resume-pick';

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
  const lease = (user: string, startMinAgo: number, seconds: number, status: string, reason: string | null) =>
    q(`INSERT INTO voice_session(user_id,status,reserved_seconds,started_at,expires_at,ended_at,ended_reason)
       VALUES ($1,$2,900, now() - make_interval(mins => $3), now() + interval '1 hour', now() - make_interval(mins => $3) + make_interval(secs => $4), $5)`,
      [user, status, startMinAgo, seconds, reason]);
  await lease(U, 300, 420, 'ended', 'user_ended');        // counts: 7 min, ended by the person, no transcript
  await lease(U, 200, 600, 'ended', 'user_ended');        // counts
  await lease(U, 150, 30, 'ended', 'user_ended');         // too short
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

  // Another person's application or resume is never touched.
  const JO = await app(OTHER);
  const RO = await art(OTHER, {});
  assert.equal((await asUser(U, LINK_APPLICATION_SQL, [R2, JO, U])).length, 0);
  assert.equal((await asUser(U, LINK_APPLICATION_SQL, [RO, (await app(U)), U])).length, 0);
  assert.equal(((await q('SELECT resume_artifact_id FROM job_application WHERE id=$1', [JO])).rows[0] as { resume_artifact_id: string | null }).resume_artifact_id, null);
});

test('lane resume: the latest-status read picks the finished base over a newer copy with no version', { skip }, async () => {
  const { q, asUser } = await setup();
  const H = 'a'.repeat(64);
  const art = async (user: string) => ((await q(`INSERT INTO refinery_artifact(user_id,artifact_type,content) VALUES ($1,'resume','{}'::jsonb) RETURNING id`, [user])).rows[0] as { id: string }).id;
  const BASE = await art(U), TAILORED = await art(U), THEIRS = await art(OTHER);
  const rev = (user: string, a: string, n: number, status: string) => q(`INSERT INTO artifact_revision(user_id,artifact_id,revision_number,source,resume_text,confirmed_credentials,defend_answers,checker_version,status,page_count,page_limit,content_hash)
    VALUES ($1,$2,$3,'forge_finish','text','[]'::jsonb,'[]'::jsonb,'v1',$4,1,1,$5)`, [user, a, n, status, H]);
  await rev(U, BASE, 1, 'draft'); await rev(U, BASE, 2, 'finished'); await rev(OTHER, THEIRS, 1, 'finished');
  const rows = await asUser(U, LATEST_REVISION_STATUS_SQL, [U, [TAILORED, BASE, THEIRS]]) as Array<{ artifact_id: string; status: string }>;
  assert.deepEqual(rows.map((r) => [r.artifact_id, r.status]), [[BASE, 'finished']], 'latest per artifact, own rows only');
  const pick = pickLaneResume([{ id: TAILORED }, { id: BASE }], new Map(rows.map((r) => [r.artifact_id, r.status])));
  assert.equal(pick?.id, BASE);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSteelMan, type RunAsUser } from '../steelman/read';
import { valueDue } from '../steelman/moments';

const at = '2026-10-20T10:00:00.000Z';
/** Canned rows chosen by what each statement asks for, so a destructure that is off by one slot gets the wrong rows. First match wins. */
const FIXTURES: Array<[RegExp, unknown[]]> = [
  [/set_config\('app\.user_id'/, [{ set_config: 'u' }]],
  [/profile_data->'masterDraft'/, [{ master: { revision: 1, facts: [{ id: 'a', text: 'Ran forklift', status: 'confirmed', confirmedAt: at }, { id: 'b', text: 'Led crew', status: 'confirmed' }, { id: 'c', text: 'Counted stock', status: 'confirmed' }, { id: 'd', text: 'Maybe', status: 'needs_check' }] } }]],
  [/defend_answers/, [{ first_at: at, latest_at: at, source: 'forge_finish', lines: 10, from_forge: true }]],
  [/confirmed_credentials/, [{ at }]],
  [/GROUP BY COALESCE\(a\.lane_id/, [{ at }]],
  [/FROM application_document/, [{ at }]],
  [/to_status='applied'/, [{ at }, { at }]],
  [/FROM interview_voice_session/, []],
  [/event_type='interview_completed'/, [{ at }]],
  [/artifact_type='disclosure_plan'/, [{ at: null }]],
  [/FROM disclosure_rehearsal_session/, []],
  [/FROM vault_document/, [{ at }, { at }]],
  [/FROM progression_request/, [{ at, status: 'pending' }, { at, status: 'approved' }]],
  [/SELECT DISTINCT to_status/, [{ to_status: 'interviewing' }]],
  [/FROM forge_package_email_sent/, [{ delivered: true }]],
  [/AS today/, [{ today: false }]],
  [/SELECT grant_key FROM progression_grant/, [{ grant_key: 'moment:first:facts' }]],
  [/SELECT grant_key, kind, label, created_at/, [{ grant_key: 'moment:first:facts', kind: 'milestone', label: 'x', created_at: at }]],
];
/** Shaped like packages/core/src/db.ts runAsUser: prepend set_config, run all, return results.slice(1). */
const fakeRun: RunAsUser = async (userId, build) => {
  const tag = (strings: TemplateStringsArray, ...vals: unknown[]) => ({ text: strings.reduce((a, s, i) => a + '$' + i + s), params: vals });
  const statements = [tag`SELECT set_config('app.user_id', ${userId}, true)`, ...(build(tag) as Array<{ text: string }>)];
  const results = statements.map((q) => {
    const hit = FIXTURES.find(([re]) => re.test(q.text));
    assert.ok(hit, `no fixture for: ${q.text.slice(0, 80)}`);
    return hit[1];
  });
  return results.slice(1);
};

test('load() reads each statement into its own slot (db.ts runAsUser already drops set_config)', async () => {
  const r = await loadSteelMan('00000000-0000-0000-0000-0000000000aa', fakeRun);
  assert.deepEqual(r.counts, { facts: 3, lines: 10, resumes: 1, lanes: 1, tailored: 1, sent: 2, practice: 1, disclosure: 0, proof: 3, feedback: 2 });
  assert.equal(r.serverCounts.practice, 0, 'client text practice never reaches server counts');
  assert.equal(r.serverCounts.feedback, 1, 'only approved feedback counts toward value');
  assert.equal(r.firstVoicePractice, false); assert.equal(r.planExists, false);
  assert.equal(r.forgeArrival, true); assert.equal(r.packageDelivered, true); assert.equal(r.meterBonusToday, false);
  assert.deepEqual(r.outcomes, ['interviewing']);
  assert.deepEqual([...r.grantKeys], ['moment:first:facts']);
  assert.equal(r.recent.length, 1);
  assert.equal(r.dated.filter((d) => d.component === 'facts').length, 1);
});
test('a client interview_completed ping alone can never pay a voice bonus', async () => {
  const r = await loadSteelMan('00000000-0000-0000-0000-0000000000aa', fakeRun);
  assert.equal(valueDue(r).some((v) => v.key === 'meter:first-voice-practice'), false);
});
test('the destructure matches the runAsUser contract in db.ts', () => {
  assert.match(readFileSync(new URL('../../../../packages/core/src/db.ts', import.meta.url), 'utf8'), /return \(results as unknown\[\]\)\.slice\(setup\.length\)/);
  assert.match(readFileSync(new URL('../steelman/read.ts', import.meta.url), 'utf8'), /const \[masterRows, finRows,/);
});
test('S10 reads server voice leases too, so voice practice without a saved transcript counts (walk 10/24)', () => {
  const src = readFileSync(new URL('../steelman/read.ts', import.meta.url), 'utf8');
  assert.match(src, /FROM voice_session vs\s+WHERE vs\.user_id=\$\{userId\}::uuid AND vs\.status='ended' AND vs\.ended_reason='user_ended'/);
  assert.match(src, /vs\.ended_at - vs\.started_at >= interval '60 seconds'/);
  assert.match(src, /NOT EXISTS \(SELECT 1 FROM interview_voice_session t2/, 'a call with a saved transcript is counted once');
  assert.match(src, /COALESCE\(context->>'mode',''\)<>'voice'/, 'the voice ping still never counts as text practice');
});

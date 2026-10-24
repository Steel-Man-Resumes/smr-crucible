import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { awardMoments, milestoneInsert, momentsDue, valueDue, type MomentDeps, type MomentRow } from '../steelman/moments';
import { buildPayload } from '../steelman/payload';
import type { SteelManRead } from '../steelman/read';

const zero = { facts: 0, lines: 0, resumes: 0, lanes: 0, tailored: 0, sent: 0, practice: 0, disclosure: 0, proof: 0, feedback: 0 };
function read(over: Partial<SteelManRead> = {}): SteelManRead {
  return { counts: { ...zero }, serverCounts: { ...zero }, dated: [], firstVoicePractice: false, meterBonusToday: false, planExists: false, forgeArrival: false, packageDelivered: false, outcomes: [], grantKeys: new Set(), recent: [], ...over };
}
/** A fake progression_grant with the real UNIQUE(user_id, grant_key) rule. */
function fakeDb(cap = 99) {
  const rows = new Map<string, { kind: string; label: string }>();
  let bonuses = 0;
  const deps: MomentDeps = {
    insertMilestones: async (_u, list: MomentRow[]) => list.flatMap((r) => (rows.has(r.key) ? [] : (rows.set(r.key, { kind: 'milestone', label: r.label }), [r.key]))),
    grantBonus: async (_u, key) => { if (rows.has(key)) return true; if (bonuses >= cap) return false; bonuses++; rows.set(key, { kind: 'bonus', label: 'Extra AI actions earned' }); return true; },
  };
  return { rows, deps, bonusCount: () => bonuses };
}
const week1 = { facts: 5, lines: 14, resumes: 1, lanes: 1, tailored: 1, sent: 1, practice: 0, disclosure: 0, proof: 0, feedback: 0 };
const w6 = { facts: 17, lines: 22, resumes: 2, lanes: 2, tailored: 5, sent: 9, practice: 3, disclosure: 1, proof: 2, feedback: 0 };

test('a fresh account: score 0, Showing up, no moments and nothing granted', async () => {
  const r = read();
  const db = fakeDb();
  assert.deepEqual(await awardMoments('u', r, db.deps), []);
  assert.equal(db.rows.size, 0);
  const p = buildPayload(r, new Date('2026-10-23T12:00:00Z'));
  assert.equal(p.score, 0); assert.equal(p.band.id, 'showing_up'); assert.equal(p.band.label, 'Showing up');
  assert.equal(p.steelMan, false); assert.equal(p.maxScore, 532); assert.equal(p.nextMark?.pointsAway, 65);
  assert.equal(p.components.length, 10); assert.ok(p.components.every((c) => c.value === 0));
});
test('awarding the same moments twice grants each once', async () => {
  const r = read({ counts: w6, serverCounts: w6, forgeArrival: true, planExists: true });
  const db = fakeDb();
  const first = await awardMoments('u', r, db.deps);
  assert.ok(first.includes('moment:mark:65') && first.includes('moment:first:sent') && first.includes('moment:forge-arrival'));
  const size = db.rows.size;
  assert.equal(db.bonusCount(), 1); // one meter bonus per UTC day
  assert.deepEqual(await awardMoments('u', r, db.deps), []); // same stale read: UNIQUE keeps it to one
  assert.deepEqual(await awardMoments('u', read({ ...r, grantKeys: new Set(db.rows.keys()), meterBonusToday: true }), db.deps), []);
  assert.equal(db.rows.size, size); assert.equal(db.bonusCount(), 1);
});
test('mark 65 is a moment only; value starts at 159 and needs a finished resume', () => {
  assert.equal(valueDue(read({ counts: week1, serverCounts: week1 })).length, 0);
  assert.deepEqual(valueDue(read({ counts: w6, serverCounts: w6, planExists: true })).map((v) => v.key), ['meter:mark:159', 'meter:mark:235', 'meter:first-disclosure-plan']);
  const noResume = { ...w6, resumes: 0, lines: 0 };
  assert.deepEqual(valueDue(read({ counts: noResume, serverCounts: noResume, planExists: true, firstVoicePractice: true })), []);
});
test('junk self-asserted rows with no finished resume pay nothing', async () => {
  const junk = { ...zero, facts: 40, sent: 25, feedback: 3, proof: 8 };
  const db = fakeDb();
  const got = await awardMoments('u', read({ counts: junk, serverCounts: { ...junk, feedback: 0 } }), db.deps);
  assert.ok(got.includes('moment:mark:159'));
  assert.equal(db.bonusCount(), 0);
});
test('at most one meter bonus a day; a later one arrives with a notice', async () => {
  const db = fakeDb();
  const r = read({ counts: w6, serverCounts: w6, planExists: true });
  await awardMoments('u', r, db.deps);
  assert.equal(db.bonusCount(), 1);
  assert.deepEqual(await awardMoments('u', read({ ...r, grantKeys: new Set(db.rows.keys()), meterBonusToday: true }), db.deps), []);
  const later = await awardMoments('u', read({ ...r, grantKeys: new Set(db.rows.keys()), meterBonusToday: false }), db.deps);
  assert.equal(db.bonusCount(), 2);
  assert.deepEqual(later, ['moment:bonus:meter:mark:235']);
  assert.equal(db.rows.get('moment:bonus:meter:mark:235')!.label, 'Your extra AI actions for reaching Putting in work arrived today. They last until midnight UTC.');
});
test('client-reported practice counts toward the score and moments but never toward value', () => {
  const r = read({ counts: { ...w6, practice: 4 }, serverCounts: { ...w6, practice: 0 } });
  assert.ok(momentsDue(r).some((m) => m.key === 'moment:first:practice'));
  assert.equal(valueDue(r).some((v) => v.key === 'meter:first-voice-practice'), false);
  const big = { ...zero, facts: 1, lines: 1, resumes: 1, lanes: 1, tailored: 1, sent: 1, disclosure: 1, proof: 1, feedback: 1, practice: 1 };
  const r2 = read({ counts: big, serverCounts: { ...big, practice: 0 } });
  assert.ok(momentsDue(r2).some((m) => m.key === 'moment:mark:159'));
  assert.equal(valueDue(r2).some((v) => v.key === 'meter:mark:159'), false);
});
test('the first-loop copy only claims a sent application when one exists', () => {
  const forgeOnly = { ...zero, facts: 5, lines: 14, resumes: 1 }; // 69 points, nothing sent
  const m = momentsDue(read({ counts: forgeOnly })).find((x) => x.key === 'moment:mark:65')!;
  assert.equal(m.label, 'In the game: 65 points of real work saved.');
  assert.match(momentsDue(read({ counts: week1 })).find((x) => x.key === 'moment:mark:65')!.label, /sent it\.$/);
  const p = buildPayload(read({ counts: forgeOnly }), new Date());
  assert.equal(p.band.id, 'in_the_game'); assert.doesNotMatch(p.band.why, /sent it/);
  assert.match(buildPayload(read({ counts: week1 }), new Date()).band.why, /sent it/);
});
test('Steel Man allowance marker needs server-recorded breadth and approved feedback', async () => {
  const sm = { facts: 18, lines: 22, resumes: 3, lanes: 2, tailored: 7, sent: 12, practice: 5, disclosure: 2, proof: 3, feedback: 1 };
  const clientOnly = await awardMoments('u', read({ counts: sm, serverCounts: { ...sm, practice: 0 } }), fakeDb().deps);
  assert.ok(clientOnly.includes('moment:steel-man')); assert.equal(clientOnly.includes('meter:steel-man'), false);
  const pending = await awardMoments('u', read({ counts: sm, serverCounts: { ...sm, feedback: 0 }, firstVoicePractice: true }), fakeDb().deps);
  assert.equal(pending.includes('meter:steel-man'), false);
  const real = await awardMoments('u', read({ counts: sm, serverCounts: sm, firstVoicePractice: true }), fakeDb().deps);
  assert.ok(real.includes('meter:steel-man'));
  assert.equal(real.at(-1), 'moment:steel-man');
});
test('internal meter:* rows never show as moments', () => {
  const p = buildPayload(read({ recent: [{ grant_key: 'meter:steel-man', kind: 'milestone', label: 'Steel Man status recorded on this account.', created_at: '2026-10-23T00:00:00Z' }, { grant_key: 'moment:steel-man', kind: 'milestone', label: 'Steel Man: your whole job search is built and running.', created_at: '2026-10-23T00:00:00Z' }] }), new Date());
  assert.deepEqual(p.moments.map((m) => m.key), ['moment:steel-man']);
  assert.match(readFileSync(new URL('../progression-server.ts', import.meta.url), 'utf8'), /kind==='milestone'&&!g\.grant_key\.startsWith\('meter:'\)/);
});
test('a capped bonus waits: the moment shows, the bonus lands on a later read, never said to be lost', async () => {
  const db = fakeDb(0);
  const got = await awardMoments('u', read({ counts: w6, serverCounts: w6 }), db.deps);
  assert.ok(got.includes('moment:mark:159')); assert.equal(db.rows.has('meter:mark:159'), false);
  assert.doesNotMatch(db.rows.get('moment:mark:159')!.label, /AI actions|lost/);
});
test('moments never use the tailor or apply steps, and copy follows the meter rules', () => {
  const all = momentsDue(read({ counts: { facts: 40, lines: 28, resumes: 6, lanes: 4, tailored: 12, sent: 25, practice: 10, disclosure: 5, proof: 8, feedback: 4 }, forgeArrival: true, packageDelivered: true, outcomes: ['heard_back', 'interviewing', 'offered', 'hired'], firstVoicePractice: true }));
  assert.ok(all.length >= 20);
  for (const m of all) {
    assert.notEqual(m.step, 'tailor'); assert.notEqual(m.step, 'apply');
    assert.ok(m.key.startsWith('moment:') && m.key.length <= 180 && m.label.length <= 200);
    assert.doesNotMatch(m.label, /—|\brecords?\b(?! question)|ready to work|hireable|likely|chance|odds|predict|lost|missing|behind|failed|you are a/i);
  }
});
test('the insert is one statement guarded by UNIQUE(user_id, grant_key)', () => {
  const q = milestoneInsert('00000000-0000-0000-0000-000000000001', [{ key: 'moment:first:facts', step: 'foundation', label: 'x' }]);
  assert.match(q.text, /ON CONFLICT \(user_id,grant_key\) DO NOTHING RETURNING grant_key/);
  assert.match(q.text, /'milestone'/); assert.match(q.text, /,0,/);
  assert.match(readFileSync(new URL('../../../../packages/core/migrations/092_progression_access.sql', import.meta.url), 'utf8'), /UNIQUE\(user_id,grant_key\)/);
});

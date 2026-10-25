/**
 * Settings and You fixes (fix-settings lane, 2026-10-24, TOOL-REVISIONS S1, S2,
 * S5, S6, S7, S8, S10, T2). Each test here failed on 964090c.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coachSaveBody, coachSettingsPatch, COACH_SAVE_FIELDS } from '../coach-settings';
import { SETTINGS_LESSONS } from '../orientation-lessons';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/* S1: Coach Save must not undo reading help */
const GET_PAYLOAD = {
  coachName: 'Guide', coachStyle: 'balanced', coachLength: 'full', coachFocus: 'guide', coachCreativity: 50,
  coachVoice: false, coachPlainLanguage: false, coachLanguage: 'en',
};

test('S1: the Your Coach save body carries only the five coach fields', () => {
  const body = coachSaveBody(GET_PAYLOAD);
  assert.deepEqual(Object.keys(body).sort(), [...COACH_SAVE_FIELDS].sort());
  for (const k of ['coachVoice', 'coachPlainLanguage', 'coachLanguage']) assert.ok(!(k in body), k);
});

test('S1: a coach save after a plain-language tap leaves plain language, read aloud and Spanish alone', () => {
  const columns = coachSettingsPatch(coachSaveBody({ ...GET_PAYLOAD, coachStyle: 'direct' })).map(([c]) => c);
  assert.ok(columns.includes('coach_style'));
  for (const c of ['coach_voice', 'coach_plain_language', 'coach_language']) assert.ok(!columns.includes(c), c);
});

test('S1: the component posts the picked body, never the whole GET payload', () => {
  const src = read('components/CoachSettingsSection.tsx');
  assert.doesNotMatch(src, /body:\s*JSON\.stringify\(s\)/);
  assert.match(src, /JSON\.stringify\(coachSaveBody\(/);
  assert.match(read('app/api/coach/settings/route.ts'), /coachSettingsPatch\(body\)/);
});

test('S1: the route applies only keys that are present and valid; an absent or bad key gets no default', () => {
  assert.deepEqual(coachSettingsPatch({}), []);
  assert.deepEqual(coachSettingsPatch(null), []);
  assert.deepEqual(coachSettingsPatch({ coachPlainLanguage: true }), [['coach_plain_language', true]]);
  assert.deepEqual(coachSettingsPatch({ coachCreativity: 'loud' }), [], 'a bad creativity is not reset to 50');
  assert.deepEqual(coachSettingsPatch({ coachCreativity: 140 }), [['coach_creativity', 100]]);
  assert.deepEqual(coachSettingsPatch({ coachStyle: 'mean', coachName: '   ' }), []);
  assert.deepEqual(coachSettingsPatch({ coachVoice: 'yes' }), [], 'only real booleans');
});

/* S2: the creativity slider is read; the lesson must say what it really does */
test('S2: creativity reaches the Refinery coach prompt, and the lesson says what it does', () => {
  assert.match(read('app/api/coach/route.ts'), /coachCreativityNote\(profile\.coachCreativity\)/);
  const coach = SETTINGS_LESSONS.find(l => l.id === 'coach');
  assert.ok(coach, 'coach lesson exists');
  const text = JSON.stringify(coach);
  assert.doesNotMatch(text, /framed/, 'the old line promised framing, not behavior');
  assert.match(text, /usual path/);
  assert.match(text, /middle of the slider changes nothing/);
});

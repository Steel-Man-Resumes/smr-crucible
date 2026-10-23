import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gradeOrientation } from '../orientation-grade';
import { ORIENTATION_VERSION, ORIENTATION_QUESTIONS } from '../orientation';
import { ORIENTATION_LESSONS, SETTINGS_LESSONS } from '../orientation-lessons';
import { GUIDED_LESSONS } from '../guided-lessons';
import { TOUR_STOP_COUNT } from '../guidedTour';
import { captionDeltaFromEvent, turnFromRealtimeEvent } from '../voice-transcript';

const answers = { facts: 1, target: 2, application: 0, privacy: 2, limits: 1, practice: 1 };
const pass = { version: ORIENTATION_VERSION, answers };
test('orientation grades actual answers, with explanations and unlimited safe retry', () => {
  assert.equal(gradeOrientation(pass)?.passed, true);
  for (const q of ORIENTATION_QUESTIONS) {
    const result = gradeOrientation({ ...pass, answers: { ...answers, [q.id]: (answers[q.id as keyof typeof answers] + 1) % q.choices.length } });
    assert.equal(result?.passed, false); assert.equal(result?.correct, 5);
    assert.equal(result?.review[0].id, q.id); assert.ok(result?.review[0].explanation);
  }
  assert.equal(gradeOrientation(pass)?.passed, true);
});
test('malformed, forged scores, client grants and obsolete versions cannot pass', () => {
  for (const input of [null, [], {}, { ...pass, version: 0 }, { ...pass, passed: true }, { ...pass, userId: 'another-account' },
    { ...pass, calls: 100 }, { ...pass, answers: [] }, { ...pass, answers: { ...answers, extra: 0 } },
    { ...pass, answers: { ...answers, facts: '1' } }, { ...pass, answers: { ...answers, facts: -1 } },
    { ...pass, answers: { ...answers, facts: 3 } }, { ...pass, answers: { ...answers, facts: 0.5 } },
    { ...pass, answers: Object.create(answers) }, { ...pass, answers: { facts: 1 } }]) assert.equal(gradeOrientation(input), null);
});
test('every lesson action reaches an existing page; chapter count follows the catalog', () => {
  assert.equal(TOUR_STOP_COUNT, GUIDED_LESSONS.length + 1);
  for (const lesson of ORIENTATION_LESSONS) {
    const path = lesson.href.split(/[?#]/)[0].replace('/dashboard', '');
    assert.ok(existsSync(join(import.meta.dirname, '../../app/(dashboard)/dashboard', path, 'page.tsx')), lesson.href);
  }
  assert.equal(new Set(SETTINGS_LESSONS.map(l => l.id)).size, 8);
});
test('current and legacy voice events yield final text only, never audio or unfinished speech', () => {
  for (const type of ['response.output_audio_transcript.done', 'response.audio_transcript.done']) {
    assert.deepEqual(turnFromRealtimeEvent({ type, transcript: ' A real example. ' }), { role: 'assistant', text: 'A real example.' });
    assert.equal(turnFromRealtimeEvent({ type, transcript: '  ' }), null);
  }
  for (const type of ['response.output_audio_transcript.delta', 'response.audio_transcript.delta']) {
    assert.equal(turnFromRealtimeEvent({ type, delta: 'unfinished' }), null);
    assert.equal(captionDeltaFromEvent({ type, delta: 'A detail' }), 'A detail');
  }
  assert.equal(turnFromRealtimeEvent({ type: 'response.output_audio.delta', delta: 'audio-bytes' }), null);
});

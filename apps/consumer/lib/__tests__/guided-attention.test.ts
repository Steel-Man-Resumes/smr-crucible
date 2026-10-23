import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeTourRoute, visibleGuidedRect } from '../guided-attention';
import { GUIDED_LESSONS } from '../guided-lessons';

test('mobile focus stays above the guide and below the fixed header', () => {
  assert.deepEqual(visibleGuidedRect({ left: -5, top: 20, width: 400, height: 900 }, 390, 844, 200), { left: 4, top: 76, width: 382, height: 560 });
  assert.equal(visibleGuidedRect({ left: 0, top: 700, width: 100, height: 50 }, 390, 844, 200), null);
});
test('desktop focus cannot cover the reserved coach area', () => {
  assert.deepEqual(visibleGuidedRect({ left: 800, top: 100, width: 600, height: 200 }, 1040, 900), { left: 800, top: 100, width: 236, height: 200 });
});
test('tour destinations cannot redirect outside the workspace', () => {
  for (const route of ['https://evil.test/dashboard', '//evil.test', '/dashboard/../admin', '/dashboard?next=https://evil.test', '/forge']) assert.equal(safeTourRoute(route), false);
  for (const lesson of GUIDED_LESSONS) assert.equal(safeTourRoute(lesson.route), true);
});
test('three levels stay brief enough to teach before the dedicated quiz', () => {
  assert.deepEqual(['story', 'map', 'pages'].map(part => GUIDED_LESSONS.filter(lesson => lesson.part === part).length), [3, 3, 7]);
  const words = GUIDED_LESSONS.map(l => `${l.title} ${l.message} ${l.observation}`).join(' ').split(/\s+/).length;
  assert.ok(words <= 550, `Core lesson has ${words} words`);
});

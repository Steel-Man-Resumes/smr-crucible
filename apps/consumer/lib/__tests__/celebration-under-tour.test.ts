/** Production run 2026-10-25: the celebration toast sat under the Settings tour card, which covered its Close button. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('the celebration toast waits while any tour holds the page', () => {
  assert.match(read('lib/tour/page-lock.ts'), /html\.dataset\.guidedLearning = 'true'/, 'every tour sets the flag through the page lock');
  assert.match(read('components/progression/progression.css'), /html\[data-guided-learning\] \.progress-celebration\{display:none\}/);
  for (const tour of ['components/GuidedTour.tsx', 'components/tour/SettingsTour.tsx', 'components/tour/StaffTour.tsx']) {
    assert.match(read(tour), /lockPageForTour/, `${tour} holds the page through the shared lock`);
  }
});

test('review B-1: the toast is marked seen only once it can be seen, never while a tour holds the page', () => {
  const src = read('components/progression/ProgressCelebration.tsx');
  const show = src.indexOf('const show = () => {');
  const gate = src.indexOf('if (shown || html.dataset.guidedLearning) return;');
  const seenAdd = src.indexOf('seenThisSession.add(seenKey);');
  const stored = src.indexOf('localStorage.setItem(seenKey, "1");');
  assert.ok(show > 0 && gate > show, 'the tour flag is checked first inside show()');
  assert.ok(seenAdd > gate && stored > gate, 'both seen marks come after the flag check');
  assert.equal(src.split('seenThisSession.add(').length - 1, 1, 'seen is marked in one place only');
  assert.match(src, /new MutationObserver\(show\)/);
  assert.match(src, /attributeFilter: \["data-guided-learning"\]/, 'it waits for the flag to clear');
  assert.match(src, /observer\?\.disconnect\(\); document\.removeEventListener/, 'the wait ends on unmount');
});

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

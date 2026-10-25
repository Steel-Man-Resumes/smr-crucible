/**
 * Production run 2026-10-25: the same account had the Settings tour open in two
 * tabs. The second started a newer run; the first showed "Another tab started a
 * newer tour" as a warning but kept auto-playing to the end, and every later
 * save failed. A save that fails because the run was replaced now stops the
 * tour (lib/tour/run-conflict.ts); other failures keep the warning and Retry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_CONFLICT_COPY, TourSaveError, isRetiredRun, isRunConflict, retiredRun, runReplacedError, saveFailureAction, tourSaveFailure } from '../tour/run-conflict';
import { handleTourWrite, type TourWriteStore } from '../tour/tour-write';
import { TOURS } from '../tour/registry';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const CONTROLLERS = ['components/GuidedTour.tsx', 'components/tour/SettingsTour.tsx', 'components/tour/StaffTour.tsx'];

test('classifier: a 409 (newer run, saved past, account changed) and the replaced-run marker stop the tour', () => {
  assert.equal(isRunConflict(tourSaveFailure('Another tab started a newer tour. Reload to continue from there.', 409)), true);
  assert.equal(isRunConflict(tourSaveFailure('Your tour changed in another tab. Reload to pick up its saved place.', 409)), true);
  assert.equal(isRunConflict(tourSaveFailure('Your account changed. Reload before continuing.', 409)), true);
  assert.equal(isRunConflict(runReplacedError()), true);
  assert.equal(runReplacedError().replaced, true);
  // By status, never by the words: the same words with another status do not stop it, and other words with 409 do.
  assert.equal(isRunConflict(tourSaveFailure('Your tour changed in another tab. Reload to pick up its saved place.', 503)), false);
  assert.equal(isRunConflict(new Error('Another tab started a newer tour. Reload to continue from there.')), false);
  assert.equal(isRunConflict(new Error('This tour was replaced by a newer run.')), false, 'the marker, not the message');
  assert.equal(isRunConflict(tourSaveFailure('anything', 409)), true);
});

test('classifier: 500, 503, timeout, abort, offline, 401 and 403 do not stop the tour', () => {
  assert.equal(isRunConflict(tourSaveFailure('Your place could not be saved. Keep reading or try again.', 503)), false);
  assert.equal(isRunConflict(tourSaveFailure('Server error', 500)), false);
  assert.equal(isRunConflict(tourSaveFailure('Sign in again before saving your place.', 401)), false);
  assert.equal(isRunConflict(tourSaveFailure('The tour is the person\'s own.', 403)), false);
  assert.equal(isRunConflict(tourSaveFailure('Your place could not be saved.', null)), false, 'a 200 with a mismatched body');
  const abort = new DOMException('This operation was aborted', 'AbortError');
  assert.equal(isRunConflict(abort), false, 'the 10 s timeout aborts the fetch');
  assert.equal(isRunConflict(new TypeError('Failed to fetch')), false, 'offline');
  for (const v of [null, undefined, 'conflict', 409, {}, { status: '409' }]) assert.equal(isRunConflict(v), false, JSON.stringify(v));
  assert.ok(tourSaveFailure('x', 503) instanceof TourSaveError);
  assert.equal(tourSaveFailure('x', 503).status, 503);
});

test('decision: stop only for the current run; an older run of this tab is ignored; anything else warns', () => {
  assert.equal(saveFailureAction(tourSaveFailure('x', 409), true), 'stop');
  assert.equal(saveFailureAction(runReplacedError(), true), 'stop');
  assert.equal(saveFailureAction(tourSaveFailure('x', 503), true), 'warn');
  assert.equal(saveFailureAction(new DOMException('aborted', 'AbortError'), true), 'warn');
  assert.equal(saveFailureAction(tourSaveFailure('x', 409), false), 'ignore', 'a replay in this tab replaced it: the new run keeps playing');
  assert.equal(saveFailureAction(tourSaveFailure('x', 503), false), 'ignore');
  const r = retiredRun();
  assert.deepEqual(r, { id: '', sequence: 0, account: '' });
  assert.equal(isRetiredRun(r), true);
  assert.equal(isRetiredRun({ id: '', sequence: 0, account: '' }), false, 'only the identity a stop made');
  assert.notEqual(retiredRun(), retiredRun(), 'each stop gets its own identity');
});

test('copy: one plain notice with Reload and Dismiss, no long dashes, no emoji', () => {
  assert.equal(RUN_CONFLICT_COPY.notice, 'This tour is open in another tab or window. Pick it up there, or reload here to continue from where it was saved.');
  assert.equal(RUN_CONFLICT_COPY.reload, 'Reload');
  assert.equal(RUN_CONFLICT_COPY.dismiss, 'Dismiss');
  for (const f of ['lib/tour/run-conflict.ts', 'components/tour/RunConflictNotice.tsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /—|–/, f);
    assert.doesNotMatch(src, /\s--\s/, f);
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, f);
  }
  const notice = read('components/tour/RunConflictNotice.tsx');
  assert.match(notice, /window\.location\.reload\(\)/);
  assert.match(notice, /onClick=\{onDismiss\}/);
});

/** Two tabs of one account against the real save handler, each write classified the way the controllers do. */
function slotStore(): TourWriteStore {
  const place: { runId?: string; sequence: number; inProgress: boolean } = { sequence: 0, inProgress: false };
  return {
    async start(_u, runId, previous) {
      if (place.runId === runId) return 'same';
      if ((place.runId ?? null) !== previous) return 'conflict';
      Object.assign(place, { runId, sequence: 0, inProgress: true });
      return 'started';
    },
    async advance(_u, runId, sequence, _stop, complete) {
      if (place.runId === runId && place.inProgress && place.sequence < sequence) { place.sequence = sequence; if (complete) place.inProgress = false; return 'saved'; }
      return place.runId === runId && !place.inProgress ? 'already-complete' : 'conflict';
    },
    async watchedMs() { return 0; },
    async grant() { return { status: 'early', calls: 0 }; },
    async invalidate() {},
  };
}

test('two tabs: once a second tab starts a newer Settings run, the first tab\'s next save classifies as stop, and so does its finish', async () => {
  const store = slotStore();
  const U = '00000000-0000-4000-8000-000000000001';
  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
  const S = TOURS.settings;
  const post = async (body: Record<string, unknown>) => {
    const r = await handleTourWrite(store, U, { tourId: 'settings', version: S.version, stop: 0, ...body });
    return r.status === 200 ? null : tourSaveFailure(String(r.json.error), r.status);
  };
  assert.equal(await post({ action: 'start', runId: A, sequence: 0, previousRunId: null }), null);
  assert.equal(await post({ action: 'progress', runId: A, sequence: 1, stop: 2 }), null);
  // The second tab: Start over (a new run naming the current one).
  assert.equal(await post({ action: 'start', runId: B, sequence: 0, previousRunId: A }), null);
  const third = await post({ action: 'progress', runId: A, sequence: 2, stop: 3 });
  assert.equal(third?.status, 409);
  assert.equal(saveFailureAction(third, true), 'stop');
  assert.equal(saveFailureAction(await post({ action: 'complete', runId: A, sequence: 3, stop: S.stopCount - 1 }), true), 'stop');
  // A stale start from the first tab (it never saw B) is a 409 too.
  assert.equal(saveFailureAction(await post({ action: 'start', runId: '33333333-3333-4333-8333-333333333333', sequence: 0, previousRunId: A }), true), 'stop');
  // The second tab keeps saving.
  assert.equal(await post({ action: 'progress', runId: B, sequence: 1, stop: 3 }), null);
});

/** The body of `const name = useCallback(...)` up to its dependency list. */
function callback(src: string, name: string): string {
  const at = src.indexOf(`const ${name} = useCallback(`);
  assert.ok(at > 0, name);
  const end = src.indexOf('\n  }, [', at);
  assert.ok(end > at, name);
  return src.slice(at, end);
}

for (const file of CONTROLLERS) {
  test(`${file}: a run conflict stops the player, releases the page lock, and queues no further write`, () => {
    const src = read(file);
    // persist() carries the status on the error and marks its own replaced-run check.
    assert.match(src, /throw tourSaveFailure\(result\?\.error \|\| 'Your place could not be saved\.', response\.ok \? null : response\.status\);/);
    assert.match(src, /if \(!alive\.current \|\| run\.current\.id !== body\.runId \|\| run\.current\.account !== current\.account\) throw runReplacedError\(\);/);
    assert.doesNotMatch(src, /throw new Error\(result\?\.error/);
    assert.doesNotMatch(src, /\.message\.(includes|match|startsWith)|\/another tab\//i, 'never classified by text');
    // Every rejected save and the finish go through the shared decision.
    const save = callback(src, 'save');
    const finish = callback(src, 'finish');
    for (const [name, body] of [['save', save], ['finish', finish]] as const) {
      assert.match(body, /const next = saveFailureAction\(e, alive\.current && run\.current === identity && !isRetiredRun\(identity\)\);/, name);
      assert.match(body, /if \(next === 'stop'\) stopForConflict\(\);/, name);
      assert.match(body, /else if \(next === 'warn'\) setSaveError\(/, name, );
    }
    assert.match(finish, /throw e instanceof Error \? e :/, 'the player still hears the finish failed');
    // The stop: the run is retired (queued writes for it fail before fetch), the player closes, nothing is saved.
    const stop = callback(src, 'stopForConflict');
    assert.match(stop, /run\.current = retiredRun\(\); pendingStart\.current = null; lastWrite\.current = null;/);
    assert.match(stop, /setActive\(false\);/);
    assert.match(stop, /setConflict\(true\);/);
    assert.match(stop, /setSaveError\(''\)/);
    assert.doesNotMatch(stop, /save\(|persist\(|fetch\(|sessionStorage/, 'a stop writes nothing');
    if (!file.endsWith('SettingsTour.tsx')) assert.match(stop, /onNavigationReveal\?\.\(false\)/, 'the drawer closes like pause does');
    // The page lock is released by the same effect cleanup pause relies on: it only holds while active.
    assert.match(src, /useEffect\(\(\) => \{\n    if \(!active[^\n]*return;\n    const unlock = lockPageForTour\(/);
    assert.match(src, /return \(\) => \{ unlock\(\); document\.removeEventListener\('keydown', onKey\); if \(oldFocus\.current\?\.isConnected\) oldFocus\.current\.focus\(\{ preventScroll: true \}\); \};/);
    // One notice, the warning hidden while it shows, cleared when a run is entered again.
    assert.match(src, /\{conflict && <RunConflictNotice onDismiss=\{\(\) => setConflict\(false\)\} \/>\}/);
    assert.match(src, /\{!conflict && \(notice \|\| error \|\| saveError\) && <div className="et-notice"/);
    assert.match(src, /setConflict\(false\); setActive\(true\);/);
    // Safeguards kept: UUID run, rising sequence, start before progress, the account header, keepalive.
    assert.match(src, /crypto\.randomUUID\(\)/);
    assert.match(src, /sequence: action === 'start' \? 0 : \+\+current\.sequence/);
    assert.match(src, /if \(pendingStart\.current\?\.runId === body\.runId && body\.action !== 'start'\)/);
    assert.match(src, /'X-Orientation-Account': current\.account/);
    assert.match(src, /keepalive: true/);
  });
}

test('Settings: the chips stay hidden while the conflict notice shows, and the pagehide save goes with the player', () => {
  const src = read('components/tour/SettingsTour.tsx');
  assert.match(src, /\{open && !conflict && !notice && !error && <div/);
  assert.match(src, /\{fresh && !conflict && !notice && !error && <div/);
  assert.match(src, /useEffect\(\(\) => \{\n    if \(!active\) return;\n    const hide = /, 'the pagehide listener only exists while the tour is open');
});

test('the route and the SQL keep their 409s (this fix is client only)', () => {
  const write = read('lib/tour/tour-write.ts');
  assert.match(write, /fail\(409, 'Another tab started a newer tour\. Reload to continue from there\.'\)/);
  assert.match(write, /fail\(409, 'Your tour changed in another tab\. Reload to pick up its saved place\.'\)/);
  assert.match(read('app/api/onboarding/tour/route.ts'), /request\.headers\.get\("X-Orientation-Account"\) !== userId\) return NextResponse\.json\(\{ error: "Your account changed\. Reload before continuing\." \}, \{ status: 409/);
});

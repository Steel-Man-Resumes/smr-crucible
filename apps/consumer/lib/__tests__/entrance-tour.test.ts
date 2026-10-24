/**
 * Entrance tour (TOUR_VERSION 5): reading pace, camera and spotlight geometry,
 * phone text size, the save handler and its one-time reward, the services
 * chart data, the page lock, and copy rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOUR_BEATS, TOUR_CHAPTERS, type StageBeat } from '../tour/beats';
import { holdMs, readingMs, tourRuntimeMs, wordCount, MS_PER_WORD, READ_CAP_MS, READ_FLOOR_MS } from '../tour/timing';
import { captionPlacement, frameCamera, onStage, particlePath, spotlightRect, unionBox, ZOOM_MAX, ZOOM_MIN } from '../tour/geometry';
import { PORTRAIT_MIN_FONT, PORTRAIT_MIN_SCALE, SCENE_SIZE, portraitSceneSize, portraitSpot, spotBox } from '../tour/layout';
import { readTourReward, rewardCelebrates, rewardMessage, tourRewardOutcome, TOUR_MIN_WATCH_MS, TOUR_REWARD_KEY, type TourReward } from '../tour/reward';
import { gapStart, serviceCatalog, serviceRows } from '../tour/services';
import { handleTourWrite, type TourWriteStore } from '../tour/tour-write';
import { leaveAction, lockPageForTour, safeTourDestination } from '../tour/page-lock';
import { TOUR_STOP_COUNT, TOUR_VERSION } from '../guidedTour';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stageBeats = TOUR_BEATS.filter((b): b is StageBeat => b.kind === 'stage');

/* Pace */
test('reading pace: 300 ms a word, never under the floor, never over the cap', () => {
  assert.equal(MS_PER_WORD, 300);
  assert.equal(readingMs(0), READ_FLOOR_MS);
  assert.equal(readingMs(500), READ_CAP_MS);
  let prev = 0;
  for (let w = 0; w < 80; w++) { const ms = readingMs(w); assert.ok(ms >= prev); prev = ms; }
  assert.equal(readingMs(500, 900), READ_CAP_MS + 900);
  assert.equal(readingMs(10, -50), readingMs(10));
  assert.equal(holdMs({ title: 'A b', body: 'c d e' }), readingMs(5));
});

test('the whole tour stays under three minutes at the slower pace, with room for render time', () => {
  const { stage, room, total } = tourRuntimeMs(TOUR_BEATS);
  assert.ok(total <= 172_000, `runtime ${total}ms`);
  assert.ok(stage > room && room > 0);
});

test('captions stay in their word ranges: 12 to 30 on the stage, 8 to 20 in the room', () => {
  for (const b of TOUR_BEATS) {
    for (const body of [b.body, ...(b.kind === 'stage' && b.noForge ? [b.noForge.body] : [])]) {
      const n = wordCount(body);
      if (b.kind === 'stage') assert.ok(n >= 12 && n <= 30, `${b.id}: ${n} words`);
      else assert.ok(n >= 8 && n <= 20, `${b.id}: ${n} words`);
    }
  }
});

test('station beats never say the station name twice', () => {
  for (const b of stageBeats.filter(b => b.station)) assert.equal(b.title, '', `${b.id} repeats the tile's name in the caption`);
});

test('station beats vary their shot', () => {
  const spots = stageBeats.filter(b => b.station).map(b => b.spot);
  assert.equal(new Set(spots).size, spots.length);
  const sizes = spots.map(s => { const b = spotBox('board', s)!; return `${Math.round(b.w)}x${Math.round(b.h)}`; });
  assert.ok(new Set(sizes).size >= 3, `only ${new Set(sizes).size} framings`);
});

test('every beat belongs to a chapter, chapters are in order, ids are unique', () => {
  const ids = TOUR_CHAPTERS.map(c => c.id);
  let last = 0;
  for (const b of TOUR_BEATS) { const at = ids.indexOf(b.chapter); assert.ok(at >= last, `${b.id} out of order`); last = at; }
  assert.equal(new Set(TOUR_BEATS.map(b => b.id)).size, TOUR_BEATS.length);
  assert.equal(TOUR_VERSION, 5);
  assert.equal(TOUR_STOP_COUNT, TOUR_BEATS.length + 1);
});

test('act two: five stops on the nav contract, the path as one, no Settings stand-in', () => {
  const room = TOUR_BEATS.filter(b => b.kind === 'room');
  assert.deepEqual(room.map(b => b.id), ['room-overview', 'room-path', 'room-next', 'room-toolbox', 'room-meter']);
  const all = room.flatMap(b => b.kind === 'room' ? b.targets.flat() : []);
  assert.ok(!all.includes('refinery-nav-settings'));
  const path = room.find(b => b.id === 'room-path');
  assert.ok(path && path.kind === 'room' && path.minFound >= 2);
  for (const id of ['refinery-nav-find', 'refinery-nav-jobs', 'refinery-nav-apply', 'refinery-nav-applications']) assert.ok(all.includes(id), id);
  const first = TOUR_BEATS.findIndex(b => b.kind === 'room');
  assert.ok(TOUR_BEATS.slice(first).every(b => b.kind === 'room'));
});

/* Camera, desktop */
test('desktop camera frames each spot above the caption, zoom capped', () => {
  const stage = { w: 1440, h: 780 }, reserve = 230;
  for (const b of stageBeats) {
    const spot = spotBox(b.scene, b.spot, { rows: 14, gapStart: 11 });
    const cam = frameCamera(stage, SCENE_SIZE[b.scene], spot, b.scene === 'title' ? 0 : reserve);
    const base = Math.min(stage.w / SCENE_SIZE[b.scene].w, stage.h / SCENE_SIZE[b.scene].h);
    assert.ok(cam.s / base <= ZOOM_MAX + 1e-9 && cam.s / base >= ZOOM_MIN - 1e-9, `${b.id} zoom ${cam.s / base}`);
    if (!spot) continue;
    const on = onStage(spot, cam);
    assert.ok(on.x >= -1 && on.x + on.w <= stage.w + 1, `${b.id} off stage`);
    assert.ok(on.y >= -1 && on.y + on.h <= stage.h - reserve + 1, `${b.id} under the caption`);
  }
});

test('camera with no spot fits the scene; a small spot zooms to the cap; the floor holds scale', () => {
  assert.deepEqual(frameCamera({ w: 1280, h: 800 }, { w: 1280, h: 800 }, null, 0), { s: 1, tx: 0, ty: 0 });
  assert.equal(frameCamera({ w: 1280, h: 800 }, { w: 1280, h: 800 }, { x: 600, y: 380, w: 20, h: 20 }, 0).s, ZOOM_MAX);
  const floored = frameCamera({ w: 390, h: 300 }, { w: 320, h: 2000 }, { x: 0, y: 0, w: 320, h: 2000 }, 0, 0.9);
  assert.equal(floored.s, 0.9);
  assert.ok(floored.ty <= 0 && floored.ty > -20, 'shows the top of a spot too tall to fit');
});

/* Camera, phones: portrait scenes, and no text under 13 px */
function cssRules(css: string) {
  const out: { sel: string; px: number }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    for (const f of m[2].matchAll(/font(?:-size)?\s*:[^;]*?(\d+(?:\.\d+)?)(px|rem)/g)) out.push({ sel, px: f[2] === 'rem' ? Number(f[1]) * 16 : Number(f[1]) });
  }
  return out;
}
const CSS = read('components/tour/entrance-tour.css');

test('every portrait scene font is at least the declared floor', () => {
  const ps = cssRules(CSS).filter(r => /\.ps\b|\.ps-/.test(r.sel));
  assert.ok(ps.length > 15);
  for (const r of ps) assert.ok(r.px >= PORTRAIT_MIN_FONT, `${r.sel} is ${r.px}px`);
  assert.doesNotMatch(read('components/tour/TourPortrait.tsx'), /fontSize/);
});

test('tour chrome text (captions, controls, ending) is 13 px or more', () => {
  const chrome = cssRules(CSS).filter(r => /\.et-/.test(r.sel) && !/\.sc-|\.ps/.test(r.sel));
  assert.ok(chrome.length > 5);
  for (const r of chrome) assert.ok(r.px >= 13, `${r.sel} is ${r.px}px`);
});

test('at 390 and 360 wide, every portrait shot renders text at 13 px or more and fits the stage', () => {
  for (const [vw, vh] of [[390, 844], [360, 780], [360, 740]]) {
    for (const b of stageBeats) {
      const shots = b.chart === 'rows' ? [b.spot, 'chart-rest'] : [b.spot];
      for (const name of shots) {
        const stage = { w: vw, h: vh - 125 - (b.scene === 'title' ? 0 : 240) };
        const spot = portraitSpot(b.scene, name, { rows: 14, gapStart: 11 });
        const cam = frameCamera(stage, portraitSceneSize(b.scene, 14), spot, 0, PORTRAIT_MIN_SCALE);
        assert.ok(cam.s * PORTRAIT_MIN_FONT >= 13 - 1e-9, `${vw}x${vh} ${b.id} ${name}: ${(cam.s * PORTRAIT_MIN_FONT).toFixed(1)}px`);
        if (!spot) continue;
        const on = onStage(spot, cam);
        assert.ok(on.x >= -1 && on.x + on.w <= stage.w + 1 && on.y >= -1 && on.y + on.h <= stage.h + 1, `${vw}x${vh} ${b.id} ${name} does not fit`);
      }
    }
  }
});

/* Spotlight and caption */
test('spotlight pads the target and stays inside the viewport; a group becomes one box', () => {
  assert.deepEqual(spotlightRect({ left: 20, top: 100, width: 200, height: 40 }, 1440, 900, 6), { x: 14, y: 94, w: 212, h: 52 });
  assert.deepEqual(spotlightRect({ left: 0, top: 0, width: 50, height: 30 }, 390, 844, 6), { x: 4, y: 4, w: 52, h: 32 });
  assert.equal(spotlightRect({ left: 500, top: 950, width: 50, height: 30 }, 390, 844, 6), null);
  assert.deepEqual(unionBox([{ x: 10, y: 100, w: 200, h: 40 }, { x: 10, y: 300, w: 220, h: 40 }]), { x: 10, y: 100, w: 220, h: 240 });
  assert.equal(unionBox([]), null);
});

test('caption sits beside a left-rail target on desktop, avoids it elsewhere', () => {
  const card = { w: 360, h: 200 };
  const beside = captionPlacement({ x: 10, y: 300, w: 240, h: 44 }, 1440, 900, card);
  assert.deepEqual(beside, { x: 270, y: 300, w: 360, h: 200 });
  const low = captionPlacement({ x: 10, y: 820, w: 240, h: 44 }, 1440, 900, card);
  assert.equal(low.y, 900 - 16 - 200);
  assert.deepEqual(captionPlacement(null, 1440, 900, card), { x: 1440 - 16 - 360, y: 900 - 16 - 200, w: 360, h: 200 });
  const phone = captionPlacement({ x: 10, y: 700, w: 280, h: 40 }, 390, 844, card);
  assert.equal(phone.w, 390 - 32);
  assert.ok(phone.y + phone.h < 700);
});

test('the act-two card stays inside the viewport on every stop at 360x780, 390x844 and 1366x768', () => {
  // Targets where the real menu puts each stop: a left rail on a laptop (the meter
  // sits low), a drawer on a phone. Card heights cover the measured range of the
  // card (title, body, progress, controls, motion row) and more.
  const cases: [number, number, { x: number; y: number; w: number; h: number }[]][] = [
    [1366, 768, [{ x: 8, y: 70, w: 240, h: 40 }, { x: 8, y: 115, w: 240, h: 240 }, { x: 8, y: 360, w: 240, h: 40 }, { x: 8, y: 410, w: 240, h: 40 }, { x: 8, y: 640, w: 240, h: 70 }]],
    [390, 844, [{ x: 8, y: 20, w: 290, h: 40 }, { x: 8, y: 65, w: 290, h: 240 }, { x: 8, y: 310, w: 290, h: 40 }, { x: 8, y: 360, w: 290, h: 40 }, { x: 8, y: 470, w: 290, h: 70 }]],
    [360, 780, [{ x: 8, y: 20, w: 300, h: 40 }, { x: 8, y: 65, w: 300, h: 240 }, { x: 8, y: 310, w: 300, h: 40 }, { x: 8, y: 360, w: 300, h: 40 }, { x: 8, y: 470, w: 300, h: 70 }]],
  ];
  for (const [vw, vh, targets] of cases) for (const t of targets) for (const h of [200, 260, 300, 340]) {
    const box = captionPlacement(t, vw, vh, { w: 360, h });
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= vw && box.y + box.h <= vh, `${vw}x${vh} target y ${t.y}, card ${h}px: ${JSON.stringify(box)}`);
  }
  // The card is measured where it mounts (a callback ref), not from a ref read before it exists.
  const player = read('components/tour/TourPlayer.tsx');
  assert.match(player, /ref=\{setCardEl\}/);
  assert.match(player, /useLayoutEffect\(\(\) => \{\n    if \(!cardEl\) return;/);
});

test('particle path starts at the mark and ends at the target', () => {
  assert.match(particlePath({ x: 10, y: 20 }, { x: 300, y: 400 }), /^M 10 20 Q [\d.]+ [-\d.]+ 300 400$/);
});

/* Save handler and the reward, against the handler with an in-memory store */
const USER = '00000000-0000-4000-8000-000000000001';
const RUN = '11111111-1111-4111-8111-111111111111';
const RUN2 = '22222222-2222-4222-8222-222222222222';
function memoryStore() {
  let now = 1_000_000;
  const place: { runId?: string; sequence: number; inProgress: boolean; startedAt?: number; completedAt?: number } = { sequence: 0, inProgress: false };
  const grants: { runId: string; at: number }[] = [];
  const calls = { grant: 0 };
  const store: TourWriteStore = {
    async start(_u, runId, previous) {
      if (place.runId === runId) return 'same';
      if ((place.runId ?? null) !== previous) return 'conflict';
      Object.assign(place, { runId, sequence: 0, inProgress: true, startedAt: now, completedAt: undefined });
      return 'started';
    },
    async advance(_u, runId, sequence, _stop, complete) {
      if (place.runId === runId && place.inProgress && place.sequence < sequence) { place.sequence = sequence; if (complete) { place.inProgress = false; place.completedAt = now; } return 'saved'; }
      return place.runId === runId && !place.inProgress ? 'already-complete' : 'conflict';
    },
    async watchedMs(_u, runId) { return place.runId === runId && place.startedAt != null ? (place.completedAt ?? now) - place.startedAt : null; },
    async grant(_u, runId): Promise<TourReward> {
      calls.grant++;
      const prior = grants[0];
      if (prior) return tourRewardOutcome({ prior: { calls: 2, created_at: new Date(prior.at).toISOString(), expires_at: null, request_key: prior.runId }, inserted: null, runId });
      grants.push({ runId, at: now });
      return tourRewardOutcome({ prior: null, inserted: { calls: 2, created_at: new Date(now).toISOString(), expires_at: new Date(now + 86_400_000).toISOString(), request_key: runId }, runId });
    },
    async invalidate() {},
  };
  return { store, calls, tick: (ms: number) => { now += ms; } };
}
const write = (s: TourWriteStore, body: Record<string, unknown>) => handleTourWrite(s, USER, { version: TOUR_VERSION, runId: RUN, sequence: 0, stop: 0, ...body });

test('handler: a direct start-then-complete skips the tour and gets nothing', async () => {
  const m = memoryStore();
  assert.equal((await write(m.store, { action: 'start', previousRunId: null })).status, 200);
  const done = await write(m.store, { action: 'complete', sequence: 1, stop: TOUR_STOP_COUNT - 1 });
  assert.equal(done.status, 200);
  assert.deepEqual(done.json.reward, { status: 'early', calls: 0 });
  assert.equal(m.calls.grant, 0);
  assert.equal(rewardCelebrates(readTourReward(done.json.reward)), false);
});

test('handler: a run open a minute or more gets the bonus once; a retry is the same grant; a replay gets nothing new', async () => {
  const m = memoryStore();
  await write(m.store, { action: 'start', previousRunId: null });
  await write(m.store, { action: 'progress', sequence: 1, stop: 5 });
  m.tick(TOUR_MIN_WATCH_MS);
  const done = await write(m.store, { action: 'complete', sequence: 2, stop: TOUR_STOP_COUNT - 1 });
  assert.equal((done.json.reward as TourReward).status, 'granted');
  assert.equal((done.json.reward as TourReward).calls, 2);
  const retry = await write(m.store, { action: 'complete', sequence: 3, stop: TOUR_STOP_COUNT - 1 });
  assert.equal((retry.json.reward as TourReward).status, 'granted', 'a lost response re-confirms the same grant');
  await write(m.store, { action: 'start', runId: RUN2, previousRunId: RUN });
  m.tick(TOUR_MIN_WATCH_MS);
  const again = await write(m.store, { action: 'complete', runId: RUN2, sequence: 1, stop: TOUR_STOP_COUNT - 1 });
  assert.equal((again.json.reward as TourReward).status, 'already');
  assert.equal((again.json.reward as TourReward).calls, 0);
});

test('handler: a run finished early stays early, even if complete is posted again later', async () => {
  const m = memoryStore();
  await write(m.store, { action: 'start', previousRunId: null });
  m.tick(5_000);
  assert.equal(((await write(m.store, { action: 'complete', sequence: 1, stop: TOUR_STOP_COUNT - 1 })).json.reward as TourReward).status, 'early');
  m.tick(TOUR_MIN_WATCH_MS * 2);
  const again = await write(m.store, { action: 'complete', sequence: 2, stop: TOUR_STOP_COUNT - 1 });
  assert.equal(again.status, 200);
  assert.equal((again.json.reward as TourReward).status, 'early');
  assert.equal(m.calls.grant, 0);
});

test('handler: 59 seconds is not a minute', async () => {
  const m = memoryStore();
  await write(m.store, { action: 'start', previousRunId: null });
  m.tick(TOUR_MIN_WATCH_MS - 1000);
  const done = await write(m.store, { action: 'complete', sequence: 1, stop: TOUR_STOP_COUNT - 1 });
  assert.equal((done.json.reward as TourReward).status, 'early');
});

test('handler: stale writes, forged input and store failures', async () => {
  const m = memoryStore();
  await write(m.store, { action: 'start', previousRunId: null });
  await write(m.store, { action: 'progress', sequence: 3, stop: 3 });
  assert.equal((await write(m.store, { action: 'progress', sequence: 2, stop: 4 })).status, 409);
  assert.equal((await write(m.store, { action: 'complete', runId: RUN2, sequence: 9, stop: 4 })).status, 409);
  assert.equal(m.calls.grant, 0);
  for (const bad of [{ version: 4 }, { runId: 'x' }, { stop: TOUR_STOP_COUNT }, { action: 'grant' }, { sequence: -1 }, { action: 'start', sequence: 1, previousRunId: null }]) {
    assert.equal((await write(m.store, { action: 'progress', sequence: 5, ...bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await handleTourWrite(m.store, USER, null)).status, 400);
  const broken = memoryStore();
  await write(broken.store, { action: 'start', previousRunId: null });
  broken.tick(TOUR_MIN_WATCH_MS);
  broken.store.grant = async () => { throw new Error('db'); };
  const done = await write(broken.store, { action: 'complete', sequence: 1, stop: 1 });
  assert.equal(done.status, 200);
  assert.deepEqual(done.json.reward, { status: 'unavailable', calls: 0 });
  broken.store.advance = async () => { throw new Error('db'); };
  assert.equal((await write(broken.store, { action: 'progress', sequence: 5, stop: 1 })).status, 503);
});

test('reward outcomes and client reading', () => {
  assert.equal(tourRewardOutcome({ prior: null, inserted: null, runId: RUN }).status, 'capped');
  for (const raw of [null, undefined, 'granted', {}, { status: 'granted', calls: 0 }, { status: 'granted', calls: 999 }, { status: 'granted', calls: 1.5 }, { status: 'free', calls: 2 }, { status: 'early', calls: 2 }]) {
    assert.equal(rewardCelebrates(readTourReward(raw)), false, JSON.stringify(raw));
  }
  assert.equal(TOUR_REWARD_KEY, 'tour:complete');
  assert.match(rewardMessage({ status: 'granted', calls: 2 })[1], /^2 extra AI actions .* next 24 hours\.$/);
  assert.match(rewardMessage({ status: 'early', calls: 0 })[1], /watching the tour through/);
  assert.match(rewardMessage({ status: 'already', calls: 0, grantedAt: '2026-10-20T10:00:00Z' })[1], /one time/);
});

test('the tour grant lasts 24 hours from now, through the shared bonus lock and caps', () => {
  // Source shape only; tour-reward-pglite.test.ts runs this SQL for real.
  const fn = read('lib/tour/tour-sql.ts');
  assert.match(fn, /now\(\)\+interval '24 hours'/);
  assert.match(fn, /pg_advisory_xact_lock\(hashtextextended\(\$\{userId\}, 874\)\)/);
  assert.match(fn, /bonus_daily_cap/); assert.match(fn, /bonus_monthly_cap/);
  const store = fn;
  assert.match(store, /jsonb_build_object\('startedAt', now\(\)\)/, 'startedAt is set by the database clock at start');
  assert.match(store, /'startedAt', preferences->'guidedTour'->'startedAt'/, 'progress keeps startedAt');
});

/* Controller helpers */
test('page lock: no scroll, inert shell and the flag while open; everything restored after', () => {
  const html = { dataset: {} as DOMStringMap };
  const body = { style: { overflow: 'auto', overflowAnchor: '' } };
  const shell = { inert: false };
  const undo = lockPageForTour(html, body, shell);
  assert.equal(html.dataset.guidedLearning, 'true');
  assert.equal(body.style.overflow, 'hidden');
  assert.equal(body.style.overflowAnchor, 'none');
  assert.equal(shell.inert, true);
  undo();
  assert.equal(html.dataset.guidedLearning, undefined);
  assert.equal(body.style.overflow, 'auto');
  assert.equal(body.style.overflowAnchor, '');
  assert.equal(shell.inert, false);
  assert.match(CSS, /html\[data-guided-learning\] body\{overflow:hidden;overflow-anchor:none\}/);
});

test('leaving after a confirmed finish closes; before it, it pauses', () => {
  assert.equal(leaveAction(true), 'close');
  assert.equal(leaveAction(false), 'pause');
});

test('tour destinations stay inside the workspace', () => {
  for (const href of ['https://evil.test/dashboard', '//evil.test', '/dashboard/../admin', '/dashboard/./x', '/dashboard?next=https://evil.test', '/forge', '/dashboard//evil.test', '/dashboard/%2e%2e/admin', '/dashboard?tour=1', '/dashboard\\evil', undefined, '']) {
    assert.equal(safeTourDestination(href), null, String(href));
  }
  for (const href of ['/dashboard', '/dashboard/jobs', '/dashboard/application-tailor?job=abc&id=def']) assert.equal(safeTourDestination(href), href);
});

/* Copy matches the code */
test('the lock scenes repeat the server messages word for word', () => {
  const server = read('lib/progression-server.ts');
  for (const text of ['is open. The recommended preparation is still there when you need it.', 'opened at your request.']) {
    assert.ok(server.includes(text), `server: ${text}`);
    assert.ok(read('components/tour/TourScenes.tsx').includes(text), `desktop scene: ${text}`);
    assert.ok(read('components/tour/TourPortrait.tsx').includes(text), `portrait scene: ${text}`);
  }
});

/* Services chart */
test('services chart: gaps last, every service in the catalog, and the pill is never better than its services', () => {
  const rows = serviceRows();
  const gap = gapStart(rows);
  assert.ok(gap < rows.length && rows.slice(gap).every(r => r.status === 'absent'));
  const catalog = new Map(serviceCatalog().map(r => [r.service, r]));
  assert.ok(catalog.size > 50);
  for (const r of rows) {
    const statuses = (r.services ?? []).map(s => { assert.ok(catalog.has(s), `${r.id}: ${s}`); return catalog.get(s)!.status; });
    for (const s of statuses) assert.match(s, /^LIVE/);
    if (statuses.some(s => s !== 'LIVE')) assert.equal(r.status, 'limits', `${r.id} names a service with a limit but reads "${r.status}"`);
    if (r.status === 'limits') assert.ok(r.limit, `${r.id} says what the limit is`);
  }
  assert.ok(![...catalog.values()].some(r => r.station === 'For programs'));
  const absent = rows.filter(r => r.status === 'absent').map(r => `${r.need} ${r.here}`).join(' ');
  assert.match(absent, /single score/);
  assert.match(absent, /Nothing submits an application/);
});

test('copy: no long dashes, no competitor names, no counts, no promised email, no rough base', () => {
  for (const f of ['lib/tour/beats.ts', 'lib/tour/services.json', 'components/tour/TourScenes.tsx', 'components/tour/TourPortrait.tsx', 'components/tour/TourPlayer.tsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /—|–/, `${f} has a long dash`);
    assert.doesNotMatch(src, /Honest Jobs|Orijin|Jobscan|\bTeal\b|Rezi|Yoodli|AIApply|CaseWorthy|Apricot|Unite Us/i, f);
  }
  const beats = read('lib/tour/beats.ts');
  assert.doesNotMatch(beats, /\b\d{2,}\s+(employers|people|resources|services|states)\b/i);
  assert.doesNotMatch(beats, /\bunlock|journey|seamless|empower\b/i);
  assert.doesNotMatch(beats, /own email|rough on purpose|Life gets easier/i);
});

/**
 * Entrance tour (TOUR_VERSION 5): reading pace, camera and spotlight geometry,
 * the one-time reward's pure rules, the services chart data, and copy rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOUR_BEATS, TOUR_CHAPTERS } from '../tour/beats';
import { holdMs, readingMs, tourRuntimeMs, wordCount, READ_CAP_MS, READ_FLOOR_MS } from '../tour/timing';
import { captionPlacement, frameCamera, onStage, particlePath, spotlightRect, ZOOM_MAX, ZOOM_MIN } from '../tour/geometry';
import { SCENE_SIZE, chartSceneSize, spotBox } from '../tour/layout';
import { readTourReward, rewardCelebrates, tourRewardOutcome, TOUR_REWARD_KEY } from '../tour/reward';
import { gapStart, serviceCatalog, serviceRows } from '../tour/services';
import { TOUR_STOP_COUNT, TOUR_VERSION } from '../guidedTour';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/* Timing */
test('reading pace: never under the floor, never over the cap, longer text never shorter', () => {
  assert.equal(readingMs(0), READ_FLOOR_MS);
  assert.equal(readingMs(3), READ_FLOOR_MS);
  assert.equal(readingMs(500), READ_CAP_MS);
  let prev = 0;
  for (let w = 0; w < 80; w++) { const ms = readingMs(w); assert.ok(ms >= prev); prev = ms; }
  assert.equal(readingMs(500, 900), READ_CAP_MS + 900);
  assert.equal(readingMs(10, -50), readingMs(10));
  assert.equal(holdMs({ title: 'A b', body: 'c d e' }), readingMs(5));
});

test('the whole tour runs under three minutes at default pace, act one longer than act two', () => {
  const { stage, room, total } = tourRuntimeMs(TOUR_BEATS);
  assert.ok(total < 180_000, `runtime ${total}ms`);
  assert.ok(stage > room);
  assert.ok(room > 0);
});

test('captions stay in their word ranges: 12 to 30 on the stage, 8 to 20 in the room', () => {
  for (const b of TOUR_BEATS) {
    const n = wordCount(b.body);
    if (b.kind === 'stage') assert.ok(n >= 12 && n <= 30, `${b.id}: ${n} words`);
    else assert.ok(n >= 8 && n <= 20, `${b.id}: ${n} words`);
  }
});

test('every beat belongs to a chapter, chapters are in order, ids are unique', () => {
  const ids = TOUR_CHAPTERS.map(c => c.id);
  let last = 0;
  for (const b of TOUR_BEATS) {
    const at = ids.indexOf(b.chapter);
    assert.ok(at >= last, `${b.id} out of chapter order`); last = at;
  }
  assert.equal(new Set(TOUR_BEATS.map(b => b.id)).size, TOUR_BEATS.length);
  assert.equal(TOUR_VERSION, 5);
  assert.equal(TOUR_STOP_COUNT, TOUR_BEATS.length + 1);
});

test('act two points at the navigation contract ids, with legacy fallbacks', () => {
  const room = TOUR_BEATS.filter(b => b.kind === 'room');
  assert.deepEqual(room.map(b => b.kind === 'room' && b.target), ['refinery-nav-overview', 'refinery-nav-find', 'refinery-nav-tailor', 'refinery-nav-plan', 'refinery-nav-practice', 'refinery-nav-apply', 'refinery-nav-next', 'refinery-nav-toolbox', 'refinery-meter']);
  const legacy = new Set(room.flatMap(b => b.kind === 'room' ? [...b.legacy] : []));
  for (const id of ['refinery-nav-jobs', 'refinery-nav-resumes', 'refinery-nav-applications', 'refinery-nav-interview', 'refinery-nav-support', 'refinery-nav-settings']) assert.ok(legacy.has(id), id);
  // Act two follows act one: no stage beat after the first room beat.
  const first = TOUR_BEATS.findIndex(b => b.kind === 'room');
  assert.ok(TOUR_BEATS.slice(first).every(b => b.kind === 'room'));
});

/* Camera geometry */
test('camera frames a spot inside the space above the caption, zoom capped', () => {
  const stage = { w: 1440, h: 780 };
  const reserve = 230;
  for (const b of TOUR_BEATS) {
    if (b.kind !== 'stage') continue;
    const spot = spotBox(b.scene, b.spot, { rows: 14, gapStart: 11 });
    const cam = frameCamera(stage, SCENE_SIZE[b.scene], spot, b.scene === 'title' ? 0 : reserve);
    const base = Math.min(stage.w / SCENE_SIZE[b.scene].w, stage.h / SCENE_SIZE[b.scene].h);
    assert.ok(cam.s / base <= ZOOM_MAX + 1e-9 && cam.s / base >= ZOOM_MIN - 1e-9, `${b.id} zoom ${cam.s / base}`);
    if (!spot) continue;
    const on = onStage(spot, cam);
    assert.ok(on.x >= -1 && on.x + on.w <= stage.w + 1, `${b.id} spot off stage horizontally`);
    assert.ok(on.y >= -1 && on.y + on.h <= stage.h - reserve + 1, `${b.id} spot under the caption`);
  }
});

test('camera on a phone keeps the spot on the stage, and the chart stays readable', () => {
  const stage = { w: 390, h: 430 };
  const shots = TOUR_BEATS.flatMap(b => b.kind !== 'stage' ? [] : b.chart === 'rows' ? [[b, b.spot], [b, 'chart-rest']] as const : [[b, b.spot]] as const);
  for (const [b, name] of shots) {
    const size = b.scene === 'chart' ? chartSceneSize(14, true) : SCENE_SIZE[b.scene];
    const spot = spotBox(b.scene, name, { rows: 14, gapStart: 11, narrow: true });
    if (!spot) continue;
    const cam = frameCamera(stage, size, spot, 0);
    const on = onStage(spot, cam);
    assert.ok(on.x >= -1 && on.x + on.w <= stage.w + 1 && on.y >= -1 && on.y + on.h <= stage.h + 1, `${b.id} ${name}`);
    // Chart titles are 22px in the scene: on a phone they must land at 9px or more.
    if (b.scene === 'chart') assert.ok(22 * cam.s >= 9, `${b.id} ${name} text at ${(22 * cam.s).toFixed(1)}px`);
  }
});

test('camera with no spot fits the whole scene; a small spot zooms in to the cap', () => {
  const cam = frameCamera({ w: 1280, h: 800 }, { w: 1280, h: 800 }, null, 0);
  assert.deepEqual(cam, { s: 1, tx: 0, ty: 0 });
  const tiny = frameCamera({ w: 1280, h: 800 }, { w: 1280, h: 800 }, { x: 600, y: 380, w: 20, h: 20 }, 0);
  assert.equal(tiny.s, ZOOM_MAX);
});

/* Spotlight geometry */
test('spotlight pads the target and stays inside the viewport', () => {
  assert.deepEqual(spotlightRect({ left: 20, top: 100, width: 200, height: 40 }, 1440, 900, 6), { x: 14, y: 94, w: 212, h: 52 });
  assert.deepEqual(spotlightRect({ left: 0, top: 0, width: 50, height: 30 }, 390, 844, 6), { x: 4, y: 4, w: 52, h: 32 });
  assert.equal(spotlightRect({ left: 500, top: 950, width: 50, height: 30 }, 390, 844, 6), null);
});

test('caption avoids the target, defaults to bottom right', () => {
  const card = { w: 360, h: 200 };
  const none = captionPlacement(null, 1440, 900, card);
  assert.deepEqual(none, { x: 1440 - 16 - 360, y: 900 - 16 - 200, w: 360, h: 200 });
  const leftNav = captionPlacement({ x: 10, y: 600, w: 260, h: 44 }, 1440, 900, card);
  assert.equal(leftNav.x, none.x);
  const bottomRight = captionPlacement({ x: 1100, y: 760, w: 300, h: 100 }, 1440, 900, card);
  assert.notDeepEqual(bottomRight, none);
  const phone = captionPlacement({ x: 10, y: 700, w: 280, h: 40 }, 390, 844, card);
  assert.equal(phone.w, 390 - 32);
  assert.ok(phone.y + phone.h < 700, 'caption moves above a low target on a phone');
});

test('particle path starts at the mark and ends at the target', () => {
  const d = particlePath({ x: 10, y: 20 }, { x: 300, y: 400 });
  assert.match(d, /^M 10 20 Q [\d.]+ [-\d.]+ 300 400$/);
});

/* Reward, pure part */
const RUN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
test('reward: a first completion is granted with the server amount', () => {
  const r = tourRewardOutcome({ prior: null, inserted: { calls: 2, created_at: '2026-10-23T20:00:00Z', expires_at: '2026-10-24T00:00:00Z', request_key: RUN }, runId: RUN });
  assert.deepEqual(r, { status: 'granted', calls: 2, grantedAt: '2026-10-23T20:00:00Z', expiresAt: '2026-10-24T00:00:00Z' });
  assert.equal(rewardCelebrates(r), true);
});
test('reward: a second completion grants nothing and says when the first one was', () => {
  const r = tourRewardOutcome({ prior: { calls: 2, created_at: new Date('2026-10-20T10:00:00Z'), expires_at: null, request_key: OTHER }, inserted: null, runId: RUN });
  assert.deepEqual(r, { status: 'already', calls: 0, grantedAt: '2026-10-20T10:00:00.000Z' });
  assert.equal(rewardCelebrates(r), false);
});
test('reward: a retry of the same run reads as the same grant, not a second one', () => {
  const r = tourRewardOutcome({ prior: { calls: 2, created_at: '2026-10-23T20:00:00Z', expires_at: '2026-10-24T00:00:00Z', request_key: RUN }, inserted: null, runId: RUN });
  assert.equal(r.status, 'granted'); assert.equal(r.calls, 2);
});
test('reward: held back by the bonus caps is honest, not a celebration', () => {
  const r = tourRewardOutcome({ prior: null, inserted: null, runId: RUN });
  assert.deepEqual(r, { status: 'capped', calls: 0 });
  assert.equal(rewardCelebrates(r), false);
});
test('reward: the client never celebrates a malformed or forged response', () => {
  for (const raw of [null, undefined, 'granted', {}, { status: 'granted', calls: 0 }, { status: 'granted', calls: 999 }, { status: 'granted', calls: 1.5 }, { status: 'free', calls: 2 }]) {
    assert.equal(rewardCelebrates(readTourReward(raw)), false, JSON.stringify(raw));
  }
  assert.equal(readTourReward({ status: 'granted', calls: 2 }).calls, 2);
});
test('reward: server grant runs under the bonus lock with the caps and the tour key', () => {
  const server = read('lib/progression-server.ts');
  const fn = server.slice(server.indexOf('export async function grantTourReward'), server.indexOf('export async function tourRewardClaimed'));
  assert.match(fn, /pg_advisory_xact_lock\(hashtextextended\(\$\{userId\}, 874\)\)/);
  assert.match(fn, /grant_key=\$\{TOUR_REWARD_KEY\}/);
  assert.match(fn, /WHERE NOT EXISTS/);
  assert.match(fn, /bonus_daily_cap/); assert.match(fn, /bonus_monthly_cap/);
  assert.match(fn, /\$\{p\.bonus_calls\}/);
  assert.equal(TOUR_REWARD_KEY, 'tour:complete');
  const route = read('app/api/onboarding/tour/route.ts');
  assert.match(route, /grantTourReward\(userId, body\.runId\)/);
});

/* Copy matches the server */
test('the lock scene repeats the server message for an early open, word for word', () => {
  const server = read('lib/progression-server.ts');
  assert.match(server, /is open\. The recommended preparation is still there when you need it\./);
  assert.match(read('components/tour/TourScenes.tsx'), /is open\. The recommended preparation is still there when you need it\./);
});

/* Services chart */
test('services chart: rows are well formed, gaps come last, every named service is in the catalog', () => {
  const rows = serviceRows();
  assert.ok(rows.length >= 8);
  const gap = gapStart(rows);
  assert.ok(gap < rows.length, 'the chart names what is not here');
  assert.ok(rows.slice(gap).every(r => r.status === 'absent'));
  const catalog = new Map(serviceCatalog().map(r => [r.service, r]));
  assert.ok(catalog.size > 50);
  for (const r of rows) for (const s of r.services ?? []) {
    assert.ok(catalog.has(s), `${r.id}: ${s} is not in the catalog`);
    assert.match(catalog.get(s)!.status, /^LIVE/);
  }
  assert.ok(![...catalog.values()].some(r => r.station === 'For programs'), 'demo-organization rows stay out of the job-seeker tour');
  const absent = rows.filter(r => r.status === 'absent').map(r => `${r.need} ${r.here}`).join(' ');
  assert.match(absent, /single score/);
  assert.match(absent, /Nothing submits an application/);
});

test('copy: no em dashes, no competitor names, no counts in the tour files', () => {
  for (const f of ['lib/tour/beats.ts', 'lib/tour/services.json', 'components/tour/TourScenes.tsx', 'components/tour/TourPlayer.tsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /—|–/, `${f} has a long dash`);
    assert.doesNotMatch(src, /Honest Jobs|Orijin|Jobscan|Teal|Rezi|Yoodli|AIApply|CaseWorthy|Apricot|Unite Us/i, f);
  }
  const beats = read('lib/tour/beats.ts');
  assert.doesNotMatch(beats, /\b\d{2,}\s+(employers|people|resources|services|states)\b/i);
  assert.doesNotMatch(beats, /\bunlock|journey|seamless|empower\b/i);
});

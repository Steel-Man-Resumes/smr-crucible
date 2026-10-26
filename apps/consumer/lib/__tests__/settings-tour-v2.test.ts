/**
 * Settings tour v2 (SETTINGS-TOUR-V2-STORYBOARD.md, "v2 teaching plan, Troy
 * 2026-10-26"): the map pace Troy asked for, the page camera, the teaching
 * order, the objectives that tick, the quiz (graded on the server, key never in
 * the browser), the chip that offers the questions alone, and the claims rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MAP_TILES, OBJECTIVES, SETTINGS_BEATS } from '../tour/settings-beats';
import {
  MAP_SCENE, beatMs, chipAt, chipDwells, chipStarts, cubicBezier, cameraEase, focusScroll, followTimes, mapTileBox,
  pageShot, portraitMapHeight, portraitMapRows, readMs, stageCamera,
} from '../tour/settings-camera';
import { applicableBeats, objectivesDone } from '../tour/settings-tour';
import { SETTINGS_QUESTIONS, SETTINGS_QUIZ_VERSION, readSettingsQuizResult } from '../tour/settings-quiz';
import { gradeSettingsQuiz } from '../tour/settings-quiz-grade';

const ROOT = join(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const beat = (id: string) => SETTINGS_BEATS.find(b => b.id === id)!;
const NON = { member: false, required: false, plainLanguage: false };
const PAGE_SOURCES = [
  'app/(dashboard)/dashboard/settings/page.tsx', 'components/CoachSettingsSection.tsx', 'components/AccessibilitySettingsSection.tsx',
  'components/AvatarSettingsSection.tsx', 'components/PackageEmailSetting.tsx', 'components/SharingControls.tsx', 'components/SharingConsentSection.tsx',
  'components/ConsentPanel.tsx', 'components/DecisionLogViewer.tsx', 'components/AiCostsSection.tsx', 'components/SupportRequestsSection.tsx',
];

test('pace: the map walks its eight tiles at 2.2 s (Troy: half the speed), 2.4 s a row on a phone; the open and the shrink are unchanged', () => {
  const m1 = beat('m1');
  assert.deepEqual(chipDwells(m1, false), Array(8).fill(2200));
  assert.deepEqual(chipDwells(m1, true), Array(8).fill(2400));
  assert.equal(beatMs(m1, false), 1100 + 8 * 2200);
  assert.equal(beatMs(m1, true), 1100 + 8 * 2400);
  assert.match(read('components/tour/SettingsTourPlayer.tsx'), /transform \$\{tile <= 0 \? 1100 : TILE_PAN_MS\}ms/, 'the wide open and the pan move are the slice\'s');
  assert.match(read('lib/tour/timing.ts'), /ACT_CHANGE_MS = 900/);
  // The rest of the pace Troy called great: C1 9.2 s, X1 11.3 s with 1.7 s chips and the 2.2 s pause after Spanish.
  assert.equal(beatMs(beat('c1'), false), 9200);
  assert.equal(beatMs(beat('x1'), false), 11300);
  const d = chipDwells(beat('x1'), false);
  assert.equal(d[2], 2200);
  assert.ok(Math.abs(d.reduce((a, b) => a + b, 0) - 6 * 1700) < 1e-6);
  const s = chipStarts(beat('x1'), false);
  assert.equal(s[0], 0);
  assert.equal(s[1], 1100 + 1600);
  assert.equal(chipAt(beat('x1'), false, 99999), 5);
});

test('teaching: one idea per slow beat with a why line, familiar first, every page beat inside the reading cap', () => {
  for (const b of SETTINGS_BEATS.filter(x => x.where === 'page')) {
    assert.ok(b.kind === 'sweep' || b.why, `${b.id}: a slow beat says why it matters`);
    assert.ok(readMs(b) <= 11000, b.id);
    if (b.kind === 'sweep') assert.ok((b.chips?.length ?? 0) >= 3, `${b.id}: a sweep shows several things`);
  }
  const order = applicableBeats(NON).map(b => b.id);
  const at = (id: string) => order.indexOf(id);
  assert.ok(at('c1') < at('x1') && at('x1') < at('p1n') && at('p1n') < at('s1') && at('s1') < at('u1') && at('u1') < at('k1') && at('k1') < at('m2') && at('m2') < at('d1'), order.join(' '));
  // The creativity slider is back, and the tour opens Advanced settings to show it.
  assert.equal(beat('k1').reveal, 'coach-advanced');
  assert.deepEqual(beat('k1').targets, ['settings-creativity']);
  const coach = read('components/CoachSettingsSection.tsx');
  assert.match(coach, /\{showAdvanced && \(\s*<div className="mt-3" id="settings-creativity">/);
  assert.match(coach, /window\.addEventListener\(SETTINGS_TOUR_REVEAL_EVENT, onReveal\)/);
  assert.match(coach, /if \(d\.open\) \{ setShowAdvanced\(v => \{ if \(beforeTour\.current === null\) beforeTour\.current = v; return true; \}\); \}/);
  assert.match(coach, /else if \(beforeTour\.current !== null\) \{ const was = beforeTour\.current; beforeTour\.current = null; setShowAdvanced\(was\); \}/, 'put back the way it was');
  assert.doesNotMatch(coach.slice(coach.indexOf('onReveal'), coach.indexOf('onReveal') + 600), /update\(|setS\(|fetch\(/, 'the reveal never changes a value');
  const player = read('components/tour/SettingsTourPlayer.tsx');
  assert.match(player, /useEffect\(\(\) => \(\) => \{ resetPageCamera\(\); reveal\(false\); \}, \[\]\);/, 'every way out closes it again');
  // C1's ring follows the words: style, then length and focus, then save, after the title is read.
  const c1 = beat('c1');
  const words = `${c1.body} ${c1.why}`.split(/\s+/);
  assert.deepEqual(c1.follow!.map(w => words[w]), ['Supportive,', 'Brief', 'Press']);
  assert.deepEqual(followTimes(c1), [1100 + 5 * 300, 1100 + (5 + 4) * 300, 1100 + (5 + 13) * 300]);
});

test('objectives: five, each ticked by one beat when that beat is behind the person; the recap lists them; nothing is sent', () => {
  assert.deepEqual(OBJECTIVES.map(o => o.id), ['help', 'sharing', 'signin', 'ai', 'data']);
  const path = applicableBeats(NON);
  const idx = (id: string) => path.findIndex(b => b.id === id);
  assert.deepEqual([...objectivesDone(path, idx('x1'))], [], 'on X1 nothing yet');
  assert.deepEqual([...objectivesDone(path, idx('x1') + 1)], ['help'], 'the moment X1 is done');
  assert.deepEqual([...objectivesDone(path, idx('d1') + 1)].sort(), ['ai', 'data', 'help', 'sharing', 'signin']);
  assert.ok(path.at(-1)!.scene === 'recap' && path.at(-1)!.where === 'stage');
  for (const o of OBJECTIVES) assert.ok(beat('r1').body.includes(o.recap), o.id);
  // The strip lives on the card, the recap and the passed result; no request is made for it.
  const player = read('components/tour/SettingsTourPlayer.tsx');
  assert.match(player, /<Strip done=\{done\} \/>/);
  assert.match(player, /\{passed && <><Strip done=\{done\} confirmed \/>/, 'a passed quiz confirms all five');
  assert.doesNotMatch(player, /\bfetch\(/, 'the player sends nothing itself');
  assert.match(read('components/tour/SettingsScenes.tsx'), /done=\{shown && done\.has\(o\.id\)\}/);
});

test('quiz: five short questions, one per objective; strict shape; graded on the server; the key never reaches the browser', () => {
  assert.equal(SETTINGS_QUESTIONS.length, 5);
  assert.deepEqual(SETTINGS_QUESTIONS.map(q => q.objective), OBJECTIVES.map(o => o.id));
  for (const q of SETTINGS_QUESTIONS) {
    assert.ok(q.prompt.split(/\s+/).length <= 9, q.id);
    assert.equal(q.choices.length, 3);
    assert.ok(q.choices.every(c => c.split(/\s+/).length <= 7), q.id);
  }
  const pass = { version: SETTINGS_QUIZ_VERSION, answers: { reading: 1, doors: 0, devices: 1, memory: 1, delete: 0 } };
  const ok = gradeSettingsQuiz(pass)!;
  assert.deepEqual([ok.passed, ok.correct, ok.total], [true, 5, 5]);
  const miss = gradeSettingsQuiz({ ...pass, answers: { ...pass.answers, doors: 1, memory: 0 } })!;
  assert.deepEqual([miss.passed, miss.correct], [false, 3]);
  assert.deepEqual(miss.review.filter(r => !r.right).map(r => r.id), ['doors', 'memory']);
  for (const bad of [null, [], 'x', { ...pass, version: 2 }, { ...pass, extra: true }, { version: 1 }, { version: 1, answers: [] },
    { version: 1, answers: { ...pass.answers, reading: 3 } }, { version: 1, answers: { ...pass.answers, reading: 1.5 } }, { version: 1, answers: { ...pass.answers, more: 0 } }, { version: 1, answers: { reading: 1, doors: 0, devices: 1, memory: 1 } }]) {
    assert.equal(gradeSettingsQuiz(bad), null, JSON.stringify(bad));
  }
  // The client reads only a well-formed result for these questions.
  assert.deepEqual(readSettingsQuizResult(ok), ok);
  assert.equal(readSettingsQuizResult({ ...ok, total: 4 }), null);
  assert.equal(readSettingsQuizResult({ ...ok, passed: true, review: ok.review.map((r, n) => (n ? r : { ...r, right: false })) })!.passed, false, 'a pass with a miss is not a pass');
  // The key is server only: the public file has no answers, and only tour-write imports the grader.
  assert.doesNotMatch(read('lib/tour/settings-quiz.ts'), /answer:\s*\d|explanation:\s*['"]/);
  const importers: string[] = [];
  const walk = (dir: string) => { for (const f of readdirSync(join(ROOT, dir))) { const p = join(dir, f); if (['node_modules', '.next', '__tests__'].includes(f)) continue; if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f) && /from ['"][^'"]*settings-quiz-grade['"]/.test(read(p))) importers.push(p); } };
  for (const d of ['app', 'components', 'lib']) walk(d);
  assert.deepEqual(importers, ['lib/tour/tour-write.ts']);
  assert.doesNotMatch(read('lib/tour/registry.ts'), /settings-quiz-grade|tour-write/, 'the client imports the registry; it must not pull the key in');
  // Kind feedback: right or not quite, always with the reason; misses jump to the first one.
  const player = read('components/tour/SettingsTourPlayer.tsx');
  assert.match(player, /review\.right \? SETTINGS_ENDING\.right : SETTINGS_ENDING\.notQuite/);
  assert.match(player, /const miss = SETTINGS_QUESTIONS\.findIndex/);
});

test('controller: the answers ride on the completion write, a retry is the same run, and the chip offers the questions alone', () => {
  const ctl = read('components/tour/SettingsTour.tsx');
  assert.match(ctl, /\.\.\.\(action === 'complete' && quiz \? \{ quiz \} : \{\}\)/);
  assert.match(ctl, /const result = await persist\('complete', SETTINGS_ENDING_STOP, quiz\);/);
  assert.match(ctl, /run\.current = \{ id: data\.runId, sequence: data\.sequence \?\? 0, account: data\.accountId \};\n    completed\.current = true;/, 'the questions alone reuse the finished run, no start write');
  assert.match(ctl, /const quizWaiting = !!slot && !slot\.impersonating && slot\.version === DEF\.version && slot\.inProgress === false && !!slot\.completedAt && !!slot\.runId && slot\.rewardClaimedAt === null;/);
  assert.match(ctl, /data-tour-chip="quiz"/);
  assert.match(ctl, /document\.documentElement\.dataset\.settingsTour = 'true';/);
  assert.match(ctl, /return \(\) => \{ delete document\.documentElement\.dataset\.settingsTour; \};\n  \}, \[active, allowed\]\);/);
  // The safeguards stay: run UUID, rising sequence, start before progress, the account header, keepalive, the another-tab stop.
  assert.match(ctl, /crypto\.randomUUID\(\)/);
  assert.match(ctl, /\+\+current\.sequence/);
  assert.match(ctl, /if \(pendingStart\.current\?\.runId === body\.runId && body\.action !== 'start'\)/);
  assert.match(ctl, /'X-Orientation-Account': current\.account/);
  assert.match(ctl, /keepalive: true/);
  assert.match(ctl, /if \(next === 'stop'\) stopForConflict\(\);/);
  // The route: GET says whether the bonus exists (for the chip); POST is unchanged (impersonation 403, account header 409, 1 KB body).
  const route = read('app/api/onboarding/tour/route.ts');
  assert.match(route, /tourRewardClaimed\(userId, def\.rewardKey\)/);
  assert.match(route, /if \(raw\.length > 1024\)/);
  assert.ok(JSON.stringify({ tourId: 'settings', version: 2, runId: '99999999-9999-4999-8999-999999999999', sequence: 999999, stop: 12, action: 'complete', quiz: { version: 1, answers: { reading: 1, doors: 0, devices: 1, memory: 1, delete: 0 } } }).length < 1024);
  assert.match(read('lib/progression-server.ts'), /export async function tourRewardClaimed\(userId:string,key:string=TOUR_REWARD_KEY\)/, 'the entrance read is unchanged by default');
});

test('page camera: zoom capped at 1.3, never under the card or off screen, never on a phone or with motion off; every exit takes it off', () => {
  assert.equal(cameraEase(0), 0);
  assert.equal(cameraEase(1), 1);
  let last = 0;
  for (let n = 1; n <= 100; n++) { const v = cameraEase(n / 100); assert.ok(v >= last - 1e-9); last = v; }
  assert.ok(Math.abs(cubicBezier(0, 0, 1, 1)(0.3) - 0.3) < 1e-3);
  const view = { w: 1440, h: 900 };
  const card = { x: 1064, y: 520, w: 360, h: 364 };
  const frame = { x: 280, y: 100 };
  const coach = { x: 304, y: 2400, w: 672, h: 300 };
  const shot = pageShot({ target: coach, frame, view, card, maxScale: 1.3, maxScroll: 9000 });
  assert.equal(shot.scale, 1.3);
  assert.equal(shot.scrollTop, 2400 - 84);
  assert.deepEqual(shot.origin, { x: 24, y: 2300 });
  const overlap = (a: typeof card, b: typeof card) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  assert.ok(!overlap(shot.box, card));
  const tall = pageShot({ target: { ...coach, x: 700, w: 640, h: 520 }, frame, view, card, maxScale: 1.3, maxScroll: 9000 });
  assert.ok(tall.scale === 1 || !overlap(tall.box, card));
  assert.equal(pageShot({ target: coach, frame, view: { w: 390, h: 844 }, card: { x: 16, y: 450, w: 358, h: 380 }, maxScale: 1, maxScroll: 9000 }).scale, 1);
  assert.ok(SETTINGS_BEATS.every(b => (b.zoom ?? 1) <= 1.3));
  assert.equal(focusScroll(3000, view, 884, 9000), Math.round(3000 - (84 + 800 * 0.3)));
  const player = read('components/tour/SettingsTourPlayer.tsx');
  assert.match(player, /maxScale: portrait \|\| reduced \? 1 : beat\.zoom \?\? 1/);
  assert.match(player, /export function resetPageCamera\(\) \{\n  const el = pageFrame\(\);\n  if \(el\) \{ el\.style\.transform = ''; el\.style\.transformOrigin = ''; \}/);
  assert.match(player, /if \(ending\) \{ resetPageCamera\(\);/);
  // Phone flaws fixed: a cutout squeezed under the bottom card is hidden until it rises; chip labels go on the card, never over the page.
  assert.match(player, /if \(box\.y > cardTop - 56\) return null;/);
  assert.match(player, /if \(!portrait\) beat\.chips!\.forEach/);
  assert.match(player, /\{portrait && sweep && <p className="st-cardchips"/);
});

test('scoping: every new style is .st-* or html[data-settings-tour]; the map stops sticking and the bar is solid only while this tour holds the page', () => {
  const css = read('components/tour/settings-tour.css');
  assert.match(css, /html\[data-settings-tour\] #refinery-tool-settings-map\{position:static\}/);
  assert.match(css, /html\[data-settings-tour\] \.refinery-app > nav\{background-color:var\(--t-panel\)\}/);
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(r => r.trim()).filter(r => r && !r.startsWith('@'))) {
    const selector = rule.split('{')[0].trim();
    if (/^(from|to|\d+%)/.test(selector)) continue;
    for (const sel of selector.split(',')) assert.match(sel.trim(), /^(\.st-|html\[data-settings-tour\]|html\.reduce-motion \.st-|\.st-root)/, `unscoped rule: ${sel}`);
  }
  // The entrance player and the shared engine files are not edited for this tour.
  assert.doesNotMatch(read('components/tour/TourPlayer.tsx'), /settings-tour|SettingsTour/);
  assert.doesNotMatch(read('components/tour/entrance-tour.css'), /\.st-|settings-tour/);
});

test('claims: every chip label and every control named on the map is the page\'s own text; the map leaves out the coach name and the premium list', () => {
  const sources = PAGE_SOURCES.map(read).join('\n').replace(/&amp;/g, '&');
  for (const b of SETTINGS_BEATS) for (const c of b.chips ?? []) if (b.where === 'page') assert.ok(sources.includes(c.label), `${b.id}: "${c.label}" is not on the page`);
  for (const t of MAP_TILES) { assert.ok(sources.includes(t.label), t.label); for (const c of t.controls) assert.ok(sources.includes(c), `${t.label}: "${c}"`); }
  const named = MAP_TILES.flatMap(t => t.controls).join('\n');
  assert.doesNotMatch(named, /Coach name|Your tools|premium/i);
  // The slider's two ends, as the page names them, are what the beat explains.
  assert.match(read('components/CoachSettingsSection.tsx'), /Focused advice[\s\S]*More exploratory/);
  assert.match(read('lib/ai/troy-chat.ts'), /Stick to the most common, proven path[\s\S]*offer one less obvious option or angle next to the standard advice, and say which is which/);
  // The page order of the map is the page's own.
  const page = read('app/(dashboard)/dashboard/settings/page.tsx');
  const order = [...page.slice(page.indexOf(': [\n        { id: "account"')).matchAll(/\{ id: "([a-z]+)", label: "([^"]+)" \}/g)].slice(0, 8);
  assert.deepEqual(order.map(m => m[1]), MAP_TILES.map(t => t.id));
});

test('stage: eight tiles in the page order inside the scene; the phone list fits with the longest row open; the camera never shows past an edge', () => {
  for (let k = 0; k < 8; k++) {
    const b = mapTileBox(k);
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= MAP_SCENE.w && b.y + b.h <= MAP_SCENE.h, `tile ${k}`);
  }
  for (let open = -1; open < 8; open++) { const rows = portraitMapRows(open); assert.ok(rows.at(-1)!.y + rows.at(-1)!.h <= portraitMapHeight()); }
  const close = stageCamera({ w: 1440, h: 790 }, MAP_SCENE, 1.3, { x: 1075, y: 511 }, 200);
  assert.ok(close.tx <= 0 && close.tx >= 1440 - MAP_SCENE.w * 1.3 && close.ty >= 590 - MAP_SCENE.h * 1.3);
});

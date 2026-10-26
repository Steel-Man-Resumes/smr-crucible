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
import { applicableBeats, metMinWatch, objectivesDone, settingsChipFor, settingsRewardMessage } from '../tour/settings-tour';
import { GOAL_PACE, SETTINGS_ENDING, SETTINGS_REWARD_COPY, SETTINGS_TOUR_COPY } from '../tour/settings-beats';
import { usageWords, type UsageView } from '../usage-view';
import { TOURS } from '../tour/registry';
import { handleTourWrite, type TourWriteStore } from '../tour/tour-write';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
  assert.match(read('components/tour/SettingsEnding.tsx'), /\{passed && <><Strip done=\{done\} confirmed \/>/, 'a passed quiz confirms all five');
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
  const ending = read('components/tour/SettingsEnding.tsx');
  assert.match(ending, /review\.right \? SETTINGS_ENDING\.right : SETTINGS_ENDING\.notQuite/);
  assert.match(ending, /const miss = SETTINGS_QUESTIONS\.findIndex/);
});

test('controller: the answers ride on the completion write, a retry is the same run, and the chip offers the questions alone', () => {
  const ctl = read('components/tour/SettingsTour.tsx');
  assert.match(ctl, /\.\.\.\(action === 'complete' && quiz \? \{ quiz \} : \{\}\)/);
  assert.match(ctl, /const result = await persist\('complete', SETTINGS_ENDING_STOP, quiz\);/);
  assert.match(ctl, /run\.current = \{ id: data\.runId, sequence: data\.sequence \?\? 0, account: data\.accountId \};\n    completed\.current = true;/, 'the questions alone reuse the finished run, no start write');
  assert.match(ctl, /const chip = settingsChipFor\(slot, DEF\.version\);/);
  assert.match(ctl, /\{chip === 'quiz' && !conflict[^\n]*data-tour-chip="quiz"/);
  assert.match(ctl, /\{chip === 'early' && !conflict[^\n]*data-tour-chip="early"[^\n]*SETTINGS_TOUR_COPY\.startOver/);
  assert.match(ctl, /\{chip === 'returning' && !conflict[^\n]*data-tour-chip="returning"/);
  assert.match(ctl, /bonusClaimedAt=\{slot\?\.rewardClaimedAt\}/);
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
  // The padded cutout (6 px) keeps a gap above the card: the take of 2026-10-26 found a 3 px overlap at rest.
  const near = pageShot({ target: { x: 301, y: 2400, w: 616, h: 305 }, frame, view, card: { x: 1064, y: 485, w: 360, h: 399 }, maxScale: 1.3, maxScroll: 9000 });
  assert.ok(near.box.y + near.box.h + 6 <= 485 - 6, `bottom ${near.box.y + near.box.h}`);
  assert.ok(near.scale > 1.2 && near.scale < 1.3, String(near.scale));
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

/* ---------------- Fix round 1 (SETTINGS-TOUR-V2-REVIEW.md, Troy 2026-10-26) ---------------- */

test('fix 1, Troy: the goal card is 1.75 times slower, hold and reveal times both; the reading cap does not swallow it; nothing else changes pace', async () => {
  const g0 = beat('g0');
  assert.equal(g0.pace, GOAL_PACE);
  assert.equal(GOAL_PACE, 1.75);
  assert.equal(readMs(g0), Math.round(9200 * 1.75), 'was 9.2 s, now 16.1 s');
  assert.ok(readMs(g0) > 11000, 'past the reading cap on purpose');
  for (const b of SETTINGS_BEATS) if (b.id !== 'g0') assert.equal(b.pace, undefined, `${b.id} keeps its pace`);
  (globalThis as { React?: unknown }).React = React;
  const { goalTimes } = await import('../../components/tour/SettingsScenes');
  assert.deepEqual(goalTimes(1), { rise: [80, 220, 400, 900], agenda: [2600, 3250, 3900, 4550, 5200], small: 6000 });
  const slow = goalTimes(GOAL_PACE);
  assert.deepEqual(slow.rise, [140, 385, 700, 1575]);
  assert.deepEqual(slow.agenda, [4550, 5688, 6825, 7963, 9100]);
  assert.equal(slow.small, 10500);
  assert.ok(slow.small < readMs(g0), 'everything is on screen with time left to read it');
  assert.match(read('components/tour/SettingsTourPlayer.tsx'), /<GoalScene title=\{beat\.title\} body=\{beat\.body\} t=\{t\} still=\{reduced\} pace=\{beat\.pace\}/);
});

test('B1: the daily AI caption holds for all three usage kinds and claims nothing the card does not show', () => {
  const u1 = beat('u1');
  const caption = `${u1.title} ${u1.body} ${u1.why}`;
  assert.doesNotMatch(caption, /spend from|same count|count of|shared|each tool|allowance/i, 'no claim that only one kind of card makes');
  assert.match(u1.body, /today's AI use and any daily limit/);
  const base = { used: 2, bonus: 0, bonusLeft: 0, bonusExpiresAt: null, resetsAt: new Date().toISOString(), blockedReason: null, ceilings: [] };
  const kinds: UsageView[] = [
    { ...base, kind: 'allowance', remaining: 18, base: 20, perTool: null } as UsageView,
    { ...base, kind: 'per-tool', remaining: null, base: null, perTool: 10 } as UsageView,
    { ...base, kind: 'unlimited', remaining: null, base: null, perTool: null } as UsageView,
  ];
  const lines = kinds.map(v => usageWords(v, d => d.toISOString()).headline);
  assert.match(lines[0], /left today/, 'allowance: what is left today');
  assert.match(lines[1], /a day in each tool/, 'per-tool: a daily limit per tool');
  assert.match(lines[2], /No daily AI limit/, 'unlimited: says so, which "any daily limit" covers');
  // The why line is true for all three: running out never locks saved work.
  assert.match(read('lib/usage-view.ts'), /Your saved work is still available\./);
  // No other caption, recap line or question makes a usage claim.
  const rest = SETTINGS_BEATS.filter(b => b.id !== 'u1').map(b => `${b.body} ${b.why ?? ''}`).join(' ') + OBJECTIVES.map(o => o.recap).join(' ');
  assert.doesNotMatch(rest, /AI actions?|daily (count|limit)|spend/i);
});

test('B2: someone who already holds the bonus is never promised it again: goal card, quiz intro and skip words', async () => {
  (globalThis as { React?: unknown }).React = React;
  const { GoalScene, PortraitGoal } = await import('../../components/tour/SettingsScenes');
  const { Ending } = await import('../../components/tour/SettingsEnding');
  const props = { title: 'T', body: 'B', t: 99999, still: true, pace: GOAL_PACE };
  for (const Scene of [GoalScene, PortraitGoal]) {
    const claimed = renderToStaticMarkup(React.createElement(Scene, { ...props, claimed: true }));
    assert.match(claimed, /just for practice\. You already got the Settings bonus\./);
    assert.doesNotMatch(claimed, /you can earn/);
    assert.match(renderToStaticMarkup(React.createElement(Scene, { ...props, claimed: false })), /you can earn one extra AI action, one time/);
  }
  const endingProps = { beats: [], start: 0, accountId: 'a', nudge: { id: 'plain', title: 't', body: 'b', button: 'x', targets: [] }, onBeat() {}, onLeave() {}, onFinish: async () => ({ reward: null, quiz: null }), onDone() {}, reduced: true, done: new Set(), onBack() {} } as unknown as Parameters<typeof Ending>[0];
  const intro = renderToStaticMarkup(React.createElement(Ending, { ...endingProps, bonusClaimedAt: '2026-10-25T14:00:00.000Z' }));
  assert.match(intro, /These are for practice\. You already got the Settings bonus on /);
  assert.doesNotMatch(intro, /you can earn/);
  assert.match(renderToStaticMarkup(React.createElement(Ending, { ...endingProps, bonusClaimedAt: null })), /you can earn one extra AI action for 24 hours, one time/);
  // Skip words: never "they wait for you" (a chip that may not show); with a claim, say it plainly.
  assert.deepEqual(settingsRewardMessage(null, true), [SETTINGS_REWARD_COPY.skippedClaimedTitle, SETTINGS_REWARD_COPY.skippedClaimed]);
  for (const line of [SETTINGS_REWARD_COPY.skipped, SETTINGS_REWARD_COPY.skippedClaimed]) {
    assert.doesNotMatch(line, /wait for you/);
    assert.match(line, /Show me around at the top of Settings/, 'points at the header control, which every client has');
  }
  assert.match(read('app/(dashboard)/dashboard/settings/page.tsx'), />\s*Show me around\s*</);
  assert.match(read('components/tour/SettingsEnding.tsx'), /settingsRewardMessage\(skipped \? null : reward \?\? \{ status: 'unavailable', calls: 0 \}, claimed\)/);
  assert.match(SETTINGS_ENDING.quizBodyClaimed('October 25, 2026'), /nothing more is added/);
});

test('SF4 and B3: the chip at the top of Settings, from the saved place', () => {
  const V = TOURS.settings.version;
  const done = { version: V, inProgress: false, completedAt: '2026-10-26T10:00:00.000Z', runId: 'r' };
  assert.equal(settingsChipFor(null, V), null);
  assert.equal(settingsChipFor({ impersonating: true }, V), null);
  assert.equal(settingsChipFor({ version: undefined, inProgress: false, completedAt: null, rewardClaimedAt: null }, V), 'new');
  // SF4: a v1 finisher, or anyone holding the bonus, is not "new here".
  assert.equal(settingsChipFor({ version: undefined, completedAt: null, earlierDone: true, rewardClaimedAt: null }, V), 'returning');
  assert.equal(settingsChipFor({ version: undefined, completedAt: null, rewardClaimedAt: '2026-10-25T14:00:00.000Z' }, V), 'returning');
  assert.equal(settingsChipFor({ version: V, inProgress: true, runId: 'r' }, V), 'resume');
  // B3: the questions alone only after a walk that met 45 s; otherwise Start over; nothing once claimed or unknown.
  assert.equal(settingsChipFor({ ...done, rewardClaimedAt: null, metMinWatch: true }, V), 'quiz');
  assert.equal(settingsChipFor({ ...done, rewardClaimedAt: null, metMinWatch: false }, V), 'early');
  assert.equal(settingsChipFor({ ...done, rewardClaimedAt: null }, V), null, 'unknown watch: no promise');
  assert.equal(settingsChipFor({ ...done, rewardClaimedAt: '2026-10-25T14:00:00.000Z', metMinWatch: true }, V), null);
  assert.equal(settingsChipFor({ ...done, rewardClaimedAt: undefined, metMinWatch: true }, V), null, 'claim read failed: no promise');
  assert.match(SETTINGS_TOUR_COPY.chipEarly, /Start over/);
  assert.match(SETTINGS_REWARD_COPY.early, /Start over at the top of Settings/);
  assert.doesNotMatch(SETTINGS_TOUR_COPY.chipReturning, /New here/);
  // Watch time is measured as before: completedAt minus startedAt, both from the database clock.
  const at = (s: number) => new Date(Date.UTC(2026, 9, 26, 10, 0, s)).toISOString();
  assert.equal(metMinWatch({ startedAt: at(0), completedAt: at(44) }, 45_000), false);
  assert.equal(metMinWatch({ startedAt: at(0), completedAt: at(45) }, 45_000), true);
  assert.equal(metMinWatch({ startedAt: at(0), completedAt: null }, 45_000), false);
  assert.equal(metMinWatch({ completedAt: at(50) }, 45_000), false);
  const route = read('app/api/onboarding/tour/route.ts');
  assert.match(route, /metMinWatch: current && !!slot\?\.completedAt \? metMinWatch\(slot, def\.minWatchMs\) : undefined, earlierDone: !current && !!slot\?\.completedAt/);
  assert.match(read('lib/tour/tour-sql.ts'), /COALESCE\(\(g->>'completedAt'\)::timestamptz, now\(\)\) - \(g->>'startedAt'\)::timestamptz/, 'the server watch rule is unchanged');
});

test('B3 early path: a pass on a run finished under 45 s is early and grants nothing; the chip then says Start over', async () => {
  const calls: string[] = [];
  const store: TourWriteStore = {
    async start() { return 'started'; },
    async advance() { calls.push('advance'); return 'already-complete'; },
    async watchedMs() { calls.push('watched'); return 44_000; },
    async grant() { calls.push('grant'); return { status: 'granted', calls: 1 }; },
    async invalidate() {},
  };
  const pass = { version: 1, answers: { reading: 1, doors: 0, devices: 1, memory: 1, delete: 0 } };
  const r = await handleTourWrite(store, 'u', { tourId: 'settings', version: TOURS.settings.version, runId: '99999999-9999-4999-8999-999999999999', sequence: 14, stop: 12, action: 'complete', quiz: pass });
  assert.deepEqual(r.json.reward, { status: 'early', calls: 0 });
  assert.deepEqual(calls, ['advance', 'watched'], 'no grant');
  assert.equal(settingsChipFor({ version: TOURS.settings.version, inProgress: false, completedAt: 'x', runId: 'r', rewardClaimedAt: null, metMinWatch: false }, TOURS.settings.version), 'early');
});

test('SF1, SF2, N1 to N3: the page\'s own words', () => {
  const d1 = beat('d1'), s1 = beat('s1'), x1 = beat('x1');
  assert.match(d1.body, /^Download your data saves a copy once you tick the box that says the device is your own\./);
  assert.doesNotMatch(SETTINGS_BEATS.map(b => `${b.title} ${b.body} ${b.why ?? ''}`).join(' '), /\bExport\b/);
  assert.match(read('lib/export-plan.ts'), /OWN_DEVICE_LABEL = 'This is my own phone or computer'/);
  assert.match(s1.why!, /Press Revoke next to it in Active devices\./);
  assert.match(read('app/(dashboard)/dashboard/settings/page.tsx'), /"Revoke"/);
  assert.match(read('app/(dashboard)/dashboard/settings/page.tsx'), /"Sign out others"/);
  assert.equal(SETTINGS_QUESTIONS.find(q => q.id === 'devices')!.choices[1], 'Active devices, then Revoke');
  assert.match(gradeSettingsQuiz({ version: 1, answers: { reading: 1, doors: 0, devices: 1, memory: 1, delete: 0 } })!.review.find(r => r.id === 'devices')!.explanation, /Press Revoke next to one, or Sign out others/);
  assert.match(applicableBeats({ member: true, required: true, plainLanguage: false }).find(b => b.id === 'p1m')!.why!, /^Required means your program asks for it\./);
  assert.match(s1.body, /^A password is the first lock\./, 'fits "Create a password" too');
  assert.match(x1.body, /read aloud reads them out loud/);
});

test('SF5: neither the quiz key nor the tour write path is reachable from any client file; the Forge chat never reads the slider', () => {
  const exts = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
  const resolve = (from: string, spec: string): string | null => {
    let base: string | null = null;
    if (spec.startsWith('@/')) base = spec.slice(2);
    else if (spec.startsWith('.')) base = join(from, '..', spec);
    if (base === null) return null;
    for (const e of exts) { try { if (statSync(join(ROOT, base + e)).isFile()) return base + e; } catch {} }
    return null;
  };
  const graph = (start: string): Set<string> => {
    const seen = new Set<string>(); const stack = [start];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue; seen.add(f);
      for (const m of read(f).matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) {
        if (/^import\s+type\s/.test(m[0]) || /^export\s+type\s/.test(m[0])) continue;
        const r = resolve(f, m[1]); if (r && /\.(ts|tsx)$/.test(r)) stack.push(r);
      }
      for (const m of read(f).matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) { const r = resolve(f, m[1]); if (r) stack.push(r); }
    }
    return seen;
  };
  const clients: string[] = [];
  const walk = (dir: string) => { for (const f of readdirSync(join(ROOT, dir))) { const p = join(dir, f); if (['node_modules', '.next', '__tests__'].includes(f)) continue; if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f) && /^\s*["']use client["']/.test(read(p))) clients.push(p); } };
  for (const d of ['app', 'components', 'lib']) walk(d);
  assert.ok(clients.length > 50 && clients.includes('components/tour/SettingsTourPlayer.tsx') && clients.includes('components/tour/SettingsTour.tsx'));
  const reach = new Set<string>(); for (const c of clients) for (const f of graph(c)) reach.add(f);
  assert.ok(reach.has('lib/tour/settings-quiz.ts'), 'the public half is in the client graph (the walker works)');
  for (const secret of ['lib/tour/settings-quiz-grade.ts', 'lib/tour/tour-write.ts', 'lib/tour/tour-sql.ts']) assert.ok(!reach.has(secret), `${secret} is reachable from a client file`);
  // The Forge chat (/api/assistant) and everything it imports in this app never read the creativity slider.
  const forge = graph('app/api/assistant/route.ts');
  assert.ok(forge.size > 3);
  for (const f of forge) {
    // troy-chat.ts defines coachCreativityNote (shared module); only a call or a read of the setting would apply the slider.
    const src = f === 'lib/ai/troy-chat.ts' ? read(f).replace(/export function coachCreativityNote\(creativity: number\)[\s\S]*?\n\}\n/, '') : read(f);
    assert.doesNotMatch(src, /coachCreativity|coach_creativity|creativityNote\(/, f);
  }
  assert.match(read('app/api/coach/route.ts'), /coachCreativityNote\(profile\.coachCreativity\)/);
  assert.ok(graph('app/api/coach/route.ts').has('lib/ai/troy-chat.ts'), 'the Refinery chat is where the slider applies');
});

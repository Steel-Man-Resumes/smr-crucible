/**
 * The Settings tour v2 playable slice (SETTINGS-TOUR-V2-STORYBOARD.md section 9):
 * the flag is ignored without slice=1 (the v1 tour is what plays), the slice
 * writes nothing, its timing matches the storyboard, the page camera never puts
 * a target under the card or zooms a phone, the copy follows the rules, and
 * every target and chip label is the page's own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAP_TILES, SLICE_BEATS, SLICE_COPY, beatMs, chipAt, chipDwells, chipStarts, cubicBezier, cameraEase, focusScroll, followTimes, mapTileBox,
  pageShot, portraitMapHeight, portraitMapRows, settingsSliceRequested, sliceRuntimeMs, stageCamera, MAP_SCENE,
} from '../tour/settings-slice';
import { settingsTourRequested } from '../tour/settings-tour';
import { holdMs } from '../tour/timing';

const ROOT = join(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const q = (s: string) => new URLSearchParams(s);
const PAGE_SOURCES = [
  'app/(dashboard)/dashboard/settings/page.tsx', 'components/CoachSettingsSection.tsx', 'components/AccessibilitySettingsSection.tsx',
  'components/AvatarSettingsSection.tsx', 'components/PackageEmailSetting.tsx', 'components/SharingControls.tsx', 'components/ConsentPanel.tsx',
  'components/DecisionLogViewer.tsx', 'components/AiCostsSection.tsx', 'components/SupportRequestsSection.tsx',
];

test('flag: only /dashboard/settings?tour=settings&slice=1 plays the slice; anything else is the v1 tour, untouched', () => {
  assert.equal(settingsSliceRequested('/dashboard/settings', q('tour=settings&slice=1')), true);
  for (const s of ['tour=settings', 'tour=settings&slice=0', 'tour=settings&slice=true', 'tour=settings&slice=', 'slice=1', 'tour=1&slice=1', 'tour=crm&slice=1', '']) {
    assert.equal(settingsSliceRequested('/dashboard/settings', q(s)), false, s);
  }
  assert.equal(settingsSliceRequested('/dashboard', q('tour=settings&slice=1')), false);
  assert.equal(settingsSliceRequested(null, q('tour=settings&slice=1')), false);
  assert.equal(settingsSliceRequested('/dashboard/settings', null), false);
  // v1's own rule is unchanged: ?tour=settings still asks for the v1 tour.
  assert.equal(settingsTourRequested('/dashboard/settings', q('tour=settings')), true);
  // The page mounts the gate where it mounted SettingsTour, and the gate renders SettingsTour unless the slice flag is set.
  const page = read('app/(dashboard)/dashboard/settings/page.tsx');
  assert.match(page, /\{!isOrgStaff && !impersonating && <SettingsTourGate \/>\}/);
  assert.doesNotMatch(page, /<SettingsTour \/>/, 'the page mounts the tour only through the gate');
  const slice = read('components/tour/SettingsSlice.tsx');
  assert.match(slice, /return settingsSliceRequested\(pathname, search\) \? <SettingsSlice \/> : <SettingsTour \/>;/);
  // The v1 controller and the entrance player know nothing about the slice.
  for (const f of ['components/tour/SettingsTour.tsx', 'components/tour/SettingsTourPlayer.tsx', 'components/tour/TourPlayer.tsx', 'lib/tour/settings-tour.ts', 'lib/tour/settings-beats.ts']) {
    assert.doesNotMatch(read(f), /slice/i, `${f} mentions the slice`);
  }
  // The slice reuses the shared engine, never the entrance player itself.
  assert.doesNotMatch(slice, /from '\.\/TourPlayer'/);
  // Same people as v1: clients, never staff, never under view-as or assist.
  assert.match(slice, /settingsTourAllowed\(\{ tier, orgRole: role\?\.orgRole, impersonating: role\?\.impersonating \}\)/);
  assert.match(slice, /if \(!mounted \|\| !allowed \|\| !open\) return null;/);
});

test('writes nothing: no request of any kind from the slice, no tour route, no run, no reward', () => {
  for (const f of ['components/tour/SettingsSlice.tsx', 'lib/tour/settings-slice.ts']) {
    const src = read(f);
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${f} calls fetch`);
    assert.doesNotMatch(src, /\/api\//, `${f} names an API route`);
    assert.doesNotMatch(src, /onboarding\/tour|XMLHttpRequest|sendBeacon|EventSource|WebSocket|navigator\.sendBeacon/, f);
    assert.doesNotMatch(src, /\bmethod\s*:/, `${f} builds a request`);
    assert.doesNotMatch(src, /runId|sequence|readTourReward|grantTourReward|PROGRESSION_CHANGED_EVENT|CompletionConfetti/, `${f} touches the store or the reward`);
    assert.doesNotMatch(src, /localStorage/, f);
  }
  // The only browser storage it touches is the motion switch every tour shares (this tab only).
  const slice = read('components/tour/SettingsSlice.tsx');
  for (const m of slice.matchAll(/sessionStorage\.(setItem|removeItem|getItem)\(([^,)]+)/g)) assert.match(m[2], /^MOTION_KEY \+ account(Id)?$/, m[0]);
});

test('timing: M1 9.9 / 10.7 s, C1 9.2 s, X1 11.3 / 11.9 s, about 31 s wall with the shrink; chips at the storyboard dwell', () => {
  const [m1, c1, x1] = SLICE_BEATS;
  assert.deepEqual(SLICE_BEATS.map(b => b.id), ['m1', 'c1', 'x1']);
  assert.equal(beatMs(m1, false), 9900);
  assert.equal(beatMs(m1, true), 10700);
  assert.equal(beatMs(c1, false), 9200);
  assert.equal(beatMs(c1, true), 9200);
  assert.equal(holdMs(c1), 9200, 'C1 is slow: its reading time');
  assert.equal(beatMs(x1, false), 11300);
  assert.equal(beatMs(x1, true), 11900);
  assert.ok(beatMs(x1, false) > holdMs(x1), 'a sweep holds for its chips, not just its words');
  assert.equal(sliceRuntimeMs(false), 31300);
  assert.equal(sliceRuntimeMs(true), 32700);
  // X1: the pause after Spanish is 2.2 s; the other five share the rest; the sum is n times the dwell.
  const d = chipDwells(x1, false);
  assert.equal(d.length, 6);
  assert.equal(d[2], 2200);
  assert.ok(Math.abs(d.reduce((a, b) => a + b, 0) - 6 * 1700) < 1e-6);
  assert.ok(d.filter((_, k) => k !== 2).every(ms => Math.abs(ms - 1600) < 1e-6));
  // The first chip lights at once (the camera lands on it), the next after the landing plus its dwell.
  const s = chipStarts(x1, false);
  assert.equal(s[0], 0);
  assert.equal(s[1], 1100 + 1600);
  assert.equal(s[3], 1100 + 1600 * 2 + 2200);
  assert.equal(chipAt(x1, false, 0), 0);
  assert.equal(chipAt(x1, false, s[3] - 1), 2);
  assert.equal(chipAt(x1, false, s[3]), 3);
  assert.equal(chipAt(x1, false, 99999), 5);
  // M1 walks all eight tiles at 1.1 s (1.2 s a row on a phone).
  assert.deepEqual(chipDwells(m1, false), Array(8).fill(1100));
  assert.deepEqual(chipDwells(m1, true), Array(8).fill(1200));
  // C1's reading ring follows the words: style, then length and focus, then save, each when its sentence starts.
  const words = c1.body.split(/\s+/);
  assert.deepEqual(c1.follow!.map(w => words[w]), ['Supportive,', 'Brief', 'Press']);
  const f = followTimes(c1);
  assert.deepEqual(f, [1100 + 5 * 300, 1100 + (5 + 4) * 300, 1100 + (5 + 13) * 300], "after the title is read, then each sentence");
  assert.ok(f.every((ms, k) => ms < 9200 && (k === 0 || ms > f[k - 1])), 'every part is reached inside the hold, in order');
  assert.deepEqual(followTimes(x1), []);
  // Slow and fast alternate: sweep, slow, sweep.
  assert.deepEqual(SLICE_BEATS.map(b => b.kind), ['sweep', 'slow', 'sweep']);
});

test('page camera: the eased curve is CAMERA_EASE and runs 0 to 1 without going back', () => {
  assert.equal(cameraEase(0), 0);
  assert.equal(cameraEase(1), 1);
  let last = 0;
  for (let n = 1; n <= 100; n++) { const v = cameraEase(n / 100); assert.ok(v >= last - 1e-9, `step ${n}`); last = v; }
  assert.ok(Math.abs(cameraEase(0.5) - 0.5) < 0.12);
  const linear = cubicBezier(0, 0, 1, 1);
  assert.ok(Math.abs(linear(0.3) - 0.3) < 1e-3);
  assert.match(read('lib/tour/timing.ts'), /CAMERA_EASE = 'cubic-bezier\(\.65,0,\.3,1\)'/);
});

test('page camera: zoom capped at 1.3, never under the card, never off screen, never on a phone or with motion off', () => {
  const view = { w: 1440, h: 900 };
  const card = { x: 1064, y: 664, w: 360, h: 220 };
  const frame = { x: 280, y: 100 };
  const coach = { x: 304, y: 2400, w: 672, h: 300 };
  const shot = pageShot({ target: coach, frame, view, card, maxScale: 1.3, maxScroll: 9000 });
  assert.equal(shot.scale, 1.3);
  assert.equal(shot.scrollTop, 2400 - 84, 'block start under the 72 px top bar, 12 px gap');
  assert.deepEqual(shot.origin, { x: 24, y: 2300 }, "the target's top-left in the frame's own pixels, so it stays put while it grows");
  const overlap = (a: typeof card, b: typeof card) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  assert.ok(!overlap(shot.box, card));
  assert.ok(shot.box.x + shot.box.w <= view.w - 16 && shot.box.y + shot.box.h <= view.h - 16);
  // A tall target that would run under the card zooms less, or not at all.
  const tall = pageShot({ target: { ...coach, x: 700, w: 640, h: 520 }, frame, view, card, maxScale: 1.3, maxScroll: 9000 });
  assert.ok(tall.scale < 1.3);
  assert.ok(tall.scale === 1 || !overlap(tall.box, card));
  // Phones and motion-off pass 1 and get a plain scroll.
  const phone = pageShot({ target: { x: 16, y: 2400, w: 358, h: 420 }, frame: { x: 0, y: 100 }, view: { w: 390, h: 844 }, card: { x: 16, y: 540, w: 358, h: 290 }, maxScale: 1, maxScroll: 9000 });
  assert.equal(phone.scale, 1);
  // Never above the top, never past the end.
  assert.equal(pageShot({ target: { ...coach, y: 40 }, frame, view, card, maxScale: 1.3, maxScroll: 9000 }).scrollTop, 0);
  assert.equal(pageShot({ target: coach, frame, view, card, maxScale: 1.3, maxScroll: 1000 }).scrollTop, 1000);
  // The player passes 1 on phones and with motion off, and the zoom only from the beat.
  const slice = read('components/tour/SettingsSlice.tsx');
  assert.match(slice, /maxScale: portrait \|\| reduced \? 1 : beat\.zoom \?\? 1/);
  assert.equal(SLICE_BEATS.find(b => b.id === 'c1')!.zoom, 1.3);
  assert.ok(SLICE_BEATS.every(b => (b.zoom ?? 1) <= 1.3));
  // A sweep chip sits on a focus line a third of the way down the clear band.
  assert.equal(focusScroll(3000, view, 884, 9000), Math.round(3000 - (84 + 800 * 0.3)));
  assert.equal(focusScroll(100, view, 884, 9000), 0);
});

test('page camera: every way out takes the transform off the page', () => {
  const slice = read('components/tour/SettingsSlice.tsx');
  assert.match(slice, /export function resetPageCamera\(\) \{\n  const el = pageFrame\(\);\n  if \(el\) \{ el\.style\.transform = ''; el\.style\.transformOrigin = ''; \}/);
  assert.match(slice, /const close = useCallback\(\(\) => \{\n    resetPageCamera\(\);/, 'Leave and Escape');
  assert.match(slice, /return \(\) => \{\n      resetPageCamera\(\); unlock\(\); delete html\.dataset\.settingsSlice;/, 'route change and unmount release the lock and the transform');
  assert.match(slice, /useEffect\(\(\) => \{ setMounted\(true\); return \(\) => resetPageCamera\(\); \}, \[\]\);/);
  assert.match(slice, /if \(ending\) \{ resetPageCamera\(\);/, 'the ending');
  assert.match(slice, /const FRAME_ID = 'refinery-page-settings';/);
  assert.match(read('components/tour/TourPageFrame.tsx'), /id=\{page \? `refinery-page-\$\{page\[0\]\}` : undefined\}/);
});

test('controls: Escape leaves, Pause and Space pause, focus is trapped, the page is locked, motion-off never auto-plays', () => {
  const slice = read('components/tour/SettingsSlice.tsx');
  assert.match(slice, /if \(event\.key === 'Escape'\) \{ event\.preventDefault\(\); close\(\); return; \}/);
  assert.match(slice, /const unlock = lockPageForTour\(html, document\.body, document\.querySelector<HTMLElement>\('\.refinery-app'\)\);/);
  assert.match(slice, /if \(event\.key !== 'Tab'\) return;/);
  assert.match(slice, /const \[playing, setPlaying\] = useState\(\(\) => !\(osReduced\(\) \|\| readQuiet\(accountId\)\)\);/);
  assert.match(slice, /if \(\(e\.key === ' ' && !native\) \|\| e\.key === 'k'\) \{ e\.preventDefault\(\); toggle\(\); \}/);
  assert.match(slice, /const running = playing && !hidden && !ending && !shrink;/);
  assert.match(slice, /aria-label=\{playing \? TOUR_COPY\.pause : TOUR_COPY\.play\}/);
  // Motion off: the camera cuts and the particles stay off.
  assert.match(slice, /const instant = reduced;/);
  assert.match(slice, /\{particles && !reduced && <svg/);
  // The section map stops sticking only while the slice holds the page (v1's flag is not used for it).
  const css = read('components/tour/settings-slice.css');
  assert.match(css, /html\[data-settings-slice\] #refinery-tool-settings-map\{position:static\}/);
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(r => r.trim()).filter(r => r && !r.startsWith('@media'))) {
    const selector = rule.split('{')[0].trim();
    for (const sel of selector.split(',')) assert.match(sel.trim(), /^(\.ss-|html\[data-settings-slice\]|html\.reduce-motion \.ss-|\.ss-root)/, `unscoped rule: ${sel}`);
  }
});

test('targets: every id the slice lights is on the Settings page, and the coach choices are one cutout of three parts', () => {
  const sources = PAGE_SOURCES.map(read).join('\n');
  const ids = new Set<string>();
  for (const m of sources.matchAll(/\b(?:id|data-tour)=(?:"([^"]+)"|\{[^}]*?"([^"]+)"[^}]*\})/g)) ids.add(m[1] ?? m[2]);
  for (const m of sources.matchAll(/\bid="(settings-[a-z-]+)"/g)) ids.add(m[1]);
  for (const b of SLICE_BEATS) {
    if (b.where !== 'page') continue;
    for (const t of b.targets ?? []) assert.ok(ids.has(t), `${b.id}: ${t}`);
    for (const c of b.chips ?? []) for (const t of c.targets) assert.ok(ids.has(t), `${b.id} ${c.label}: ${t}`);
  }
  const coach = read('components/CoachSettingsSection.tsx');
  assert.equal((coach.match(/data-tour="settings-coach-choices"/g) ?? []).length, 3, 'style, length and focus, save');
  assert.ok(coach.indexOf('Coach name') < coach.indexOf('data-tour="settings-coach-choices"'), 'the coach name stays out of the cutout');
  const a11y = read('components/AccessibilitySettingsSection.tsx');
  for (const id of ['settings-plain-language', 'settings-read-aloud', 'settings-spanish', 'settings-text-size', 'settings-motion', 'settings-spacing']) assert.match(a11y, new RegExp(`id="${id}"`));
  assert.match(a11y, /<div id=\{id\} className="flex items-center justify-between gap-4">/, 'ToggleRow takes an id');
  // The old v1 ids are still there for v1.
  for (const id of ['settings-coach-style', 'settings-reading-help', 'settings-display']) assert.ok(ids.has(id), id);
  // The map's sections are the page's own section ids, in the page's order.
  const page = read('app/(dashboard)/dashboard/settings/page.tsx');
  const order = [...page.slice(page.indexOf(': [\n        { id: "account"')).matchAll(/\{ id: "([a-z]+)", label: "([^"]+)" \}/g)].slice(0, 8);
  assert.deepEqual(order.map(m => m[1]), MAP_TILES.map(t => t.id));
  assert.deepEqual(order.map(m => m[2]), MAP_TILES.map(t => t.label));
});

test('claims: every chip label and every control named on the map is the page\'s own text', () => {
  const sources = PAGE_SOURCES.map(read).join('\n').replace(/&amp;/g, '&');
  for (const b of SLICE_BEATS) for (const c of b.chips ?? []) assert.ok(sources.includes(c.label), `${b.id}: "${c.label}" is not on the page`);
  for (const t of MAP_TILES) for (const c of t.controls) assert.ok(sources.includes(c), `${t.label}: "${c}" is not on the page`);
  // The map leaves out what the storyboard leaves out: the coach name, the creativity slider, the premium list.
  const named = MAP_TILES.flatMap(t => t.controls).join('\n');
  assert.doesNotMatch(named, /Coach name|creativ|Advanced|Your tools|premium/i);
});

test('copy: no long dashes or "--", no emoji, t.ROY exact, nothing the storyboard says never to claim', () => {
  for (const f of ['lib/tour/settings-slice.ts', 'components/tour/SettingsSlice.tsx', 'components/tour/settings-slice.css']) {
    const src = read(f);
    assert.doesNotMatch(src, /—|–/, `${f} has a long dash`);
    assert.doesNotMatch(src, /\s--\s/, `${f} has a -- stand-in`);
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, `${f} has an emoji`);
    for (const m of src.matchAll(/t\.roy/gi)) assert.equal(m[0], 't.ROY', `${f}: ${m[0]}`);
  }
  const lines: string[] = [];
  for (const b of SLICE_BEATS) { lines.push(b.title, b.body); for (const c of b.chips ?? []) lines.push(c.label); }
  for (const v of Object.values(SLICE_COPY)) if (typeof v === 'string') lines.push(v);
  lines.push(SLICE_COPY.stopOf(1, 3));
  lines.push(SLICE_COPY.chipsSr(['Plain language', 'Read aloud']));
  const all = lines.join('\n');
  // The storyboard's words, exactly.
  assert.equal(SLICE_BEATS[0].title, 'The whole page');
  assert.equal(SLICE_BEATS[0].body, "Eight parts, top to bottom. We'll walk them in order.");
  assert.equal(SLICE_BEATS[1].title, 'How t.ROY talks to you');
  assert.equal(SLICE_BEATS[1].body, "Supportive, balanced or direct. Brief or full answers. Guide me, or just answer. Press save when you're done, or it won't stick.");
  assert.equal(SLICE_BEATS[2].title, 'Two kinds of help');
  assert.equal(SLICE_BEATS[2].body, "Plain language, read aloud and Spanish change only t.ROY's answers. Text size, motion and spacing change the whole app, right away.");
  assert.doesNotMatch(all, /\b(felon|offender|ex-con|convict|justice-impacted|second[- ]chance)\b/i);
  assert.doesNotMatch(all, /you are a|you're a/i);
  assert.doesNotMatch(all, /HIPAA|SOC ?2|FedRAMP|\bsecure\b|guaranteed|encrypted|nobody else|no one else can/i);
  assert.doesNotMatch(all, /creativity|rename|slider|translat|unlock|premium|bonus|reward|earn/i);
  assert.doesNotMatch(all, /we (saved|changed|turned)/i, 'the slice never claims it changed a setting');
  assert.match(SLICE_COPY.endBody, /Nothing was saved, and no setting changed\./);
  assert.doesNotMatch(all, /screenshot/i);
});

test('stage map: eight tiles in the page order, two rows, inside the scene; the phone list fits its scene with the longest row open', () => {
  assert.equal(MAP_TILES.length, 8);
  for (let k = 0; k < 8; k++) {
    const b = mapTileBox(k);
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= MAP_SCENE.w && b.y + b.h <= MAP_SCENE.h, `tile ${k}`);
    if (k % 4) assert.ok(b.x > mapTileBox(k - 1).x, 'row order left to right');
  }
  assert.ok(mapTileBox(4).y > mapTileBox(3).y, 'row two under row one');
  const cam = stageCamera({ w: 1440, h: 790 }, MAP_SCENE, 0.8, null, 200);
  assert.ok(cam.tx >= 0 && cam.ty >= 0, 'the wide shot is centred');
  const close = stageCamera({ w: 1440, h: 790 }, MAP_SCENE, 1.3, { x: 1075, y: 511 }, 200);
  assert.ok(close.tx <= 0 && close.tx >= 1440 - MAP_SCENE.w * 1.3 && close.ty >= 590 - MAP_SCENE.h * 1.3, 'a close shot never shows past the scene edge');
  for (let open = -1; open < 8; open++) {
    const rows = portraitMapRows(open);
    assert.ok(rows.at(-1)!.y + rows.at(-1)!.h <= portraitMapHeight(), `open ${open}`);
  }
});

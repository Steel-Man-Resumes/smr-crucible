/**
 * The Settings tour (SETTINGS-TOUR.md): registry, runtime, targets on the real
 * page, copy rules, resume by absolute beat, the nudge picked once, the reward
 * (1 call under tour:settings, never for the entrance key), and no writes under
 * impersonation. The SQL runs for real in tour-store-map-pglite.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SETTINGS_BEATS, SETTINGS_ENDING, SETTINGS_NUDGES, SETTINGS_REWARD_COPY, SETTINGS_STOP_COUNT, SETTINGS_TOUR_COPY } from '../tour/settings-beats';
import { PORTRAIT_CUT_MIN, SPOTLIGHT_PAD, SETTINGS_ENDING_STOP, applicableBeats, clipHeight, pickNudge, portraitCutHeight, readBranches, resumeIndex, scrollTopFor, settingsRewardMessage, settingsRuntimeMs, settingsTourAllowed, settingsTourRequested, stopOfBeat } from '../tour/settings-tour';
import { TOURS } from '../tour/registry';
import { handleTourWrite, type TourWriteStore } from '../tour/tour-write';
import { grantTourRewardWith } from '../tour/tour-sql';
import { holdMs, wordCount } from '../tour/timing';
import { settingsVerdict } from '../settings-guard';

const ROOT = join(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const NON = { member: false, required: false, plainLanguage: false };
const MEM = { member: true, required: false, plainLanguage: false };
const REQ = { member: true, required: true, plainLanguage: true };

test('registry: the settings tour is pinned to its beats, grants 1 call under its own key after 45 s, and never marks onboarding', () => {
  const s = TOURS.settings;
  assert.equal(SETTINGS_BEATS.length, 13, 'S7c merged into S7a (fix round 1, SF-3)');
  assert.equal(s.stopCount, SETTINGS_STOP_COUNT);
  assert.equal(s.stopCount, SETTINGS_BEATS.length + 1, 'absolute beat indexes plus the ending');
  assert.equal(s.grants, true);
  assert.equal(s.rewardCalls, 1);
  assert.equal(s.rewardKey, 'tour:settings');
  assert.equal(s.rewardLabel, 'Settings tour finished: extra AI action');
  assert.equal(s.minWatchMs, 45_000);
  assert.equal(s.completesOnboarding, false);
  // The entrance tour is untouched: its key, label and policy amount.
  assert.equal(TOURS.entrance.rewardKey, 'tour:complete');
  assert.equal(TOURS.entrance.rewardLabel, 'Tour finished: extra AI actions');
  assert.equal(TOURS.entrance.rewardCalls, undefined);
  assert.equal(TOURS.entrance.grants, true);
});

test('runtime: 11, 11 and 12 stops; the longest path under 116 s by holdMs (the browser adds about 0.3 s a stop); bodies 12 to 30 words', () => {
  const paths: [typeof NON, number, number][] = [[NON, 11, 101.5], [MEM, 11, 103.0], [REQ, 12, 112.2]];
  for (const [branches, stops, expected] of paths) {
    const path = applicableBeats(branches);
    assert.equal(path.length, stops);
    const s = settingsRuntimeMs(path) / 1000;
    assert.ok(Math.abs(s - expected) <= 2, `${stops} stops: ${s.toFixed(1)} s vs ${expected}`);
    assert.ok(s >= 100 && s < 116, `${s} s`);
  }
  for (const b of SETTINGS_BEATS) {
    const words = wordCount(b.body);
    assert.ok(words >= 12 && words <= 30, `${b.id}: ${words} words`);
    assert.ok(holdMs(b) >= 3200 && holdMs(b) <= 11000);
  }
  // The non-member path never shows a program stop; members never see the no-program stop; the required stop needs both.
  assert.deepEqual(applicableBeats(NON).map(b => b.id).filter(id => id.startsWith('s7')), ['s7n']);
  assert.deepEqual(applicableBeats(MEM).map(b => b.id).filter(id => id.startsWith('s7')), ['s7a']);
  assert.deepEqual(applicableBeats(REQ).map(b => b.id).filter(id => id.startsWith('s7')), ['s7a', 's7b']);
  assert.ok(!SETTINGS_BEATS.some(b => b.id === 's7c'), 'the log is one sentence inside S7a now');
  assert.match(SETTINGS_BEATS.find(b => b.id === 's7a')!.body, /shows a name and time/);
  assert.deepEqual(applicableBeats({ member: false, required: true, plainLanguage: false }).map(b => b.id).filter(id => id.startsWith('s7')), ['s7n'], 'a requirement without membership is not a branch');
});

test('targets: every id the beats and nudges point at exists on the Settings page or its components', () => {
  const sources = [
    'app/(dashboard)/dashboard/settings/page.tsx', 'components/CoachSettingsSection.tsx', 'components/AccessibilitySettingsSection.tsx',
    'components/SharingConsentSection.tsx', 'components/SharingControls.tsx', 'components/tour/SettingsLesson.tsx',
  ].map(read).join('\n');
  const ids = new Set<string>();
  for (const m of sources.matchAll(/\bid=(?:"([^"]+)"|\{[^}]*?"([^"]+)"[^}]*\})/g)) ids.add(m[1] ?? m[2]);
  const wanted = new Set<string>();
  for (const b of SETTINGS_BEATS) for (const t of b.targets) wanted.add(t);
  for (const n of Object.values(SETTINGS_NUDGES)) for (const t of n.targets) wanted.add(t);
  for (const id of wanted) assert.ok(ids.has(id), `${id} is not an element id on the Settings page`);
  // The T4 ids this lane added, by name.
  for (const id of ['settings-coach-style', 'settings-reading-help', 'settings-display', 'settings-who-can-see', 'settings-required-scope', 'settings-sharing-log', 'settings-devices']) assert.ok(ids.has(id), id);
  // Every beat has one target that is a sub-id (T4) or the one the spec names, and the first wins in the player.
  assert.ok(read('components/tour/SettingsTourPlayer.tsx').includes('findNavElement(beat.targets)'));
});

test('copy: no long dashes or "--", no emoji, t.ROY exact, never a label on the reader, nothing the spec says never to claim', () => {
  const files = ['lib/tour/settings-beats.ts', 'lib/tour/settings-tour.ts', 'components/tour/SettingsTour.tsx', 'components/tour/SettingsTourPlayer.tsx'];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /—|–/, `${f} has a long dash`);
    assert.doesNotMatch(src, /\s--\s/, `${f} has a -- stand-in`);
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, `${f} has an emoji`);
    for (const m of src.matchAll(/t\.roy/gi)) assert.equal(m[0], 't.ROY', `${f}: ${m[0]}`);
  }
  const lines: string[] = [];
  for (const b of SETTINGS_BEATS) lines.push(b.title, b.body);
  for (const n of Object.values(SETTINGS_NUDGES)) lines.push(n.title, n.body, n.button);
  for (const v of Object.values(SETTINGS_ENDING)) lines.push(v);
  for (const v of Object.values(SETTINGS_TOUR_COPY)) lines.push(typeof v === 'function' ? v(1, 2) : v);
  for (const v of Object.values(SETTINGS_REWARD_COPY)) lines.push(typeof v === 'function' ? v(1 as never) : v);
  const all = lines.join('\n');
  // Labels on the reader.
  assert.doesNotMatch(all, /\b(felon|offender|ex-con|convict|justice-impacted|second[- ]chance)\b/i);
  assert.doesNotMatch(all, /you are a|you're a/i);
  // Compliance words and promises the page cannot keep.
  assert.doesNotMatch(all, /HIPAA|SOC ?2|FedRAMP|\bsecure\b|guaranteed|nobody else|no one else can/i);
  assert.doesNotMatch(all, /creativity|rename|slider/i, 'the creativity slider and the coach name stay out');
  assert.doesNotMatch(all, /document files|includes your documents|undo|midnight|unlock/i);
  assert.doesNotMatch(all, /\btakes back\b/i, 'shutting a door never takes anything back');
  assert.match(all, /can't take back/, 'and the tour says so');
  assert.doesNotMatch(all, /free choice|no effect/i);
  assert.doesNotMatch(all, /\b\d{2,}\s+(people|employers|resources|clients)\b/i, 'no counts of people helped');
  assert.doesNotMatch(all, /probation|parole|supervision|your record|conviction/i, 'nothing about the person\'s record or status in a caption');
  // The nudge never names the program: no interpolation, no org name.
  for (const n of Object.values(SETTINGS_NUDGES)) assert.doesNotMatch(`${n.title} ${n.body} ${n.button}`, /\$\{|orgName/);
  // The tour never claims to have saved or changed a setting.
  assert.doesNotMatch(all, /we (saved|changed|turned)/i);
  assert.match(SETTINGS_BEATS[0].body, /nothing changes unless you change it/);
});

test('resume: the saved stop is the absolute beat index, so the same beat comes back whatever the path is now', () => {
  const non = applicableBeats(NON), mem = applicableBeats(MEM), req = applicableBeats(REQ);
  const s6 = stopOfBeat(SETTINGS_BEATS.find(b => b.id === 's6')!);
  assert.equal(s6, 5);
  // Leave at S6 as a non-member, join a program, come back: still S6.
  assert.equal(non[resumeIndex(s6, non)].id, 's6');
  assert.equal(mem[resumeIndex(s6, mem)].id, 's6');
  assert.equal(req[resumeIndex(s6, req)].id, 's6');
  // Saved on a program stop, now a non-member: the next stop that applies, never a wrong beat under the same number.
  const s7a = stopOfBeat(SETTINGS_BEATS.find(b => b.id === 's7a')!);
  assert.equal(non[resumeIndex(s7a, non)].id, 's7n');
  assert.equal(mem[resumeIndex(s7a, mem)].id, 's7a');
  const s7b = stopOfBeat(SETTINGS_BEATS.find(b => b.id === 's7b')!);
  assert.equal(mem[resumeIndex(s7b, mem)].id, 's8', 'the requirement went away: the next stop that applies');
  // Past the branch the path position and the absolute index differ: S8 is beat 9 but path stop 7 or 8.
  const s8 = stopOfBeat(SETTINGS_BEATS.find(b => b.id === 's8')!);
  assert.equal(s8, 9);
  assert.equal(non[resumeIndex(s8, non)].id, 's8');
  assert.equal(mem[resumeIndex(s8, mem)].id, 's8');
  assert.equal(req[resumeIndex(s8, req)].id, 's8');
  assert.equal(resumeIndex(s8, non), 7);
  assert.equal(resumeIndex(s8, req), 8);
  // The ending, odd values and the first stop.
  assert.equal(resumeIndex(SETTINGS_ENDING_STOP, non), non.length);
  assert.equal(resumeIndex(99, non), non.length);
  assert.equal(resumeIndex(undefined, non), 0);
  assert.equal(resumeIndex(-3, non), 0);
  assert.equal(SETTINGS_ENDING_STOP, 13);
  // A shortened-path index is never what gets saved: the controller maps through stopOfBeat.
  const ctl = read('components/tour/SettingsTour.tsx');
  assert.match(ctl, /stopOfBeat\(beats\[index\]\) : SETTINGS_ENDING_STOP/);
  assert.match(ctl, /resumeIndex\(data\.stop, beats\)/);
  assert.doesNotMatch(ctl, /save\('progress', index\)/);
});

test('nudge: picked once from the branches, members first, never flipped by the tour', () => {
  assert.equal(pickNudge(MEM).id, 'program');
  assert.equal(pickNudge(REQ).id, 'program');
  assert.equal(pickNudge(NON).id, 'plain');
  assert.equal(pickNudge({ ...NON, plainLanguage: true }).id, 'coach');
  // Branches come from the two reads the page already makes; a failed read is the plain path.
  assert.deepEqual(readBranches(null, null, null), NON);
  assert.deepEqual(readBranches({ orgs: [{ orgId: 'o' }], policies: [{ scopes: ['progress'] }] }, { data: { coachPlainLanguage: true } }, { codes: [{ code: 'x' }] }), REQ);
  assert.deepEqual(readBranches({ orgs: [{ orgId: 'o' }], policies: [{ scopes: [] }] }, { data: { coachPlainLanguage: 'yes' } }, { codes: [{ code: 'x' }] }), MEM);
  // SF-2: membership is the page's own (any redeemed code), not /api/sharing's crm_v2-filtered orgs.
  assert.deepEqual(readBranches({ orgs: [], policies: [] }, {}, { codes: [{ code: 'x' }] }), MEM, 'a program without crm_v2 is still a program: S7n never plays over its progress switch');
  assert.deepEqual(readBranches({ orgs: [], policies: [{ scopes: ['progress'] }] }, {}, { codes: [{ code: 'x' }] }), { ...REQ, plainLanguage: false }, 'required comes from the sharing policies');
  assert.deepEqual(readBranches({ orgs: [{ orgId: 'o' }], policies: [] }, {}, { codes: [] }), NON, 'no code means no program, whatever sharing lists');
  assert.deepEqual(readBranches({ orgs: [{ orgId: 'o' }], policies: [] }, {}, null), MEM, 'the codes read failed: sharing orgs are the fallback');
  assert.deepEqual(readBranches({ orgs: [], policies: [{ scopes: ['progress'] }] }, {}, undefined), NON);
  assert.match(read('components/tour/SettingsTour.tsx'), /read\('\/api\/access-code\/mine'\)/);
  assert.match(read('components/tour/SettingsTour.tsx'), /readBranches\(sharing, coach, codes\)/);
  // The controller resolves it once per open, before the first card; the player only shows it.
  const ctl = read('components/tour/SettingsTour.tsx');
  assert.equal((ctl.match(/pickNudge\(/g) ?? []).length, 1);
  assert.match(ctl, /readBranches\(sharing, coach, codes\)/);
  const player = read('components/tour/SettingsTourPlayer.tsx');
  assert.doesNotMatch(player, /fetch\(|\.click\(\)|dispatchEvent\(new (Mouse|Pointer)Event/, 'the player presses nothing and reads nothing');
  assert.doesNotMatch(player, /pickNudge\(|applicableBeats\(/);
  // The nudge button closes the tour and lands on the control; the controller scrolls, never clicks.
  assert.match(player, /onDone\(nudge\.targets\)/);
  assert.match(ctl, /scrollToTarget\(el\)/);
  assert.doesNotMatch(ctl, /\.click\(\)/);
});

test('reward: the settings write path checks 45 s and grants under tour:settings; the SQL caps the amount at 1 and the entrance default binds no cap', async () => {
  const calls: string[] = [];
  let watched = 10 * 60_000;
  const store: TourWriteStore = {
    async start(_u, _r, _p, _s, tourId) { calls.push(`start:${tourId}`); return 'started'; },
    async advance(_u, _r, _q, _s, _c, tourId) { calls.push(`advance:${tourId}`); return 'saved'; },
    async watchedMs() { calls.push('watched'); return watched; },
    async grant(_u, _r, tourId) { calls.push(`grant:${tourId}`); return { status: 'granted', calls: 1 }; },
    async invalidate() {},
  };
  const run = '99999999-9999-4999-8999-999999999999';
  const body = { tourId: 'settings', version: TOURS.settings.version, runId: run, sequence: 1, stop: SETTINGS_ENDING_STOP, action: 'complete' };
  const done = await handleTourWrite(store, 'u', body);
  assert.equal(done.status, 200);
  assert.deepEqual(done.json.reward, { status: 'granted', calls: 1 });
  assert.deepEqual(calls, ['advance:settings', 'watched', 'grant:settings']);
  calls.length = 0; watched = 44_000;
  const early = await handleTourWrite(store, 'u', { ...body, sequence: 2 });
  assert.deepEqual(early.json.reward, { status: 'early', calls: 0 });
  assert.deepEqual(calls, ['advance:settings', 'watched'], 'under 45 s nothing is granted');
  // Stop range: the ending index is the last valid stop.
  assert.equal((await handleTourWrite(store, 'u', { ...body, sequence: 3, stop: SETTINGS_STOP_COUNT })).status, 400);

  const bound: unknown[][] = [];
  const texts: string[] = [];
  const db = { async batchAsUser(_u: string, build: (sql: (s: TemplateStringsArray, ...v: unknown[]) => unknown) => unknown[]) {
    build((s, ...v) => { bound.push(v); texts.push(s.join('?')); return null; });
    return [[], [], []];
  } };
  await grantTourRewardWith(db, 'u', run, { key: TOURS.settings.rewardKey, label: TOURS.settings.rewardLabel, calls: TOURS.settings.rewardCalls });
  const insert = texts[2];
  assert.equal((insert.match(/LEAST\(COALESCE\(\?::int,p\.bonus_calls\),p\.bonus_calls\)/g) ?? []).length, 3, 'the amount, the daily cap and the monthly cap all use the capped amount');
  assert.equal(bound[2].filter(v => v === 1).length, 3, 'the cap of 1 is bound into all three');
  assert.ok(!bound.flat().includes('tour:complete'));
  // SF-4: a cap that is not a positive integer grants nothing and runs no SQL (fail closed).
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    bound.length = 0; texts.length = 0;
    await assert.rejects(grantTourRewardWith(db, 'u', run, { key: 'tour:settings', label: 'x', calls: bad }), /positive integer/, String(bad));
    assert.equal(texts.length, 0, `calls ${bad} ran SQL`);
  }
  bound.length = 0; texts.length = 0;
  await grantTourRewardWith(db, 'u', run);
  assert.equal(bound[2].filter(v => v === null).length, 3, 'the entrance default binds no cap: COALESCE falls through to the policy amount');
  assert.deepEqual([...new Set(bound.flat().filter(v => typeof v === 'string' && /^tour:/.test(v as string)))], ['tour:complete']);
  // Reward words are the spec's.
  assert.deepEqual(settingsRewardMessage({ status: 'granted', calls: 1 }), [SETTINGS_REWARD_COPY.grantedTitle, "1 extra AI action added for the next 24 hours. It's for the tour, not for any setting you chose."]);
  assert.equal(settingsRewardMessage({ status: 'early', calls: 0 })[1], SETTINGS_REWARD_COPY.early);
  assert.match(settingsRewardMessage({ status: 'already', calls: 0, grantedAt: 'not a date' })[1], /you got it on an earlier day/);
});

test('impersonation: never offered, never opened, never written for the person', () => {
  assert.equal(settingsTourAllowed({ tier: 'client', orgRole: null, impersonating: null }), true);
  assert.equal(settingsTourAllowed({ tier: 'client', orgRole: null, impersonating: { mode: 'view' } }), false);
  assert.equal(settingsTourAllowed({ tier: 'client', orgRole: null, impersonating: { mode: 'assist' } }), false);
  assert.equal(settingsTourAllowed({ tier: 'client', orgRole: 'staff', impersonating: null }), false, 'staff Settings has no coach section or lesson');
  assert.equal(settingsTourAllowed({ tier: 'partner', orgRole: null, impersonating: null }), false);
  assert.equal(settingsTourAllowed({ tier: 'observer', orgRole: null, impersonating: null }), false);
  assert.equal(settingsTourAllowed(null), false);
  // The tours are consent-kind: no write under any impersonation, assist included.
  assert.ok(settingsVerdict({ mode: 'assist' }, 'consent', 'write'));
  assert.ok(settingsVerdict({ mode: 'view' }, 'consent', 'write'));
  const route = read('app/api/onboarding/tour/route.ts');
  assert.match(route, /if \(session\.impersonation\) return NextResponse\.json\(\{ error: [^}]*\}, \{ status: 403/);
  // The page mounts the tour and its control only for a client in their own session; the controller stops at the GET's impersonating flag too.
  const page = read('app/(dashboard)/dashboard/settings/page.tsx');
  assert.match(page, /\{!isOrgStaff && !impersonating && <SettingsTour \/>\}/);
  assert.match(page, /\{!isOrgStaff && !impersonating && \(\s*<button type="button" onClick=\{openSettingsTour\}/);
  const ctl = read('components/tour/SettingsTour.tsx');
  assert.match(ctl, /if \(mode === 'chip' \|\| data\.impersonating\) return;/);
  assert.match(ctl, /const open = !!slot && !slot\.impersonating &&/, 'N-2: no resume chip under view-as before the role loads');
  assert.match(read('app/(dashboard)/dashboard/help/page.tsx'), /\{settingsTourFor && <Link href="\/dashboard\/settings\?tour=settings"/, 'N-5: Help offers the replay to non-staff only');
  assert.match(read('app/(dashboard)/dashboard/help/page.tsx'), /const settingsTourFor = !useEffectiveRole\(\)\?\.orgRole;/);
  assert.match(ctl, /settingsTourAllowed\(\{ tier, orgRole: role\?\.orgRole, impersonating: role\?\.impersonating \}\)/);
  assert.match(ctl, /if \(!mounted \|\| !allowed\) return null;/);
  assert.match(ctl, /tourId: 'settings'/, 'every write names its tour, so the entrance slot is never touched');
});

test('entry and controls: ?tour=settings on the Settings page, the header control, the Help replay link, pause and Escape', () => {
  assert.equal(settingsTourRequested('/dashboard/settings', new URLSearchParams('tour=settings')), true);
  assert.equal(settingsTourRequested('/dashboard', new URLSearchParams('tour=settings')), false);
  assert.equal(settingsTourRequested('/dashboard/settings', new URLSearchParams('tour=1')), false, 'the entrance tour\'s request is not this tour\'s');
  assert.equal(settingsTourRequested('/dashboard/settings', null), false);
  assert.match(read('app/(dashboard)/dashboard/help/page.tsx'), /href="\/dashboard\/settings\?tour=settings"[^>]*>\s*Replay the Settings tour/);
  const ctl = read('components/tour/SettingsTour.tsx');
  // N-3: under React strict mode the mount cleanup aborts the first load; forgetting the request key lets the load effect ask again.
  assert.match(ctl, /requestController\.current\?\.abort\(\);[\s\S]{0,400}previousRequest\.current = '';\s*\n\s*document\.removeEventListener\('input'/, 'the mount cleanup forgets the request key');
  assert.match(read('lib/tour/settings-beats.ts'), /can add one extra AI action/, 'N-4: the daily cap can absorb the bonus');
  assert.match(ctl, /event\.key === 'Escape'[^\n]*pause\(\)/);
  assert.match(ctl, /lockPageForTour\(document\.documentElement, document\.body, document\.querySelector<HTMLElement>\('\.refinery-app'\)\)/, 'the shell is inert and the page does not scroll under the person');
  assert.match(ctl, /addEventListener\('pagehide', hide\)/, 'closing the tab saves the exact stop');
  assert.match(ctl, /fetch\('\/api\/onboarding\/tour\?tourId=settings'/);
  const player = read('components/tour/SettingsTourPlayer.tsx');
  assert.match(player, /playing && !hidden && ready && !ending/, 'auto-play stops while hidden, unlit or on the ending');
  assert.match(player, /useState\(\(\) => !\(osReduced\(\) \|\| readQuiet\(accountId\)\)\)/, 'reduced motion never auto-plays');
  assert.match(player, /behavior: 'auto'/, 'the tour scrolls in cuts; the cutout tween is the only motion');
  assert.match(player, /button\.et-primary'\)\?\.focus/, 'focus lands on Pause');
  // Geometry helpers.
  assert.equal(scrollTopFor(500, 1000, 48), 500 + 1000 - 72 - 48 - 12);
  assert.equal(scrollTopFor(10, 0, 0), 0);
  assert.equal(clipHeight(2000, 844, 0.42), Math.round(844 * 0.42));
  assert.equal(clipHeight(200, 844, 0.42), 200);
  assert.equal(clipHeight(2000, 844, undefined), 2000);
  // SF-1: on a 390x844 phone the card is bottom-anchored; every cutout stops 16 px above it. The three stops the review measured:
  // map 229 px under the 72 px bar, so targets start about 313 px down; card 290 to 313 px tall.
  const vh = 844;
  for (const [id, top, height, cardH] of [['s4', 313, 366, 313], ['s5', 313, Math.round(vh * 0.42), 313], ['s9', 313, 593, 290]] as [string, number, number, number][]) {
    const h = portraitCutHeight(height, top, vh, cardH, true);
    assert.ok(top + h + SPOTLIGHT_PAD <= vh - cardH - 16, `${id}: padded cutout bottom ${top + h + SPOTLIGHT_PAD} under the card top ${vh - cardH - 16}`);
    assert.ok(h >= PORTRAIT_CUT_MIN, id);
  }
  assert.equal(portraitCutHeight(366, 313, vh, 313, false), 366, 'wide screens are not capped');
  assert.equal(portraitCutHeight(100, 313, vh, 313, true), 100, 'a short target is left alone');
  assert.equal(portraitCutHeight(900, 700, vh, 313, true), PORTRAIT_CUT_MIN, 'never a sliver');
  assert.ok(SETTINGS_BEATS.find(b => b.id === 's9')!.clip, 'S9 keeps its top like S5');
  assert.match(read('components/tour/SettingsTourPlayer.tsx'), /portraitCutHeight\(clipHeight\(r\.height, innerHeight, beat\.clip\), r\.top, innerHeight, fit\.current\.cardH, fit\.current\.portrait\)/);
});

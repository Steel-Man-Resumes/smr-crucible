/**
 * The Settings tour, version 2 (SETTINGS-TOUR-V2-STORYBOARD.md and its "v2
 * teaching plan"): registry, runtime, targets on the real page, copy rules,
 * resume by absolute beat, the nudge picked once, the reward (1 call under
 * tour:settings, only after a passed quiz), and no writes under impersonation.
 * The SQL runs for real in tour-store-map-pglite.test.ts and tour-reward-pglite.test.ts.
 * Camera, objectives and quiz details are in settings-tour-v2.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OBJECTIVES, SETTINGS_BEATS, SETTINGS_ENDING, SETTINGS_NUDGES, SETTINGS_REWARD_COPY, SETTINGS_STOP_COUNT, SETTINGS_TOUR_COPY, SHARING_REQUIRED_WHY } from '../tour/settings-beats';
import { PORTRAIT_CUT_MIN, SPOTLIGHT_PAD, SETTINGS_ENDING_STOP, applicableBeats, clipHeight, pickNudge, portraitCutHeight, readBranches, resumeIndex, scrollTopFor, settingsRewardMessage, settingsRuntimeMs, settingsTourAllowed, settingsTourRequested, stopOfBeat } from '../tour/settings-tour';
import { TOURS } from '../tour/registry';
import { handleTourWrite, type TourWriteStore } from '../tour/tour-write';
import { grantTourRewardWith } from '../tour/tour-sql';
import { readMs } from '../tour/settings-camera';
import { SETTINGS_QUIZ_VERSION } from '../tour/settings-quiz';
import { wordCount } from '../tour/timing';
import { settingsVerdict } from '../settings-guard';

const ROOT = join(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const NON = { member: false, required: false, plainLanguage: false };
const MEM = { member: true, required: false, plainLanguage: false };
const REQ = { member: true, required: true, plainLanguage: true };
const PASS = { version: SETTINGS_QUIZ_VERSION, answers: { reading: 1, doors: 0, devices: 1, memory: 1, delete: 0 } };

test('registry: version 2 pinned to its beats, grants 1 call under its own key after 45 s and a passed quiz, never marks onboarding', () => {
  const s = TOURS.settings;
  assert.equal(s.version, 2, 'a v1 saved place never resumes into v2');
  assert.equal(SETTINGS_BEATS.length, 12);
  assert.equal(s.stopCount, SETTINGS_STOP_COUNT);
  assert.equal(s.stopCount, SETTINGS_BEATS.length + 1, 'absolute beat indexes plus the ending');
  assert.equal(s.grants, true);
  assert.equal(s.quiz, true);
  assert.equal(s.rewardCalls, 1);
  assert.equal(s.rewardKey, 'tour:settings');
  assert.equal(s.rewardLabel, 'Settings tour finished: extra AI action');
  assert.equal(s.minWatchMs, 45_000);
  assert.equal(s.completesOnboarding, false);
  // The entrance tour is untouched: its key, label, policy amount, and no quiz on the completion write.
  assert.equal(TOURS.entrance.rewardKey, 'tour:complete');
  assert.equal(TOURS.entrance.rewardLabel, 'Tour finished: extra AI actions');
  assert.equal(TOURS.entrance.rewardCalls, undefined);
  assert.equal(TOURS.entrance.grants, true);
  assert.equal(TOURS.entrance.quiz, undefined);
  assert.equal(TOURS.crm.quiz, undefined);
});

test('runtime: 11 stops on every path; about 132 s wide and 134 s on a phone (the goal card slowed 1.75 times); with the quiz and reward still under 3 minutes', () => {
  for (const branches of [NON, MEM, REQ]) {
    const path = applicableBeats(branches);
    assert.equal(path.length, 11);
    const wide = settingsRuntimeMs(path) / 1000, phone = settingsRuntimeMs(path, true) / 1000;
    assert.ok(wide >= 120 && wide <= 140, `wide ${wide}`);
    assert.ok(phone >= 122 && phone <= 142, `phone ${phone}`);
    // Five short questions at reading pace plus the reward card leave the whole thing under 180 s.
    assert.ok(phone + 40 < 180, `phone with quiz ${phone + 40}`);
  }
  for (const b of SETTINGS_BEATS) {
    assert.ok(wordCount(b.body) <= 45, `${b.id}: ${wordCount(b.body)} words`);
    if (b.kind === 'slow' && b.where === 'page') assert.ok(readMs(b) <= 11000, `${b.id} slow beat over the reading cap`);
  }
  // Branches: a non-member gets the no-program line; members the switches; the required path keeps the same stops and swaps the why line.
  assert.deepEqual(applicableBeats(NON).map(b => b.id).filter(id => id.startsWith('p')), ['p1n']);
  assert.deepEqual(applicableBeats(MEM).map(b => b.id).filter(id => id.startsWith('p')), ['p1m']);
  assert.deepEqual(applicableBeats(REQ).map(b => b.id).filter(id => id.startsWith('p')), ['p1m']);
  assert.equal(applicableBeats(REQ).find(b => b.id === 'p1m')!.why, SHARING_REQUIRED_WHY);
  assert.notEqual(applicableBeats(MEM).find(b => b.id === 'p1m')!.why, SHARING_REQUIRED_WHY);
  assert.deepEqual(applicableBeats({ member: false, required: true, plainLanguage: false }).map(b => b.id).filter(id => id.startsWith('p')), ['p1n'], 'a requirement without membership is not a branch');
  // Teaching order: familiar first, then sharing, sign-in, t.ROY's AI, your data.
  assert.deepEqual(applicableBeats(NON).map(b => b.id), ['g0', 'm1', 'c1', 'x1', 'p1n', 's1', 'u1', 'k1', 'm2', 'd1', 'r1']);
  assert.deepEqual(SETTINGS_BEATS.filter(b => b.ticks && b.show !== 'member').map(b => b.ticks), OBJECTIVES.map(o => o.id), 'each objective ticks once, in order');
});

test('targets: every id the beats, chips and nudges point at exists on the Settings page or its components', () => {
  const sources = [
    'app/(dashboard)/dashboard/settings/page.tsx', 'components/CoachSettingsSection.tsx', 'components/AccessibilitySettingsSection.tsx',
    'components/SharingConsentSection.tsx', 'components/SharingControls.tsx', 'components/tour/SettingsLesson.tsx', 'components/ConsentPanel.tsx',
  ].map(read).join('\n');
  const ids = new Set<string>();
  for (const m of sources.matchAll(/\b(?:id|data-tour)=(?:"([^"]+)"|\{[^}]*?"([^"]+)"[^}]*\})/g)) ids.add(m[1] ?? m[2]);
  for (const m of sources.matchAll(/\bid="(settings-[a-z-]+)"/g)) ids.add(m[1]);
  const wanted = new Set<string>();
  for (const b of SETTINGS_BEATS) { if (b.where !== 'page') continue; for (const t of b.targets ?? []) wanted.add(t); for (const c of b.chips ?? []) for (const t of c.targets) wanted.add(t); }
  for (const n of Object.values(SETTINGS_NUDGES)) for (const t of n.targets) wanted.add(t);
  for (const id of wanted) assert.ok(ids.has(id), `${id} is not an element id on the Settings page`);
  for (const id of ['settings-password', 'settings-two-step', 'settings-devices', 'settings-delete-data', 'settings-delete-account', 'settings-ai-memory', 'settings-creativity', 'settings-usage-today', 'settings-export']) assert.ok(ids.has(id), id);
  assert.ok(read('components/tour/SettingsTourPlayer.tsx').includes('findAll(beat.targets ?? [])'));
});

test('copy: no long dashes or "--", no emoji, t.ROY exact, never a label on the reader, nothing the storyboard says never to claim', () => {
  const files = ['lib/tour/settings-beats.ts', 'lib/tour/settings-tour.ts', 'lib/tour/settings-quiz.ts', 'lib/tour/settings-quiz-grade.ts', 'components/tour/SettingsTour.tsx', 'components/tour/SettingsTourPlayer.tsx', 'components/tour/SettingsScenes.tsx', 'components/tour/SettingsEnding.tsx'];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /—|–/, `${f} has a long dash`);
    assert.doesNotMatch(src, /\s--\s/, `${f} has a -- stand-in`);
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, `${f} has an emoji`);
    for (const m of src.matchAll(/t\.roy/gi)) assert.equal(m[0], 't.ROY', `${f}: ${m[0]}`);
  }
  const lines: string[] = [];
  for (const b of SETTINGS_BEATS) { lines.push(b.title, b.body, b.why ?? ''); for (const c of b.chips ?? []) lines.push(c.label); }
  for (const o of OBJECTIVES) lines.push(o.short, o.agenda, o.recap);
  lines.push(SHARING_REQUIRED_WHY);
  for (const n of Object.values(SETTINGS_NUDGES)) lines.push(n.title, n.body, n.button);
  for (const v of Object.values(SETTINGS_ENDING)) lines.push(typeof v === 'function' ? (v as (a: number, b: number) => string)(1, 5) : v);
  for (const v of Object.values(SETTINGS_TOUR_COPY)) if (typeof v === 'string') lines.push(v);
  lines.push(SETTINGS_TOUR_COPY.stopOf(1, 11), SETTINGS_TOUR_COPY.ticked('Sharing'), SETTINGS_TOUR_COPY.chipsSr(['Password', 'Active devices']));
  for (const v of Object.values(SETTINGS_REWARD_COPY)) lines.push(typeof v === 'function' ? (v as (a: never) => string)(1 as never) : v);
  const all = lines.join('\n');
  assert.doesNotMatch(all, /\b(felon|offender|ex-con|convict|justice-impacted|second[- ]chance)\b/i);
  assert.doesNotMatch(all, /you are a|you're a/i);
  assert.doesNotMatch(all, /HIPAA|SOC ?2|FedRAMP|\bsecure\b|guaranteed|encrypted|nobody else|no one else can/i);
  assert.doesNotMatch(all, /rename|coach name|translat/i, 'the coach name stays out; reading help never claims to translate the page');
  assert.doesNotMatch(all, /document files|includes your documents|midnight|unlock|premium|wrong\b/i);
  assert.doesNotMatch(all, /\btakes back\b/i, 'shutting a door never takes anything back');
  assert.doesNotMatch(all, /free choice|no effect/i);
  assert.doesNotMatch(all, /\b\d{2,}\s+(people|employers|resources|clients)\b/i, 'no counts of people helped');
  assert.doesNotMatch(all, /probation|parole|supervision|your record|conviction/i, "nothing about the person's record or status in a caption");
  for (const n of Object.values(SETTINGS_NUDGES)) assert.doesNotMatch(`${n.title} ${n.body} ${n.button}`, /\$\{|orgName/);
  assert.doesNotMatch(all, /we (saved|changed|turned)/i, 'the tour never claims to have changed a setting');
  // The creativity beat says where it reaches (the chat only) and nothing about the resume tools changing.
  const k1 = SETTINGS_BEATS.find(b => b.id === 'k1')!;
  assert.match(`${k1.body} ${k1.why}`, /only changes the chat/);
  assert.match(read('app/api/coach/route.ts'), /coachCreativityNote\(profile\.coachCreativity\)/, 'the slider reaches the Refinery chat');
  assert.doesNotMatch(read('app/api/assistant/route.ts'), /creativ/i, 'and not the other chat');
  assert.match(SETTINGS_REWARD_COPY.granted(1), /for passing the check, not for any setting you chose/);
});

test('resume: the saved stop is the absolute beat index, so the same beat comes back whatever the path is now', () => {
  const non = applicableBeats(NON), mem = applicableBeats(MEM), req = applicableBeats(REQ);
  const x1 = stopOfBeat(SETTINGS_BEATS.find(b => b.id === 'x1')!);
  assert.equal(x1, 3);
  for (const path of [non, mem, req]) assert.equal(path[resumeIndex(x1, path)].id, 'x1');
  // Saved on the member sharing stop, now a non-member: the next stop that applies, never a wrong beat under the same number.
  const p1m = stopOfBeat(SETTINGS_BEATS.find(b => b.id === 'p1m')!);
  assert.equal(non[resumeIndex(p1m, non)].id, 's1');
  const p1n = stopOfBeat(SETTINGS_BEATS.find(b => b.id === 'p1n')!);
  assert.equal(mem[resumeIndex(p1n, mem)].id, 'p1m');
  const s1 = stopOfBeat(SETTINGS_BEATS.find(b => b.id === 's1')!);
  assert.equal(s1, 6);
  assert.equal(resumeIndex(s1, non), 5);
  assert.equal(resumeIndex(s1, req), 5);
  // The ending, odd values and the first stop.
  assert.equal(resumeIndex(SETTINGS_ENDING_STOP, non), non.length);
  assert.equal(resumeIndex(99, non), non.length);
  assert.equal(resumeIndex(undefined, non), 0);
  assert.equal(resumeIndex(-3, non), 0);
  assert.equal(SETTINGS_ENDING_STOP, 12);
  const ctl = read('components/tour/SettingsTour.tsx');
  assert.match(ctl, /stopOfBeat\(beats\[index\]\) : SETTINGS_ENDING_STOP/);
  assert.match(ctl, /resumeIndex\(data\.stop, beats\)/);
  assert.doesNotMatch(ctl, /save\('progress', index\)/);
  // A v1 place (version 1) never resumes into v2.
  assert.match(ctl, /const resuming = resume && data\.version === DEF\.version/);
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
  const player = read('components/tour/SettingsTourPlayer.tsx') + read('components/tour/SettingsEnding.tsx');
  assert.doesNotMatch(player, /fetch\(|\.click\(\)|dispatchEvent\(new (Mouse|Pointer)Event/, 'the player presses nothing and reads nothing');
  assert.doesNotMatch(player, /pickNudge\(|applicableBeats\(/);
  // The nudge button closes the tour and lands on the control; the controller scrolls, never clicks.
  assert.match(player, /onDone\(nudge\.targets\)/);
  assert.match(ctl, /scrollToTarget\(el\)/);
  assert.doesNotMatch(ctl, /\.click\(\)/);
});

test('reward: the settings write path grants under tour:settings only after a passed quiz and 45 s; the SQL caps the amount at 1 and the entrance default binds no cap', async () => {
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
  const body = { tourId: 'settings', version: TOURS.settings.version, runId: run, sequence: 1, stop: SETTINGS_ENDING_STOP, action: 'complete', quiz: PASS };
  const done = await handleTourWrite(store, 'u', body);
  assert.equal(done.status, 200);
  assert.deepEqual(done.json.reward, { status: 'granted', calls: 1 });
  assert.equal((done.json.quiz as { passed: boolean }).passed, true);
  assert.deepEqual(calls, ['advance:settings', 'watched', 'grant:settings']);
  calls.length = 0; watched = 44_000;
  const early = await handleTourWrite(store, 'u', { ...body, sequence: 2 });
  assert.deepEqual(early.json.reward, { status: 'early', calls: 0 });
  assert.deepEqual(calls, ['advance:settings', 'watched'], 'under 45 s nothing is granted');
  // Skipped (no quiz) and failed complete the run and never reach the grant.
  calls.length = 0; watched = 10 * 60_000;
  const { quiz: _q, ...noQuiz } = body;
  const skipped = await handleTourWrite(store, 'u', { ...noQuiz, sequence: 3 });
  assert.deepEqual([skipped.status, skipped.json.reward, skipped.json.quiz], [200, null, null]);
  const failed = await handleTourWrite(store, 'u', { ...body, sequence: 4, quiz: { ...PASS, answers: { ...PASS.answers, delete: 1 } } });
  assert.equal(failed.json.reward, null);
  assert.deepEqual((failed.json.quiz as { passed: boolean; correct: number }), { ...(failed.json.quiz as object), passed: false, correct: 4 });
  assert.deepEqual(calls, ['advance:settings', 'advance:settings'], 'skipped and failed: no watch check, no grant');
  // A bad shape is refused before anything is written; answers on a progress write are refused too.
  calls.length = 0;
  for (const bad of [{ ...PASS, version: 99 }, { ...PASS, extra: 1 }, { version: 1, answers: { ...PASS.answers, delete: 7 } }, { version: 1, answers: { reading: 1 } }, 'pass', null]) {
    assert.equal((await handleTourWrite(store, 'u', { ...body, sequence: 5, quiz: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await handleTourWrite(store, 'u', { ...body, action: 'progress', stop: 3, sequence: 5 })).status, 400);
  assert.deepEqual(calls, [], 'nothing written for a bad quiz');
  // The server never sends the right index, only right-or-not and why.
  assert.ok((done.json.quiz as { review: object[] }).review.every(r => Object.keys(r).sort().join() === 'explanation,id,right'));
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
  assert.deepEqual(settingsRewardMessage({ status: 'granted', calls: 1 }), [SETTINGS_REWARD_COPY.grantedTitle, "1 extra AI action added for the next 24 hours. It's for passing the check, not for any setting you chose."]);
  assert.deepEqual(settingsRewardMessage(null), [SETTINGS_REWARD_COPY.skippedTitle, SETTINGS_REWARD_COPY.skipped]);
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
  assert.match(read('lib/tour/settings-beats.ts'), /you can earn one extra AI action/, 'N-4: the bonus is "can earn", never certain');
  assert.match(ctl, /event\.key === 'Escape'[^\n]*pause\(\)/);
  assert.match(ctl, /lockPageForTour\(document\.documentElement, document\.body, document\.querySelector<HTMLElement>\('\.refinery-app'\)\)/, 'the shell is inert and the page does not scroll under the person');
  assert.match(ctl, /addEventListener\('pagehide', hide\)/, 'closing the tab saves the exact stop');
  assert.match(ctl, /fetch\('\/api\/onboarding\/tour\?tourId=settings'/);
  const player = read('components/tour/SettingsTourPlayer.tsx');
  assert.match(player, /const running = playing && !hidden && !ending && !shrink && !grow;/, 'auto-play stops while hidden, between acts or on the ending');
  assert.match(player, /useState\(\(\) => !\(osReduced\(\) \|\| readQuiet\(accountId\)\)\)/, 'reduced motion never auto-plays');
  assert.match(player, /const instant = reduced;/, 'motion-off: the camera cuts');
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
  assert.ok(SETTINGS_BEATS.find(b => b.id === 'd1')!.clip, 'the tall export card keeps its top');
  assert.match(read('components/tour/SettingsTourPlayer.tsx'), /const h = portraitCutHeight\(h0, Math\.max\(box\.y, TOP_BAR_PX\), innerHeight, innerHeight - cardTop, true\);/, 'on a phone every cutout stops above the card');
});

/**
 * CRM staff tour (CRM-TOUR.md): the registry entry, the beats and their
 * targets on the real staff screens, runtime at reading pace, resume by beat
 * id, the copy rules and the must-never-claim list, the no-fetch rule, and the
 * staff-only entry. Fictional people and a fictional organization only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TOURS, TOUR_IDS, isTourId } from '../tour/registry';
import {
  CRM_ENDING_INDEX, CRM_PERSON_TOKEN, CRM_TOUR_BEATS, CRM_TOUR_COPY, CRM_TOUR_ENDING, CRM_TOUR_GROUPS, CRM_TOUR_STOP_COUNT,
  applicableBeats, beatCopy, beatHref, onBeatPage, resumeStop, splitHref, stopForBeat,
} from '../tour/crm-beats';
import { firstPersonFromCohort, isDemoOrg, personIdFromRow, staffTourAllowed, staffTourRequested, STAFF_TOUR_HOME, STAFF_TOUR_OPEN_EVENT } from '../tour/staff-tour';
import { holdMs, wordCount } from '../tour/timing';
import { handleTourWrite, type TourWriteStore } from '../tour/tour-write';
import { TOUR_VERSION, TOUR_STOP_COUNT } from '../guidedTour';
import { TOUR_REWARD_KEY } from '../tour/reward';
import type { TodayPayload } from '../today-view';

(globalThis as { React?: typeof React }).React = React;
const ROOT = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const ALL_CAPS = ['org.client.view_content', 'org.insights.view', 'org.staff.manage', 'org.participant.invite', 'org.client.request_sharing'];
const PERSON = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const TOUR_FILES = ['lib/tour/crm-beats.ts', 'lib/tour/staff-tour.ts', 'lib/tour/find-target.ts', 'components/tour/StaffTourPlayer.tsx', 'components/tour/StaffTour.tsx'];

/* Registry */
test('registry: crm is a tour of its own, reserved reward key, grants nothing, stops match the beats', () => {
  assert.deepEqual([...TOUR_IDS], ['entrance', 'settings', 'crm']);
  assert.ok(isTourId('crm'));
  const crm = TOURS.crm;
  assert.equal(crm.version, 1);
  assert.equal(crm.grants, false, 'staff tours grant nothing');
  assert.equal(crm.rewardKey, 'tour:crm');
  assert.equal(crm.completesOnboarding, false);
  assert.equal(crm.stopCount, CRM_TOUR_STOP_COUNT);
  assert.equal(CRM_TOUR_STOP_COUNT, CRM_TOUR_BEATS.length + 1);
  assert.equal(CRM_ENDING_INDEX, CRM_TOUR_BEATS.length);
  // Every tour keeps its own key; the entrance and Settings tours are untouched.
  const keys = Object.values(TOURS).map(t => t.rewardKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(TOURS.entrance.rewardKey, TOUR_REWARD_KEY);
  assert.equal(TOURS.entrance.version, TOUR_VERSION);
  assert.equal(TOURS.entrance.stopCount, TOUR_STOP_COUNT);
  assert.equal(TOURS.entrance.grants, true);
  assert.equal(TOURS.settings.rewardKey, 'tour:settings');
  assert.equal(TOURS.settings.grants, false);
  assert.equal(TOUR_VERSION, 5, 'the entrance tour version did not need a bump');
});

test('the reward is never written: completing a crm run calls no grant and returns reward null', async () => {
  const calls = { grant: 0 };
  const place: { runId?: string; sequence: number; inProgress: boolean } = { sequence: 0, inProgress: false };
  const store: TourWriteStore = {
    async start(_u, runId, previous) { if ((place.runId ?? null) !== previous) return 'conflict'; Object.assign(place, { runId, sequence: 0, inProgress: true }); return 'started'; },
    async advance(_u, runId, sequence, _stop, complete) { if (place.runId === runId && place.inProgress && place.sequence < sequence) { place.sequence = sequence; if (complete) place.inProgress = false; return 'saved'; } return 'conflict'; },
    async watchedMs() { return 10 * 60_000; },
    async grant() { calls.grant++; return { status: 'granted', calls: 2 }; },
    async invalidate() {},
  };
  const USER = '00000000-0000-4000-8000-000000000001', RUN = '11111111-1111-4111-8111-111111111111';
  const w = (body: Record<string, unknown>) => handleTourWrite(store, USER, { tourId: 'crm', version: TOURS.crm.version, runId: RUN, sequence: 0, stop: 0, ...body });
  assert.equal((await w({ action: 'start', previousRunId: null })).status, 200);
  assert.equal((await w({ action: 'progress', sequence: 1, stop: stopForBeat('person-shared') })).status, 200);
  const done = await w({ action: 'complete', sequence: 2, stop: CRM_ENDING_INDEX });
  assert.equal(done.status, 200);
  assert.equal(done.json.reward, null);
  assert.equal(calls.grant, 0, 'grants false short-circuits before the store');
  assert.equal((await w({ action: 'progress', sequence: 3, stop: CRM_TOUR_STOP_COUNT })).status, 400, 'stop range is the beats plus the ending');
  assert.equal((await w({ action: 'progress', sequence: 3, stop: 1, version: TOUR_VERSION })).status, 400, 'crm has its own version');
});

/* Beats */
test('beats: unique ids, groups in order, DESIGN section 7 order (Today, one person, their screen, Insights, privacy)', () => {
  assert.equal(new Set(CRM_TOUR_BEATS.map(b => b.id)).size, CRM_TOUR_BEATS.length);
  const order = CRM_TOUR_GROUPS.map(g => g.id);
  let last = 0;
  for (const b of CRM_TOUR_BEATS) { const at = order.indexOf(b.group); assert.ok(at >= last, `${b.id} out of order`); last = at; }
  const ids = CRM_TOUR_BEATS.map(b => b.id);
  assert.deepEqual(ids.slice(0, 3), ['today-start', 'today-reasons', 'today-person']);
  assert.ok(ids.indexOf('person-shared') < ids.indexOf('person-board'), 'what they shared before their screen');
  assert.ok(ids.indexOf('person-board') < ids.indexOf('insights-head'));
  assert.equal(ids.at(-1), 'privacy');
  assert.ok(CRM_TOUR_BEATS.find(b => b.id === 'insights-print')!.targets.flat().includes('crm-insights-mark'), 'the print stop lights the org mark too');
  for (const b of CRM_TOUR_BEATS) assert.equal(b.minFound, 1);
});

test('every target is a one-line data-tour id on a real staff screen, and every href is a real route', () => {
  const sources = ['components/org/TodayPage.tsx', 'components/org/PersonOverview.tsx', 'components/org/ClientPage.tsx', 'components/org/InsightsReport.tsx', 'components/org/OrgSidebar.tsx'].map(read).join('\n');
  const navIds = new Set([...read('lib/org-nav.ts').matchAll(/navId: "([a-z-]+)"/g)].map(m => m[1]));
  assert.match(read('components/org/OrgSidebar.tsx'), /data-tour=\{item\.navId \|\| undefined\}/, 'sidebar links carry their nav id as the tour id');
  for (const b of CRM_TOUR_BEATS) {
    for (const [id] of b.targets) {
      const inSource = sources.includes(`data-tour="${id}"`) || sources.includes(`"${id}"`) && /data-tour=\{[^}]*"crm-/.test(sources);
      assert.ok(inSource || navIds.has(id), `${b.id}: target ${id} is on no staff screen`);
    }
    const { pathname } = splitHref(beatHref(b, PERSON));
    const seg = pathname.replace('/dashboard/', '').replace(PERSON, '[id]');
    assert.ok(existsSync(join(ROOT, 'app/(dashboard)/dashboard', seg, 'page.tsx')), `${b.id}: ${pathname} is not a page`);
    if (b.needsPerson) assert.ok(b.href.includes(CRM_PERSON_TOKEN), `${b.id} needs a person but names none`);
    else assert.ok(!b.href.includes(CRM_PERSON_TOKEN));
  }
  // The conditional targets really are written where the test expects them.
  assert.match(read('components/org/TodayPage.tsx'), /data-tour=\{tourFirst \? "crm-today-first-row" : undefined\} data-client-id=/);
  assert.match(read('components/org/PersonOverview.tsx'), /data-tour=\{area\.station === "plan" \? "crm-person-never" : undefined\}/);
  assert.match(read('components/org/ClientPage.tsx'), /data-tour=\{key === "shared" \? "crm-person-shared-tab" : undefined\}/);
});

test('the person stops drop out, never invent, when the list is empty; Insights waits on its capability', () => {
  const full = applicableBeats({ personId: PERSON, capabilities: ALL_CAPS });
  assert.ok(full.every(b => !b.noPeopleOnly));
  assert.equal(full.filter(b => b.needsPerson).length, 5);
  assert.equal(full.length, CRM_TOUR_BEATS.length - 1);
  const none = applicableBeats({ personId: null, capabilities: ALL_CAPS });
  assert.ok(none.every(b => !b.needsPerson));
  assert.deepEqual(none.filter(b => b.noPeopleOnly).map(b => b.id), ['no-people']);
  assert.match(beatCopy(none.find(b => b.id === 'no-people')!, false).body, /waits until someone joins/);
  const noInsights = applicableBeats({ personId: PERSON, capabilities: ['org.client.view_content'] });
  assert.ok(noInsights.every(b => b.group !== 'insights'));
  assert.ok(noInsights.some(b => b.id === 'privacy'), 'the privacy line is for everyone');
  for (const b of CRM_TOUR_BEATS) assert.ok(!(b.needsPerson && b.noPeopleOnly));
});

test('the person page is opened on a named tab, so the staff start-tab setting can never open a shared item for the tour', () => {
  for (const b of CRM_TOUR_BEATS.filter(b => b.needsPerson)) {
    const { pathname, search } = splitHref(beatHref(b, PERSON));
    assert.equal(pathname, `/dashboard/clients/${PERSON}`);
    assert.match(search, /^\?tab=(notes|screen)$/, `${b.id} names its tab`);
  }
  assert.equal(splitHref(beatHref(CRM_TOUR_BEATS.find(b => b.id === 'person-board')!, PERSON)).search, '?tab=screen');
  const page = read('components/org/ClientPage.tsx');
  assert.match(page, /if \(startTab\) \{ setTab\(startTab\); setItem\(null\); setShared\(null\); return; \}/, 'a start tab skips initialOpen (no fetch, no saved preference)');
  assert.match(read('app/(dashboard)/dashboard/clients/[id]/page.tsx'), /PERSON_TABS\.some\(\(t\) => t\.key === v\)/, 'the route validates ?tab=');
});

/* Resume by beat id */
test('resume: the saved stop is a beat id through the full list, and resumes at that beat or the next one that applies', () => {
  const full = applicableBeats({ personId: PERSON, capabilities: ALL_CAPS });
  const none = applicableBeats({ personId: null, capabilities: ALL_CAPS });
  const shared = stopForBeat('person-shared');
  assert.equal(full[resumeStop(shared, full)].id, 'person-shared');
  // Saved mid-person on a list that is now empty: the next applying beat, not the same position.
  assert.equal(none[resumeStop(shared, none)].id, 'no-people');
  assert.equal(none[resumeStop(stopForBeat('no-people'), none)].id, 'no-people');
  assert.equal(full[resumeStop(stopForBeat('no-people'), full)].id, 'insights-head', 'a no-people place resumes at Insights once someone joined');
  const noInsights = applicableBeats({ personId: PERSON, capabilities: ['org.client.view_content'] });
  assert.equal(noInsights[resumeStop(stopForBeat('insights-head'), noInsights)].id, 'privacy');
  assert.equal(resumeStop(CRM_ENDING_INDEX, full), full.length, 'the ending');
  assert.equal(resumeStop(999, full), full.length);
  for (const bad of [undefined, null, -1, 1.5]) assert.equal(resumeStop(bad as number, full), 0, String(bad));
  assert.equal(stopForBeat('nope'), CRM_ENDING_INDEX);
  // A position in the resolved path would be wrong: index 3 in `none` is Insights, index 3 in the full list is a person stop.
  assert.notEqual(none[3].id, CRM_TOUR_BEATS[3].id);
});

/* Pace */
test('runtime at reading pace: 75 to 110 s on the full path, under 110 s on every path, demo words included', () => {
  const sum = (beats: typeof CRM_TOUR_BEATS, demo: boolean) => beats.reduce((a, b) => a + holdMs(beatCopy(b, demo)), 0);
  const full = applicableBeats({ personId: PERSON, capabilities: ALL_CAPS });
  for (const demo of [false, true]) {
    const ms = sum(full, demo);
    assert.ok(ms >= 75_000 && ms <= 110_000, `full path ${demo ? '(demo)' : ''}: ${ms} ms`);
    console.log(`# runtime ${demo ? 'demo' : 'real'} org, full path (${full.length} stops): ${(ms / 1000).toFixed(1)} s`);
  }
  console.log(`# runtime no-people path: ${(sum(applicableBeats({ personId: null, capabilities: ALL_CAPS }), false) / 1000).toFixed(1)} s`);
  for (const ctx of [{ personId: null, capabilities: ALL_CAPS }, { personId: PERSON, capabilities: [] }, { personId: null, capabilities: [] }]) {
    assert.ok(sum(applicableBeats(ctx), true) <= 110_000);
  }
});

test('captions: bodies 12 to 30 words, titles short, every stop has both', () => {
  for (const b of CRM_TOUR_BEATS) {
    for (const c of [beatCopy(b, false), beatCopy(b, true)]) {
      const n = wordCount(c.body);
      assert.ok(n >= 12 && n <= 30, `${b.id}: ${n} words`);
      assert.ok(c.title && wordCount(c.title) <= 8, `${b.id}: title`);
    }
  }
  assert.ok(wordCount(CRM_TOUR_ENDING.body) <= 30);
});

/* Copy rules and the must-never-claim list */
test('copy: no long dashes, no double-hyphen stand-in, no emojis, t.ROY spelled exactly, Steel Man Resumes', () => {
  for (const f of TOUR_FILES) {
    const src = read(f);
    assert.doesNotMatch(src, /—|–/, `${f} has a long dash`);
    assert.doesNotMatch(src, / -- /, `${f} has a double-hyphen stand-in`);
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, `${f} has an emoji`);
    for (const m of src.matchAll(/\bt\.?\s?roy\b/gi)) assert.equal(m[0], 't.ROY', `${f}: ${m[0]}`);
    assert.doesNotMatch(src, /Steel ?man resumes(?! )|SteelMan|Steel Man Resume\b/);
  }
  const beats = read('lib/tour/crm-beats.ts');
  assert.match(beats, /Steel Man Resumes/);
  assert.doesNotMatch(beats, /Five Star/);
});

test('the tour never claims: counts of people helped, "in use" for a demo, compliance words, competitors, labels on the reader', () => {
  const copy = [
    ...CRM_TOUR_BEATS.flatMap(b => [b.title, b.body, b.demo?.title ?? '', b.demo?.body ?? '']),
    ...Object.values(CRM_TOUR_COPY).map(v => typeof v === 'function' ? v(1, 2) : v),
    ...Object.values(CRM_TOUR_ENDING),
  ].join('\n');
  const never: [RegExp, string][] = [
    [/\bin use\b/i, '"in use" (demo orgs say available)'],
    [/\b\d+\s+(people|participants|clients|job seekers)\b/i, 'a count of people'],
    [/\b(helped|served|placed)\s+\d+/i, 'a count of people helped'],
    [/\bHIPAA|SOC ?2|FedRAMP|complian|encrypt|\bsecure\b|guaranteed|bank-level/i, 'a compliance or security claim'],
    [/Honest Jobs|Orijin|Jobscan|\bTeal\b|Rezi|Yoodli|AIApply|CaseWorthy|Apricot|Unite Us|Salesforce|HubSpot/i, 'a competitor by name'],
    [/second[- ]chance/i, '"second chance" as our label'],
    [/\b(felon|felons|offender|offenders|ex-con|ex-cons|inmate|inmates|convict|convicts)\b/i, 'a label on a person'],
    [/\bjustice[- ]impacted\b|\bfair[- ]chance\b/i, 'a practitioner word in a staff caption'],
    [/\bunlock|seamless|empower|leverage|journey|mission control|game[- ]changer|robust\b/i, 'AI vocabulary'],
    [/\bprint preview\b|\bprinted for you\b|\bprints for you\b/i, 'a print the tour did not run'],
    [/\bopens? (it|them|the item) for you\b|\bI (opened|will open)\b/i, 'the tour opening a shared item'],
    [/\bbonus\b|\breward\b|extra AI action/i, 'a reward (staff tours grant nothing)'],
  ];
  for (const [re, why] of never) assert.doesNotMatch(copy, re, why);
  // The demo variant exists only on the privacy stop and says "available".
  const demo = CRM_TOUR_BEATS.filter(b => b.demo);
  assert.deepEqual(demo.map(b => b.id), ['privacy']);
  assert.match(demo[0].demo!.body, /available/);
  assert.match(demo[0].demo!.body, /fictional/);
  // The teaching moment, word for word in spirit: item by item, who opened what and when.
  const shared = CRM_TOUR_BEATS.find(b => b.id === 'person-shared')!;
  assert.match(shared.title, /item by item/);
  assert.match(shared.body, /who opened what and when/);
  assert.match(shared.body, /only points/);
});

test('the staff tour copy matches the screens it points at', () => {
  const today = read('components/org/TodayPage.tsx');
  assert.match(today, /Prep me/);
  assert.match(read('lib/today-view.ts'), /Midnight of the calendar day|sections/);
  const overview = read('components/org/PersonOverview.tsx');
  assert.match(overview, /Progress is private until \$\{first\} turns on sharing/);
  assert.match(read('lib/org-person-view.ts'), /Never shared with staff, by design\. No program can require it\./);
  assert.match(read('components/org/ClientPage.tsx'), /can see that you opened it, and when/);
  const insights = read('components/org/InsightsReport.tsx');
  assert.match(insights, /As the participant recorded it/);
  assert.match(insights, /Each person counted once, at the station they are on/);
  assert.match(insights, /with Steel Man Resumes/);
  assert.match(insights, /Print report/);
});

/* No fetch of shared items */
test('no-fetch rule: tour code never reads a participant\'s shared items, and the player and beats fetch nothing at all', () => {
  for (const f of TOUR_FILES) {
    const src = read(f);
    assert.doesNotMatch(src, /scope=/, `${f} names a shared scope`);
    assert.doesNotMatch(src, /\/api\/org\/clients/, `${f} reaches the participant door`);
    assert.doesNotMatch(src, /window\.print|\.print\(\)/, `${f} prints`);
  }
  for (const f of ['lib/tour/crm-beats.ts', 'lib/tour/staff-tour.ts', 'lib/tour/find-target.ts', 'components/tour/StaffTourPlayer.tsx']) assert.doesNotMatch(read(f), /fetch\(/, `${f} fetches`);
  const urls = [...read('components/tour/StaffTour.tsx').matchAll(/fetch\(\s*[`"']([^`"'?$]+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(urls)].sort(), ['/api/onboarding/tour', '/api/partner/org']);
  // The player never clicks a real control: no .click() and no dispatch into the page.
  const player = read('components/tour/StaffTourPlayer.tsx');
  assert.doesNotMatch(player, /\.click\(\)/);
  assert.doesNotMatch(player, /dispatchEvent/);
});

/* Staff-only entry */
test('staff-only: organization staff in a workspace organization, never under impersonation, never a participant or admin', () => {
  const staff = { tier: 'partner', orgRole: 'staff', crmV2: true, impersonating: null };
  assert.equal(staffTourAllowed(staff), true);
  assert.equal(staffTourAllowed({ ...staff, orgRole: 'owner' }), true);
  assert.equal(staffTourAllowed({ ...staff, crmV2: false }), false, 'older organizations without the workspace');
  assert.equal(staffTourAllowed({ ...staff, orgRole: null }), false);
  assert.equal(staffTourAllowed({ ...staff, tier: 'client' }), false, 'a participant');
  assert.equal(staffTourAllowed({ ...staff, tier: 'admin' }), false, 'a platform admin');
  assert.equal(staffTourAllowed({ ...staff, impersonating: { mode: 'view' } }), false);
  assert.equal(staffTourAllowed({ ...staff, impersonating: { mode: 'assist' } }), false);
  assert.equal(staffTourAllowed(null), false);
  const shell = read('app/(dashboard)/RefineryShell.tsx');
  assert.match(shell, /\{isOrgPartner && effectiveRole\?\.crmV2 && !effectiveRole\.impersonating && \(\s*<Suspense fallback=\{null\}>\s*<StaffTour/);
  const controller = read('components/tour/StaffTour.tsx');
  assert.match(controller, /const allowed = staffTourAllowed\(role\);\n  if \(!allowed \|\| !role\) return null;/);
  assert.match(controller, /if \(slot\.impersonating\) \{ setError\(CRM_TOUR_COPY\.impersonating\); return; \}/);
  assert.match(controller, /tourId: 'crm'/);
  assert.match(controller, /fetch\('\/api\/onboarding\/tour\?tourId=crm'/);
  // Entry points: the URL on Today only, and the Show me around control.
  const q = (v: string | null) => ({ get: () => v });
  assert.equal(staffTourRequested(STAFF_TOUR_HOME, q('crm')), true);
  assert.equal(staffTourRequested('/dashboard/insights', q('crm')), false);
  assert.equal(staffTourRequested(STAFF_TOUR_HOME, q('1')), false, 'tour=1 is the entrance tour');
  assert.equal(staffTourRequested(STAFF_TOUR_HOME, null), false);
  assert.equal(STAFF_TOUR_HOME, '/dashboard/today');
  const today = read('components/org/TodayPage.tsx');
  assert.match(today, /data-tour="crm-tour-start"/);
  assert.match(today, /window\.dispatchEvent\(new Event\(STAFF_TOUR_OPEN_EVENT\)\)/);
  assert.match(controller, /window\.addEventListener\(STAFF_TOUR_OPEN_EVENT, open\)/);
  assert.equal(STAFF_TOUR_OPEN_EVENT, 'staff-tour-open');
  // The entrance tour stays for clients only; the staff tour never uses its slot or its reward.
  assert.match(read('components/GuidedTour.tsx'), /tier === 'client' && !held/);
  assert.doesNotMatch(controller, /tour:complete|TOUR_REWARD|grant/);
});

test('the person comes from the staff member\'s own list: Today\'s first person row, else the caseload read; never invented', () => {
  assert.equal(firstPersonFromCohort({ cohort: { clients: [{ userId: PERSON }, { userId: 'x' }] } }), PERSON);
  assert.equal(firstPersonFromCohort({ cohort: { clients: [{ userId: 'not-a-uuid' }, { userId: PERSON }] } }), PERSON);
  assert.equal(firstPersonFromCohort({ cohort: { clients: [] } }), null);
  for (const bad of [null, {}, { cohort: {} }, { cohort: { clients: 'x' } }, 'x']) assert.equal(firstPersonFromCohort(bad), null);
  assert.equal(personIdFromRow(PERSON), PERSON);
  assert.equal(personIdFromRow('p1'), null);
  assert.equal(personIdFromRow(undefined), null);
  assert.equal(isDemoOrg('Lakeshore Works (Demo)'), true);
  assert.equal(isDemoOrg('Lakeshore Works'), false);
  assert.equal(isDemoOrg(null), false);
  const controller = read('components/tour/StaffTour.tsx');
  assert.match(controller, /personFromToday\(signal\)/);
  assert.match(controller, /applicableBeats\(\{ personId: person, capabilities \}\)/);
  assert.doesNotMatch(controller, /personId: ['"]/, 'no hard-coded person');
});

test('Today draws the tour\'s ids: the header, the reasons, the first row about a person (never a task row) with its id, the tasks rail', async () => {
  const { TodayView } = await import('../../components/org/TodayPage');
  const NOW = new Date(2026, 9, 29, 9, 0, 0).getTime();
  const iso = (days: number) => new Date(NOW + days * 86400000).toISOString();
  const sections = [['tasks', 'Your tasks'], ['interviews', 'Interviews coming up'], ['quiet', 'Gone quiet']].map(([key, label]) => ({ key, label }));
  const data: TodayPayload = {
    sections, hidden: [], canAddTasks: true, reach: { joined: 3, sharing: 2 }, volunteer: false,
    items: [
      { key: 'task:t1', section: 'tasks', clientId: null, clientName: null, taskId: 't1', when: '2026-10-30', reason: 'Order intake folders (due Friday, Oct 30)', action: { label: 'Mark done', href: '#' } },
      { key: 'int:p1:a1', section: 'interviews', clientId: PERSON, clientName: 'Dana Whitfield', when: iso(2), stage: 5, reason: 'Dana is interviewing for Line Cook at Copperline Foods, next date Saturday, Oct 31.', action: { label: 'Help them prepare', href: `/dashboard/clients/${PERSON}` } },
      { key: 'q:p2', section: 'quiet', clientId: '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', clientName: 'Sam Cole', when: iso(-33), stage: 2, reason: 'Sam was last active 33 days ago. Worth asking what is in the way.', action: { label: 'Check in', href: '/dashboard/clients/x' } },
    ],
  };
  const html = renderToStaticMarkup(React.createElement(TodayView, { state: { status: 'ready', data }, nowMs: NOW, troyReady: true }));
  assert.match(html, /<header class="mb-5" data-tour="crm-today-header">/);
  assert.match(html, /data-tour="crm-today-reasons"/);
  assert.match(html, /data-tour="crm-today-tasks"/);
  const rows = [...html.matchAll(/data-tour="crm-today-first-row" data-client-id="([^"]+)"/g)];
  assert.equal(rows.length, 1, 'exactly one first row');
  assert.equal(rows[0][1], PERSON, 'the first row about a person, not the task row above it');
  assert.ok(html.indexOf('Order intake folders') < html.indexOf('crm-today-first-row'), 'the task row comes first and is not the target');
  assert.match(html, /<button type="button" data-tour="crm-tour-start" aria-label="[^"]*two minute tour[^"]*"[^>]*>Show me around<\/button>/);
  // Loading and empty states draw the header (the first stop) but no first row.
  const loading = renderToStaticMarkup(React.createElement(TodayView, { state: { status: 'loading' }, nowMs: NOW }));
  assert.match(loading, /data-tour="crm-today-header"/);
  assert.doesNotMatch(loading, /crm-today-first-row/);
  const tasksOnly = renderToStaticMarkup(React.createElement(TodayView, { state: { status: 'ready', data: { ...data, items: data.items.slice(0, 1) } }, nowMs: NOW }));
  assert.doesNotMatch(tasksOnly, /crm-today-first-row/, 'a task row is never the person stop');
  const off = renderToStaticMarkup(React.createElement(TodayView, { state: { status: 'ready', data }, nowMs: NOW, tourReady: false }));
  assert.doesNotMatch(off, /Show me around/);
});

test('the player: on its page only when pathname and every asked query key match; no fetch; reduced motion stops auto-play', () => {
  assert.equal(onBeatPage('/dashboard/today', '/dashboard/today'), true);
  assert.equal(onBeatPage('/dashboard/today?tour=crm', '/dashboard/today'), true, 'extra keys are fine');
  assert.equal(onBeatPage(`/dashboard/clients/${PERSON}`, `/dashboard/clients/${PERSON}?tab=screen`), false, 'the asked tab is not there yet');
  assert.equal(onBeatPage(`/dashboard/clients/${PERSON}?tab=screen`, `/dashboard/clients/${PERSON}?tab=screen`), true);
  assert.equal(onBeatPage(`/dashboard/clients/${PERSON}?tab=notes`, `/dashboard/clients/${PERSON}?tab=screen`), false);
  assert.equal(onBeatPage('/dashboard/insights', '/dashboard/today'), false);
  const player = read('components/tour/StaffTourPlayer.tsx');
  assert.match(player, /useState\(\(\) => !\(osReduced\(\) \|\| readQuiet\(accountId\)\)\)/, 'auto-play is off under reduced motion');
  assert.match(player, /data-still=\{reduced\}/);
  assert.match(player, /e\.key === 'Escape'|Escape/, 'Escape is named for the leave button');
  assert.match(player, /role="dialog" aria-modal="true"/);
  assert.match(player, /ref=\{setCardEl\}/, 'the card is measured where it mounts');
  assert.match(player, /scrollIntoView\(\{ block: 'center'/);
  const controller = read('components/tour/StaffTour.tsx');
  assert.match(controller, /lockPageForTour\(document\.documentElement, document\.body, document\.querySelector<HTMLElement>\('\.refinery-app'\)\)/, 'inert shell and no page scroll');
  assert.match(controller, /if \(event\.key === 'Escape'\) \{ event\.preventDefault\(\); pause\(\); return; \}/);
  assert.match(controller, /event\.key !== 'Tab'/, 'focus trap');
  assert.match(controller, /save\('progress', canonical\(beatRef\.current\)\)/, 'pause saves the place as a beat id');
  assert.match(controller, /resumeStop\(slot\.stop, list\)/, 'resume by beat id, not by path position');
});

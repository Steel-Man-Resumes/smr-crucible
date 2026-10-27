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
  CRM_EXAMPLE_LABEL, applicableBeats, beatCopy, beatHold, beatHref, onBeatPage, resumeStop, splitHref, stopForBeat,
} from '../tour/crm-beats';
import { SELECTOR_PREFIX, targetSelector } from '../tour/find-target';
import { firstPersonFromCohort, isDemoOrg, personIdFromRow, staffTourAllowed, staffTourRequested, STAFF_TOUR_HOME, STAFF_TOUR_OPEN_EVENT } from '../tour/staff-tour';
import { holdMs, wordCount } from '../tour/timing';
import { handleTourWrite, type TourWriteStore } from '../tour/tour-write';
import { TOUR_VERSION, TOUR_STOP_COUNT } from '../guidedTour';
import { TOUR_REWARD_KEY } from '../tour/reward';
import type { TodayPayload } from '../today-view';

(globalThis as { React?: typeof React }).React = React;
const ROOT = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const STAFF_CAPS = ['org.client.view_content', 'org.note.write', 'org.task.write', 'org.participant.invite', 'org.client.request_sharing'];
const ALL_CAPS = [...STAFF_CAPS, 'org.insights.view', 'org.staff.manage'];
const PERSON = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const TOUR_FILES = ['lib/tour/crm-beats.ts', 'lib/tour/staff-tour.ts', 'lib/tour/find-target.ts', 'components/tour/StaffTourPlayer.tsx', 'components/tour/StaffTour.tsx'];

/* Registry */
test('registry: crm is a tour of its own, reserved reward key, grants nothing, stops match the beats', () => {
  assert.deepEqual([...TOUR_IDS], ['entrance', 'settings', 'crm']);
  assert.ok(isTourId('crm'));
  const crm = TOURS.crm;
  assert.equal(crm.version, 2, 'version 2: a version 1 saved place never resumes into the new stops');
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
  assert.equal((await w({ action: 'progress', sequence: 1, stop: stopForBeat('person-note') })).status, 200);
  const done = await w({ action: 'complete', sequence: 2, stop: CRM_ENDING_INDEX });
  assert.equal(done.status, 200);
  assert.equal(done.json.reward, null);
  assert.equal(calls.grant, 0, 'grants false short-circuits before the store');
  assert.equal((await w({ action: 'progress', sequence: 3, stop: CRM_TOUR_STOP_COUNT })).status, 400, 'stop range is the beats plus the ending');
  assert.equal((await w({ action: 'progress', sequence: 3, stop: 1, version: TOUR_VERSION })).status, 400, 'crm has its own version');
});

/* Beats */
test('beats: unique ids, groups in order, and the staff path is the eight power stops (staff pass S2)', () => {
  assert.equal(new Set(CRM_TOUR_BEATS.map(b => b.id)).size, CRM_TOUR_BEATS.length);
  const order = CRM_TOUR_GROUPS.map(g => g.id);
  let last = 0;
  for (const b of CRM_TOUR_BEATS) { const at = order.indexOf(b.group); assert.ok(at >= last, `${b.id} out of order`); last = at; }
  const staff = applicableBeats({ personId: PERSON, todayRow: true, capabilities: STAFF_CAPS });
  assert.deepEqual(staff.map(b => b.id), ['today-sorted', 'today-prep', 'person-timeline', 'person-note', 'person-tasks', 'referrals', 'people-views', 'ask-troy']);
  const owner = applicableBeats({ personId: PERSON, todayRow: true, capabilities: ALL_CAPS });
  assert.deepEqual(owner.map(b => b.id), ['today-sorted', 'today-prep', 'person-timeline', 'person-note', 'person-tasks', 'referrals', 'people-views', 'owner-insights', 'owner-team', 'ask-troy']);
  assert.equal(CRM_TOUR_BEATS.at(-1)!.id, 'ask-troy', 't.ROY across the whole list is the last word');
  for (const b of CRM_TOUR_BEATS) assert.equal(b.minFound, 1);
  // The old button-pointing stops are gone: the board metaphor and the three privacy stops.
  for (const gone of ['today-start', 'person-board', 'person-never', 'person-shared', 'privacy']) assert.ok(!CRM_TOUR_BEATS.some(b => b.id === gone), gone);
});

test('examples: fixed, labeled, short, about made-up people, and never fetched', () => {
  assert.equal(CRM_EXAMPLE_LABEL, 'Example');
  const withExample = CRM_TOUR_BEATS.filter(b => b.example?.length);
  assert.ok(withExample.length >= 4, 'most power stops show what the tool gives');
  for (const b of withExample) {
    assert.ok(b.example!.length <= 3, `${b.id}: at most three lines`);
    for (const line of b.example!) assert.ok(wordCount(line) <= 16, `${b.id}: "${line}" is short`);
  }
  assert.match(read('components/tour/StaffTourPlayer.tsx'), /<p className="st-example__k">\{CRM_EXAMPLE_LABEL\}<\/p>/, 'the card labels it');
  assert.deepEqual(beatCopy(CRM_TOUR_BEATS.find(b => b.id === 'person-timeline')!, false).example, [], 'no example is an empty list, not undefined');
});

test('every target: a data-tour id first, a fallback that is on the real screen today, and every href is a real route', () => {
  const sources = ['components/org/TodayPage.tsx', 'components/org/PersonOverview.tsx', 'components/org/ClientPage.tsx', 'components/org/InsightsReport.tsx', 'components/org/OrgSidebar.tsx', 'components/org/CaseloadWorkbench.tsx', 'components/org/Referrals.tsx', 'components/org/PersonTimeline.tsx'].map(read).join('\n');
  const navIds = new Set([...read('lib/org-nav.ts').matchAll(/navId: "([a-z-]+)"/g)].map(m => m[1]));
  assert.match(read('components/org/OrgSidebar.tsx'), /data-tour=\{item\.navId \|\| undefined\}/, 'sidebar links carry their nav id as the tour id');
  assert.match(read('components/org/OrgSidebar.tsx'), /data-nav-id=\{item\.navId\} data-tour=\{item\.navId\}/, 'the Ask t.ROY button carries its tour id');
  const onScreen = (id: string) => id.startsWith(SELECTOR_PREFIX) || sources.includes(`data-tour="${id}"`) || sources.includes(`id="${id}"`) || (sources.includes(`"${id}"`) && /data-tour=\{[^}]*"crm-/.test(sources)) || navIds.has(id);
  // Ids another lane adds to its own screen (S2-REPORT.md WIRING NEEDED); each has a fallback that is there today.
  const pending = new Set(['crm-person-timeline-tab', 'crm-person-note-box', 'crm-person-tasks-tab', 'crm-referrals-head', 'crm-people-save-view']);
  for (const b of CRM_TOUR_BEATS) {
    for (const ids of b.targets) {
      assert.ok(!ids[0].startsWith(SELECTOR_PREFIX), `${b.id}: the first id is a data-tour id, not a selector`);
      if (pending.has(ids[0])) assert.ok(ids.slice(1).some(onScreen), `${b.id}: ${ids[0]} is pending and has no fallback on screen`);
      else assert.ok(onScreen(ids[0]), `${b.id}: target ${ids[0]} is on no staff screen`);
    }
    const { pathname } = splitHref(beatHref(b, PERSON));
    const seg = pathname.replace('/dashboard/', '').replace(PERSON, '[id]');
    assert.ok(existsSync(join(ROOT, 'app/(dashboard)/dashboard', seg, 'page.tsx')), `${b.id}: ${pathname} is not a page`);
    if (b.needsPerson && !b.needsTodayRow) assert.ok(b.href.includes(CRM_PERSON_TOKEN), `${b.id} needs a person but names none`);
    else assert.ok(!b.href.includes(CRM_PERSON_TOKEN));
  }
  assert.match(read('components/org/TodayPage.tsx'), /data-tour=\{tourFirst \? "crm-today-first-row" : undefined\} data-client-id=/);
  assert.match(read('components/org/ClientPage.tsx'), /<textarea id="note-body"/, 'the note box fallback');
  assert.match(read('components/org/ClientPage.tsx'), /<input id="task-title"/, 'the task box fallback');
  assert.match(read('components/org/CaseloadWorkbench.tsx'), /<div data-testid="caseload-workbench">\s*<div className="mb-2 flex/, 'the People toolbar fallback');
  assert.match(read('app/(dashboard)/RefineryShell.tsx'), /<main id="main"/, 'the referrals heading fallback lives in #main');
  // Selectors resolve the way the finder builds them.
  assert.equal(targetSelector('note-body'), '[id="note-body"], [data-tour="note-body"]');
  assert.equal(targetSelector('sel:#main h1'), '#main h1');
});

test('the person stops drop out, never invent, when the list is empty; owner stops wait on their capabilities; a module that is off drops its stop', () => {
  const full = applicableBeats({ personId: PERSON, todayRow: true, capabilities: ALL_CAPS });
  assert.ok(full.every(b => !b.noPeopleOnly));
  assert.equal(full.filter(b => b.needsPerson).length, 4);
  assert.equal(full.length, CRM_TOUR_BEATS.length - 1);
  const none = applicableBeats({ personId: null, capabilities: STAFF_CAPS });
  assert.ok(none.every(b => !b.needsPerson));
  assert.deepEqual(none.map(b => b.id), ['today-sorted', 'no-people', 'referrals', 'people-views', 'ask-troy']);
  assert.match(beatCopy(none.find(b => b.id === 'no-people')!, false).body, /wait until someone joins/);
  const cohortOnly = applicableBeats({ personId: PERSON, todayRow: false, capabilities: STAFF_CAPS });
  assert.ok(!cohortOnly.some(b => b.id === 'today-prep'), 'the Prep me stop needs a Today row');
  assert.equal(cohortOnly.filter(b => b.needsPerson).length, 3);
  const volunteer = applicableBeats({ personId: PERSON, todayRow: true, capabilities: ['org.client.view_content'] });
  assert.ok(!volunteer.some(b => b.id === 'person-note' || b.id === 'person-tasks'), 'no stop shows a box the viewer cannot use');
  assert.ok(volunteer.every(b => b.group !== 'owner'));
  const noReferrals = applicableBeats({ personId: PERSON, todayRow: true, capabilities: STAFF_CAPS, modules: { referrals: false } });
  assert.ok(!noReferrals.some(b => b.id === 'referrals'), 'referrals switched off: no stop for it');
  assert.ok(applicableBeats({ personId: PERSON, todayRow: true, capabilities: STAFF_CAPS, modules: null }).some(b => b.id === 'referrals'), 'unknown modules count as on');
  for (const b of CRM_TOUR_BEATS) assert.ok(!(b.needsPerson && b.noPeopleOnly));
});

test('the person page is opened on a named tab, so the staff start-tab setting can never open a shared item for the tour', () => {
  for (const b of CRM_TOUR_BEATS.filter(b => b.needsPerson && !b.needsTodayRow)) {
    const { pathname, search } = splitHref(beatHref(b, PERSON));
    assert.equal(pathname, `/dashboard/clients/${PERSON}`);
    assert.match(search, /^\?tab=(notes|timeline|tasks)$/, `${b.id} names its tab`);
  }
  for (const b of CRM_TOUR_BEATS) assert.doesNotMatch(b.href, /tab=shared/, `${b.id} never opens what they shared`);
  const page = read('components/org/ClientPage.tsx');
  assert.match(page, /if \(startTab\) \{ setTab\(startTab\); setItem\(null\); setShared\(null\); return; \}/, 'a start tab skips initialOpen (no fetch, no saved preference)');
  assert.match(read('app/(dashboard)/dashboard/clients/[id]/page.tsx'), /PERSON_TABS\.some\(\(t\) => t\.key === v\)/, 'the route validates ?tab=');
  for (const tab of ['timeline', 'notes', 'tasks']) assert.match(read('lib/org-person-view.ts') + page, new RegExp(`key: "${tab}"`), `${tab} is a real tab`);
});

/* Resume by beat id */
test('resume: the saved stop is a beat id through the full list, and resumes at that beat or the next one that applies', () => {
  const full = applicableBeats({ personId: PERSON, todayRow: true, capabilities: ALL_CAPS });
  const none = applicableBeats({ personId: null, capabilities: ALL_CAPS });
  const note = stopForBeat('person-note');
  assert.equal(full[resumeStop(note, full)].id, 'person-note');
  // Saved mid-person on a list that is now empty: the next applying beat, not the same position.
  assert.equal(none[resumeStop(note, none)].id, 'no-people');
  assert.equal(none[resumeStop(stopForBeat('no-people'), none)].id, 'no-people');
  assert.equal(full[resumeStop(stopForBeat('no-people'), full)].id, 'referrals', 'a no-people place resumes at the next stop once someone joined');
  const staffOnly = applicableBeats({ personId: PERSON, todayRow: true, capabilities: STAFF_CAPS });
  assert.equal(staffOnly[resumeStop(stopForBeat('owner-insights'), staffOnly)].id, 'ask-troy');
  assert.equal(resumeStop(CRM_ENDING_INDEX, full), full.length, 'the ending');
  assert.equal(resumeStop(999, full), full.length);
  for (const bad of [undefined, null, -1, 1.5]) assert.equal(resumeStop(bad as number, full), 0, String(bad));
  assert.equal(stopForBeat('nope'), CRM_ENDING_INDEX);
  assert.notEqual(none[2].id, CRM_TOUR_BEATS[2].id, 'a position in the resolved path would be wrong');
});

/* Pace */
test('runtime at reading pace, examples included: about a minute and a half for staff, never past two and a half minutes', () => {
  const sum = (beats: readonly (typeof CRM_TOUR_BEATS)[number][], demo: boolean) => beats.reduce((a, b) => a + beatHold(b, demo), 0);
  const staff = applicableBeats({ personId: PERSON, todayRow: true, capabilities: STAFF_CAPS });
  const owner = applicableBeats({ personId: PERSON, todayRow: true, capabilities: ALL_CAPS });
  for (const demo of [false, true]) {
    const ms = sum(staff, demo);
    assert.ok(ms >= 60_000 && ms <= 110_000, `staff path ${demo ? '(demo)' : ''}: ${ms} ms`);
    console.log(`# runtime staff path (${staff.length} stops): ${(ms / 1000).toFixed(1)} s`);
  }
  const o = sum(owner, false);
  assert.ok(o <= 150_000, `owner path: ${o} ms`);
  console.log(`# runtime owner path (${owner.length} stops): ${(o / 1000).toFixed(1)} s`);
  for (const b of CRM_TOUR_BEATS) assert.ok(beatHold(b, false) >= holdMs(beatCopy(b, false)), `${b.id}: the example adds reading time`);
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
  assert.match(CRM_TOUR_ENDING.body, /picks what you see, and sees when you open it/, 'the privacy line lives in the ending now');
  assert.match(CRM_TOUR_ENDING.body, /Help/, 'and it says where to replay it');
});

/* Copy rules and the must-never-claim list */
test('copy: no long dashes, no double-hyphen stand-in, no emojis, t.ROY spelled exactly, Steel Man Resumes', () => {
  for (const f of TOUR_FILES) {
    const src = read(f);
    assert.doesNotMatch(src, /—|–/, `${f} has a long dash`);
    assert.doesNotMatch(src, / -- /, `${f} has a double-hyphen stand-in`);
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, `${f} has an emoji`);
    for (const m of src.matchAll(/(?<![-/])\bt\.?\s?roy\b(?!-)/gi)) assert.equal(m[0], 't.ROY', `${f}: ${m[0]}`); // ids like org-nav-troy and staff-troy are not the name
    assert.doesNotMatch(src, /Steel ?man resumes(?! )|SteelMan|Steel Man Resume\b/);
  }
  const beats = read('lib/tour/crm-beats.ts');
  assert.doesNotMatch(beats, /Five Star/);
});

test('the tour never claims: counts of people helped, "in use" for a demo, compliance words, competitors, labels on the reader', () => {
  const copy = [
    ...CRM_TOUR_BEATS.flatMap(b => [b.title, b.body, b.demo?.title ?? '', b.demo?.body ?? '', ...(b.example ?? [])]),
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
  // No demo variants now: every stop is true for any organization, and examples are labeled made-up.
  assert.deepEqual(CRM_TOUR_BEATS.filter(b => b.demo).map(b => b.id), []);
  // Drafts, never actions: the t.ROY stops say who decides.
  assert.match(CRM_TOUR_BEATS.find(b => b.id === 'ask-troy')!.body, /You decide what is saved or sent/);
  assert.match(CRM_TOUR_BEATS.find(b => b.id === 'person-note')!.body, /You read it and save it/);
  assert.match(CRM_TOUR_BEATS.find(b => b.id === 'person-note')!.body, /first wording is kept/);

});

test('the staff tour copy matches the screens and the code it describes', () => {
  const todayItems = read('../../packages/core/src/orgTodayItems.ts');
  for (const label of ['Interviews coming up', 'Referrals past due', 'Gone quiet', 'They answered you']) assert.match(todayItems, new RegExp(label), label);
  const prep = read('lib/skills/staff-prep-me/SKILL.md');
  for (const part of ['Where they are', 'What is coming', 'What is open', 'Two questions worth asking']) assert.match(prep, new RegExp(part), `Prep me gives: ${part}`);
  const page = read('components/org/ClientPage.tsx');
  assert.match(page, /A shared task shows on THEIR dashboard, and they can tick it/);
  assert.match(read('lib/org-person-view.ts'), /earlier wording is kept/);
  assert.match(read('lib/staff-troy.ts'), /"staff-note-from-bullets"/);
  assert.match(read('lib/staff-troy.ts'), /"Triage my Today"[\s\S]*"Weekly caseload digest"[\s\S]*"Flag stale cases"/);
  assert.match(read('components/org/CaseloadWorkbench.tsx'), /Save view/);
  assert.match(read('components/org/CaseloadWorkbench.tsx'), /My views/);
  assert.match(read('components/org/InsightsReport.tsx'), /Print report/);
  assert.match(read('components/org/Referrals.tsx'), /Referrals/);
  assert.match(read('lib/org-nav.ts'), /label: "My setup"/, 'My setup exists where the stop says');
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
  assert.match(controller, /const todayRow = !!person;/);
  assert.match(controller, /applicableBeats\(\{ personId: person, todayRow, capabilities, modules \}\)/);
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

test('review SF-3: Show me around resumes an open run, and the paused offer is never hidden by a session flag', () => {
  const controller = read('components/tour/StaffTour.tsx');
  assert.match(controller, /const open = \(\) => \{ if \(!active\) void load\('resume'\); \};/);
  assert.doesNotMatch(controller, /sessionStorage|PAUSE_KEY/, 'no session flag around the offer');
  assert.match(controller, /else if \(slot\.inProgress && location\.pathname === STAFF_TOUR_HOME\) setNotice\(CRM_TOUR_COPY\.paused\);/);
  assert.match(controller, /await enter\(slot, mode === 'resume' && !!slot\.inProgress, controller\.signal\)/);
});

test('review SF-4: a change of search the tour did not ask for pauses it; a push that never lands offers Try again', () => {
  const controller = read('components/tour/StaffTour.tsx');
  assert.match(controller, /const locationNow = `\$\{pathname\}\$\{search\?\.toString\(\) \? `\?\$\{search\.toString\(\)\}` : ''\}`;/);
  assert.match(controller, /if \(expectedHref\.current && onBeatPage\(locationNow, expectedHref\.current\)\) \{ expectedHref\.current = null; return; \}\n    pause\(\);/);
  assert.doesNotMatch(controller, /previousRoute|expectedRoute/);
  const player = read('components/tour/StaffTourPlayer.tsx');
  assert.match(player, /const NAV_WAIT_MS = 8000;/);
  assert.match(player, /const timer = setTimeout\(\(\) => setStuck\(true\), NAV_WAIT_MS\);/);
  assert.match(player, /onClick=\{\(\) => setRetry\(n => n \+ 1\)\}/);
  assert.match(player, /\[i, landed, href, retry\]/);
});

test('review SF-1 and SF-5: the drawer reveal is re-asked until the stop is drawn; the phone portrait rule stays in the player', () => {
  const player = read('components/tour/StaffTourPlayer.tsx');
  assert.match(player, /if \(reveal && !lit\) onNavigationReveal\?\.\(true\);/);
  assert.match(player, /if \(portrait && beat\.portraitWithin && els\[0\]\)/);
  for (const b of CRM_TOUR_BEATS.filter(b => b.drawer)) assert.ok(b.targets.flat().every(t => /^org-nav-|^crm-org-mark$/.test(t)), `${b.id} opens the drawer for a sidebar target`);
  assert.match(read('components/org/TodayPage.tsx'), /tourReady=\{!role\?\.impersonating\}/, 'review N-3');
});

test('review SF-8: resuming the same run in this mount keeps its person and path; only a new run reads the person again', () => {
  const src = read('components/tour/StaffTour.tsx');
  assert.match(src, /const same = resume && !!slot\.runId && chosen\.current\?\.runId === slot\.runId \? chosen\.current : null;/);
  assert.match(src, /let person: string \| null = same \? same\.person : await personFromToday\(signal\);/, 'a resume of the same run never re-reads Today');
  assert.match(src, /if \(!same && !person && !signal\.aborted\)/, 'a resume of the same run never re-reads the caseload');
  assert.match(src, /const list = same \? same\.list : applicableBeats\(/, 'the path, and so the stop count, stays the same on resume');
  const remember = src.indexOf('chosen.current = { runId: run.current.id, person, list };');
  const runSet = src.indexOf('run.current = { id: resume && slot.runId');
  assert.ok(runSet > 0 && remember > runSet, 'the choice is remembered under the run id just set');
});

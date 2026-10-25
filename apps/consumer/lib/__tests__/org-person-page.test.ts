/**
 * The participant page for staff (CRM lane C2, 2026-10-25). What it may show,
 * rendered with react-dom/server exactly as staff see it:
 *  - BL1 (B8 review): nothing derived from progress for anyone without
 *    progress sharing; an invited non-sharer shows only what the org typed.
 *  - Opening a shared item is the logged access, and only explicit picks (or
 *    the staff member's own start-tab setting) fetch one.
 *  - The page reads through the same doors as before, and no others.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
// Components compile with the classic JSX transform under tsx; give them React the way Next does.
(globalThis as { React?: typeof React }).React = React;
import {
  NOTE_CARE_LINE, PERSON_TABS, THEIR_SCREEN, initialOpen, noteOwnershipLine, personGlance, personStations, progressVisible, scopeToFetch,
  type PersonView, type ScopeView, type ShareScope,
} from "../org-person-view";
import { STATION_IDS, stationForJourneyStage } from "../refinery-nav";

const ROOT = join(__dirname, "..", "..");
const closed: ScopeView = { shared: false, sharedAt: null, requestPending: false, required: false, stoppedByParticipant: false, fromDate: null };
const open: ScopeView = { ...closed, shared: true, sharedAt: "2026-10-01T12:00:00Z" };
const scopes = (over: Partial<Record<ShareScope, ScopeView>> = {}) => ({ applications: closed, resume: closed, documents: closed, ...over });

const SHARER: PersonView = {
  name: "Dana Reyes", email: "dana@example.test", identitySource: "account", currentStage: 3, scopes: scopes({ applications: open }),
  progress: { nextStepAction: "Tailor your resume to the job", applications: 4, savedJobs: 2, practiceSessions: 1, hasTailoredResume: true, lastActiveAt: "2026-10-20T12:00:00Z" },
};
// What the server sends for these two (orgClientView.getClientHeader): stage and progress are null.
const INVITED: PersonView = { name: "Typed Name", email: "typed@org.test", identitySource: "invite", currentStage: null, scopes: scopes({ resume: { ...closed, requestPending: true } }), progress: null };
const NONE: PersonView = { name: null, email: null, identitySource: "none", currentStage: null, scopes: scopes(), progress: null };
// A defensive case: even if a stage and progress ever arrived for a non-sharer, nothing derived from them is drawn.
const LEAKY: PersonView = { ...INVITED, currentStage: 5, progress: SHARER.progress };

const tile = (html: string, key: string) => html.match(new RegExp(`<li data-tile="${key}">(.*?)</li>`))?.[1] ?? "";

async function render(person: PersonView) {
  const ui = await import("../../components/org/PersonOverview");
  const first = (person.name || "This person").split(" ")[0];
  return renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(ui.PersonHeaderCard, { person, first, joined: "Oct 1, 2026", caseManager: "Sam Case" }),
    React.createElement(ui.StationStrip, { person, first }),
    React.createElement(ui.GlanceRow, { person, openTasks: 2, fmtDay: () => "Oct 20, 2026" }),
    React.createElement(ui.TheirScreenBoard, { person, first, onOpenItem: () => {} }),
    React.createElement(ui.PersonRail, { clientId: "c1", first }),
  ));
}

test("BL1: a sharer's station is lit through stationForJourneyStage and the tiles show their counts", async () => {
  assert.equal(progressVisible(SHARER), true);
  assert.equal(personStations(SHARER).lit, stationForJourneyStage(3));
  assert.equal(personStations(SHARER).lit, "tailor");
  const html = await render(SHARER);
  assert.match(html, /data-station="tailor" data-tone="current" aria-current="step"/);
  assert.match(html, /The next step Dana is being shown: Tailor your resume to the job\./);
  assert.match(tile(html, "applications"), />4</);
  assert.match(tile(html, "active"), /Oct 20, 2026/);
  assert.match(html, /dana@example\.test/);
});

for (const [label, person] of [["invited non-sharer", INVITED], ["joined by code, not sharing", NONE], ["non-sharer with stray progress", LEAKY]] as const) {
  test(`BL1: ${label} gets no lit station, no counts and no last active`, async () => {
    assert.equal(progressVisible(person), false);
    assert.equal(personStations(person).lit, null);
    const html = await render(person);
    assert.doesNotMatch(html, /data-tone="current"/, "no station lit");
    assert.doesNotMatch(html, /aria-current="step"/);
    assert.doesNotMatch(html, /next step .* is being shown/);
    assert.doesNotMatch(html, /\b4 applications\b/);
    assert.match(tile(html, "applications"), /Not shared/);
    assert.match(tile(html, "active"), /Not shared/);
    assert.doesNotMatch(html, /Oct 20, 2026/, "no last-active date");
    const tiles = personGlance(person, 2, () => "x");
    assert.equal(tiles.find((t) => t.key === "active")!.value, "Not shared");
    assert.equal(tiles.find((t) => t.key === "applications")!.value, "Not shared");
    assert.match(html, /Progress is private until/);
    assert.doesNotMatch(html, /Stage \d of 6/);
  });
}

test("BL1: the invited non-sharer shows only the name and email the organization typed", async () => {
  const html = await render(INVITED);
  assert.match(html, /Typed Name/); assert.match(html, /typed@org\.test/);
  assert.match(html, /You see only the name and email your organization entered when it invited them\./);
  const none = await render(NONE);
  assert.match(none, /Name not shared/);
  assert.match(none, /their name and progress are not shown/);
  assert.doesNotMatch(none, /@/, "no email at all");
});

test("org records still show for a non-sharer: open tasks and open asks", () => {
  const t = personGlance(INVITED, 3, () => "x");
  assert.equal(t.find((x) => x.key === "tasks")!.value, "3");
  assert.equal(t.find((x) => x.key === "asks")!.value, "1");
});

test("opening a shared item is the only thing that fetches it", () => {
  const s = scopes({ applications: open, resume: open });
  for (const t of PERSON_TABS) assert.equal(scopeToFetch({ kind: "tab", tab: t.key }, s), null, `tab ${t.key} fetches nothing`);
  assert.equal(scopeToFetch({ kind: "item", scope: "applications" }, s), "applications");
  assert.equal(scopeToFetch({ kind: "item", scope: "documents" }, s), null, "an unshared item shows the ask form, no fetch");
  // On load: only the staff member's own start tab, and only if shared. Same as the eight-tab page.
  assert.equal(scopeToFetch({ kind: "load", pref: "notes", last: null }, s), null);
  assert.equal(scopeToFetch({ kind: "load", pref: "screen", last: null }, s), null);
  assert.equal(scopeToFetch({ kind: "load", pref: "resume", last: null }, s), "resume");
  assert.equal(scopeToFetch({ kind: "load", pref: "documents", last: null }, s), null);
  assert.equal(scopeToFetch({ kind: "load", pref: "last", last: "applications" }, s), "applications");
  assert.equal(scopeToFetch({ kind: "load", pref: "last", last: "shared" }, s), null);
  assert.equal(scopeToFetch({ kind: "load", pref: "last", last: null }, s), null);
  assert.deepEqual(initialOpen("screen", null, s), { tab: "screen", scope: null });
});

test("the page fetches a shared item in exactly one place, after scopeToFetch", () => {
  const src = readFileSync(join(ROOT, "components/org/ClientPage.tsx"), "utf8");
  const hits = src.match(/\?scope=/g) ?? [];
  assert.equal(hits.length, 1, "one ?scope= fetch");
  const at = src.indexOf("?scope=");
  const gate = src.lastIndexOf("scopeToFetch(", at);
  assert.ok(gate > 0 && at - gate < 400, "the fetch sits right after the scopeToFetch decision");
});

test("access does not widen: the page reads through the same doors as before, and no others", () => {
  const files = ["components/org/ClientPage.tsx", "components/org/PersonOverview.tsx"];
  const urls = new Set<string>();
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const m of src.matchAll(/fetch\(\s*[`"']([^`"'?$]+)/g)) urls.add(m[1]);
  }
  assert.deepEqual([...urls].sort(), ["/api/org/clients/", "/api/org/prefs", "/api/org/tasks"].sort());
  assert.doesNotMatch(readFileSync(join(ROOT, "components/org/PersonOverview.tsx"), "utf8"), /fetch\(/, "the overview reads nothing itself");
});

test("Their screen is the board: seven stations, and plan what to say and practice are never shared", async () => {
  assert.deepEqual(THEIR_SCREEN.map((a) => a.station), [...STATION_IDS]);
  const html = await render(SHARER);
  for (const old of ["Job Board and Applications", "Application Tailor", "Interview Prep", "My stuff", "Stage "]) assert.ok(!html.includes(old), `no old name: ${old}`);
  for (const id of ["plan", "practice"]) assert.match(html, new RegExp(`data-station="${id}"[^]*?Never shared with staff, by design`));
  assert.match(html, /Open what Dana shared: Applications/);
  assert.match(html, /Resumes: not shared\. Ask Dana/);
});

test("the note lines, word for word", () => {
  assert.equal(NOTE_CARE_LINE, "Do not record diagnoses, treatment, medication or anything from a court file here.");
  assert.equal(noteOwnershipLine("Dana"), "Notes belong to your organization. They can be corrected, and earlier wording is kept. They cannot be deleted. Never visible to Dana.");
  const src = readFileSync(join(ROOT, "components/org/ClientPage.tsx"), "utf8");
  assert.match(src, /\{NOTE_CARE_LINE\}/); assert.match(src, /noteOwnershipLine\(first\)/);
  assert.doesNotMatch(src, /\$ |"\$"/, "no terminal prompt in the note box");
  // The shared-item honesty line stays word for word.
  assert.match(src, /can see that you opened it, and when\. You can read it\. You cannot change it\./);
});

test("the rail opens staff t.ROY for this person and says it only drafts", async () => {
  const html = await render(SHARER);
  for (const k of ["staff-prep-me", "staff-check-in"]) assert.match(html, new RegExp(`data-skill="${k}"`));
  assert.match(html, /t\.ROY drafts\. You decide\. Nothing is saved or sent until you do it\./);
});

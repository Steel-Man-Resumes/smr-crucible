/**
 * Walkthrough W11 (2026-10-27): a participant turns off resume sharing while a
 * case manager has their page open. The next read was correctly refused
 * ({ shared: false, rows: [] }), but the page kept saying "Shared" and
 * "Shared, and there is nothing here yet." The server's answer now wins.
 * Access control is unchanged: these tests also prove the view can only turn
 * sharing OFF, and that a stopped scope is never fetched again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as { React?: typeof React }).React = React;
import { scopeToFetch, scopesAfterRead, stoppedSharingLine, type PersonView, type ScopeView, type ShareScope } from "../org-person-view";

const ROOT = join(__dirname, "..", "..");
const closed: ScopeView = { shared: false, sharedAt: null, requestPending: false, required: false, stoppedByParticipant: false, fromDate: null };
const open: ScopeView = { ...closed, shared: true, sharedAt: "2026-10-27T12:00:00Z", fromDate: "2026-10-01T00:00:00Z" };
const scopes = (over: Partial<Record<ShareScope, ScopeView>> = {}) => ({ applications: open, resume: open, documents: closed, ...over });

test("W11: a refused read turns that scope off in the view, and nothing else", () => {
  const before = scopes();
  const { scopes: after, stopped } = scopesAfterRead(before, "resume", false);
  assert.equal(stopped, true);
  assert.deepEqual(after.resume, { ...closed });
  assert.equal(after.applications, before.applications, "other scopes untouched");
  assert.equal(before.resume.shared, true, "the old state is not mutated");
});

test("W11: a stopped scope is not fetched again (the access check still blocks)", () => {
  const { scopes: after } = scopesAfterRead(scopes(), "resume", false);
  assert.equal(scopeToFetch({ kind: "item", scope: "resume" }, after), null);
  assert.equal(scopeToFetch({ kind: "load", pref: "resume", last: null }, after), null);
  assert.equal(scopeToFetch({ kind: "item", scope: "applications" }, after), "applications");
});

test("W11: a read can never turn sharing ON in the view", () => {
  const before = scopes();
  for (const answer of [true, undefined, null, "false", 0]) {
    const r = scopesAfterRead(before, "documents", answer);
    assert.equal(r.stopped, false); assert.equal(r.scopes, before); assert.equal(r.scopes.documents.shared, false);
  }
  const ok = scopesAfterRead(before, "resume", true);
  assert.equal(ok.stopped, false); assert.equal(ok.scopes, before, "a shared read changes nothing");
  // Already not shared: a refused read is not news.
  assert.equal(scopesAfterRead(before, "documents", false).stopped, false);
});

test("W11: a required item that was stopped reads as stopped by them", () => {
  const before = scopes({ resume: { ...open, required: true } });
  const { scopes: after } = scopesAfterRead(before, "resume", false);
  assert.equal(after.resume.shared, false);
  assert.equal(after.resume.required, true);
  assert.equal(after.resume.stoppedByParticipant, true);
});

test("W11: the line, word for word", () => {
  assert.equal(stoppedSharingLine("Marqus", "resume"), "Not shared. Marqus turned off sharing for resumes.");
  assert.equal(stoppedSharingLine("this person", "documents"), "Not shared. This person turned off sharing for cover letters.");
  assert.doesNotMatch(stoppedSharingLine("Marqus", "applications"), /—|--/);
});

test("W11: the Resumes tab renders the not-shared state, not 'Shared, and there is nothing here yet'", async () => {
  const { SharedTab } = await import("../../components/org/ClientPage");
  const person: PersonView = { name: "Marqus Relly", email: null, identitySource: "account", currentStage: 1, scopes: scopesAfterRead(scopes(), "resume", false).scopes, progress: null };
  const html = renderToStaticMarkup(React.createElement(SharedTab, {
    client: person as never, clientId: "c1", first: "Marqus", item: "resume", rows: [], loading: false, stopped: true,
    viewer: { canRequest: true, canSuggest: false }, suggestions: [], onPick: () => {}, onChange: () => {},
  }));
  assert.match(html, /Not shared\. Marqus turned off sharing for resumes\./);
  assert.match(html, /Marqus has not shared this with you/);
  assert.match(html, /Resumes <span[^>]*>· Not shared<\/span>/);
  assert.doesNotMatch(html, /Shared, and there is nothing here yet/);
  assert.doesNotMatch(html, /chose to share this with your organization/);
  // Without the flag (a fresh page load), the plain not-shared state shows, as before.
  const fresh = renderToStaticMarkup(React.createElement(SharedTab, {
    client: person as never, clientId: "c1", first: "Marqus", item: "resume", rows: null, loading: false,
    viewer: { canRequest: true, canSuggest: false }, suggestions: [], onPick: () => {}, onChange: () => {},
  }));
  assert.doesNotMatch(fresh, /turned off sharing/);
  assert.match(fresh, /Marqus has not shared this with you/);
});

test("W11: the page applies the server's answer right after the one shared read", () => {
  const src = readFileSync(join(ROOT, "components/org/ClientPage.tsx"), "utf8");
  const at = src.indexOf("?scope=");
  const apply = src.indexOf("scopesAfterRead(", at);
  assert.ok(apply > at && apply - at < 700, "scopesAfterRead follows the ?scope= read");
});

test("W11: 'stopped' is shown only when a fresh header also says not shared (review should-fix)", () => {
  const src = readFileSync(join(ROOT, "components/org/ClientPage.tsx"), "utf8");
  const at = src.indexOf("scopesAfterRead(client.scopes");
  const block = src.slice(at, at + 900);
  const reread = block.indexOf("fetch(`/api/org/clients/${clientId}`)");
  const guard = block.indexOf("!fresh.client.scopes?.[scope]?.shared");
  const mark = block.indexOf("setStoppedNow(");
  assert.ok(reread > 0 && guard > reread && mark > guard, "re-read, then check, then mark stopped");
});

/**
 * Staff directory contributions, the pure half (lane S6, migration 112).
 * The SQL half is proven in staff-rewards-pglite.test.ts and the isolation suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONTRIBUTION_CREDIT, DOCUMENTED_METHODS, FLOW_LABELS, METHOD_LABELS, OUTCOMES_FOR_FLOW, STATUS_WORDS,
  contributionFreeText, intakePayload, normalizeContribution,
} from "../directoryContributionShared";
import {
  submitContribution, listMyContributions, withdrawContribution, claimListingNudge, approvedInWindow, decideContribution, applyContributionCall,
} from "../directoryContribution";
import type { OrgActor } from "../authz/resolveOrgActor";

const MIG = readFileSync(new URL("../../migrations/112_directory_contributions.sql", import.meta.url), "utf8");
const TODAY = "2026-10-27";
const ID = "00000000-0000-4000-8000-000000000042";

test("a new place needs a name and a state, and no listing", () => {
  assert.equal(normalizeContribution({ flow: "new_place", targetKind: "employer", details: { name: "Harbor Freight Lines (Demo)" } }, TODAY).ok, false);
  const ok = normalizeContribution({ flow: "new_place", targetKind: "resource", details: { name: " Weekly  pantry ", state: "mi", junk: "x" } }, TODAY);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.value.details, { name: "Weekly pantry", state: "MI" }, "unknown fields dropped, state upper-cased");
    assert.equal(ok.value.creditOrgOk, true, "credit to the program by default");
    assert.equal(ok.value.creditPersonOk, false, "never a person's name unless they opt in");
  }
  assert.equal(normalizeContribution({ flow: "new_place", targetKind: "employer", targetId: ID, details: { name: "X", state: "MI" } }, TODAY).ok, false);
});

test("a call needs the listing, a date in the last 30 days, a documented method, and what they said", () => {
  const base = { flow: "called_today", targetKind: "resource", targetId: ID, details: { said: "Still open Tuesdays" }, interactionOn: TODAY, interactionMethod: "phone_call" };
  assert.ok(normalizeContribution(base, TODAY).ok);
  assert.equal(normalizeContribution({ ...base, interactionMethod: "heard_from_someone" }, TODAY).ok, false, "hearsay is not a call");
  assert.equal(normalizeContribution({ ...base, interactionMethod: "website" }, TODAY).ok, false, "a website is not a call");
  assert.equal(normalizeContribution({ ...base, interactionOn: null }, TODAY).ok, false);
  assert.equal(normalizeContribution({ ...base, interactionOn: "2026-09-20" }, TODAY).ok, false, "older than 30 days");
  assert.equal(normalizeContribution({ ...base, interactionOn: "2026-10-28" }, TODAY).ok, false, "not in the future");
  assert.equal(normalizeContribution({ ...base, details: {} }, TODAY).ok, false);
  assert.equal(normalizeContribution({ ...base, targetId: null }, TODAY).ok, false);
  assert.ok(normalizeContribution({ ...base, interactionMethod: "site_visit" }, TODAY).ok, "a visit counts");
});

test("knowing someone is for employers, and who stays in the private note", () => {
  assert.equal(normalizeContribution({ flow: "knows_someone", targetKind: "resource", targetId: ID, privateNote: "My cousin" }, TODAY).ok, false);
  assert.equal(normalizeContribution({ flow: "knows_someone", targetKind: "employer", targetId: ID }, TODAY).ok, false);
  const ok = normalizeContribution({ flow: "knows_someone", targetKind: "employer", details: { name: "Lakeshore Foods (Demo)" }, privateNote: "My cousin runs the dock" }, TODAY);
  assert.ok(ok.ok);
  if (ok.ok) {
    const p = intakePayload(ok.value);
    assert.equal(p.private_note, "My cousin runs the dock");
    assert.ok(!contributionFreeText(ok.value).some((t) => t.includes("cousin")), "the private note is not sent anywhere else");
  }
});

test("a correction needs the listing and the change; bad links and states are refused", () => {
  assert.equal(normalizeContribution({ flow: "correction", targetKind: "employer", targetId: ID }, TODAY).ok, false);
  assert.ok(normalizeContribution({ flow: "correction", targetKind: "employer", targetId: ID, details: { change: "Moved to Pine St" } }, TODAY).ok);
  assert.equal(normalizeContribution({ flow: "correction", targetKind: "employer", targetId: "nope", details: { change: "x" } }, TODAY).ok, false);
  assert.equal(normalizeContribution({ flow: "correction", targetKind: "employer", targetId: ID, details: { change: "x", website: "example.org" } }, TODAY).ok, false);
  assert.equal(normalizeContribution({ flow: "correction", targetKind: "employer", targetId: ID, details: { change: "x" }, sourceUrl: "javascript:alert(1)" }, TODAY).ok, false);
  assert.equal(normalizeContribution({ flow: "new_place", targetKind: "employer", details: { name: "X", state: "Michigan" } }, TODAY).ok, false);
  assert.equal(normalizeContribution(null, TODAY).ok, false);
  assert.equal(normalizeContribution({ flow: "publish_now", targetKind: "employer" }, TODAY).ok, false);
});

test("the app's rules and weights are the 112 migration's", () => {
  for (const m of DOCUMENTED_METHODS) assert.ok(MIG.includes(`'${m}'`), m);
  assert.ok(!DOCUMENTED_METHODS.includes("heard_from_someone") && !DOCUMENTED_METHODS.includes("website"));
  assert.match(MIG, /WHEN 'verified_call' THEN 3 WHEN 'warm_intro' THEN 3 WHEN 'correction' THEN 2 WHEN 'new_row' THEN 1/);
  assert.deepEqual(CONTRIBUTION_CREDIT, { verified_call: 3, warm_intro: 3, correction: 2, new_row: 1 });
  assert.deepEqual(OUTCOMES_FOR_FLOW.called_today, ["verified_call", "correction"]);
  assert.match(MIG, /outcome = 'correction' AND flow IN \('correction', 'called_today'\)/);
  assert.match(MIG, /recheck_on = COALESCE\(c\.interaction_on, current_date\) \+ 365/, "a yearly re-check, the 211 standard");
  // No publication view or contract is touched: credit is recorded, not shown (decision 5).
  assert.ok(!/CREATE (OR REPLACE )?VIEW/i.test(MIG));
  assert.ok(!/employer_publication_rows|resource_publication_v/.test(MIG));
});

test("words: no dashes as punctuation, warm and plain", () => {
  const all = [...Object.values(FLOW_LABELS).flatMap((f) => [f.title, f.help, f.button]), ...Object.values(METHOD_LABELS), ...Object.values(STATUS_WORDS)].join("\n");
  assert.ok(!/[–—]/.test(all));
  assert.ok(!/ -- /.test(all));
});

test("approvedInWindow counts only my approvals in the window", () => {
  const row = (over: Record<string, unknown>) => ({ id: "x", flow: "correction", targetKind: "employer", targetId: ID, name: null, status: "approved", outcome: "correction",
    ownerAnswer: null, interactionOn: null, createdAt: "2026-10-01", decidedAt: "2026-10-05T00:00:00Z", recheckOn: null, mine: true, submitterFirstName: null, ...over }) as never;
  const from = Date.parse("2026-10-01T00:00:00Z"), to = Date.parse("2026-11-01T00:00:00Z");
  assert.equal(approvedInWindow([row({}), row({ mine: false }), row({ status: "received", decidedAt: null }), row({ decidedAt: "2026-09-30T00:00:00Z" })], from, to), 1);
});

const viewing: OrgActor = {
  userId: "00000000-0000-4000-8000-000000000001", orgId: "00000000-0000-4000-8000-000000000002", orgName: "Lakeshore Works (Demo)",
  role: "staff", capabilities: new Set(), reach: "assigned", viaPlatformAdmin: true,
};

test("a viewing platform admin submits, reads and claims nothing; bad input never reaches the database", async () => {
  assert.equal((await submitContribution(viewing, { flow: "new_place", targetKind: "employer", details: { name: "X", state: "MI" } }, TODAY)).ok, false);
  assert.deepEqual(await listMyContributions(viewing), []);
  assert.equal(await withdrawContribution(viewing, ID), false);
  assert.equal(await claimListingNudge(viewing, "resource", ID), false);
  const staff = { ...viewing, viaPlatformAdmin: false };
  const bad = await submitContribution(staff, { flow: "called_today", targetKind: "employer", targetId: ID, details: { said: "yes" }, interactionOn: TODAY, interactionMethod: "heard_from_someone" }, TODAY);
  assert.ok(!bad.ok && /how you reached them/.test(bad.reason));
  assert.equal(await claimListingNudge(staff, "resource", "nope"), false);
  assert.equal(await withdrawContribution(staff, "nope"), false);
  assert.equal((await decideContribution(ID, "nope", "approved", "verified_call", null)).ok, false);
  assert.equal((await decideContribution(ID, ID, "approved", null, null)).ok, false, "an approval says what it turned out to be");
  assert.equal((await applyContributionCall(ID, ID, "nope", null)).ok, false);
});
